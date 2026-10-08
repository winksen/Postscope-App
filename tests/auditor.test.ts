import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCollection } from '../src/lib/parser'
import { runAudit, sanitizeAuditOptions, type Finding } from '../src/lib/auditor'
import { calculateScore } from '../src/lib/scorer'
import { requestHealthScore } from '../src/lib/requestFindings'
import { RULE_LIST } from '../src/lib/rules'
import { FAKE, cleanCollection, kitchenSinkCollection } from './fixtures'

function audit(json: unknown) {
  const parsed = parseCollection(json)
  const findings = runAudit(parsed)
  const byRule = new Map(findings.map((finding) => [finding.ruleId, finding]))
  const affectedNames = (ruleId: string) =>
    (byRule.get(ruleId as Finding['ruleId'])?.affected ?? []).map((id) => parsed.requests.find((r) => r.id === id)?.name)
  return { parsed, findings, byRule, affectedNames }
}

test('kitchen sink triggers every major rule family', () => {
  const { byRule } = audit(kitchenSinkCollection())
  for (const ruleId of [
    'HARDCODED_PASSWORD',
    'HARDCODED_TOKEN',
    'HARDCODED_API_KEY',
    'HARDCODED_SECRET',
    'HARDCODED_AUTH_CREDENTIAL',
    'SECRET_IN_QUERY',
    'CREDENTIALS_IN_URL',
    'SECRET_IN_SCRIPT',
    'SECRET_IN_COLLECTION_VARIABLE',
    'SECRET_IN_SAVED_RESPONSE',
    'KNOWN_SECRET_PATTERN',
    'INSECURE_HTTP',
    'TLS_VERIFICATION_DISABLED',
    'SECRET_LOGGED_IN_SCRIPT',
    'BASIC_AUTH_PLAINTEXT',
    'GET_WITH_BODY',
    'MISSING_AUTH',
  ]) {
    assert.ok(byRule.has(ruleId as Finding['ruleId']), `expected ${ruleId}`)
  }
})

test('finding ids are stable rule ids and unique per run', () => {
  const { findings } = audit(kitchenSinkCollection())
  assert.equal(new Set(findings.map((f) => f.id)).size, findings.length)
  for (const finding of findings) assert.equal(finding.id, finding.ruleId)
  const again = runAudit(parseCollection(kitchenSinkCollection()))
  assert.deepEqual(again.map((f) => f.id), findings.map((f) => f.id))
})

test('findings are ordered critical, warning, info', () => {
  const { findings } = audit(kitchenSinkCollection())
  const order = { critical: 0, warning: 1, info: 2 }
  for (let i = 1; i < findings.length; i += 1) assert.ok(order[findings[i - 1].severity] <= order[findings[i].severity])
})

test('evidence never contains full secret values', () => {
  const { findings } = audit(kitchenSinkCollection())
  const serialized = JSON.stringify(findings)
  for (const secret of Object.values(FAKE)) assert.ok(!serialized.includes(secret), `leaked ${secret.slice(0, 6)}…`)
})

test('variables with dashes are not reported as hardcoded tokens', () => {
  const { affectedNames } = audit(kitchenSinkCollection())
  assert.ok(!affectedNames('HARDCODED_TOKEN').includes('List users'))
  assert.ok(affectedNames('HARDCODED_TOKEN').includes('Create user'))
})

test('pagination tokens and disabled fields are ignored', () => {
  const { byRule } = audit(kitchenSinkCollection())
  const queryEvidence = byRule.get('SECRET_IN_QUERY')?.evidence?.map((e) => e.location) ?? []
  assert.deepEqual(queryEvidence, ['query api_key'])
  const secretEvidence = JSON.stringify(byRule.get('HARDCODED_SECRET')?.evidence)
  assert.ok(!secretEvidence.includes('disabled_secret'))
})

test('inherited auth suppresses MISSING_AUTH and flags inherited credentials', () => {
  const { affectedNames, byRule } = audit(kitchenSinkCollection())
  assert.ok(!affectedNames('MISSING_AUTH').includes('Login'))
  assert.ok(affectedNames('MISSING_AUTH').includes('Github hook'))
  assert.ok(affectedNames('BASIC_AUTH_PLAINTEXT').includes('Login'))
  const locations = byRule.get('HARDCODED_AUTH_CREDENTIAL')?.evidence?.map((e) => e.location).join('|') ?? ''
  assert.match(locations, /collection level/)
})

test('a clean collection has no secret, auth, or transport findings', () => {
  const { findings, parsed } = audit(cleanCollection())
  assert.deepEqual(findings.filter((f) => f.severity !== 'info').map((f) => f.ruleId), [])
  assert.ok(calculateScore(parsed, findings).total >= 90)
})

test('local http endpoints are not flagged as insecure', () => {
  const { affectedNames } = audit(kitchenSinkCollection())
  assert.ok(!affectedNames('INSECURE_HTTP').includes('Get user with body'))
  assert.ok(affectedNames('INSECURE_HTTP').includes('Login'))
})

test('audit options disable rules and override severity', () => {
  const parsed = parseCollection(kitchenSinkCollection())
  const findings = runAudit(parsed, { disabledRules: ['INSECURE_HTTP'], severityOverrides: { GET_WITH_BODY: 'critical' } })
  assert.ok(!findings.some((f) => f.ruleId === 'INSECURE_HTTP'))
  assert.equal(findings.find((f) => f.ruleId === 'GET_WITH_BODY')?.severity, 'critical')
})

test('sanitizeAuditOptions drops unknown rules and invalid severities', () => {
  const options = sanitizeAuditOptions({
    disabledRules: ['INSECURE_HTTP', 'NOPE', 42],
    severityOverrides: { GET_WITH_BODY: 'warning', MISSING_AUTH: 'warning', FAKE: 'critical', HARDCODED_TOKEN: 'urgent' },
  })
  assert.deepEqual(options.disabledRules, ['INSECURE_HTTP'])
  assert.deepEqual(options.severityOverrides, { GET_WITH_BODY: 'warning' })
  assert.deepEqual(sanitizeAuditOptions('garbage'), {})
})

test('score and per-request health share the same penalty table', () => {
  const { findings, parsed } = audit(kitchenSinkCollection())
  const score = calculateScore(parsed, findings)
  assert.ok(score.total >= 0 && score.total <= 100)
  assert.equal(requestHealthScore([]), 100)
  assert.equal(requestHealthScore([{ severity: 'critical' } as Finding, { severity: 'warning' } as Finding]), 72)
})

test('every rule has complete metadata', () => {
  for (const rule of RULE_LIST) {
    assert.ok(rule.title && rule.description && rule.recommendation, rule.id)
  }
})
