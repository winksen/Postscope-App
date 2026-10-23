import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'

// The browser storage wrappers read `window`; a small in-memory stand-in is enough here.
const store = new Map<string, string>()
const memory = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
}
;(globalThis as unknown as { window: unknown }).window = { sessionStorage: memory, localStorage: memory }

const { clearCollectionSession, loadCollectionSession, saveCollectionSession } = await import('../src/lib/collectionSession')

beforeEach(() => store.clear())

test('keeps the collection, its environments and the selection across a refresh', () => {
  assert.equal(saveCollectionSession('{"item":[]}', 'My API', ['{"values":[]}', '{"values":[{"key":"a"}]}'], 1), true)
  const session = loadCollectionSession()
  assert.equal(session?.rawJson, '{"item":[]}')
  assert.deepEqual(session?.environments, ['{"values":[]}', '{"values":[{"key":"a"}]}'])
  assert.equal(session?.activeEnvironment, 1)
  clearCollectionSession()
  assert.equal(loadCollectionSession(), null)
})

test('sessions without environments stay compatible with older saved data', () => {
  store.set('postscope:collection-session', JSON.stringify({ rawJson: '{"item":[]}', collectionName: 'Old', savedAt: 1 }))
  const session = loadCollectionSession()
  assert.deepEqual(session?.environments, [])
  assert.equal(session?.activeEnvironment, undefined)
})

test('the size limit counts the environments too', () => {
  const big = 'x'.repeat(2_600_000)
  assert.equal(saveCollectionSession(big, 'Big', []), true)
  assert.equal(saveCollectionSession(big, 'Big', [big]), false)
})
