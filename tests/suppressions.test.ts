import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { sha256Hex } from '../src/lib/sha256'
import { findingOccurrences, occurrenceFingerprint } from '../src/lib/occurrences'
import { parseCollection } from '../src/lib/parser'
import { runAudit, runAuditDetailed, type Finding } from '../src/lib/auditor'
import { applyBaseline, buildBaseline, parseBaseline } from '../src/lib/baseline'
import { globToRegExp, type ConfigSuppression } from '../src/lib/suppressions'
import { CONFIG_FILE_NAME, parseProjectConfig } from '../src/lib/projectConfig'
import { calculateScore } from '../src/lib/scorer'
import { buildJsonReport, buildMarkdownReport, buildSarifReport } from '../src/lib/reportExport'
import { FAKE } from './fixtures'

const NOW = new Date('2026-10-15T12:00:00Z')

function find(findings: Finding[], ruleId: string) {
  return findings.find((finding) => finding.ruleId === ruleId)
}

/** Three unprotected POSTs in two folders, plus a root request. */
function collection(description = '', folderDescription = '', requestDescription = 'Creates a thing.') {
  return {
    info: { name: 'Suppress', description },
    variable: [{ key: 'baseUrl', value: 'https://api.example.com' }],
    item: [
      {
        name: 'Public',
        description: folderDescription,
        item: [
          {
            name: 'Health',
            request: { method: 'POST', url: '{{baseUrl}}/health', auth: { type: 'noauth' }, description: requestDescription },
          },
          { name: 'Ping', request: { method: 'POST', url: '{{baseUrl}}/ping', auth: { type: 'noauth' }, description: 'Ping.' } },
        ],
      },
      {
        name: 'Private',
        item: [
          { name: 'Create', request: { method: 'POST', url: '{{baseUrl}}/things', auth: { type: 'noauth' }, description: 'Creates.' } },
        ],
      },
      { name: 'Root', request: { method: 'POST', url: '{{baseUrl}}/root', auth: { type: 'noauth' }, description: 'Root.' } },
    ],
  }
}

const detailed = (json: unknown, suppressions?: ConfigSuppression[], now = NOW) =>
  runAuditDetailed(parseCollection(json), { suppressions, now })

test('sha256 matches the reference implementation', () => {
  for (const text of ['', 'abc', 'PostScope', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'x'.repeat(1000), 'Zoë 日本語 🙂']) {
    assert.equal(sha256Hex(text), createHash('sha256').update(text, 'utf8').digest('hex'), text.slice(0, 10))
  }
})

test('occurrence fingerprints ignore the masked preview and distinguish rule, request and location', () => {
  const a = occurrenceFingerprint('HARDCODED_TOKEN', 'Users/List', 'header Authorization')
  assert.equal(a, sha256Hex('HARDCODED_TOKEN|Users/List|header Authorization'))
  assert.notEqual(a, occurrenceFingerprint('HARDCODED_TOKEN', 'Users/List', 'header X-Api-Key'))
  assert.notEqual(a, occurrenceFingerprint('HARDCODED_TOKEN', 'Users/Other', 'header Authorization'))
  const finding = {
    ruleId: 'HARDCODED_TOKEN',
    affected: ['A', 'B'],
    evidence: [
      { requestId: 'A', location: 'header Authorization', preview: 'one' },
      { requestId: 'A', location: 'header Authorization', preview: 'two' },
    ],
  } as Finding
  assert.deepEqual(
    findingOccurrences(finding).map((item) => [item.requestId, item.location]),
    [
      ['A', 'header Authorization'],
      ['B', undefined],
    ]
  )
  assert.equal(findingOccurrences({ ruleId: 'X', affected: [], evidence: undefined } as unknown as Finding).length, 1)
})

test('request globs match folder levels as documented', () => {
  assert.ok(globToRegExp('Public/*').test('Public/Health'))
  assert.ok(!globToRegExp('Public/*').test('Public/Sub/Health'))
  assert.ok(globToRegExp('Public/**').test('Public/Sub/Health'))
  assert.ok(globToRegExp('**').test('anything/at/all'))
  assert.ok(globToRegExp('Re?uest').test('Request'))
  assert.ok(globToRegExp('A.B (copy)').test('A.B (copy)'))
  assert.ok(!globToRegExp('A.B').test('AxB'))
})

