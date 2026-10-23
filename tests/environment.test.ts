import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activeEnvironmentOf, attachEnvironments, detectEnvironmentKind, isCollectionJson, lookupVariableValue, parseEnvironment, withActiveEnvironment } from '../src/lib/environment'
import { parseCollection } from '../src/lib/parser'
import { runAudit, type Finding } from '../src/lib/auditor'
import { redactEnvironment } from '../src/lib/redaction'
import { buildJsonReport, buildMarkdownReport } from '../src/lib/reportExport'
import { calculateScore } from '../src/lib/scorer'
import { FAKE, cleanCollection, environmentExport, globalsExport } from './fixtures'

const text = (json: unknown) => JSON.stringify(json)

function withEnvironments(collection: unknown, ...environments: unknown[]) {
  return attachEnvironments(parseCollection(collection), environments.map(text))
}

test('detects environment and globals exports and tells them apart from collections', () => {
  assert.equal(detectEnvironmentKind(environmentExport()), 'environment')
  assert.equal(detectEnvironmentKind(globalsExport()), 'globals')
  assert.equal(detectEnvironmentKind({ values: [] }), 'environment')
  assert.equal(detectEnvironmentKind({ values: [] }, 'x.postman_globals.json'), 'globals')
  assert.equal(detectEnvironmentKind(cleanCollection()), null)
  assert.equal(detectEnvironmentKind({ name: 'no values' }), null)
  assert.equal(detectEnvironmentKind(null), null)
  assert.equal(isCollectionJson(cleanCollection()), true)
  assert.equal(isCollectionJson(environmentExport()), false)
})

test('parses variables, types and the enabled flag', () => {
  const parsed = parseEnvironment(environmentExport('Staging'))
  assert.equal(parsed.name, 'Staging')
  assert.equal(parsed.kind, 'environment')
  assert.equal(parsed.variables.length, 8)
  assert.deepEqual(parsed.variables.find((variable) => variable.key === 'apiToken'), { key: 'apiToken', value: FAKE.bearer, type: 'default', enabled: false })
  assert.equal(parseEnvironment({ values: [{ key: 'a', value: 1 }, { value: 'no key' }, 'junk'] }).variables.length, 1)
  assert.equal(parseEnvironment({ values: [] }).name, 'Environment')
  assert.throws(() => parseEnvironment({ item: [] }), /Invalid Postman environment format/)
})

test('unreadable environment files become parse warnings instead of failing the analysis', () => {
  const parsed = attachEnvironments(parseCollection(cleanCollection()), ['{ not json', text(environmentExport())])
  assert.equal(parsed.environments?.length, 1)
  assert.match(parsed.parseWarnings?.[0] ?? '', /Environment file 1 could not be read/)
  assert.equal(attachEnvironments(parseCollection(cleanCollection()), []).environments, undefined)
})

test('flags secrets in environment and globals files with precise evidence', () => {
  const parsed = withEnvironments(cleanCollection(), environmentExport(), globalsExport())
  const findings = runAudit(parsed)
  const finding = findings.find((candidate) => candidate.ruleId === 'SECRET_IN_ENVIRONMENT')
  assert.equal(finding?.severity, 'critical')
  assert.equal(finding?.category, 'secrets')
  assert.equal(finding?.cwe, 'CWE-798')
  assert.deepEqual(finding?.evidence?.map((item) => item.location), [
    'environment "Staging" variable clientSecret',
    'environment "Staging" variable sessionNote',
    'environment "Staging" variable apiToken (disabled)',
    'environment "Staging" variable githubKey (GitHub token)',
    'globals "Workspace Globals" variable adminPassword',
  ])
  const serialized = JSON.stringify(finding)
  for (const secret of [FAKE.clientSecret, FAKE.bearer, FAKE.githubToken, FAKE.password]) assert.ok(!serialized.includes(secret))
})

test('empty secret values, URLs and plain settings are not reported', () => {
  const clean = { ...environmentExport(), values: [{ key: 'emptySecret', value: '', type: 'secret', enabled: true }, { key: 'region', value: 'eu-west-1', enabled: true }, { key: 'tokenUrl', value: 'https://login.example.com/token', enabled: true }, { key: 'password', value: '{{vaultPassword}}', enabled: true }] }
  assert.ok(!runAudit(withEnvironments(cleanCollection(), clean)).some((finding: Finding) => finding.ruleId === 'SECRET_IN_ENVIRONMENT'))
})

