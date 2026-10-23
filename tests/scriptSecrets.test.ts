import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findScriptSecrets, scrubScript } from '../src/lib/scriptSecrets'
import { parseCollection } from '../src/lib/parser'
import { runAudit } from '../src/lib/auditor'
import { redactCollection } from '../src/lib/redaction'
import { FAKE } from './fixtures'

const labels = (source: string) => findScriptSecrets(source).map((secret) => [secret.label, secret.value])

test('detects literals added with pm.request.headers.add and upsert', () => {
  assert.deepEqual(labels(`pm.request.headers.add({ key: 'Authorization', value: 'Bearer ${FAKE.bearer}' })`), [['header Authorization', FAKE.bearer]])
  assert.deepEqual(labels(`pm.request.headers.upsert({\n  value: '${FAKE.apiKey}',\n  key: 'X-API-Key'\n})`), [['X-API-Key', FAKE.apiKey]])
  assert.deepEqual(labels(`pm.request.headers.add('Authorization: Basic ${FAKE.bearer}')`), [['header Authorization', FAKE.bearer]])
  assert.deepEqual(labels(`pm.request.headers.add({ key: 'Cookie', value: 'theme=dark; session_id=${FAKE.refreshToken}' })`), [['header Cookie', FAKE.refreshToken]])
})

test('detects Authorization literals in pm.sendRequest headers and object properties', () => {
  const objectForm = `pm.sendRequest({ url: 'https://x.test', method: 'GET', header: { 'Authorization': 'Bearer ${FAKE.bearer}', Accept: 'application/json' } })`
  assert.deepEqual(labels(objectForm), [['header Authorization', FAKE.bearer]])
  const arrayForm = `pm.sendRequest({ url: 'https://x.test', header: [{ key: 'Authorization', value: 'Bearer ${FAKE.bearer}' }, { key: 'Accept', value: 'application/json' }] })`
  assert.deepEqual(labels(arrayForm), [['header Authorization', FAKE.bearer]])
  assert.deepEqual(labels(`const authorization = 'Bearer ${FAKE.bearer}'`), [['header authorization', FAKE.bearer]])
})

test('detects bearer literals in pm.request.auth and encoded basic credentials', () => {
  assert.deepEqual(labels(`pm.request.auth = { type: 'bearer', bearer: [{ key: 'token', value: '${FAKE.bearer}', type: 'string' }] }`), [['token', FAKE.bearer]])
  assert.deepEqual(labels(`const header = 'Basic ' + btoa('svc-account:${FAKE.password}')`), [['btoa credentials', FAKE.password]])
  assert.deepEqual(labels(`Buffer.from('svc-account:${FAKE.password}').toString('base64')`), [['btoa credentials', FAKE.password]])
})

test('variables, dynamic values and plain literals produce nothing', () => {
  for (const source of [
    "pm.request.headers.add({ key: 'Authorization', value: 'Bearer ' + pm.environment.get('token') })",
    "pm.request.headers.add({ key: 'Authorization', value: `Bearer ${pm.environment.get('token')}` })",
    "pm.request.headers.upsert({ key: 'Authorization', value: 'Bearer {{token}}' })",
    "pm.request.headers.add('Authorization: Bearer {{token}}')",
    "pm.sendRequest({ header: { Authorization: 'Bearer ' + pm.collectionVariables.get('t'), Accept: 'application/json' } })",
    "pm.request.headers.add({ key: 'Content-Type', value: 'application/json' })",
    "pm.request.auth = { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}' }] }",
    "const label = btoa('hh:mm:ss')",
    "const x = Buffer.from('a:b').toString('hex')",
    "const authorization = 'required'",
    "const token = pm.environment.get('token')",
    "pm.environment.set('token', pm.response.json().access_token)",
  ]) {
    assert.deepEqual(labels(source), [], source)
  }
})

test('scrubbing replaces only the literal and keeps the scheme and structure', () => {
  const source = `pm.request.headers.add({\n  key: 'Authorization',\n  value: 'Bearer ${FAKE.bearer}'\n})\npm.environment.set('accessToken', '${FAKE.refreshToken}')`
  const result = scrubScript(source, '{{REDACTED}}')
  assert.equal(result.count, 2)
  assert.equal(result.text, "pm.request.headers.add({\n  key: 'Authorization',\n  value: 'Bearer {{REDACTED}}'\n})\npm.environment.set('accessToken', '{{REDACTED}}')")
  assert.equal(scrubScript(result.text, '{{REDACTED}}').count, 0)
})

test('auditor reports script header literals and the sanitized copy removes them', () => {
  const json = {
    info: { name: 'Scripts' },
    event: [{ listen: 'prerequest', script: { exec: [`pm.request.headers.add({ key: 'Authorization', value: 'Bearer ${FAKE.bearer}' })`] } }],
    item: [
      {
        name: 'R',
        event: [
          {
            listen: 'prerequest',
            script: { exec: ['pm.sendRequest({', '  url: "https://x.test/login",', `  header: { Authorization: 'Bearer ${FAKE.jwt}' },`, `  body: { password: '${FAKE.password}' }`, '})'] },
          },
        ],
        request: { method: 'GET', url: '{{baseUrl}}/x', auth: { type: 'noauth' }, description: 'd' },
      },
    ],
  }
  const findings = runAudit(parseCollection(json))
  const locations = findings.find((finding) => finding.ruleId === 'SECRET_IN_SCRIPT')?.evidence?.map((item) => item.location) ?? []
  assert.ok(locations.includes('collection pre-request script: header Authorization'))
  assert.ok(locations.includes('pre-request script: header Authorization'))
  assert.ok(locations.includes('pre-request script: password'))

  const { json: sanitized, redactedCount } = redactCollection(json)
  assert.ok(redactedCount >= 3)
  const serialized = JSON.stringify(sanitized)
  for (const secret of [FAKE.bearer, FAKE.jwt, FAKE.password]) assert.ok(!serialized.includes(secret))
  const exec = (sanitized as { item: Array<{ event: Array<{ script: { exec: string[] } }> }> }).item[0].event[0].script.exec
  assert.equal(exec.length, 5)
  assert.equal(exec[2], "  header: { Authorization: 'Bearer {{REDACTED}}' },")
  assert.deepEqual(runAudit(parseCollection(sanitized)).filter((finding) => finding.ruleId === 'SECRET_IN_SCRIPT'), [])
})
