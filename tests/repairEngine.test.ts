import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCollection } from '../src/lib/parser'
import { runAudit } from '../src/lib/auditor'
import { applyRepairPlan, createRepairPlan, getItemAtPath } from '../src/lib/repairEngine'
import type { PostmanCollection } from '../src/types/postman'
import { FAKE, kitchenSinkCollection } from './fixtures'

function analyze(json: unknown) {
  const parsed = parseCollection(json)
  const findings = runAudit(parsed)
  return { parsed, findings, plan: createRepairPlan(json, parsed, findings) }
}

test('plans fixes by rule id with sensible defaults', () => {
  const { plan } = analyze(kitchenSinkCollection())
  const kinds = new Map(plan.fixes.map((fix) => [fix.kind, fix]))
  for (const kind of ['authHelperSecrets', 'bodySecrets', 'querySecrets', 'secretVariables', 'hardcodedApiKey', 'basicAuthCredentials']) {
    assert.equal(kinds.get(kind as never)?.status, 'auto', kind)
  }
  assert.equal(kinds.get('insecureHttp')?.risk, 'high')
  assert.equal(kinds.get('insecureHttp')?.selectedByDefault, false)
  assert.equal(kinds.get('tlsVerification')?.selectedByDefault, false)
  assert.ok(plan.fixes.some((fix) => fix.status === 'manual'))
})

test('applying the default plan removes the targeted secrets and keeps the collection valid', () => {
  const original = kitchenSinkCollection()
  const { plan } = analyze(original)
  const { fixedJson, applied } = applyRepairPlan(original, plan.defaultSelectedFixIds, plan)
  assert.ok(applied.length > 0)

  const after = runAudit(parseCollection(fixedJson))
  const remaining = new Set(after.map((finding) => finding.ruleId))
  for (const ruleId of ['HARDCODED_AUTH_CREDENTIAL', 'SECRET_IN_QUERY', 'SECRET_IN_COLLECTION_VARIABLE', 'HARDCODED_API_KEY', 'BASIC_AUTH_PLAINTEXT']) {
    assert.ok(!remaining.has(ruleId as never), `${ruleId} should be fixed`)
  }

  const serialized = JSON.stringify(fixedJson)
  for (const secret of [FAKE.bearer, FAKE.apiKey, FAKE.clientSecret]) assert.ok(!serialized.includes(secret))
  assert.deepEqual(kitchenSinkCollection(), original, 'input must not be mutated')
})

test('inherited basic auth is patched once at the owning folder', () => {
  const original = kitchenSinkCollection()
  const { plan } = analyze(original)
  const fix = plan.fixes.find((candidate) => candidate.kind === 'basicAuthCredentials')!
  const { fixedJson } = applyRepairPlan(original, [fix.id], plan)
  const folder = getItemAtPath(fixedJson, [0])!
  assert.deepEqual(folder.auth?.basic, [
    { key: 'username', value: '{{username}}' },
    { key: 'password', value: '{{password}}' },
  ])
})

test('body secrets keep JSON formatting and become variables', () => {
  const original = kitchenSinkCollection()
  const { plan } = analyze(original)
  const fix = plan.fixes.find((candidate) => candidate.kind === 'bodySecrets' && candidate.bodyRule === 'HARDCODED_PASSWORD')!
  const { fixedJson } = applyRepairPlan(original, [fix.id], plan)
  const login = getItemAtPath(fixedJson, [0, 0])!
  assert.equal(login.request?.body?.raw, JSON.stringify({ username: 'admin', password: '{{password}}' }, null, 2))
  assert.ok((fixedJson as PostmanCollection).variable?.some((variable) => variable.key === 'password'))
})

test('query secrets are replaced in both raw URL and query array', () => {
  const original = kitchenSinkCollection()
  const { plan } = analyze(original)
  const fix = plan.fixes.find((candidate) => candidate.kind === 'querySecrets')!
  const { fixedJson } = applyRepairPlan(original, [fix.id], plan)
  const url = getItemAtPath(fixedJson, [1, 0])!.request!.url as { raw: string; query: Array<{ key: string; value: string }> }
  assert.match(url.raw, /api_key=\{\{api_key\}\}&page=2&pageToken=abcdefghijklmnop/)
  assert.equal(url.query[0].value, '{{api_key}}')
  assert.equal(url.query[2].value, 'abcdefghijklmnop')
})

test('HTTPS upgrade rewrites a leading baseUrl variable once', () => {
  const original = kitchenSinkCollection()
  const { plan } = analyze(original)
  const fix = plan.fixes.find((candidate) => candidate.kind === 'insecureHttp')!
  const { fixedJson } = applyRepairPlan(original, [fix.id], plan)
  const baseUrl = (fixedJson as PostmanCollection).variable?.find((variable) => variable.key === 'baseUrl')
  assert.equal(baseUrl?.value, 'https://api.corp.internal')
  assert.ok(!runAudit(parseCollection(fixedJson)).some((finding) => finding.ruleId === 'INSECURE_HTTP'))
})

test('TLS fix removes strictSSL: false from the collection', () => {
  const original = kitchenSinkCollection()
  const { plan } = analyze(original)
  const fix = plan.fixes.find((candidate) => candidate.kind === 'tlsVerification')!
  const { fixedJson } = applyRepairPlan(original, [fix.id], plan)
  assert.equal((fixedJson as PostmanCollection).protocolProfileBehavior?.strictSSL, undefined)
})

test('manual fixes are reported as skipped when selected', () => {
  const original = kitchenSinkCollection()
  const { plan } = analyze(original)
  const manual = plan.fixes.find((fix) => fix.status === 'manual')!
  const { skipped, applied } = applyRepairPlan(original, [manual.id], plan)
  assert.equal(applied.length, 0)
  assert.match(skipped[0].reason, /Manual-review/)
})

test('repair patches secrets in disabled headers, query params and form fields', () => {
  const original = {
    info: { name: 'Disabled' },
    variable: [{ key: 'baseUrl', value: 'https://x.test' }],
    item: [
      {
        name: 'R',
        request: {
          method: 'POST',
          auth: { type: 'noauth' },
          description: 'd',
          header: [{ key: 'Authorization', value: `Bearer ${FAKE.bearer}`, disabled: true }],
          url: { raw: '{{baseUrl}}/p', host: ['{{baseUrl}}'], path: ['p'], query: [{ key: 'api_key', value: FAKE.apiKey, disabled: true }] },
          body: { mode: 'urlencoded', urlencoded: [{ key: 'password', value: FAKE.password, disabled: true }] },
        },
      },
    ],
  }
  const { plan } = analyze(original)
  const { fixedJson } = applyRepairPlan(original, plan.defaultSelectedFixIds, plan)
  const serialized = JSON.stringify(fixedJson)
  for (const secret of [FAKE.bearer, FAKE.apiKey, FAKE.password]) assert.ok(!serialized.includes(secret))
  const request = (fixedJson as { item: Array<{ request: { header: Array<{ disabled?: boolean; value: string }> } }> }).item[0].request
  assert.equal(request.header[0].disabled, true)
  assert.equal(request.header[0].value, 'Bearer {{token}}')
  assert.deepEqual(runAudit(parseCollection(fixedJson)).filter((finding) => finding.category === 'secrets'), [])
})
