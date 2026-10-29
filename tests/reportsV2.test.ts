/* eslint-disable @typescript-eslint/no-explicit-any -- the schema validator walks arbitrary JSON */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parseCollection } from '../src/lib/parser'
import { runAuditDetailed } from '../src/lib/auditor'
import { attachEvidencePointers } from '../src/lib/evidencePointers'
import { locatePointers } from '../src/lib/jsonPositions'
import { buildHtmlReport, escapeHtml, renderHtmlReports } from '../src/lib/htmlReport'
import {
  REPORT_VERSION,
  buildJsonReport,
  buildMarkdownReport,
  buildReport,
  buildSarifReport,
  reportFileName,
  reportMimeType,
} from '../src/lib/reportExport'
import { calculateScore } from '../src/lib/scorer'
import { attachEnvironments } from '../src/lib/environment'
import { validate } from './schema'
import { FAKE, cleanCollection, environmentExport, kitchenSinkCollection, scopedSecretsCollection } from './fixtures'

const schema = JSON.parse(fs.readFileSync(new URL('../docs/schemas/postscope-report.v2.schema.json', import.meta.url), 'utf8')) as Record<
  string,
  unknown
>

function context(json: unknown, options: { suppress?: boolean; environment?: boolean; pretty?: boolean } = {}) {
  const sourceText = JSON.stringify(json, null, options.pretty === false ? 0 : 2)
  const raw = JSON.parse(sourceText) as unknown
  let parsed = parseCollection(raw)
  if (options.environment) parsed = attachEnvironments(parsed, [JSON.stringify(environmentExport())])
  const result = runAuditDetailed(parsed, {
    suppressions: options.suppress ? [{ ruleId: 'MISSING_AUTH', reason: 'Accepted', request: 'Users/**' }] : undefined,
  })
  return {
    raw,
    sourceText,
    parsed,
    ctx: {
      parsed,
      findings: attachEvidencePointers(raw, parsed, result.findings),
      suppressed: attachEvidencePointers(raw, parsed, result.suppressed),
      score: calculateScore(parsed, result.findings),
      appVersion: '1.2.3',
      sourceName: 'api.postman_collection.json',
      sourceText,
    },
  }
}

function resolvePointer(root: unknown, pointer: string): unknown {
  if (pointer === '') return root
  return pointer
    .split('/')
    .slice(1)
    .reduce<unknown>(
      (node, segment) => (node as Record<string, unknown> | undefined)?.[segment.replace(/~1/g, '/').replace(/~0/g, '~')],
      root
    )
}

test('the JSON report validates against the published version 2 schema', () => {
  for (const options of [{}, { suppress: true }, { environment: true, suppress: true }]) {
    for (const json of [kitchenSinkCollection(), scopedSecretsCollection(), cleanCollection()]) {
      const { ctx } = context(json, options)
      const report = JSON.parse(buildJsonReport({ ...ctx, baselined: options.suppress ? 3 : undefined }))
      assert.equal(report.reportVersion, REPORT_VERSION)
      assert.equal(report.score.scoreModel, 2)
      assert.deepEqual(validate(schema, report), [])
    }
  }
})

test('the schema rejects reports that drift from the contract', () => {
  const { ctx } = context(kitchenSinkCollection())
  const report = JSON.parse(buildJsonReport(ctx))
  const broken = (mutate: (copy: any) => void) => {
    const copy = JSON.parse(JSON.stringify(report))
    mutate(copy)
    return validate(schema, copy)
  }
  assert.ok(
    broken((copy) => {
      copy.reportVersion = 1
    }).length > 0
  )
  assert.ok(
    broken((copy) => {
      delete copy.score.security
    }).length > 0
  )
  assert.ok(
    broken((copy) => {
      copy.findings[0].severity = 'urgent'
    }).length > 0
  )
  assert.ok(
    broken((copy) => {
      copy.findings[0].occurrences[0].fingerprint = 'abc'
    }).length > 0
  )
  assert.ok(
    broken((copy) => {
      copy.findings[0].secretValue = 'leak'
    }).length > 0
  )
  assert.ok(
    broken((copy) => {
      copy.score.total = 101
    }).length > 0
  )
})

