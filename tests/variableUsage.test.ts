import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCollection } from '../src/lib/parser'
import { attachEnvironments, withActiveEnvironment } from '../src/lib/environment'
import { runAudit, sanitizeAuditOptions, type Finding } from '../src/lib/auditor'
import { analyzeVariableUsage } from '../src/lib/variableUsage'
import { applyRepairPlan, createRepairPlan } from '../src/lib/repairEngine'
import { cleanCollection } from './fixtures'

const script = (exec: string, listen = 'prerequest') => [{ listen, script: { exec: [exec] } }]

function collection(overrides: Record<string, unknown> = {}, request: Record<string, unknown> = {}, item: Record<string, unknown> = {}) {
  return {
    info: { name: 'Variables' },
    variable: [{ key: 'baseUrl', value: 'https://api.example.com' }],
    item: [{ name: 'R', ...item, request: { method: 'GET', url: '{{baseUrl}}/users', description: 'd', ...request } }],
    ...overrides,
  }
}

function find(findings: Finding[], ruleId: string) {
  return findings.find((finding) => finding.ruleId === ruleId)
}

const locations = (finding: Finding | undefined) => (finding?.evidence ?? []).map((item) => item.location)

test('references in URLs, headers, query, bodies and auth are checked against definitions', () => {
  const json = collection(
    {},
    {
      url: '{{baseUrl}}/users/{{userId}}?key={{apiKey}}',
      header: [
        { key: 'X-Tenant', value: '{{tenant}}' },
        { key: 'X-Off', value: '{{disabledOnly}}', disabled: true },
      ],
      body: { mode: 'raw', raw: '{"id": {{bodyId}}, "when": "{{$isoTimestamp}}"}' },
      auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{authToken}}' }] },
    }
  )
  const finding = find(runAudit(parseCollection(json)), 'UNDEFINED_VARIABLE')
  assert.deepEqual(locations(finding).sort(), [
    '{{apiKey}} in url',
    '{{authToken}} in auth',
    '{{bodyId}} in body',
    '{{tenant}} in header X-Tenant',
    '{{userId}} in url',
  ])
  assert.deepEqual(finding?.affected, ['R'])
})

test('definitions from collection, folder, request, script and iteration data variables satisfy references', () => {
  const json = {
    info: { name: 'Defined' },
    variable: [{ key: 'baseUrl', value: 'https://api.example.com' }],
    event: script("pm.collectionVariables.set('fromCollectionScript', '1')"),
    item: [
      {
        name: 'Folder',
        variable: [{ key: 'folderVar', value: '1' }],
        item: [
          {
            name: 'Inside',
            variable: [{ key: 'requestVar', value: '1' }],
            event: script("pm.environment.set('token', pm.response.json().token); const v = pm.iterationData.get('row')"),
            request: {
              method: 'GET',
              url: '{{baseUrl}}/{{folderVar}}/{{requestVar}}/{{fromCollectionScript}}/{{token}}/{{row}}',
              description: 'd',
            },
          },
          { name: 'Outside request var', request: { method: 'GET', url: '{{baseUrl}}/{{requestVar}}', description: 'd' } },
        ],
      },
      { name: 'Outside folder', request: { method: 'GET', url: '{{baseUrl}}/{{folderVar}}', description: 'd' } },
    ],
  }
  const finding = find(runAudit(parseCollection(json)), 'UNDEFINED_VARIABLE')
  assert.deepEqual(locations(finding).sort(), ['{{folderVar}} in url', '{{requestVar}} in url'])
  assert.deepEqual(finding?.affected.sort(), ['Folder/Outside request var', 'Outside folder'])
})

test('pm.get references and replaceIn strings in scripts are checked', () => {
  const json = collection(
    {},
    {},
    {
      event: [
        ...script("const a = pm.environment.get('envOnly'); const b = pm.variables.get('computed'); pm.variables.replaceIn('{{inline}}')"),
        ...script("pm.environment.get('fromTest')", 'test'),
      ],
    }
  )
  const finding = find(runAudit(parseCollection(json)), 'UNDEFINED_VARIABLE')
  assert.deepEqual(locations(finding).sort(), [
    '{{computed}} in pre-request script',
    '{{envOnly}} in pre-request script',
    '{{fromTest}} in test script',
    '{{inline}} in pre-request script',
  ])
})

test('without a loaded environment the finding is informational and says so', () => {
  const finding = find(runAudit(parseCollection(collection({}, { url: '{{baseUrl}}/{{missing}}' }))), 'UNDEFINED_VARIABLE')
  assert.equal(finding?.severity, 'info')
  assert.match(finding?.description ?? '', /may be defined in an environment that was not loaded/)
  assert.equal(finding?.category, 'variables')
})

