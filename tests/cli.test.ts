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

  const blocking = RULE_LIST.filter((rule) => rule.severity !== 'info').map((rule) => rule.id).join(',')
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
  assert.deepEqual(report.collection.environments.map((item: { name: string }) => item.name), ['Staging', 'Workspace Globals'])
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
  assert.deepEqual(fs.readdirSync(out).sort(), ['collection.json', 'dev.sanitized.postman_environment.json', 'team.sanitized.postman_globals.json'])
  const sanitizedEnvironment = fs.readFileSync(path.join(out, 'dev.sanitized.postman_environment.json'), 'utf8')
  const sanitizedGlobals = fs.readFileSync(path.join(out, 'team.sanitized.postman_globals.json'), 'utf8')
  for (const secret of [FAKE.clientSecret, FAKE.githubToken, FAKE.bearer, FAKE.password]) {
    assert.ok(!sanitizedEnvironment.includes(secret) && !sanitizedGlobals.includes(secret))
  }
  assert.equal(JSON.parse(sanitizedEnvironment).values.find((item: { key: string }) => item.key === 'clientSecret').value, '')
  assert.equal(JSON.parse(sanitizedGlobals).values.find((item: { key: string }) => item.key === 'gatewayHost').value, 'https://gateway.example.com')
})