test('evidence pointers resolve to the value that was reported', () => {
  const { ctx, raw } = context(kitchenSinkCollection())
  const all = ctx.findings.flatMap((finding) => (finding.evidence ?? []).map((entry) => ({ finding, entry })))
  const withPointer = all.filter(({ entry }) => entry.pointer !== undefined)
  assert.ok(withPointer.length / all.length > 0.9, `${withPointer.length}/${all.length} evidence entries have a pointer`)
  for (const { entry } of withPointer)
    assert.notEqual(resolvePointer(raw, entry.pointer!), undefined, `${entry.location} -> ${entry.pointer}`)

  const find = (ruleId: string, location: string) =>
    ctx.findings.find((finding) => finding.ruleId === ruleId)?.evidence?.find((entry) => entry.location === location)
  assert.equal(resolvePointer(raw, find('HARDCODED_API_KEY', 'header X-API-Key')!.pointer!), FAKE.apiKey)
  assert.equal(resolvePointer(raw, find('SECRET_IN_QUERY', 'query api_key')!.pointer!), FAKE.apiKey)
  assert.equal(resolvePointer(raw, find('HARDCODED_SECRET', 'body field client_secret')!.pointer!), FAKE.clientSecret)
  assert.equal(
    find('HARDCODED_SECRET', 'body field disabled_secret (disabled)')!.pointer,
    find('HARDCODED_SECRET', 'body field client_secret')!.pointer!.replace(/\/\d+\/value$/, '/2/value')
  )
  assert.equal(resolvePointer(raw, find('SECRET_IN_COLLECTION_VARIABLE', 'collection variable clientSecret')!.pointer!), FAKE.clientSecret)
  assert.ok(String(resolvePointer(raw, find('HARDCODED_TOKEN', 'header Authorization')!.pointer!)).includes('Token '))
})

test('SARIF results carry line and column regions that point at the reported value', () => {
  for (const pretty of [true, false]) {
    const { ctx, sourceText, raw } = context(kitchenSinkCollection(), { pretty })
    const sarif = JSON.parse(buildSarifReport(ctx))
    const run = sarif.runs[0]
    assert.equal(run.columnKind, 'utf16CodeUnits')
    assert.deepEqual(run.invocations, [{ executionSuccessful: true }])
    assert.match(run.automationDetails.id, /^postscope\/Kitchen_sink\/\d{4}-\d{2}-\d{2}$/)
    const regions = run.results.map((result: any) => result.locations[0].physicalLocation.region).filter(Boolean)
    assert.ok(regions.length >= run.results.length * 0.9, `${regions.length}/${run.results.length} results have a region`)
    for (const region of regions) assert.ok(region.startLine >= 1 && region.startColumn >= 1)

    const apiKey = ctx.findings.find((finding) => finding.ruleId === 'HARDCODED_API_KEY')!
    const pointer = apiKey.evidence![0].pointer!
    const result = run.results.find(
      (candidate: any) => candidate.ruleId === 'HARDCODED_API_KEY' && candidate.locations[0].physicalLocation.region
    )
    const { startLine, startColumn } = result.locations[0].physicalLocation.region
    const line = sourceText.split('\n')[startLine - 1]
    assert.ok(line.slice(startColumn - 1).startsWith(JSON.stringify(resolvePointer(raw, pointer)).slice(0, 8)), line)
    assert.deepEqual(locatePointers(sourceText, new Set([pointer])).get(pointer), { line: startLine, column: startColumn })
  }
})

