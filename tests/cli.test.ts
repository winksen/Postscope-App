import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { FAKE, cleanCollection, environmentExport, globalsExport, kitchenSinkCollection } from './fixtures'
import { RULE_LIST } from '../src/lib/rules'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'postscope-cli-'))
const risky = path.join(tmp, 'risky.postman_collection.json')
const clean = path.join(tmp, 'clean.postman_collection.json')
fs.writeFileSync(risky, JSON.stringify(kitchenSinkCollection()))
fs.writeFileSync(clean, JSON.stringify(cleanCollection()))

after(() => fs.rmSync(tmp, { recursive: true, force: true }))

function cli(...args: string[]) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'cli/postscope.ts', ...args], { encoding: 'utf8', cwd: process.cwd() })
  return { code: result.status, stdout: result.stdout, stderr: result.stderr }
}

test('fails the build on critical findings and passes clean collections', () => {
  const failing = cli(risky)
  assert.equal(failing.code, 1)
  assert.match(failing.stdout, /HARDCODED_AUTH_CREDENTIAL/)
  assert.match(failing.stderr, /FAIL/)
  for (const secret of Object.values(FAKE)) assert.ok(!failing.stdout.includes(secret))

  const passing = cli(clean)
  assert.equal(passing.code, 0)
  assert.match(passing.stderr, /PASS/)
})

test('honors --fail-on none, --min-score, --disable and --severity', () => {
  assert.equal(cli(risky, '--fail-on', 'none').code, 0)
  assert.equal(cli(clean, '--min-score', '100').code, 0)
  assert.equal(cli(risky, '--fail-on', 'none', '--min-score', '90').code, 1)

  const blocking = RULE_LIST.filter((rule) => rule.severity !== 'info')
    .map((rule) => rule.id)
    .join(',')
  assert.equal(cli(risky, '--fail-on', 'warning', '--disable', blocking).code, 0)
  const withoutGetBody = blocking.split(',').concat('GET_WITH_BODY').join(',')
  assert.equal(cli(risky, '--fail-on', 'critical', '--disable', blocking, '--severity', 'GET_WITH_BODY=critical').code, 1)
  assert.equal(cli(risky, '--fail-on', 'critical', '--disable', withoutGetBody).code, 0)
})

test('writes SARIF and sanitized output files', () => {
  const sarifPath = path.join(tmp, 'out.sarif')
  const sanitizedPath = path.join(tmp, 'sanitized.json')
  const result = cli(risky, '--format', 'sarif', '--output', sarifPath, '--sanitize', sanitizedPath, '--fail-on', 'none')
  assert.equal(result.code, 0)
  const sarif = JSON.parse(fs.readFileSync(sarifPath, 'utf8'))
  assert.equal(sarif.version, '2.1.0')
  assert.equal(sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri, 'risky.postman_collection.json')
  const sanitized = fs.readFileSync(sanitizedPath, 'utf8')
  for (const secret of Object.values(FAKE)) assert.ok(!sanitized.includes(secret))
})

test('merges multiple inputs into one JSON array', () => {
  const result = cli(risky, clean, '--format', 'json', '--fail-on', 'none')
  const reports = JSON.parse(result.stdout)
  assert.equal(reports.length, 2)
  assert.equal(reports[1].collection.name, 'Clean')
})

test('reports usage errors with exit code 2', () => {
  assert.equal(cli().code, 2)
  assert.equal(cli(risky, '--format', 'pdf').code, 2)
  assert.equal(cli(risky, '--disable', 'NOT_A_RULE').code, 2)
  const missing = cli(path.join(tmp, 'missing.json'))
  assert.equal(missing.code, 2)
  const notCollection = path.join(tmp, 'not.json')
  fs.writeFileSync(notCollection, '{"hello":"world"}')
  assert.match(cli(notCollection).stderr, /not a Postman collection/)
  assert.match(cli('--list-rules').stdout, /SECRET_IN_QUERY/)
})

