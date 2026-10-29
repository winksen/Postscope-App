import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AnalysisCancelledError, analyzeCollectionText, isAnalysisCancelled, type AnalysisStage } from '../src/lib/analyzeCollection'
import { cleanCollection } from './fixtures'

// There is no Worker in Node, so these run the main thread fallback, which reports the same stages and honors the
// same signal as the worker pipeline. The worker path itself is covered by e2e/cancel.spec.ts.

const text = () => JSON.stringify(cleanCollection())

test('an analysis reports parse, audit and score in order', async () => {
  const stages: AnalysisStage[] = []
  const result = await analyzeCollectionText(text(), undefined, { onProgress: (stage) => stages.push(stage) })
  assert.deepEqual(stages, ['parse', 'audit', 'score'])
  assert.ok(result.parsed.requests.length > 0)
})

test('a signal that is already aborted stops the analysis before it starts', async () => {
  const controller = new AbortController()
  controller.abort()
  const stages: AnalysisStage[] = []
  await assert.rejects(
    analyzeCollectionText(text(), undefined, { signal: controller.signal, onProgress: (stage) => stages.push(stage) }),
    (error: unknown) => {
      assert.ok(error instanceof AnalysisCancelledError)
      assert.ok(isAnalysisCancelled(error))
      return true
    }
  )
  assert.deepEqual(stages, [])
})

test('aborting while the analysis waits to run cancels it and nothing is returned', async () => {
  const controller = new AbortController()
  const running = analyzeCollectionText(text(), undefined, { signal: controller.signal })
  controller.abort()
  await assert.rejects(running, (error: unknown) => isAnalysisCancelled(error))
})

test('a later analysis is not affected by an earlier cancelled one', async () => {
  const first = new AbortController()
  const cancelled = analyzeCollectionText(text(), undefined, { signal: first.signal })
  first.abort()
  await assert.rejects(cancelled, (error: unknown) => isAnalysisCancelled(error))
  const second = await analyzeCollectionText(text(), undefined, { signal: new AbortController().signal })
  assert.ok(second.parsed.requests.length > 0)
})

test('only cancellation is recognized as cancellation', () => {
  assert.equal(isAnalysisCancelled(new Error('Analysis timed out after 120 seconds.')), false)
  assert.equal(isAnalysisCancelled(null), false)
})