test('SARIF without the source text still works, and truncation is reported', () => {
  const { ctx } = context(kitchenSinkCollection())
  const withoutText = JSON.parse(buildSarifReport({ ...ctx, sourceText: undefined })).runs[0]
  assert.ok(withoutText.results.every((result: any) => !result.locations[0].physicalLocation.region))

  const huge = {
    info: { name: 'Huge' },
    item: Array.from({ length: 5200 }, (_, index) => ({
      name: `R${index}`,
      request: { method: 'GET', url: 'http://api.example.com/x', header: [{ key: 'X-API-Key', value: FAKE.apiKey }] },
    })),
  }
  const big = context(huge, { pretty: false })
  const run = JSON.parse(buildSarifReport(big.ctx)).runs[0]
  assert.equal(run.results.length, 5000)
  assert.equal(run.invocations[0].executionSuccessful, true)
  assert.match(run.invocations[0].toolExecutionNotifications[0].message.text, /truncated at 5000; \d+ more result/)
})

test('SARIF results keep both fingerprints and mark suppressed results', () => {
  const { ctx } = context(kitchenSinkCollection(), { suppress: true })
  const results = JSON.parse(buildSarifReport(ctx)).runs[0].results as Array<{
    ruleId: string
    suppressions?: unknown[]
    partialFingerprints: Record<string, string>
  }>
  assert.ok(
    results.every(
      (result) =>
        /^[0-9a-f]{8}$/.test(result.partialFingerprints['postscope/v1']) &&
        /^[0-9a-f]{64}$/.test(result.partialFingerprints['postscope/v2'])
    )
  )
  assert.ok(results.some((result) => result.ruleId === 'MISSING_AUTH' && result.suppressions?.length === 1))
})

test('the HTML report is one self-contained file without scripts or secrets', () => {
  const { ctx } = context(kitchenSinkCollection(), { suppress: true, environment: true })
  const html = buildHtmlReport({ ...ctx, appVersion: '9.9.9', baselined: 2 })
  assert.match(html, /^<!doctype html>/)
  assert.match(html, /<title>PostScope report: Kitchen sink<\/title>/)
  assert.match(html, /<style>/)
  assert.ok(!/<script/i.test(html) && !/\son\w+=/i.test(html) && !/javascript:/i.test(html))
  assert.ok(!/<link|<img|<iframe|src=|href=|@import|url\(/i.test(html), 'no external resources')
  for (const secret of Object.values(FAKE)) assert.ok(!html.includes(secret))
  for (const text of [
    'Critical (',
    'Warning (',
    'Suppressed (',
    'Environments:',
    'PostScope 9.9.9',
    'known occurrence(s) are hidden by the baseline',
    'Score impact: -',
    'Hardcoded password in headers or body',
  ]) {
    assert.ok(html.includes(text), text)
  }
  assert.ok(!/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u2014]/u.test(html))
})

test('HTML output escapes every dynamic value', () => {
  const nasty = '<img src=x onerror=alert(1)> & "quotes" \'single\''
  const json = {
    info: { name: nasty },
    item: [{ name: nasty, request: { method: 'GET', url: 'https://x.test', header: [{ key: nasty, value: FAKE.apiKey }] } }],
  }
  const { ctx } = context(json)
  const html = buildHtmlReport(ctx)
  assert.ok(!html.includes('<img src=x'))
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;quotes&quot; &#39;single&#39;'))
  assert.equal(escapeHtml(undefined), '')
  assert.equal(escapeHtml(5), '5')
})

test('several collections share one HTML document', () => {
  const first = context(kitchenSinkCollection()).ctx
  const second = context(cleanCollection()).ctx
  const html = renderHtmlReports([first, second])
  assert.equal(html.match(/<!doctype html>/g)?.length, 1)
  assert.match(html, /<title>PostScope report: 2 collections<\/title>/)
  assert.ok(html.includes('<h2>Kitchen sink</h2>') && html.includes('<h2>Clean</h2>'))
})

test('html is a report format with its own file name and media type', () => {
  assert.equal(reportFileName('My API', 'html'), 'My_API.postscope.html')
  assert.equal(reportMimeType('html'), 'text/html')
  const { ctx } = context(cleanCollection())
  const pinned = { ...ctx, generatedAt: new Date('2026-01-01T00:00:00Z') }
  assert.equal(buildReport('html', pinned), buildHtmlReport(pinned))
  assert.match(buildMarkdownReport(ctx), /No findings\./)
})