test('analyzes environment and globals files passed with --environment and --globals', () => {
  const environment = path.join(tmp, 'staging.postman_environment.json')
  const globals = path.join(tmp, 'workspace.postman_globals.json')
  fs.writeFileSync(environment, JSON.stringify(environmentExport()))
  fs.writeFileSync(globals, JSON.stringify(globalsExport()))

  const result = cli(clean, '-e', environment, '--globals', globals, '--format', 'json', '--fail-on', 'none')
  assert.equal(result.code, 0)
  const report = JSON.parse(result.stdout)
  assert.deepEqual(
    report.collection.environments.map((item: { name: string }) => item.name),
    ['Staging', 'Workspace Globals']
  )
  const finding = report.findings.find((item: { ruleId: string }) => item.ruleId === 'SECRET_IN_ENVIRONMENT')
  assert.equal(finding.severity, 'critical')
  for (const secret of [FAKE.clientSecret, FAKE.password, FAKE.githubToken]) assert.ok(!result.stdout.includes(secret))

  assert.equal(cli(clean, '-e', environment).code, 1)
  assert.match(cli(clean, '-e', environment, '--fail-on', 'none').stdout, /Environments: Staging \(environment\)/)
})

test('rejects missing, invalid and mismatched environment files with exit code 2', () => {
  const notEnvironment = path.join(tmp, 'collection-as-env.json')
  fs.writeFileSync(notEnvironment, JSON.stringify(cleanCollection()))
  const environment = path.join(tmp, 'plain.postman_environment.json')
  fs.writeFileSync(environment, JSON.stringify(environmentExport()))
  assert.equal(cli(clean, '-e', path.join(tmp, 'missing.json')).code, 2)
  assert.match(cli(clean, '-e', notEnvironment).stderr, /not a Postman environment or globals export/)
  assert.match(cli(clean, '--globals', environment).stderr, /--globals expects a globals export/)
  assert.equal(cli(clean, '-e').code, 2)
})

test('--sanitize also writes sanitized environment copies next to the output', () => {
  const environment = path.join(tmp, 'dev.postman_environment.json')
  const globals = path.join(tmp, 'team.postman_globals.json')
  fs.writeFileSync(environment, JSON.stringify(environmentExport()))
  fs.writeFileSync(globals, JSON.stringify(globalsExport()))
  const out = path.join(tmp, 'sanitized-out')
  fs.mkdirSync(out)
  const result = cli(risky, '-e', environment, '--globals', globals, '--sanitize', path.join(out, 'collection.json'), '--fail-on', 'none')
  assert.equal(result.code, 0)
  assert.deepEqual(fs.readdirSync(out).sort(), [
    'collection.json',
    'dev.sanitized.postman_environment.json',
    'team.sanitized.postman_globals.json',
  ])
  const sanitizedEnvironment = fs.readFileSync(path.join(out, 'dev.sanitized.postman_environment.json'), 'utf8')
  const sanitizedGlobals = fs.readFileSync(path.join(out, 'team.sanitized.postman_globals.json'), 'utf8')
  for (const secret of [FAKE.clientSecret, FAKE.githubToken, FAKE.bearer, FAKE.password]) {
    assert.ok(!sanitizedEnvironment.includes(secret) && !sanitizedGlobals.includes(secret))
  }
  assert.equal(JSON.parse(sanitizedEnvironment).values.find((item: { key: string }) => item.key === 'clientSecret').value, '')
  assert.equal(
    JSON.parse(sanitizedGlobals).values.find((item: { key: string }) => item.key === 'gatewayHost').value,
    'https://gateway.example.com'
  )
})

test('--weights changes the score and invalid weights are usage errors', () => {
  const score = (...args: string[]) =>
    JSON.parse(cli(risky, '--format', 'json', '--fail-on', 'none', ...args).stdout).score as {
      total: number
      security: number
      hygiene: number
      scoreModel: number
    }
  const defaults = score()
  const light = score('--weights', 'critical=2,warning=1,info=0')
  const none = score('--weights', 'critical=0,warning=0,info=0')
  assert.equal(defaults.scoreModel, 2)
  assert.ok(light.security > defaults.security)
  assert.equal(none.total, 100)
  assert.equal(cli(risky, '--weights', 'critical=abc').code, 2)
  assert.equal(cli(risky, '--weights', 'fatal=5').code, 2)
  assert.match(cli(risky, '--fail-on', 'none').stdout, /security \d+, hygiene \d+/)
  assert.equal(cli(risky, '--fail-on', 'none', '--min-score', '80', '--weights', 'critical=1,warning=1,info=0').code, 0)
  assert.equal(cli(risky, '--fail-on', 'none', '--min-score', '80').code, 1)
})

