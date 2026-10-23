import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findDescriptionSecrets, scrubDescription } from '../src/lib/descriptions'
import { parseCollection } from '../src/lib/parser'
import { runAudit, type Finding } from '../src/lib/auditor'
import { redactCollection } from '../src/lib/redaction'
import { applyRepairPlan, createRepairPlan } from '../src/lib/repairEngine'
import { FAKE, scopedSecretsCollection } from './fixtures'

function evidence(findings: Finding[], ruleId: string): string[] {
  return (findings.find((finding) => finding.ruleId === ruleId)?.evidence ?? []).map((item) => item.location)
}

test('finds provider tokens and credential fragments in documentation but ignores prose', () => {
  const text = `Use password: ${FAKE.password} and client_secret=${FAKE.clientSecret}\nAuthorization: Bearer ${FAKE.bearer}\nGitHub ${FAKE.githubToken}\nThe token: required. api_key=your-api-key. password: {{pw}}. secret: optional`
  const labels = findDescriptionSecrets(text).map((secret) => [secret.kind, secret.label])
  assert.deepEqual(labels, [
    ['fragment', 'password'],
    ['fragment', 'client_secret'],
    ['fragment', 'Authorization'],
    ['pattern', 'GitHub token'],
  ])
})

test('scrubbing replaces only the values, keeps the prose and handles very large text', () => {
  const text = `Use password: ${FAKE.password} then continue`
  assert.deepEqual(scrubDescription(text, '{{REDACTED}}'), { text: 'Use password: {{REDACTED}} then continue', count: 1 })
  const big = `${'lorem ipsum '.repeat(10_000)}\npassword: ${FAKE.password}\n${'dolor '.repeat(5_000)}`
  const scrubbed = scrubDescription(big, '{{REDACTED}}')
  assert.equal(scrubbed.count, 1)
  assert.ok(!scrubbed.text.includes(FAKE.password))
  assert.equal(scrubbed.text.length, big.length - FAKE.password.length + '{{REDACTED}}'.length)
})

test('parser reads descriptions, scoped variables, path variables and saved request bodies', () => {
  const parsed = parseCollection(scopedSecretsCollection())
  assert.deepEqual(parsed.descriptions?.map((entry) => [entry.kind, entry.owner]), [
    ['collection', 'collection'],
    ['folder', 'Admin'],
    ['request', 'Admin/Get user'],
    ['request', 'Admin/Get user'],
  ])
  assert.deepEqual(parsed.scopedVariables?.map((entry) => [entry.scope, entry.owner, entry.key]), [
    ['folder', 'Admin', 'clientSecret'],
    ['folder', 'Admin', 'region'],
    ['request', 'Admin/Get user', 'apiKey'],
  ])
  const request = parsed.requests[0]
  assert.deepEqual(request.pathVariables?.map((entry) => entry.key), ['token', 'id'])
  assert.match(request.savedResponses?.[0].requestBody ?? '', /"password"/)
  assert.deepEqual(request.savedResponses?.[0].requestQuery, [{ key: 'api_key', value: FAKE.apiKey }])
})

test('auditor flags secrets in descriptions, scoped variables, path variables and saved request bodies', () => {
  const findings = runAudit(parseCollection(scopedSecretsCollection()))
  assert.deepEqual(evidence(findings, 'KNOWN_SECRET_PATTERN'), ['description (collection) (GitHub token)'])
  assert.deepEqual(evidence(findings, 'HARDCODED_SECRET'), ['description (folder "Admin"): password', 'description (folder "Admin"): Authorization'])
  assert.deepEqual(evidence(findings, 'SECRET_IN_COLLECTION_VARIABLE'), ['folder variable clientSecret (folder "Admin")', 'request variable apiKey'])
  assert.ok(evidence(findings, 'SECRET_IN_QUERY').includes('path variable token'))
  const saved = evidence(findings, 'SECRET_IN_SAVED_RESPONSE')
  assert.ok(saved.includes('saved response "Example" original request body password'))
  assert.ok(saved.includes('saved response "Example" original request query api_key'))
  const scoped = findings.find((finding) => finding.ruleId === 'SECRET_IN_COLLECTION_VARIABLE')
  assert.deepEqual(scoped?.affected, ['Admin/Get user'])
})

test('sanitized copy removes documentation, scoped variable and path variable secrets', () => {
  const { json, redactedCount } = redactCollection(scopedSecretsCollection())
  assert.ok(redactedCount >= 8)
  const serialized = JSON.stringify(json)
  for (const secret of Object.values(FAKE)) assert.ok(!serialized.includes(secret), `leaked ${secret.slice(0, 6)}`)
  const folder = (json as { item: Array<{ description: string; variable: Array<{ key: string; value: string }> }> }).item[0]
  assert.match(folder.description, /password: \{\{REDACTED\}\}/)
  assert.deepEqual(folder.variable, [{ key: 'clientSecret', value: '' }, { key: 'region', value: 'eu-west-1' }])
  const remaining = runAudit(parseCollection(json)).filter((finding) => finding.category === 'secrets')
  assert.deepEqual(remaining, [])
})

test('repair clears scoped variables and scrubs request documentation', () => {
  const original = scopedSecretsCollection()
  const parsed = parseCollection(original)
  const findings = runAudit(parsed)
  const plan = createRepairPlan(original, parsed, findings)
  const { fixedJson } = applyRepairPlan(original, plan.defaultSelectedFixIds, plan)
  const folder = (fixedJson as { item: Array<{ variable: Array<{ key: string; value: string }>; item: Array<{ variable: Array<{ value: string }> }> }> }).item[0]
  assert.equal(folder.variable[0].value, '')
  assert.equal(folder.variable[1].value, 'eu-west-1')
  assert.equal(folder.item[0].variable[0].value, '')
})