test('a config suppression hides matching occurrences, keeps them visible and keeps them out of the score', () => {
  const json = collection()
  const before = runAuditDetailed(parseCollection(json), { now: NOW })
  const result = detailed(json, [{ ruleId: 'MISSING_AUTH', request: 'Public/*', reason: 'Public endpoints', expires: '2027-01-01' }])
  assert.deepEqual(find(before.findings, 'MISSING_AUTH')?.affected, ['Public/Health', 'Public/Ping', 'Private/Create', 'Root'])
  assert.deepEqual(find(result.findings, 'MISSING_AUTH')?.affected, ['Private/Create', 'Root'])
  assert.deepEqual(
    find(result.findings, 'MISSING_AUTH')?.evidence?.map((item) => item.location),
    ['POST /things', 'POST /root']
  )
  const suppressed = result.suppressed.find((finding) => finding.ruleId === 'MISSING_AUTH')
  assert.equal(suppressed?.suppressed, true)
  assert.deepEqual(suppressed?.affected, ['Public/Health', 'Public/Ping'])
  assert.deepEqual(
    suppressed?.suppressions.map((item) => [item.requestId, item.location, item.reason, item.source, item.expires]),
    [
      ['Public/Health', 'POST /health', 'Public endpoints', 'config', '2027-01-01'],
      ['Public/Ping', 'POST /ping', 'Public endpoints', 'config', '2027-01-01'],
    ]
  )
  const parsed = parseCollection(json)
  assert.ok(calculateScore(parsed, result.findings).total >= calculateScore(parsed, before.findings).total)
})

test('suppressing every occurrence removes the finding and a location filter narrows the match', () => {
  const all = detailed(collection(), [{ ruleId: 'MISSING_AUTH', reason: 'Accepted for the prototype' }])
  assert.equal(find(all.findings, 'MISSING_AUTH'), undefined)
  assert.equal(all.suppressed.find((finding) => finding.ruleId === 'MISSING_AUTH')?.suppressions.length, 4)

  const one = detailed(collection(), [{ ruleId: 'MISSING_AUTH', location: 'POST /health', reason: 'Health probe' }])
  assert.deepEqual(find(one.findings, 'MISSING_AUTH')?.affected, ['Public/Ping', 'Private/Create', 'Root'])
  assert.equal(one.suppressed[0].suppressions.length, 1)
  assert.equal(detailed(collection(), [{ ruleId: 'HARDCODED_TOKEN', reason: 'other rule' }]).suppressed.length, 0)
})

test('descriptions that count requests follow the number that remains', () => {
  const json = collection()
  const result = detailed(json, [{ ruleId: 'MISSING_DESCRIPTION', request: 'Private/*', reason: 'Internal' }])
  const missing = find(result.findings, 'MISSING_DESCRIPTION')
  assert.ok(missing === undefined || /^\d+ request/.test(missing.description))
  const noDescriptions = {
    ...collection(),
    item: [1, 2, 3].map((n) => ({ name: `R${n}`, request: { method: 'GET', url: '{{baseUrl}}/x' } })),
  }
  const partial = find(
    detailed(noDescriptions, [{ ruleId: 'MISSING_DESCRIPTION', request: 'R1', reason: 'x' }]).findings,
    'MISSING_DESCRIPTION'
  )
  assert.equal(partial?.description, '2 request(s) have no description.')
})

test('inline suppressions in request, folder and collection descriptions', () => {
  const request = detailed(collection('', '', 'Creates a thing.\npostscope-ignore MISSING_AUTH: Health check is public'))
  assert.deepEqual(find(request.findings, 'MISSING_AUTH')?.affected, ['Public/Ping', 'Private/Create', 'Root'])
  assert.equal(request.suppressed[0].suppressions[0].source, 'inline')

  const folder = detailed(collection('', '- postscope-ignore MISSING_AUTH: Everything public is unauthenticated by design'))
  assert.deepEqual(find(folder.findings, 'MISSING_AUTH')?.affected, ['Private/Create', 'Root'])

  const all = detailed(collection('postscope-ignore missing_auth: prototype collection'))
  assert.equal(find(all.findings, 'MISSING_AUTH'), undefined)
  assert.equal(all.suppressed[0].suppressions.length, 4)
})

test('a suppression without a reason, with an unknown rule or a bad date is not applied and is reported', () => {
  const bad = detailed(
    collection(
      'postscope-ignore MISSING_AUTH\npostscope-ignore MISSING_AUTH:\npostscope-ignore NOT_A_RULE: because\npostscope-ignore MISSING_AUTH expires=soon: later'
    )
  )
  assert.equal(bad.suppressed.length, 0)
  assert.equal(find(bad.findings, 'MISSING_AUTH')?.affected.length, 4)
  const notice = find(bad.findings, 'SUPPRESSION_INVALID')
  assert.equal(notice?.severity, 'info')
  assert.equal(notice?.evidence?.length, 4)
  assert.match(notice?.evidence?.[0].location ?? '', /^description \(collection\): postscope-ignore MISSING_AUTH/)
})

