import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'

// The browser storage wrappers read `window`; a small in-memory stand-in is enough here.
const local = new Map<string, string>()
const session = new Map<string, string>()
const memory = (store: Map<string, string>) => ({
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
})
;(globalThis as unknown as { window: unknown }).window = { sessionStorage: memory(session), localStorage: memory(local) }

const {
  SESSION_TTL_MS,
  clearCollectionSession,
  isSessionRetentionEnabled,
  loadCollectionSession,
  saveCollectionSession,
  setSessionRetention,
} = await import('../src/lib/collectionSession')

beforeEach(() => {
  local.clear()
  session.clear()
})

const SENTINEL = 'SECRET-SENTINEL-VALUE'
const everythingStored = () => [...local.values(), ...session.values()].join('\n')

test('keeps the collection, its environments and the selection across a refresh', () => {
  assert.notEqual(saveCollectionSession('{"item":[]}', 'My API', ['{"values":[]}', '{"values":[{"key":"a"}]}'], 1), null)
  const kept = loadCollectionSession()
  assert.equal(kept?.rawJson, '{"item":[]}')
  assert.deepEqual(kept?.environments, ['{"values":[]}', '{"values":[{"key":"a"}]}'])
  assert.equal(kept?.activeEnvironment, 1)
  clearCollectionSession()
  assert.equal(loadCollectionSession(), null)
})

test('retention is off until the person turns it on, and turning it off removes the stored copy', () => {
  assert.equal(isSessionRetentionEnabled(), false)
  setSessionRetention(true)
  assert.equal(isSessionRetentionEnabled(), true)
  saveCollectionSession(`{"item":[],"x":"${SENTINEL}"}`, 'Kept')
  assert.ok(everythingStored().includes(SENTINEL))
  setSessionRetention(false)
  assert.equal(isSessionRetentionEnabled(), false)
  assert.ok(!everythingStored().includes(SENTINEL), 'the stored copy is gone')
})

test('a copy has a visible expiry and is removed once it passes', () => {
  const now = 1_000_000
  const expiresAt = saveCollectionSession(`{"item":[],"x":"${SENTINEL}"}`, 'Soon', ['{"values":[]}'], 0, now)
  assert.equal(expiresAt, now + SESSION_TTL_MS)
  assert.equal(loadCollectionSession(now + SESSION_TTL_MS - 1)?.collectionName, 'Soon')
  assert.equal(loadCollectionSession(now + SESSION_TTL_MS), null)
  assert.ok(!everythingStored().includes(SENTINEL), 'expiry removes the stored data')
})

test('a copy from an older version without an expiry is discarded', () => {
  session.set(
    'postscope:collection-session',
    JSON.stringify({ rawJson: `{"item":[],"x":"${SENTINEL}"}`, collectionName: 'Old', savedAt: 1 })
  )
  assert.equal(loadCollectionSession(), null)
  assert.ok(!everythingStored().includes(SENTINEL))
})

test('the size limit counts the environments too', () => {
  const big = 'x'.repeat(2_600_000)
  assert.notEqual(saveCollectionSession(big, 'Big', []), null)
  assert.equal(saveCollectionSession(big, 'Big', [big]), null)
})
