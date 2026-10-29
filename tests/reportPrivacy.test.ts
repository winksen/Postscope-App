import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parseCollection } from '../src/lib/parser'
import { runAuditDetailed } from '../src/lib/auditor'
import { calculateScore } from '../src/lib/scorer'
import { buildReport, type ReportContext, type ReportFormat } from '../src/lib/reportExport'
import { applyReportProfile, isReportProfile, reportStemForProfile } from '../src/lib/reportPrivacy'
import { FAKE } from './fixtures'
import { validate } from './schema'

const schema = JSON.parse(fs.readFileSync(new URL('../docs/schemas/postscope-report.v2.schema.json', import.meta.url), 'utf8')) as Record<
  string,
  unknown
>

const INTERNAL = ['acme-corp', 'Project Falcon', 'jdoe@example.com']

function collection() {
  return {
    info: { name: 'Acme Corp Identity Platform', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    item: [
      { name: 'Hidden Legacy Folder', item: 'not-a-list' },
      {
        name: 'Payroll Admin Zone',
        item: [
          {
            name: 'Rotate Falconry Vault',
            request: {
              method: 'POST',
              url: `http://idp.acme-corp.com/realms/payroll-prod/protocol/openid-connect/token?client_secret=${FAKE.clientSecret}`,
              description: 'd',
              header: [
                { key: 'Authorization', value: `Bearer ${FAKE.bearer}` },
                { key: 'X-Owner', value: 'jdoe@example.com' },
              ],
              body: {
                mode: 'urlencoded',
                urlencoded: [
                  { key: 'grant_type', value: 'client_credentials' },
                  { key: 'client_id', value: 'payroll-svc-0001-abcdef' },
                  { key: 'client_secret', value: FAKE.clientSecret },
                  { key: 'note', value: 'Project Falcon rollout' },
                ],
              },
            },
          },
        ],
      },
      {
        name: 'Directory lookup',
        request: {
          method: 'GET',
          url: 'https://tenant-7781.okta.com/api/v1/users',
          description: 'd',
          header: [{ key: 'Authorization', value: `SSWS ${FAKE.apiKey}00000000000000` }],
        },
      },
      {
        name: 'Aws call',
        request: {
          method: 'GET',
          url: 'https://billing.internal.example.net:8443/export',
          description: 'd',
          header: [{ key: 'X-Api-Key', value: FAKE.githubToken }],
        },
      },
    ],
  }
}

function context(privacy?: ReportContext['privacy']): ReportContext {
  const parsed = parseCollection(collection())
  const { findings } = runAuditDetailed(parsed)
  return {
    parsed,
    findings,
    score: calculateScore(parsed, findings),
    appVersion: 'test',
    generatedAt: new Date('2026-06-01T00:00:00Z'),
    sourceName: 'acme-corp-prod.postman_collection.json',
    sourceText: JSON.stringify(collection()),
    privacy,
  }
}

const FORMATS: ReportFormat[] = ['json', 'sarif', 'markdown', 'html', 'identity-csv']

const FORBIDDEN = [
  FAKE.clientSecret,
  FAKE.bearer,
  FAKE.githubToken,
  FAKE.apiKey,
  'idp.acme-corp.com',
  'tenant-7781',
  'okta.com',
  'billing.internal.example.net',
  'payroll-prod',
  'payroll-svc-0001-abcdef',
  'Acme Corp Identity Platform',
  'Payroll Admin Zone',
  'Hidden Legacy Folder',
  'Rotate Falconry Vault',
  'Directory lookup',
  'acme-corp',
  'Falcon',
  'jdoe@example.com',
]

test('external reports hold no seeded secret, configured identifier, name, host or path in any format', () => {
  const ctx = context({ profile: 'external', internalIdentifiers: INTERNAL })
  for (const format of FORMATS) {
    const output = buildReport(format, ctx)
    assert.ok(output.length > 0, format)
    for (const forbidden of FORBIDDEN) assert.ok(!output.toLowerCase().includes(forbidden.toLowerCase()), `${format} leaks ${forbidden}`)
  }
})

test('external reports stay valid and keep the rule context', () => {
  const ctx = context({ profile: 'external', internalIdentifiers: INTERNAL })
  const json = JSON.parse(buildReport('json', ctx)) as { findings: Array<{ ruleId?: string; id?: string }>; score: unknown }
  assert.deepEqual(validate(json, schema), [])
  assert.ok(json.findings.length > 0)
  const internalJson = JSON.parse(buildReport('json', context())) as typeof json
  const ids = (report: typeof json) => report.findings.map((finding) => finding.ruleId ?? finding.id).sort()
  assert.deepEqual(ids(json), ids(internalJson), 'the same findings, only the identifiers differ')
  assert.deepEqual(json.score, internalJson.score)

  const sarif = JSON.parse(buildReport('sarif', ctx)) as { version: string; runs: Array<{ results: unknown[] }> }
  assert.equal(sarif.version, '2.1.0')
  assert.ok(sarif.runs[0].results.length > 0)
  assert.match(buildReport('markdown', ctx), /INSECURE_HTTP|MISSING_AUTH|HARDCODED/)
  assert.match(buildReport('markdown', ctx), /Request \d+|Folder \d+|Collection/)
})

test('the internal profile and a missing profile leave the report unchanged', () => {
  for (const format of FORMATS) {
    const plain = buildReport(format, context())
    assert.equal(buildReport(format, context({ profile: 'internal', internalIdentifiers: INTERNAL })), plain, format)
  }
  assert.ok(buildReport('markdown', context()).includes('Payroll Admin Zone'), 'internal reports keep names')
})

test('pseudonyms are stable for one collection', () => {
  const ctx = context({ profile: 'external' })
  assert.equal(buildReport('markdown', ctx), buildReport('markdown', ctx))
})

test('documentation links in rule text are kept and unknown hosts in free text are replaced', () => {
  const ctx = context({ profile: 'external' })
  const out = applyReportProfile('markdown', 'See https://owasp.org/x and https://intranet.vendor-x.example.org/secret/path', ctx)
  assert.match(out, /https:\/\/host-\d+\.invalid\/\[path removed\]/)
  assert.ok(!out.includes('vendor-x'))
})

test('profile helpers', () => {
  assert.equal(isReportProfile('external'), true)
  assert.equal(isReportProfile('public'), false)
  assert.equal(reportStemForProfile('Acme', { profile: 'external' }), 'collection')
  assert.equal(reportStemForProfile('Acme', { profile: 'internal' }), 'Acme')
  assert.equal(reportStemForProfile('Acme'), 'Acme')
})

import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { parseProjectConfig } from '../src/lib/projectConfig'

function cli(...args: string[]) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'cli/postscope.ts', ...args], { encoding: 'utf8', cwd: process.cwd() })
  return { code: result.status, stdout: result.stdout, stderr: result.stderr }
}

