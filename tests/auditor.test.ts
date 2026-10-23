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

test('pagination tokens are ignored and disabled fields are labelled', () => {
  const { byRule } = audit(kitchenSinkCollection())
  const queryEvidence = byRule.get('SECRET_IN_QUERY')?.evidence?.map((e) => e.location) ?? []
  assert.deepEqual(queryEvidence, ['query api_key'])
  const secretEvidence = byRule.get('HARDCODED_SECRET')?.evidence?.map((e) => e.location) ?? []
  assert.ok(secretEvidence.includes('body field disabled_secret (disabled)'))
})

function disabledCollection(): Record<string, unknown> {
  return {
    info: { name: 'Disabled entries' },
    variable: [{ key: 'baseUrl', value: 'https://api.example.com' }, { key: 'a', value: '1' }, { key: 'b', value: '2' }, { key: 'c', value: '3' }],
    item: [
      {
        name: 'Leaky request',
        event: [
          { listen: 'prerequest', disabled: true, script: { exec: [`pm.environment.set("accessToken", "${FAKE.refreshToken}")`] } },
        ],
        request: {
          method: 'POST',
          auth: { type: 'noauth' },
          description: 'Has only disabled credentials.',
          header: [
            { key: 'Authorization', value: `Bearer ${FAKE.bearer}`, disabled: true },
            { key: 'X-Empty', value: '', disabled: true },
            { key: 'Content-Type', value: 'application/json' },
          ],
          url: {
            raw: '{{baseUrl}}/login',
            host: ['{{baseUrl}}'],
            path: ['login'],
            query: [{ key: 'api_key', value: FAKE.apiKey, disabled: true }],
          },
          body: {
            mode: 'urlencoded',
            urlencoded: [
              { key: 'username', value: 'admin' },
              { key: 'password', value: FAKE.password, disabled: true },
            ],
          },
        },
        response: [
          {
            name: 'Example',
            originalRequest: { method: 'POST', header: [{ key: 'X-API-Key', value: FAKE.apiKey, disabled: true }], url: '{{baseUrl}}/login' },
            body: '{}',
          },
        ],
      },
    ],
  }
}

test('disabled headers, query params, form fields and scripts are audited and labelled', () => {
  const { byRule, affectedNames } = audit(disabledCollection())
  const locations = (ruleId: string) => (byRule.get(ruleId as Finding['ruleId'])?.evidence ?? []).map((e) => e.location)
  assert.deepEqual(locations('HARDCODED_TOKEN'), ['header Authorization (disabled)'])
  assert.deepEqual(locations('SECRET_IN_QUERY'), ['query api_key (disabled)'])
  assert.deepEqual(locations('HARDCODED_PASSWORD'), ['body field password (disabled)'])
  assert.ok(locations('SECRET_IN_SCRIPT').some((location) => location === 'pre-request script (disabled): sets accessToken'))
  assert.ok(locations('SECRET_IN_SAVED_RESPONSE').some((location) => location.endsWith('original request header X-API-Key (disabled)')))
  assert.deepEqual(affectedNames('HARDCODED_TOKEN'), ['Leaky request'])
})

test('disabled entries do not suppress auth or hygiene checks', () => {
  const { affectedNames } = audit(disabledCollection())
  assert.deepEqual(affectedNames('MISSING_AUTH'), ['Leaky request'])
  assert.deepEqual(affectedNames('EMPTY_HEADERS'), [])
})

test('disabled placeholders and variables raise nothing', () => {
  const json = disabledCollection() as { item: Array<{ request: { header: unknown[] } }> }
  json.item[0].request.header = [{ key: 'Authorization', value: 'Bearer {{token}}', disabled: true }]
  const { byRule } = audit({ ...json, item: [{ ...json.item[0], event: [], response: [], request: { ...json.item[0].request, url: '{{baseUrl}}/x', body: undefined } }] })
  assert.ok(!byRule.has('HARDCODED_TOKEN'))
  assert.ok(!byRule.has('SECRET_IN_QUERY'))
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

test('JSON bodies with unquoted variables still reveal literal secrets', () => {
  const { affectedNames, byRule } = audit({
    info: { name: 'Templated' },
    item: [
      { name: 'Unquoted', request: { method: 'POST', url: '{{baseUrl}}/a', body: { mode: 'raw', raw: `{"id": {{userId}}, "password": "${FAKE.password}"}` } } },
      { name: 'Only variables', request: { method: 'POST', url: '{{baseUrl}}/b', body: { mode: 'raw', raw: '{"id": {{userId}}, "password": {{password}}, "n": "{{x}}"}' } } },
      { name: 'Nested', request: { method: 'POST', url: '{{baseUrl}}/c', body: { mode: 'raw', raw: `{"a": [{{one}}, {"client_secret": "${FAKE.clientSecret}"}], "b": {{two}}}` } } },
    ],
  })
  assert.deepEqual(affectedNames('HARDCODED_PASSWORD'), ['Unquoted'])
  assert.deepEqual(affectedNames('HARDCODED_SECRET'), ['Nested'])
  assert.equal(byRule.get('HARDCODED_PASSWORD')?.evidence?.[0].location, 'body password')
})

test('XML, form-like and fragment raw bodies are scanned field by field', () => {
  const { affectedNames, byRule } = audit({
    info: { name: 'Raw bodies' },
    item: [
      { name: 'SOAP', request: { method: 'POST', url: 'https://x.test/s', body: { mode: 'raw', raw: `<wsse:UsernameToken><wsse:Password Type="PasswordText">${FAKE.password}</wsse:Password></wsse:UsernameToken>` } } },
      { name: 'SOAP variable', request: { method: 'POST', url: 'https://x.test/s', body: { mode: 'raw', raw: '<Password>{{pw}}</Password><Name>Bob</Name>' } } },
      { name: 'Pairs', request: { method: 'POST', url: 'https://x.test/t', body: { mode: 'raw', raw: `grant_type=client_credentials&client_secret=${FAKE.clientSecret}&scope=read` } } },
      { name: 'Fragment', request: { method: 'POST', url: 'https://x.test/f', body: { mode: 'raw', raw: `// note\n{"password": "${FAKE.password}", }` } } },
      { name: 'Plain text', request: { method: 'POST', url: 'https://x.test/p', body: { mode: 'raw', raw: 'this mentions a secret but has no value' } } },
    ],
  })
  assert.deepEqual(affectedNames('HARDCODED_PASSWORD'), ['SOAP', 'Fragment'])
  assert.deepEqual(affectedNames('HARDCODED_SECRET'), ['Pairs'])
  assert.deepEqual(byRule.get('HARDCODED_PASSWORD')?.evidence?.map((e) => e.location), ['raw body Password', 'raw body password'])
})