test('expired suppressions stop applying and raise an informational finding', () => {
  const config = [{ ruleId: 'MISSING_AUTH', reason: 'Until the gateway ships', expires: '2026-10-14' }]
  const expired = detailed(collection(), config)
  assert.equal(find(expired.findings, 'MISSING_AUTH')?.affected.length, 4)
  assert.equal(expired.suppressed.length, 0)
  assert.match(
    find(expired.findings, 'SUPPRESSION_EXPIRED')?.evidence?.[0].location ?? '',
    /config suppression MISSING_AUTH \(expired 2026-10-14\)/
  )
  const onTheDay = detailed(collection(), [{ ...config[0], expires: '2026-10-15' }])
  assert.equal(find(onTheDay.findings, 'MISSING_AUTH'), undefined)
  assert.equal(find(onTheDay.findings, 'SUPPRESSION_EXPIRED'), undefined)
  const inline = detailed(collection('postscope-ignore MISSING_AUTH expires=2026-01-01: old decision'))
  assert.match(find(inline.findings, 'SUPPRESSION_EXPIRED')?.evidence?.[0].location ?? '', /\(expired 2026-01-01\)/)
  assert.equal(find(inline.findings, 'MISSING_AUTH')?.affected.length, 4)
})

test('suppressions cover secret findings without exposing values', () => {
  const json = {
    info: { name: 'Secrets' },
    item: [
      {
        name: 'Legacy',
        request: { method: 'GET', url: 'https://x.test', description: 'd', header: [{ key: 'X-API-Key', value: FAKE.apiKey }] },
      },
    ],
  }
  const result = detailed(json, [{ ruleId: 'HARDCODED_API_KEY', request: 'Legacy', reason: 'Sandbox key, rotated monthly' }])
  assert.equal(find(result.findings, 'HARDCODED_API_KEY'), undefined)
  assert.ok(!JSON.stringify(result.suppressed).includes(FAKE.apiKey))
})