test('with an environment loaded the finding is a warning and the environment satisfies references', () => {
  const env = (name: string, keys: string[]) =>
    JSON.stringify({ name, values: keys.map((key) => ({ key, value: 'v', enabled: true })), _postman_variable_scope: 'environment' })
  const globals = JSON.stringify({
    name: 'G',
    values: [{ key: 'fromGlobals', value: 'v', enabled: true }],
    _postman_variable_scope: 'globals',
  })
  const json = collection({}, { url: '{{baseUrl}}/{{inStaging}}/{{inProd}}/{{fromGlobals}}/{{missing}}' })
  const parsed = attachEnvironments(parseCollection(json), [env('Staging', ['inStaging']), env('Prod', ['inProd']), globals])
  let finding = find(runAudit(parsed), 'UNDEFINED_VARIABLE')
  assert.equal(finding?.severity, 'warning')
  assert.deepEqual(locations(finding).sort(), ['{{inProd}} in url', '{{missing}} in url'])
  finding = find(runAudit(withActiveEnvironment(parsed, 1)), 'UNDEFINED_VARIABLE')
  assert.deepEqual(locations(finding).sort(), ['{{inStaging}} in url', '{{missing}} in url'])
  const disabledEnvironment = attachEnvironments(parseCollection(json), [
    JSON.stringify({ name: 'E', values: [{ key: 'inStaging', value: 'v', enabled: false }], _postman_variable_scope: 'environment' }),
  ])
  assert.ok(locations(find(runAudit(disabledEnvironment), 'UNDEFINED_VARIABLE')).includes('{{inStaging}} in url'))
})

test('scripts that set variables with computed names make the finding informational', () => {
  const json = collection({}, { url: '{{baseUrl}}/{{missing}}' }, { event: script('pm.environment.set(name, value)') })
  const parsed = attachEnvironments(parseCollection(json), [
    JSON.stringify({ name: 'E', values: [], _postman_variable_scope: 'environment' }),
  ])
  const finding = find(runAudit(parsed), 'UNDEFINED_VARIABLE')
  assert.equal(finding?.severity, 'info')
  assert.match(finding?.description ?? '', /computed names/)
})

test('a user severity override wins over the automatic downgrade', () => {
  const findings = runAudit(
    parseCollection(collection({}, { url: '{{baseUrl}}/{{missing}}' })),
    sanitizeAuditOptions({ severityOverrides: { UNDEFINED_VARIABLE: 'critical' } })
  )
  assert.equal(find(findings, 'UNDEFINED_VARIABLE')?.severity, 'critical')
})

test('unused collection variables are reported once nothing references them', () => {
  const json = collection(
    {
      variable: [
        { key: 'baseUrl', value: 'https://api.example.com' },
        { key: 'usedInUrl', value: '1' },
        { key: 'usedInScript', value: '1' },
        { key: 'usedInOtherVariable', value: '1' },
        { key: 'usedInDisabledHeader', value: '1' },
        { key: 'dataFile', value: '1' },
        { key: 'neverUsed', value: 'x' },
        { key: 'alsoUnused', value: 'y' },
        { key: 'apiKey', value: '' },
        { key: 'token', value: '' },
        { key: 'composed', value: '{{usedInOtherVariable}}/x' },
      ],
    },
    {
      url: '{{baseUrl}}/{{usedInUrl}}/{{composed}}',
      header: [{ key: 'X', value: '{{usedInDisabledHeader}}', disabled: true }],
    },
    {
      event: script("pm.collectionVariables.get('usedInScript'); pm.iterationData.get('dataFile')"),
    }
  )
  const finding = find(runAudit(parseCollection(json)), 'UNUSED_COLLECTION_VARIABLE')
  assert.equal(finding?.severity, 'info')
  assert.equal(finding?.category, 'hygiene')
  assert.deepEqual(locations(finding), ['collection variable neverUsed', 'collection variable alsoUnused'])
  assert.deepEqual(finding?.affected, [])
})

test('variable statistics match the findings', () => {
  const usage = analyzeVariableUsage(parseCollection(collection({}, { url: '{{baseUrl}}/{{missing}}/{{missing}}' })))
  assert.deepEqual([...usage.undefinedNames.keys()], ['missing'])
  assert.equal(usage.undefinedNames.get('missing')?.length, 1, 'one reference per request and place')
  assert.equal(usage.definedAnywhere.has('baseUrl'), true)
  assert.equal(usage.referencedAnywhere.has('missing'), true)
  assert.deepEqual(usage.unusedCollectionVariables, [])
})

test('the clean fixture raises neither rule', () => {
  const findings = runAudit(parseCollection(cleanCollection()))
  assert.ok(!find(findings, 'UNDEFINED_VARIABLE') && !find(findings, 'UNUSED_COLLECTION_VARIABLE'))
})

test('repair adds empty placeholders for undefined variables, off by default', () => {
  const original = collection({}, { url: '{{baseUrl}}/{{missing}}/{{otherMissing}}' })
  const parsed = parseCollection(original)
  const plan = createRepairPlan(original, parsed, runAudit(parsed))
  const fix = plan.fixes.find((candidate) => candidate.kind === 'undefinedVariables')!
  assert.equal(fix.status, 'auto')
  assert.equal(fix.risk, 'low')
  assert.equal(fix.selectedByDefault, false)
  assert.ok(!plan.defaultSelectedFixIds.includes(fix.id))
  const { fixedJson, applied } = applyRepairPlan(original, [fix.id], plan)
  assert.equal(applied.length, 1)
  const variables = (fixedJson as { variable: Array<{ key: string; value: string }> }).variable
  assert.deepEqual(
    variables.map((variable) => variable.key),
    ['baseUrl', 'missing', 'otherMissing']
  )
  assert.ok(!find(runAudit(parseCollection(fixedJson)), 'UNDEFINED_VARIABLE'))
})
