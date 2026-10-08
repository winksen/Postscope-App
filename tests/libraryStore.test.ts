import { after, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'postscope-store-'))
process.env.DATA_DIR = tmpRoot
process.env.LOG_LEVEL = 'error'

const store = await import('../server/libraryStore')
const { RateLimiter, safeEqual, isSameOriginRequest } = await import('../server/security')
const { resolveStaticPath } = await import('../server/staticFiles')

const libraryDir = path.join(tmpRoot, 'library')
const collection = (name: string) => JSON.stringify({ info: { name }, item: [{ name: 'A', request: { url: 'x' } }, { name: 'F', item: [{ name: 'B', request: 'y' }] }] })

beforeEach(() => {
  fs.rmSync(libraryDir, { recursive: true, force: true })
  store.resetLibraryCache()
  delete process.env.LIBRARY_MAX_ITEMS
  delete process.env.LIBRARY_RETENTION_DAYS
  delete process.env.LIBRARY_MAX_TOTAL_MB
})

after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }))

test('saves atomically, counts requests server-side, and never trusts client counts', async () => {
  const meta = await store.saveCollection(collection('one'), 'One', 999)
  assert.equal(meta.requestCount, 2)
  assert.ok(store.isValidCollectionId(meta.id))
  const files = fs.readdirSync(libraryDir)
  assert.deepEqual(files, [`${meta.id}.json`])
  const loaded = await store.getCollection(meta.id)
  assert.equal(loaded?.name, 'One')
})

test('rejects invalid input', async () => {
  await assert.rejects(store.saveCollection('', 'x'), /rawJson is required/)
  await assert.rejects(store.saveCollection('{not json', 'x'), /not valid JSON/)
  await assert.rejects(store.saveCollection('{"a":1}', 'x'), /item array/)
  assert.equal(await store.getCollection('../../etc/passwd'), null)
  assert.equal(await store.deleteCollection('../../etc/passwd'), false)
})

test('de-duplicates identical content', async () => {
  const first = await store.saveCollection(collection('dup'), 'Dup')
  const second = await store.saveCollection(collection('dup'), 'Dup again')
  assert.equal(second.id, first.id)
  assert.equal(second.deduplicated, true)
  assert.equal((await store.listCollections()).length, 1)
})

test('lists from cache and notices files removed outside the app', async () => {
  const a = await store.saveCollection(collection('a'), 'A')
  await store.saveCollection(collection('b'), 'B')
  assert.equal((await store.listCollections()).length, 2)
  fs.rmSync(path.join(libraryDir, `${a.id}.json`))
  const remaining = await store.listCollections()
  assert.deepEqual(remaining.map((item) => item.name), ['B'])
})

test('skips corrupt or foreign files in the library directory', async () => {
  await store.saveCollection(collection('ok'), 'OK')
  fs.writeFileSync(path.join(libraryDir, '11111111-1111-4111-8111-111111111111.json'), '{broken')
  fs.writeFileSync(path.join(libraryDir, 'notes.json'), '{}')
  store.resetLibraryCache()
  assert.deepEqual((await store.listCollections()).map((item) => item.name), ['OK'])
})

test('prunes beyond LIBRARY_MAX_ITEMS keeping the newest', async () => {
  process.env.LIBRARY_MAX_ITEMS = '2'
  for (const name of ['c1', 'c2', 'c3']) {
    await store.saveCollection(collection(name), name)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.deepEqual((await store.listCollections()).map((item) => item.name), ['c3', 'c2'])
})

test('prunes collections older than LIBRARY_RETENTION_DAYS', async () => {
  await store.saveCollection(collection('old'), 'Old')
  process.env.LIBRARY_RETENTION_DAYS = '1'
  const removed = await store.pruneLibrary(Date.now() + 2 * 86_400_000)
  assert.equal(removed, 1)
  assert.equal((await store.listCollections()).length, 0)
})

test('enforces LIBRARY_MAX_TOTAL_MB quota', async () => {
  process.env.LIBRARY_MAX_TOTAL_MB = '0.1'
  await assert.rejects(store.saveCollection(JSON.stringify({ item: [], pad: 'x'.repeat(150_000) }), 'Huge'), /quota/)
})

test('concurrent saves are serialized without losing records', async () => {
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => store.saveCollection(collection(`p${i}`), `P${i}`)))
  assert.equal(new Set(results.map((item) => item.id)).size, 8)
  assert.equal((await store.listCollections()).length, 8)
})

test('sanitizes names', () => {
  assert.equal(store.sanitizeCollectionName(`  a${String.fromCharCode(0x202e)}b${String.fromCharCode(7)}  `), 'a b')
  assert.equal(store.sanitizeCollectionName(''), 'Untitled collection')
  assert.equal(store.sanitizeCollectionName('x'.repeat(500)).length, 200)
})

test('rate limiter windows and sweeping', () => {
  const limiter = new RateLimiter()
  const now = 1_000_000
  assert.equal(limiter.hit('k', 2, 60_000, now), 0)
  assert.equal(limiter.hit('k', 2, 60_000, now), 0)
  assert.ok(limiter.hit('k', 2, 60_000, now) > 0)
  assert.equal(limiter.hit('k', 2, 60_000, now + 61_000), 0)
  assert.equal(limiter.hit('k', 0, 60_000, now), 0, 'limit 0 disables')
  assert.equal(limiter.sweep(now + 200_000), 1)
})

test('constant-time compare and same-origin checks', () => {
  assert.equal(safeEqual('abc', 'abc'), true)
  assert.equal(safeEqual('abc', 'abcd'), false)
  const req = (headers: Record<string, string>) => ({ headers }) as never
  assert.equal(isSameOriginRequest(req({})), true)
  assert.equal(isSameOriginRequest(req({ 'sec-fetch-site': 'same-origin' })), true)
  assert.equal(isSameOriginRequest(req({ 'sec-fetch-site': 'cross-site' })), false)
  assert.equal(isSameOriginRequest(req({ origin: 'http://app.local:3010', host: 'app.local:3010' })), true)
  assert.equal(isSameOriginRequest(req({ origin: 'http://evil.local', host: 'app.local:3010' })), false)
  assert.equal(isSameOriginRequest(req({ origin: 'null', host: 'app.local:3010' })), false)
})

test('static path resolution stays inside the root', () => {
  const root = path.join(tmpRoot, 'dist')
  assert.equal(resolveStaticPath(root, '/assets/app.js'), path.join(root, 'assets', 'app.js'))
  for (const attack of ['/../x', '/%2e%2e/x', '/a/%2e%2e/%2e%2e/x', '/.env', '/a\\..\\x', '/%00', '/%E0%A4%A']) {
    assert.equal(resolveStaticPath(root, attack), null, attack)
  }
})
