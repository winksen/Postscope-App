import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseCollection } from '../src/lib/parser'
import { runAuditDetailed } from '../src/lib/auditor'
import { calculateScore } from '../src/lib/scorer'
import { buildHtmlReport } from '../src/lib/htmlReport'
import {
  buildJsonReport,
  buildMarkdownReport,
  buildReport,
  buildSarifReport,
  reportFileName,
  reportMimeType,
  type ReportContext,
} from '../src/lib/reportExport'
import { COMPLIANCE_FRAMEWORKS, complianceRows, controlsOf, groupByControl, isComplianceFramework } from '../src/lib/compliance'
import { buildIdentityInventoryCsv, csvCell, identityAppendix } from '../src/lib/iam/appendix'
import { FAKE, cleanCollection } from './fixtures'
import { validate } from './schema'

const schema = JSON.parse(fs.readFileSync(new URL('../docs/schemas/postscope-report.v2.schema.json', import.meta.url), 'utf8')) as Record<
  string,
  unknown
>

function collection() {
  return {
    info: { name: 'Identity =report', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    item: [
      {
        name: '=Token',
        request: {
          method: 'POST',
          url: 'http://idp.acme-corp.com/oauth2/default/v1/token?client_secret=' + FAKE.clientSecret,
          description: 'd',
          header: [],
          body: {
            mode: 'urlencoded',
            urlencoded: [
              { key: 'grant_type', value: 'client_credentials' },
              { key: 'client_id', value: 'svc-0001-abcdef' },
            ],
          },
        },
      },
      {
        name: 'Grant',
        request: {
          method: 'POST',
          url: 'https://acme.okta.com/api/v1/users/{{id}}/roles',
          description: 'd',
          header: [],
          body: { mode: 'raw', raw: '{"type":"SUPER_ADMIN"}' },
        },
      },
      { name: 'Users', request: { method: 'GET', url: 'https://acme.okta.com/api/v1/users', description: 'd', header: [] } },
    ],
  }
}

function context(compliance?: ReportContext['compliance'], raw: unknown = collection()): ReportContext {
  const parsed = parseCollection(raw)
  const { findings } = runAuditDetailed(parsed)
  return {
    parsed,
    findings,
    score: calculateScore(parsed, findings),
    appVersion: 'test',
    generatedAt: new Date('2026-06-01T00:00:00Z'),
    compliance,
  }
}

test('markdown and html reports carry the identity appendix and the compliance mapping', () => {
  const ctx = context()
  const markdown = buildMarkdownReport(ctx)
  assert.match(markdown, /^## Identity$/m)
  for (const heading of ['Platforms', 'OAuth clients and flows', 'Privileged operations'])
    assert.match(markdown, new RegExp(`^### ${heading}$`, 'm'))
  assert.match(markdown, /Okta SUPER_ADMIN/)
  assert.match(markdown, /^## Compliance mapping$/m)
  assert.match(markdown, /\| `OAUTH_TOKEN_ENDPOINT_HTTP` \| critical \| SC-8, SC-13 \| A\.8\.24 \| 3\.10 \|/)
  assert.match(markdown, /Identity \d+/, 'the category score includes identity')

  const html = buildHtmlReport(ctx)
  assert.match(html, /<h2>Identity<\/h2>/)
  assert.match(html, /<h2>Compliance mapping<\/h2>/)
  assert.match(html, /<th>NIST SP 800-53<\/th>/)
  for (const text of [markdown, html]) assert.ok(!text.includes(FAKE.clientSecret), 'no secret in the report')
  assert.ok(!html.includes('<script'), 'still a script-free document')
})

test('reports without identity content have no identity or empty compliance sections', () => {
  const ctx = context(undefined, cleanCollection())
  const markdown = buildMarkdownReport(ctx)
  assert.ok(!/^## Identity$/m.test(markdown))
  assert.ok(!buildHtmlReport(ctx).includes('<h2>Identity</h2>'))
  assert.deepEqual(identityAppendix(ctx.parsed.identity), [])
  assert.equal(JSON.parse(buildJsonReport(ctx)).compliance, undefined)
})

test('findings group by the controls of the chosen framework', () => {
  const ctx = context('nist-800-53')
  const groups = groupByControl(ctx.findings, 'nist-800-53')
  const sc8 = groups.find((group) => group.control === 'SC-8')!
  assert.ok(sc8.findings.some((finding) => finding.ruleId === 'OAUTH_TOKEN_ENDPOINT_HTTP'))
  assert.ok(sc8.findings.some((finding) => finding.ruleId === 'INSECURE_HTTP'))
  assert.equal(sc8.findings[0].severity, 'critical', 'the worst finding comes first')
  assert.deepEqual(
    groups.map((group) => group.control),
    [...groups.map((group) => group.control)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  )
  assert.ok(controlsOf('INSECURE_HTTP', 'cis-v8').includes('3.10'))
  assert.deepEqual(controlsOf('MISSING_DESCRIPTION', 'iso-27001'), [])
  assert.ok(complianceRows(ctx.findings).every((row) => row.nist80053.length + row.iso27001.length + row.cisV8.length + row.rfc.length > 0))
  assert.ok(COMPLIANCE_FRAMEWORKS.every(isComplianceFramework) && !isComplianceFramework('pci'))

  assert.match(buildMarkdownReport(ctx), /^## Findings by control: NIST SP 800-53 Rev\. 5$/m)
  assert.match(buildHtmlReport(ctx), /<h2>Findings by control: NIST SP 800-53 Rev\. 5<\/h2>/)
  const json = JSON.parse(buildJsonReport(ctx)) as { compliance: { framework: string; controls: Array<{ control: string }> } }
  assert.equal(json.compliance.framework, 'nist-800-53')
  assert.ok(json.compliance.controls.some((control) => control.control === 'SC-8'))
  assert.deepEqual(validate(schema, json), [])
})

test('the JSON report with identity content and compliance is schema-valid and SARIF has an identity summary', () => {
  const ctx = context('iso-27001')
  assert.deepEqual(validate(schema, JSON.parse(buildJsonReport(ctx))), [])
  const sarif = JSON.parse(buildSarifReport(ctx)) as {
    runs: Array<{ properties?: { identity?: { platforms: Array<{ id: string }>; endpoints: number } } }>
  }
  const identity = sarif.runs[0].properties?.identity
  assert.equal(identity?.platforms[0].id, 'okta')
  assert.ok((identity?.endpoints ?? 0) >= 2)
  assert.equal(JSON.parse(buildSarifReport(context(undefined, cleanCollection()))).runs[0].properties, undefined)
})

test('the identity inventory is a CSV with masked URLs, related findings and formula protection', () => {
  const ctx = context()
  const csv = buildIdentityInventoryCsv(ctx.parsed, ctx.findings)
  const lines = csv.trimEnd().split('\r\n')
  assert.equal(lines[0], 'endpoint class,platform,method,url,request,findings')
  const token = lines.find((line) => line.startsWith('oauth.token'))!
  assert.match(token, /idp\.acme-corp\.com\/oauth2\/default\/v1\/token/)
  assert.match(token, /OAUTH_TOKEN_ENDPOINT_HTTP/)
  assert.ok(token.includes("'=Token"), 'a request name that starts with = cannot run as a formula')
  assert.ok(!csv.includes(FAKE.clientSecret) && !csv.includes('client_secret'), 'query strings never reach the file')
  assert.match(
    lines.find((line) => line.startsWith('admin.role-assignment'))!,
    /PRIVILEGED_ROLE_ASSIGNMENT/
  )
  assert.equal(csvCell('a,b'), '"a,b"')
  assert.equal(csvCell('say "hi"'), '"say ""hi"""')
  assert.equal(csvCell('+1'), "'+1")
  assert.equal(csvCell('@cmd'), "'@cmd")
  assert.equal(buildReport('identity-csv', ctx), csv)
  assert.equal(reportFileName('x', 'identity-csv'), 'identity-inventory.csv')
  assert.equal(reportMimeType('identity-csv'), 'text/csv')
  assert.equal(
    buildIdentityInventoryCsv(context(undefined, cleanCollection()).parsed, []).trimEnd(),
    'endpoint class,platform,method,url,request,findings'
  )
})

test('the CLI groups reports by control and writes the identity inventory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'postscope-iam-report-'))
  try {
    const file = path.join(dir, 'idp.postman_collection.json')
    fs.writeFileSync(file, JSON.stringify(collection()))
    const run = (...args: string[]) =>
      spawnSync(process.execPath, ['--import', 'tsx', 'cli/postscope.ts', file, '--fail-on', 'none', ...args], {
        encoding: 'utf8',
        cwd: process.cwd(),
      })
    const text = run('--compliance', 'nist-800-53')
    assert.equal(text.status, 0, text.stderr)
    assert.match(text.stdout, /By control \(NIST SP 800-53 Rev\. 5\):/)
    assert.match(text.stdout, /SC-8\s+.*OAUTH_TOKEN_ENDPOINT_HTTP/)
    const json = JSON.parse(run('--compliance', 'cis-v8', '--format', 'json').stdout) as { compliance: { framework: string } }
    assert.equal(json.compliance.framework, 'cis-v8')
    const csv = run('--format', 'identity-csv')
    assert.equal(csv.status, 0, csv.stderr)
    assert.match(csv.stdout, /^endpoint class,platform,method,url,request,findings\r\n/)
    const bad = run('--compliance', 'pci')
    assert.equal(bad.status, 2)
    assert.match(bad.stderr, /Unknown --compliance framework/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