test('reports keep suppressed occurrences with their reasons', () => {
  const json = collection()
  const parsed = parseCollection(json)
  const result = runAuditDetailed(parsed, {
    now: NOW,
    suppressions: [{ ruleId: 'MISSING_AUTH', request: 'Public/*', reason: 'Public endpoints' }],
  })
  const ctx = {
    parsed,
    findings: result.findings,
    suppressed: result.suppressed,
    score: calculateScore(parsed, result.findings),
    appVersion: '0.0.0',
  }

  const report = JSON.parse(buildJsonReport(ctx)) as {
    suppressed: Array<{ ruleId: string; suppressed: boolean; suppressions: Array<{ fingerprint: string; reason: string }> }>
    findings: Array<{ ruleId: string; occurrences: Array<{ fingerprint: string }> }>
  }
  assert.equal(report.suppressed[0].suppressed, true)
  assert.equal(report.suppressed[0].suppressions[0].reason, 'Public endpoints')
  assert.match(report.suppressed[0].suppressions[0].fingerprint, /^[0-9a-f]{64}$/)
  assert.ok(report.findings.every((finding) => finding.occurrences.length > 0))

  const sarif = JSON.parse(buildSarifReport(ctx)) as {
    runs: Array<{
      results: Array<{
        ruleId: string
        suppressions?: Array<{ kind: string; status: string; justification: string }>
        partialFingerprints: Record<string, string>
      }>
    }>
  }
  const results = sarif.runs[0].results.filter((result) => result.ruleId === 'MISSING_AUTH')
  assert.equal(results.filter((result) => result.suppressions).length, 2)
  assert.deepEqual(results.find((result) => result.suppressions)?.suppressions, [
    { kind: 'external', status: 'accepted', justification: 'Public endpoints' },
  ])
  assert.ok(results.every((result) => /^[0-9a-f]{64}$/.test(result.partialFingerprints['postscope/v2'])))
  assert.ok(results.every((result) => result.partialFingerprints['postscope/v1']))

  const markdown = buildMarkdownReport(ctx)
  assert.match(markdown, /## Suppressed \(1, not scored\)/)
  assert.match(markdown, /Reason: Public endpoints \(config\)/)
})

test('a baseline hides known occurrences and lets new ones through', () => {
  const parsed = parseCollection(collection())
  const original = runAudit(parsed, { now: NOW })
  const baseline = buildBaseline(original, NOW)
  assert.equal(baseline.version, 1)
  assert.ok(baseline.entries.every((entry) => /^[0-9a-f]{64}$/.test(entry.fingerprint)))
  assert.deepEqual(baseline.entries, parseBaseline(JSON.parse(JSON.stringify(baseline))).entries)
  assert.deepEqual(applyBaseline(original, baseline).findings, [])
  assert.equal(applyBaseline(original, baseline).hidden, baseline.entries.length)

  const grown = collection()
  grown.item.push({
    name: 'Brand new',
    request: { method: 'DELETE', url: '{{baseUrl}}/new', auth: { type: 'noauth' }, description: 'New.' },
  } as never)
  const next = applyBaseline(runAudit(parseCollection(grown), { now: NOW }), baseline)
  assert.deepEqual(
    next.findings.map((finding) => [finding.ruleId, finding.affected]),
    [
      ['MISSING_AUTH', ['Brand new']],
      ['ROOT_LEVEL_REQUESTS', ['Brand new']],
    ]
  )
  assert.deepEqual(
    next.findings[0].evidence?.map((item) => item.location),
    ['DELETE /new']
  )
})

test('baselines are deterministic, contain no values and reject malformed files', () => {
  const json = {
    info: { name: 'Secrets' },
    item: [
      {
        name: 'Legacy',
        request: { method: 'GET', url: 'https://x.test', description: 'd', header: [{ key: 'X-API-Key', value: FAKE.apiKey }] },
      },
    ],
  }
  const findings = runAudit(parseCollection(json))
  const first = JSON.stringify(buildBaseline(findings, NOW))
  assert.equal(first, JSON.stringify(buildBaseline([...findings].reverse(), NOW)))
  assert.ok(!first.includes(FAKE.apiKey))
  assert.throws(() => parseBaseline(null), /not a PostScope baseline/)
  assert.throws(() => parseBaseline({ version: 2, entries: [] }), /unsupported baseline version/)
  assert.throws(() => parseBaseline({ version: 1 }), /no entries/)
  assert.throws(() => parseBaseline({ version: 1, entries: [{ fingerprint: 'short', ruleId: 'X' }] }), /invalid entry/)
})

test('the project config is validated strictly', () => {
  const good = parseProjectConfig({
    disabledRules: ['get_with_body'],
    severityOverrides: { INSECURE_HTTP: 'critical' },
    weights: { critical: 30 },
    rulePacks: ['future'],
    suppressions: [{ ruleId: 'missing_auth', request: 'Public/**', location: 'POST', reason: ' Public ', expires: '2027-02-28' }],
  })
  assert.deepEqual(good.errors, [])
  assert.deepEqual(good.config.disabledRules, ['GET_WITH_BODY'])
  assert.deepEqual(good.config.weights, { critical: 30, warning: 8, info: 2 })
  assert.deepEqual(good.config.suppressions, [
    { ruleId: 'MISSING_AUTH', request: 'Public/**', location: 'POST', reason: 'Public', expires: '2027-02-28' },
  ])

  const bad = parseProjectConfig({
    disabledRule: [],
    disabledRules: ['NOPE'],
    severityOverrides: { MISSING_AUTH: 'urgent' },
    weights: { critical: 'high', fatal: 1 },
    suppressions: [
      { ruleId: 'MISSING_AUTH' },
      { ruleId: 'MISSING_AUTH', reason: '   ' },
      { ruleId: 'NOPE', reason: 'x' },
      { ruleId: 'MISSING_AUTH', reason: 'x', expires: '2027-02-30' },
      { ruleId: 'MISSING_AUTH', reason: 'x', color: 'red' },
      'text',
    ],
  })
  assert.ok(bad.errors.includes('unknown key "disabledRule"'))
  assert.ok(bad.errors.some((error) => error.includes('unknown rule "NOPE"')))
  assert.ok(bad.errors.some((error) => error.includes('severityOverrides.MISSING_AUTH')))
  assert.ok(bad.errors.some((error) => error.includes('weights.critical')))
  assert.ok(bad.errors.some((error) => error.includes('unknown severity "fatal"')))
  assert.equal(bad.errors.filter((error) => error.includes('.reason is required')).length, 2)
  assert.ok(bad.errors.some((error) => error.includes('suppressions[3].expires')))
  assert.ok(bad.errors.some((error) => error.includes('suppressions[4] has unknown key "color"')))
  assert.ok(bad.errors.some((error) => error.includes('suppressions[5] must be an object')))
  assert.deepEqual(parseProjectConfig([]).errors, ['the config must be a JSON object'])
  assert.equal(CONFIG_FILE_NAME, '.postscope.json')
})