test('the CLI applies --profile external to every format and reads identifiers from the config', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'postscope-privacy-'))
  try {
    const file = path.join(dir, 'acme-corp-prod.postman_collection.json')
    fs.writeFileSync(file, JSON.stringify(collection()))
    fs.writeFileSync(path.join(dir, '.postscope.json'), JSON.stringify({ privacy: { internalIdentifiers: ['Project Falcon'] } }))
    for (const format of ['text', 'json', 'sarif', 'markdown', 'html', 'junit', 'identity-csv']) {
      const result = cli(
        file,
        '--fail-on',
        'none',
        '--format',
        format,
        '--profile',
        'external',
        '--internal-identifier',
        'jdoe@example.com'
      )
      assert.equal(result.code, 0, `${format}: ${result.stderr}`)
      assert.ok(result.stdout.length > 0, format)
      for (const forbidden of FORBIDDEN)
        assert.ok(!result.stdout.toLowerCase().includes(forbidden.toLowerCase()), `${format} leaks ${forbidden}`)
    }
    const internal = cli(file, '--fail-on', 'none', '--format', 'markdown')
    assert.ok(internal.stdout.includes('Payroll Admin Zone'), 'the default profile is internal')
    assert.equal(cli(file, '--profile', 'public').code, 2)
    assert.equal(cli(file, '--internal-identifier', 'ab').code, 2)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('the project config validates the privacy block', () => {
  assert.deepEqual(parseProjectConfig({ privacy: { profile: 'external', internalIdentifiers: ['acme-corp'] } }).errors, [])
  assert.match(parseProjectConfig({ privacy: { profile: 'secret' } }).errors.join(), /privacy\.profile/)
  assert.match(parseProjectConfig({ privacy: { internalIdentifiers: ['ab'] } }).errors.join(), /at least 3/)
  assert.match(parseProjectConfig({ privacy: { other: 1 } }).errors.join(), /unknown key "other"/)
  assert.match(parseProjectConfig({ privacy: 'x' }).errors.join(), /must be an object/)
})
