import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCollection } from '../src/lib/parser'
import { runAudit } from '../src/lib/auditor'
import { calculateScore } from '../src/lib/scorer'
import { redactCollection } from '../src/lib/redaction'
import { buildJsonReport, buildMarkdownReport, buildSarifReport, reportFileName } from '../src/lib/reportExport'
import { FAKE, kitchenSinkCollection } from './fixtures'

const SECRET_RULES = new Set([
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
])

test('sanitized copy contains no credentials and no secret findings', () => {
  const { json, redactedCount } = redactCollection(kitchenSinkCollection())
  assert.ok(redactedCount > 10)
  const serialized = JSON.stringify(json)
  for (const secret of Object.values(FAKE)) assert.ok(!serialized.includes(secret), `leaked ${secret.slice(0, 6)}…`)
  assert.ok(!serialized.includes('hunter2pass'))

  const remaining = runAudit(parseCollection(json)).filter((finding) => SECRET_RULES.has(finding.ruleId))
  assert.deepEqual(remaining.map((finding) => finding.ruleId), [])
})

test('redaction is idempotent and does not mutate input', () => {
  const input = kitchenSinkCollection()
  const once = redactCollection(input)
  const twice = redactCollection(once.json)
  assert.equal(twice.redactedCount, 0)
  assert.deepEqual(input, kitchenSinkCollection())
})

test('redaction keeps request-side values runnable via variables', () => {
  const { json } = redactCollection(kitchenSinkCollection())
  const serialized = JSON.stringify(json)
  assert.ok(serialized.includes('{{token}}'))
  assert.ok(serialized.includes('{{apiKey}}') || serialized.includes('{{X-API-Key}}'))
  assert.ok(serialized.includes('{{REDACTED}}'))
})

function context() {
  const parsed = parseCollection(kitchenSinkCollection())
  const findings = runAudit(parsed)
  return { parsed, findings, score: calculateScore(parsed, findings), appVersion: '9.9.9', generatedAt: new Date('2026-01-01T00:00:00Z') }
}

test('SARIF report is structurally valid', () => {
  const sarif = JSON.parse(buildSarifReport(context()))
  assert.equal(sarif.version, '2.1.0')
  const run = sarif.runs[0]
  assert.equal(run.tool.driver.name, 'PostScope')
  assert.ok(run.tool.driver.rules.length >= 27)
  assert.ok(run.results.length > 0)
  for (const result of run.results) {
    assert.ok(['error', 'warning', 'note'].includes(result.level))
    assert.equal(run.tool.driver.rules[result.ruleIndex].id, result.ruleId)
    assert.ok(result.locations[0].physicalLocation.artifactLocation.uri)
  }
})

test('JSON and Markdown reports include findings but no raw secrets', () => {
  const ctx = context()
  const json = JSON.parse(buildJsonReport(ctx))
  assert.equal(json.tool.version, '9.9.9')
  assert.equal(json.findings.length, ctx.findings.length)
  const markdown = buildMarkdownReport(ctx)
  assert.match(markdown, /# PostScope report: Kitchen sink/)
  assert.match(markdown, /## Critical/)
  for (const report of [JSON.stringify(json), markdown, buildSarifReport(ctx)]) {
    for (const secret of Object.values(FAKE)) assert.ok(!report.includes(secret))
  }
})

test('report file names are filesystem safe', () => {
  assert.equal(reportFileName('My API / v2', 'sarif'), 'My_API_v2.postscope.sarif')
  assert.equal(reportFileName('../../etc', 'markdown'), 'etc.postscope.md')
})

test('sanitized copy scrubs credentials in disabled headers, query params, form fields and scripts', () => {
  const original = {
    info: { name: 'Disabled' },
    item: [
      {
        name: 'R',
        event: [{ listen: 'prerequest', disabled: true, script: { exec: [`pm.environment.set("accessToken", "${FAKE.refreshToken}")`] } }],
        request: {
          method: 'POST',
          header: [{ key: 'Authorization', value: `Bearer ${FAKE.bearer}`, disabled: true }],
          url: { raw: 'https://x.test/p', query: [{ key: 'api_key', value: FAKE.apiKey, disabled: true }] },
          body: { mode: 'urlencoded', urlencoded: [{ key: 'password', value: FAKE.password, disabled: true }] },
        },
      },
    ],
  }
  const { json, redactedCount } = redactCollection(original)
  assert.ok(redactedCount >= 3)
  const serialized = JSON.stringify(json)
  for (const secret of [FAKE.bearer, FAKE.apiKey, FAKE.password, FAKE.refreshToken]) assert.ok(!serialized.includes(secret))
  const findings = runAudit(parseCollection(json))
  assert.deepEqual(findings.filter((finding) => SECRET_RULES.has(finding.ruleId)).map((finding) => finding.ruleId), [])
})

test('sanitized copy keeps unquoted variables, indentation and XML structure in raw bodies', () => {
  const json = {
    info: { name: 'Bodies' },
    item: [
      {
        name: 'JSON with variable',
        request: { method: 'POST', url: '{{baseUrl}}/a', body: { mode: 'raw', raw: `{\n\t"id": {{userId}},\n\t"password": "${FAKE.password}"\n}` } },
      },
      {
        name: 'SOAP',
        request: {
          method: 'POST',
          url: '{{baseUrl}}/soap',
          body: { mode: 'raw', raw: `<s:Envelope><wsse:Password Type="x">${FAKE.password}</wsse:Password><user>{{user}}</user></s:Envelope>` },
        },
      },
    ],
  }
  const { json: sanitized, redactedCount } = redactCollection(json)
  assert.equal(redactedCount, 2)
  const [first, second] = (sanitized as { item: Array<{ request: { body: { raw: string } } }> }).item
  assert.equal(first.request.body.raw, '{\n\t"id": {{userId}},\n\t"password": "{{password}}"\n}')
  assert.equal(second.request.body.raw, '<s:Envelope><wsse:Password Type="x">{{Password}}</wsse:Password><user>{{user}}</user></s:Envelope>')
  assert.ok(!JSON.stringify(sanitized).includes(FAKE.password))
})