test('requests that use a leaked environment variable are listed as affected', () => {
  const collection = {
    info: { name: 'Uses env secret' },
    item: [{ name: 'Token', request: { method: 'POST', url: '{{baseUrl}}/token', auth: { type: 'noauth' }, description: 'd', body: { mode: 'raw', raw: '{"client_secret": "{{clientSecret}}"}' } } }],
  }
  const finding = runAudit(withEnvironments(collection, environmentExport())).find((candidate) => candidate.ruleId === 'SECRET_IN_ENVIRONMENT')
  assert.deepEqual(finding?.affected, ['Token'])
})

test('base URLs are resolved through the selected environment for transport checks', () => {
  const collection = {
    info: { name: 'Transport' },
    variable: [{ key: 'baseUrl', value: 'https://api.example.com' }],
    item: [{ name: 'List', request: { method: 'GET', url: '{{baseUrl}}/users', description: 'd' } }],
  }
  const without = runAudit(parseCollection(collection))
  assert.ok(!without.some((finding) => finding.ruleId === 'INSECURE_HTTP'))
  const parsed = withEnvironments(collection, environmentExport('Staging', 'http://staging.corp.internal'), environmentExport('Prod', 'https://prod.corp.internal'))
  assert.equal(runAudit(parsed).find((finding) => finding.ruleId === 'INSECURE_HTTP')?.evidence?.[0]?.preview, 'http://staging.corp.internal')
  const prod = withActiveEnvironment(parsed, 1)
  assert.equal(activeEnvironmentOf(prod)?.name, 'Prod')
  assert.ok(!runAudit(prod).some((finding) => finding.ruleId === 'INSECURE_HTTP'))
})

test('variable lookup follows environment, then collection, then globals', () => {
  const parsed = withEnvironments(
    { info: { name: 'Scopes' }, variable: [{ key: 'a', value: 'from-collection' }, { key: 'b', value: 'from-collection' }], item: [] },
    { name: 'Env', values: [{ key: 'a', value: 'from-environment', enabled: true }, { key: 'off', value: 'ignored', enabled: false }], _postman_variable_scope: 'environment' },
    { name: 'Globals', values: [{ key: 'a', value: 'from-globals', enabled: true }, { key: 'c', value: 'from-globals', enabled: true }], _postman_variable_scope: 'globals' }
  )
  assert.equal(lookupVariableValue(parsed, 'a'), 'from-environment')
  assert.equal(lookupVariableValue(parsed, 'b'), 'from-collection')
  assert.equal(lookupVariableValue(parsed, 'c'), 'from-globals')
  assert.equal(lookupVariableValue(parsed, 'off'), undefined)
  assert.equal(withActiveEnvironment(parsed, 1), parsed)
})

test('sanitizing an environment empties secret values and nothing else', () => {
  const original = environmentExport()
  const { json, redactedCount } = redactEnvironment(original)
  assert.equal(redactedCount, 4)
  const values = (json as { values: Array<{ key: string; value: string; type?: string; enabled: boolean }> }).values
  for (const key of ['clientSecret', 'sessionNote', 'apiToken', 'githubKey']) assert.equal(values.find((variable) => variable.key === key)?.value, '', key)
  assert.equal(values.find((variable) => variable.key === 'clientId')?.value, 'client-12345')
  assert.equal(values.find((variable) => variable.key === 'baseUrl')?.value, 'http://staging.corp.internal')
  assert.equal(values.find((variable) => variable.key === 'sessionNote')?.type, 'secret')
  assert.equal((json as { name: string }).name, 'Staging')
  assert.ok(!JSON.stringify(json).includes(FAKE.clientSecret))
  assert.equal(redactEnvironment(json).redactedCount, 0)
  assert.equal((original.values as Array<{ value: string }>)[2].value, FAKE.clientSecret, 'input is not mutated')
})

test('reports list the loaded environments', () => {
  const parsed = withEnvironments(cleanCollection(), environmentExport(), globalsExport())
  const findings = runAudit(parsed)
  const ctx = { parsed, findings, score: calculateScore(parsed, findings), appVersion: '0.0.0' }
  const json = JSON.parse(buildJsonReport(ctx)) as { collection: { environments: Array<{ name: string; kind: string; variableCount: number; active: boolean }> } }
  assert.deepEqual(json.collection.environments, [
    { name: 'Staging', kind: 'environment', variableCount: 8, active: true },
    { name: 'Workspace Globals', kind: 'globals', variableCount: 2, active: false },
  ])
  assert.match(buildMarkdownReport(ctx), /\| Environments \| Staging \(environment\), Workspace Globals \(globals\) \|/)
})
