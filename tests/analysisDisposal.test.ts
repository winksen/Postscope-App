import { test } from 'node:test'
import assert from 'node:assert/strict'
import v8 from 'node:v8'
import vm from 'node:vm'
import { analysisCacheStatus, analyzeCollectionText, auditAgain, disposeAnalysis } from '../src/lib/analyzeCollection'
import { cleanCollection } from './fixtures'

// There is no Worker in Node, so the main thread copies are the retained state. The worker side is released by
// terminating the worker (resetWorker), which e2e/cancel.spec.ts exercises.

v8.setFlagsFromString('--expose-gc')
const gc = vm.runInNewContext('gc') as () => void

const SENTINEL = 'RAW-INPUT-SENTINEL-4f9c'
const text = () => JSON.stringify({ ...cleanCollection(), note: SENTINEL })

async function collected(ref: WeakRef<object>): Promise<boolean> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve))
    gc()
    if (ref.deref() === undefined) return true
  }
  return false
}

test('a finished analysis is kept for later audits until it is disposed', async () => {
  disposeAnalysis()
  assert.deepEqual(analysisCacheStatus(), { workers: 0, pendingJobs: 0, fallbackSlots: 0 })
  await analyzeCollectionText(text(), undefined, { slot: 'main' })
  await analyzeCollectionText(text(), undefined, { slot: 'reference' })
  assert.equal(analysisCacheStatus().fallbackSlots, 2)
  assert.ok(await auditAgain(undefined, { slot: 'main' }), 'the cached collection is audited again without parsing')
})

test('disposing one slot leaves the other untouched', async () => {
  disposeAnalysis()
  await analyzeCollectionText(text(), undefined, { slot: 'main' })
  await analyzeCollectionText(text(), undefined, { slot: 'reference' })
  disposeAnalysis(['reference'])
  assert.equal(analysisCacheStatus().fallbackSlots, 1)
  assert.ok(await auditAgain(undefined, { slot: 'main' }))
  assert.equal(await auditAgain(undefined, { slot: 'reference' }), null)
})

test('after disposal nothing is cached and a reopened collection starts from a fresh analysis', async () => {
  await analyzeCollectionText(text(), undefined)
  disposeAnalysis()
  assert.deepEqual(analysisCacheStatus(), { workers: 0, pendingJobs: 0, fallbackSlots: 0 })
  assert.equal(await auditAgain(undefined), null, 'a cache miss tells the caller to analyze the text again')
  const reopened = await analyzeCollectionText(text(), undefined)
  assert.ok(reopened.parsed.requests.length > 0)
  assert.equal(analysisCacheStatus().fallbackSlots, 1)
})

/** Analyzes in its own frame so the test itself keeps no reference to the parsed collection. */
async function analyzeAndWatch(): Promise<WeakRef<object>> {
  const result = await analyzeCollectionText(text(), undefined)
  return new WeakRef(result.parsed)
}

test('heap probe: the parsed collection can be collected after disposal and not before', async () => {
  disposeAnalysis()
  const ref = await analyzeAndWatch()
  assert.equal(await collected(ref), false, 'the analysis layer still holds the parsed collection')
  disposeAnalysis()
  assert.equal(await collected(ref), true, 'no app-held reference to the parsed collection remains')
})
