import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeDataHandling } from '../src/lib/dataHandling'
import { canSaveToAppStorage, shouldPersistSession, type LoggingMode } from '../src/lib/deploymentConfig'
import type { StorageMode } from '../src/lib/storagePreferences'

const MODES: LoggingMode[] = ['off', 'hybrid', 'on']
const STORAGE: StorageMode[] = ['incognito', 'history']

test('the summary follows the same predicates that decide uploads and session copies in every mode', () => {
  for (const mode of MODES) {
    for (const storage of STORAGE) {
      const summary = describeDataHandling(mode, storage)
      assert.equal(summary.uploadsCollection, canSaveToAppStorage(mode, storage, true), `${mode}/${storage} upload`)
      assert.equal(summary.canKeepSession, shouldPersistSession(mode, storage, true), `${mode}/${storage} eligible`)
      assert.equal(summary.keepsSessionCopy, false, `${mode}/${storage} nothing is kept until the person opts in`)
      assert.equal(
        describeDataHandling(mode, storage, { keepSession: true }).keepsSessionCopy,
        shouldPersistSession(mode, storage, true),
        `${mode}/${storage} session`
      )
      assert.equal(summary.uploadsEnvironments, false)
    }
  }
})

test('off mode and incognito say nothing is sent and nothing is kept', () => {
  for (const [mode, storage] of [
    ['off', 'incognito'],
    ['hybrid', 'incognito'],
  ] as const) {
    const summary = describeDataHandling(mode, storage)
    const text = summary.rows.map((row) => row.value).join(' ')
    assert.match(text, /not sent to the app server/)
    assert.match(text, /Nothing is kept/)
    assert.equal(describeDataHandling(mode, storage, { keepSession: true }).keepsSessionCopy, false, 'no copy is allowed here')
  }
})

test('team modes offer keep for refresh, off by default, and state the expiry once on', () => {
  const offered = describeDataHandling('on', 'history')
  assert.equal(offered.canKeepSession, true)
  assert.match(offered.rows.find((row) => row.id === 'refresh')?.value ?? '', /Nothing is kept. Turn on keep for refresh/)
  const kept = describeDataHandling('on', 'history', { keepSession: true, sessionExpiresAt: Date.now() + 60_000 })
  assert.match(kept.rows.find((row) => row.id === 'refresh')?.value ?? '', /until .*restored after a refresh/)
})

test('team modes say the collection is shared and describe the server protections', () => {
  const plain = describeDataHandling('on', 'history')
  const collection = (summary: ReturnType<typeof describeDataHandling>) => summary.rows.find((row) => row.id === 'collection')?.value ?? ''
  assert.match(collection(plain), /shared with your team/)
  assert.match(collection(plain), /including URLs, headers and tokens/)
  assert.match(collection(plain), /not encrypted at rest/)
  const protectedCopy = describeDataHandling('hybrid', 'history', { serverRedactsSecrets: true, serverEncrypts: true })
  assert.match(collection(protectedCopy), /credentials are removed before it is stored/)
  assert.match(collection(protectedCopy), /, encrypted at rest/)
})

test('environment files are always described as browser only', () => {
  for (const mode of MODES) {
    for (const storage of STORAGE) {
      const row = describeDataHandling(mode, storage).rows.find((entry) => entry.id === 'environments')
      assert.match(row?.value ?? '', /never sent to the server/)
    }
  }
})
