import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FAKE, environmentExport, kitchenSinkCollection } from './fixtures'
import { analyzeCollectionText, auditAgain } from '../src/lib/analyzeCollection'

// No Web Worker exists under Node, so these exercise the main-thread fallback with the same contract as the worker.

test('auditAgain applies new rule settings without parsing again', async () => {
  const raw = JSON.stringify(kitchenSinkCollection())
  const first = await analyzeCollectionText(raw)
  assert.ok(first.findings.some((finding) => finding.ruleId === 'HARDCODED_AUTH_CREDENTIAL'))

  const second = await auditAgain({ disabledRules: ['HARDCODED_AUTH_CREDENTIAL'] })
  assert.ok(second)
  assert.ok(!second.findings.some((finding) => finding.ruleId === 'HARDCODED_AUTH_CREDENTIAL'))
  assert.equal(second.parsed.requests.length, first.parsed.requests.length)

  const third = await auditAgain({})
  assert.ok(third?.findings.some((finding) => finding.ruleId === 'HARDCODED_AUTH_CREDENTIAL'))
})

test('the reference collection has its own slot and never replaces the one on screen', async () => {
  const main = await analyzeCollectionText(JSON.stringify(kitchenSinkCollection()), undefined, { slot: 'main' })
  const other = {
    info: { name: 'Other', schema: 'x' },
    item: [{ name: 'Only', request: { method: 'GET', url: 'https://example.com/only', description: 'Only.' } }],
  }
  const reference = await analyzeCollectionText(JSON.stringify(other), undefined, { slot: 'reference' })
  assert.equal(reference.parsed.requests.length, 1)

  const again = await auditAgain({ disabledRules: ['MISSING_DESCRIPTION'] })
  assert.equal(again?.parsed.name, main.parsed.name)
  const referenceAgain = await auditAgain({}, { slot: 'reference' })
  assert.equal(referenceAgain?.parsed.name, 'Other')
})

test('another environment can be selected and audited from the cached analysis', async () => {
  const environments = [
    JSON.stringify(environmentExport('Staging', 'http://staging.corp.internal')),
    JSON.stringify(environmentExport('Production', 'https://api.corp.example')),
  ]
  const raw = JSON.stringify(kitchenSinkCollection())
  const first = await analyzeCollectionText(raw, undefined, { environments })
  const firstSelected = first.parsed.activeEnvironment
  assert.equal(first.parsed.environments?.[firstSelected ?? -1]?.name, 'Staging')

  const production = await auditAgain(undefined, { activeEnvironment: 1 })
  assert.equal(production?.parsed.activeEnvironment, 1)
  assert.equal(production?.parsed.environments?.length, 2)

  const direct = await analyzeCollectionText(raw, undefined, { environments, activeEnvironment: 1 })
  assert.equal(direct.parsed.activeEnvironment, 1)
  assert.deepEqual(
    direct.findings.map((finding) => finding.ruleId),
    production?.findings.map((finding) => finding.ruleId)
  )
})

test('nothing is leaked into results', async () => {
  const result = await analyzeCollectionText(JSON.stringify(kitchenSinkCollection()))
  const text = JSON.stringify(result.findings)
  for (const secret of [FAKE.password, FAKE.githubToken, FAKE.clientSecret]) assert.ok(!text.includes(secret))
})