/** A small project folder with its own config; the CLI looks for `.postscope.json` above the scanned file. */
function project(config: unknown, collection: unknown = kitchenSinkCollection()) {
  const dir = fs.mkdtempSync(path.join(tmp, 'project-'))
  const nested = path.join(dir, 'collections', 'api')
  fs.mkdirSync(nested, { recursive: true })
  const file = path.join(nested, 'api.postman_collection.json')
  fs.writeFileSync(file, JSON.stringify(collection))
  if (config !== undefined) fs.writeFileSync(path.join(dir, '.postscope.json'), JSON.stringify(config))
  return { dir, file }
}

const rulesIn = (stdout: string) => JSON.parse(stdout).findings as Array<{ ruleId: string; severity: string }>

test('a project config is found above the scanned file and applies rules, severities and weights', () => {
  const { file, dir } = project({
    disabledRules: ['GET_WITH_BODY', 'MISSING_DESCRIPTION'],
    severityOverrides: { INSECURE_HTTP: 'critical' },
    weights: { critical: 0, warning: 0, info: 0 },
  })
  const result = cli(file, '--format', 'json', '--fail-on', 'none')
  assert.equal(result.code, 0)
  const findings = rulesIn(result.stdout)
  assert.ok(!findings.some((finding) => finding.ruleId === 'GET_WITH_BODY' || finding.ruleId === 'MISSING_DESCRIPTION'))
  assert.equal(findings.find((finding) => finding.ruleId === 'INSECURE_HTTP')?.severity, 'critical')
  assert.equal(JSON.parse(result.stdout).score.total, 100)
  assert.match(result.stderr, new RegExp(`Config: ${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))

  assert.ok(
    rulesIn(cli(file, '--no-config', '--format', 'json', '--fail-on', 'none').stdout).some((finding) => finding.ruleId === 'GET_WITH_BODY')
  )
  const elsewhere = path.join(dir, 'other-config.json')
  fs.writeFileSync(elsewhere, JSON.stringify({ disabledRules: ['INSECURE_HTTP'] }))
  const explicit = rulesIn(cli(file, '--config', elsewhere, '--format', 'json', '--fail-on', 'none').stdout)
  assert.ok(
    !explicit.some((finding) => finding.ruleId === 'INSECURE_HTTP') && explicit.some((finding) => finding.ruleId === 'GET_WITH_BODY')
  )
})

test('command line flags add to and override the config', () => {
  const { file } = project({ disabledRules: ['GET_WITH_BODY'], severityOverrides: { INSECURE_HTTP: 'critical' } })
  const findings = rulesIn(
    cli(file, '--format', 'json', '--fail-on', 'none', '--disable', 'MISSING_DESCRIPTION', '--severity', 'INSECURE_HTTP=info').stdout
  )
  assert.ok(!findings.some((finding) => ['GET_WITH_BODY', 'MISSING_DESCRIPTION'].includes(finding.ruleId)))
  assert.equal(findings.find((finding) => finding.ruleId === 'INSECURE_HTTP')?.severity, 'info')
})

test('an invalid config is a usage error that lists every problem', () => {
  const { file } = project({ disabledRule: [], suppressions: [{ ruleId: 'MISSING_AUTH' }] })
  const result = cli(file)
  assert.equal(result.code, 2)
  assert.match(result.stderr, /invalid project config/)
  assert.match(result.stderr, /unknown key "disabledRule"/)
  assert.match(result.stderr, /suppressions\[0\]\.reason is required/)
  assert.equal(cli(clean, '--config', path.join(tmp, 'nope.json')).code, 2)
  assert.equal(cli(clean, '--config', path.join(tmp, 'x.json'), '--no-config').code, 2)
})

test('suppressions with a reason hide findings from the result, the exit code and the score but not from reports', () => {
  const { file } = project(undefined)
  const withoutSuppression = JSON.parse(cli(file, '--format', 'json', '--fail-on', 'none', '--no-config').stdout)
  const critical = (withoutSuppression.findings as Array<{ ruleId: string; severity: string }>)
    .filter((finding) => finding.severity === 'critical')
    .map((finding) => finding.ruleId)
  assert.ok(critical.length > 0)
  assert.equal(cli(file).code, 1)

  const accepted = project({
    suppressions: critical.map((ruleId) => ({ ruleId, reason: 'Accepted for the demo collection', expires: '2999-01-01' })),
  })
  const result = cli(accepted.file, '--format', 'json')
  assert.equal(result.code, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.ok(report.findings.every((finding: { severity: string }) => finding.severity !== 'critical'))
  assert.ok(report.suppressed.length > 0)
  assert.ok(report.score.total > withoutSuppression.score.total)
  assert.match(result.stderr, /Suppressed: \d+ occurrence\(s\)/)
  assert.ok(!result.stdout.includes(FAKE.githubToken))
})

test('expired config suppressions are reported and no longer hide anything', () => {
  const { file } = project({ suppressions: [{ ruleId: 'HARDCODED_API_KEY', reason: 'Temporary', expires: '2020-01-01' }] })
  const report = JSON.parse(cli(file, '--format', 'json', '--fail-on', 'none').stdout)
  const ids = (report.findings as Array<{ ruleId: string }>).map((finding) => finding.ruleId)
  assert.ok(ids.includes('HARDCODED_API_KEY') && ids.includes('SUPPRESSION_EXPIRED'))
})

test('--write-baseline records today and --baseline only reports what is new', () => {
  const { file, dir } = project(undefined)
  const baselineFile = path.join(dir, 'postscope-baseline.json')
  const written = cli(file, '--write-baseline', baselineFile)
  assert.equal(written.code, 0)
  assert.match(written.stderr, /baseline of \d+ occurrence\(s\) written/)
  const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'))
  assert.equal(baseline.version, 1)
  assert.ok(baseline.entries.length > 10)
  for (const secret of Object.values(FAKE)) assert.ok(!JSON.stringify(baseline).includes(secret))

  const unchanged = cli(file, '--baseline', baselineFile, '--format', 'json')
  assert.equal(unchanged.code, 0, unchanged.stderr)
  assert.deepEqual(JSON.parse(unchanged.stdout).findings, [])
  assert.equal(JSON.parse(unchanged.stdout).baseline.hiddenOccurrences, baseline.entries.length)

  const grown = kitchenSinkCollection() as { item: unknown[] }
  grown.item.push({
    name: 'Leaky new request',
    request: { method: 'GET', url: 'https://new.example.com/x', header: [{ key: 'X-API-Key', value: FAKE.apiKey }] },
  })
  fs.writeFileSync(file, JSON.stringify(grown))
  const regression = cli(file, '--baseline', baselineFile, '--format', 'json')
  assert.equal(regression.code, 1)
  const findings = JSON.parse(regression.stdout).findings as Array<{ ruleId: string; affected: Array<{ id: string }> }>
  assert.ok(
    findings.some((finding) => finding.ruleId === 'HARDCODED_API_KEY' && finding.affected.every((item) => item.id === 'Leaky new request'))
  )
})

test('baseline problems are usage errors', () => {
  assert.equal(cli(clean, '--baseline', path.join(tmp, 'missing-baseline.json')).code, 2)
  const broken = path.join(tmp, 'broken-baseline.json')
  fs.writeFileSync(broken, '{"version": 9}')
  assert.match(cli(clean, '--baseline', broken).stderr, /unsupported baseline version/)
  assert.equal(cli(clean, '--baseline', broken, '--write-baseline', broken).code, 2)
})

test('--format html writes one self-contained report without secrets', () => {
  const result = cli(risky, '--format', 'html', '--fail-on', 'none')
  assert.equal(result.code, 0)
  assert.match(result.stdout, /^<!doctype html>/)
  assert.ok(!/<script/i.test(result.stdout))
  for (const secret of Object.values(FAKE)) assert.ok(!result.stdout.includes(secret))
  const two = cli(risky, clean, '--format', 'html', '--fail-on', 'none').stdout
  assert.equal(two.match(/<!doctype html>/g)?.length, 1)
  assert.match(two, /2 collections/)
})

test('SARIF from the CLI points at the exact line and column, also in CRLF files', () => {
  for (const eol of ['\n', '\r\n']) {
    const file = path.join(tmp, `crlf-${eol.length}.postman_collection.json`)
    fs.writeFileSync(file, JSON.stringify(kitchenSinkCollection(), null, 2).replace(/\n/g, eol))
    const sarif = JSON.parse(cli(file, '--format', 'sarif', '--fail-on', 'none').stdout)
    const run = sarif.runs[0]
    assert.equal(run.invocations[0].executionSuccessful, true)
    const result = run.results.find((candidate: { ruleId: string }) => candidate.ruleId === 'HARDCODED_API_KEY')
    const { startLine, startColumn } = result.locations[0].physicalLocation.region
    const line = fs.readFileSync(file, 'utf8').split(/\r?\n/)[startLine - 1]
    assert.ok(line.slice(startColumn - 1).startsWith(`"${FAKE.apiKey}"`), `${JSON.stringify(line)} @${startColumn}`)
  }
})

test('the JSON report is version 2 and every evidence entry names a pointer where possible', () => {
  const report = JSON.parse(cli(risky, '--format', 'json', '--fail-on', 'none').stdout)
  assert.equal(report.reportVersion, 2)
  const evidence = report.findings.flatMap((finding: { evidence: Array<{ pointer?: string }> }) => finding.evidence)
  assert.ok(evidence.filter((entry: { pointer?: string }) => entry.pointer).length / evidence.length > 0.9)
})

test('folders and quoted globs are expanded by the CLI, and `scan` is accepted as a subcommand', () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'tree-'))
  fs.mkdirSync(path.join(dir, 'a', 'b'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'one.postman_collection.json'), JSON.stringify(cleanCollection()))
  fs.writeFileSync(path.join(dir, 'a', 'b', 'two.postman_collection.json'), JSON.stringify(kitchenSinkCollection()))
  fs.writeFileSync(path.join(dir, 'a', 'ignored.json'), '{}')

  const folder = JSON.parse(cli('scan', dir, '--no-config', '--format', 'json', '--fail-on', 'none').stdout) as Array<{
    collection: { name: string }
  }>
  assert.deepEqual(
    folder.map((report) => report.collection.name),
    ['Kitchen sink', 'Clean']
  )
  const glob = JSON.parse(
    cli(path.join(dir, '**', '*.postman_collection.json'), '--no-config', '--format', 'json', '--fail-on', 'none').stdout
  ) as unknown[]
  assert.equal(glob.length, 2)
  assert.equal(cli('scan', path.join(dir, 'a', '*.nothing')).code, 2)
  assert.match(cli(path.join(dir, 'empty-*')).stderr, /no files match this pattern/)
  assert.equal(cli('scan', dir, '--no-config', '--sanitize', path.join(tmp, 'x.json')).code, 2)
})

test('--auto-env analyzes the environment files stored next to each collection', () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'auto-env-'))
  fs.writeFileSync(path.join(dir, 'api.postman_collection.json'), JSON.stringify(cleanCollection()))
  fs.writeFileSync(path.join(dir, 'api.postman_environment.json'), JSON.stringify(environmentExport()))
  const names = (args: string[]) =>
    (JSON.parse(cli(...args, '--no-config', '--format', 'json', '--fail-on', 'none').stdout).collection.environments ?? []).map(
      (item: { name: string }) => item.name
    )
  assert.deepEqual(names([path.join(dir, 'api.postman_collection.json')]), [])
  assert.deepEqual(names([path.join(dir, 'api.postman_collection.json'), '--auto-env']), ['Staging'])
  assert.deepEqual(names([dir, '--auto-env', '-e', path.join(dir, 'api.postman_environment.json')]), ['Staging'])
})

test('--format junit produces well-formed XML with failures, passes and skips', () => {
  const { file } = project({ suppressions: [{ ruleId: 'HARDCODED_API_KEY', reason: 'Sandbox key', expires: '2999-01-01' }] })
  const result = cli(file, '--format', 'junit', '--fail-on', 'critical')
  assert.equal(result.code, 1)
  const xml = result.stdout
  const stack: string[] = []
  for (const tag of xml.replace(/<\?xml[^>]*\?>/, '').matchAll(/<(\/?)([A-Za-z-]+)[^>]*?(\/?)>/g)) {
    if (tag[3] === '/') continue
    if (tag[1] === '/') assert.equal(stack.pop(), tag[2])
    else stack.push(tag[2])
  }
  assert.deepEqual(stack, [])
  assert.match(xml, /<testsuites name="PostScope" tests="\d+" failures="[1-9]\d*" errors="0" skipped="[1-9]/)
  assert.match(xml, /<failure message="[^"]+" type="critical">/)
  assert.match(xml, /<skipped message="Suppressed: Sandbox key"\/>/)
  assert.match(xml, /<system-out>/)
  for (const secret of Object.values(FAKE)) assert.ok(!xml.includes(secret))
  const lenient = cli(file, '--format', 'junit', '--fail-on', 'none').stdout
  assert.match(lenient, /failures="0"/)
  assert.ok(!/<failure/.test(lenient))
})
