import { after, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { IncomingMessage } from 'node:http'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'postscope-crypto-'))
process.env.DATA_DIR = tmpRoot
process.env.LOG_LEVEL = 'error'

const store = await import('../server/libraryStore')
const crypt = await import('../server/libraryCrypto')
const maintenance = await import('../server/libraryMaintenance')
const audit = await import('../server/auditLog')
const { getProxyUser } = await import('../server/security')
const { getLibraryEncryption } = await import('../server/runtimeConfig')

const libraryDir = path.join(tmpRoot, 'library')
const KEY_A = crypto.randomBytes(32)
const KEY_B = crypto.randomBytes(32)
const collection = (name: string) => JSON.stringify({ info: { name }, item: [{ name: 'A', request: { url: 'https://x.test', header: [{ key: 'X-Marker', value: 'visible-in-plaintext-only' }] } }] })
const read = (id: string) => fs.readFileSync(path.join(libraryDir, `${id}.json`), 'utf8')

function useKey(key?: Buffer, extra: Record<string, string> = {}) {
  for (const name of ['LIBRARY_ENCRYPTION_KEY', 'LIBRARY_ENCRYPTION_KEY_FILE', 'LIBRARY_ENCRYPTION_KEY_PREVIOUS', 'LIBRARY_ENCRYPTION_KEY_PREVIOUS_FILE']) delete process.env[name]
  if (key) process.env.LIBRARY_ENCRYPTION_KEY = key.toString('hex')
  Object.assign(process.env, extra)
}

beforeEach(() => {
  fs.rmSync(libraryDir, { recursive: true, force: true })
  fs.rmSync(path.join(tmpRoot, 'audit'), { recursive: true, force: true })
  store.resetLibraryCache()
  useKey()
  delete process.env.LIBRARY_AUDIT_LOG
  delete process.env.TRUST_PROXY
  delete process.env.TRUSTED_USER_HEADER
})
after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }))

test('keys are accepted as 64 hex characters or base64 and nothing else', () => {
  assert.deepEqual(crypt.parseEncryptionKey(KEY_A.toString('hex')), KEY_A)
  assert.deepEqual(crypt.parseEncryptionKey(KEY_A.toString('base64')), KEY_A)
  assert.deepEqual(crypt.parseEncryptionKey(KEY_A.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')), KEY_A)
  assert.deepEqual(crypt.parseEncryptionKey(`  ${KEY_A.toString('hex')}\n`), KEY_A)
  for (const bad of ['', 'short', 'zz'.repeat(32), KEY_A.toString('hex').slice(2), crypto.randomBytes(16).toString('base64'), crypto.randomBytes(48).toString('base64')]) {
    assert.equal(crypt.parseEncryptionKey(bad), null, bad)
  }
  assert.equal(crypt.keyId(KEY_A), crypt.keyId(Buffer.from(KEY_A)))
  assert.notEqual(crypt.keyId(KEY_A), crypt.keyId(KEY_B))
})

test('key settings are resolved from the environment, key files and the previous key list', () => {
  assert.deepEqual(crypt.resolveEncryptionState({}), { enabled: false })
  const file = path.join(tmpRoot, 'key.txt')
  fs.writeFileSync(file, `${KEY_A.toString('base64')}\n`)
  const state = crypt.resolveEncryptionState({ keyFile: file, previous: `${KEY_B.toString('hex')}, ${KEY_B.toString('hex')}, ${KEY_A.toString('hex')}` })
  assert.ok(state.enabled && 'keys' in state)
  if (state.enabled && 'keys' in state) {
    assert.equal(state.keys.current.id, crypt.keyId(KEY_A))
    assert.deepEqual(state.keys.previous.map((key) => key.id), [crypt.keyId(KEY_B)], 'duplicates and the current key are dropped')
  }
  assert.ok('error' in crypt.resolveEncryptionState({ key: 'not-a-key' }))
  assert.match((crypt.resolveEncryptionState({ keyFile: path.join(tmpRoot, 'missing.txt') }) as { error: string }).error, /LIBRARY_ENCRYPTION_KEY_FILE/)
  assert.ok('error' in crypt.resolveEncryptionState({ key: KEY_A.toString('hex'), previous: 'junk' }))
})

test('records round trip, and tampering, a wrong id or a wrong key is rejected', () => {
  const keys = { current: { id: crypt.keyId(KEY_A), key: KEY_A }, previous: [] }
  const id = crypto.randomUUID()
  const envelope = crypt.encryptRecord('{"secret":"value"}', id, keys.current)
  assert.equal(envelope.alg, 'aes-256-gcm')
  assert.equal(Buffer.from(envelope.iv, 'base64').length, 12)
  assert.ok(!JSON.stringify(envelope).includes('value'))
  assert.equal(crypt.decryptRecord(envelope, id, keys), '{"secret":"value"}')
  assert.notEqual(crypt.encryptRecord('{"secret":"value"}', id, keys.current).iv, envelope.iv, 'fresh IV per record')

  const flip = (value: string) => Buffer.from(Buffer.from(value, 'base64').map((byte, index) => (index === 0 ? byte ^ 1 : byte))).toString('base64')
  for (const tampered of [{ ...envelope, data: flip(envelope.data) }, { ...envelope, tag: flip(envelope.tag) }, { ...envelope, iv: flip(envelope.iv) }]) {
    assert.throws(() => crypt.decryptRecord(tampered, id, keys), crypt.DecryptionError)
  }
  assert.throws(() => crypt.decryptRecord(envelope, crypto.randomUUID(), keys), /failed authentication/)
  const other = { current: { id: crypt.keyId(KEY_B), key: KEY_B }, previous: [] }
  assert.throws(() => crypt.decryptRecord(envelope, id, other), (error) => error instanceof crypt.DecryptionError && error.unknownKey)
  assert.equal(crypt.decryptRecord(envelope, id, { ...other, previous: [keys.current] }), '{"secret":"value"}')
})

test('with a key configured, records are stored as ciphertext and still read back', async () => {
  useKey(KEY_A)
  const meta = await store.saveCollection(collection('Secret plans'), 'Secret plans')
  const onDisk = read(meta.id)
  assert.ok(crypt.isEnvelope(JSON.parse(onDisk)))
  for (const leak of ['Secret plans', 'visible-in-plaintext-only', 'x.test', 'rawJson']) assert.ok(!onDisk.includes(leak), leak)
  assert.deepEqual(Object.keys(JSON.parse(onDisk)).sort(), ['alg', 'data', 'iv', 'kid', 'tag', 'v'])
  assert.ok((fs.statSync(path.join(libraryDir, `${meta.id}.json`)).mode & 0o077) === 0, 'owner-only file')

  store.resetLibraryCache()
  assert.deepEqual((await store.listCollections()).map((item) => item.name), ['Secret plans'])
  const loaded = await store.getCollection(meta.id)
  assert.equal(loaded?.rawJson, collection('Secret plans'))
  assert.equal(loaded?.name, 'Secret plans')
})

test('the duplicate check uses a keyed hash once encryption is on', async () => {
  const plain = await store.saveCollection(collection('dup'), 'dup')
  store.resetLibraryCache()
  fs.rmSync(libraryDir, { recursive: true })
  useKey(KEY_A)
  const first = await store.saveCollection(collection('dup'), 'dup')
  const second = await store.saveCollection(collection('dup'), 'dup again')
  assert.equal(second.deduplicated, true)
  assert.equal(second.id, first.id)
  assert.notEqual(first.contentHash, plain.contentHash)
  assert.equal(first.contentHash, crypto.createHmac('sha256', KEY_A).update(collection('dup')).digest('hex'))
})

test('plaintext records keep working next to encrypted ones, and ciphertext without the key is skipped', async () => {
  const legacy = await store.saveCollection(collection('Legacy'), 'Legacy')
  useKey(KEY_A)
  const sealed = await store.saveCollection(collection('Sealed'), 'Sealed')
  store.resetLibraryCache()
  assert.deepEqual((await store.listCollections()).map((item) => item.name).sort(), ['Legacy', 'Sealed'])
  assert.equal((await store.getCollection(legacy.id))?.name, 'Legacy')

  useKey()
  store.resetLibraryCache()
  assert.deepEqual((await store.listCollections()).map((item) => item.name), ['Legacy'])
  assert.equal(await store.getCollection(sealed.id), null)
})

test('a modified or swapped record is rejected and skipped', async () => {
  useKey(KEY_A)
  const one = await store.saveCollection(collection('One'), 'One')
  const two = await store.saveCollection(collection('Two'), 'Two')
  const envelope = JSON.parse(read(one.id))
  envelope.data = Buffer.from(Buffer.from(envelope.data, 'base64').map((byte: number, index: number) => (index === 5 ? byte ^ 255 : byte))).toString('base64')
  fs.writeFileSync(path.join(libraryDir, `${one.id}.json`), JSON.stringify(envelope))
  fs.copyFileSync(path.join(libraryDir, `${two.id}.json`), path.join(libraryDir, `${crypto.randomUUID()}.json`))
  store.resetLibraryCache()
  assert.deepEqual((await store.listCollections()).map((item) => item.name), ['Two'])
  assert.equal(await store.getCollection(one.id), null)
})

test('a configured but unusable key refuses to save instead of writing plaintext', async () => {
  process.env.LIBRARY_ENCRYPTION_KEY = 'nope'
  await assert.rejects(store.saveCollection(collection('x'), 'x'), /misconfigured/)
  assert.equal(store.libraryEncryptionStatus().enabled, true)
  assert.ok(store.libraryEncryptionStatus().error)
  assert.deepEqual(fs.existsSync(libraryDir) ? fs.readdirSync(libraryDir) : [], [])
  useKey(KEY_A)
  assert.deepEqual(store.libraryEncryptionStatus(), { enabled: true, keyId: crypt.keyId(KEY_A) })
  useKey()
  assert.deepEqual(store.libraryEncryptionStatus(), { enabled: false })
})

test('library:encrypt encrypts plaintext records, verifies them and is safe to repeat', async () => {
  const a = await store.saveCollection(collection('A'), 'A')
  const b = await store.saveCollection(collection('B'), 'B')
  fs.writeFileSync(path.join(libraryDir, 'not-a-record.json'), '{}')
  assert.equal((await maintenance.libraryStatus(libraryDir)).plaintext, 2)

  useKey(KEY_A)
  const state = getLibraryEncryption()
  assert.ok(state.enabled && 'keys' in state)
  if (!(state.enabled && 'keys' in state)) return
  const before = read(a.id)
  const dry = await maintenance.migrateLibrary(libraryDir, state.keys, { dryRun: true })
  assert.deepEqual([dry.dryRun, dry.scanned, dry.encrypted, dry.failed.length], [true, 2, 2, 0])
  assert.equal(read(a.id), before, 'a dry run changes nothing')

  const report = await maintenance.migrateLibrary(libraryDir, state.keys)
  assert.deepEqual([report.scanned, report.encrypted, report.rotated, report.alreadyCurrent, report.failed.length], [2, 2, 0, 0, 0])
  const status = await maintenance.libraryStatus(libraryDir)
  assert.deepEqual([status.plaintext, status.encrypted, status.byKey[crypt.keyId(KEY_A)]], [0, 2, 2])
  assert.ok(!read(a.id).includes('visible-in-plaintext-only'))
  assert.deepEqual(fs.readdirSync(libraryDir).filter((name) => name.endsWith('.tmp')), [])

  store.resetLibraryCache()
  assert.equal((await store.getCollection(b.id))?.rawJson, collection('B'))
  assert.equal((await store.listCollections()).find((item) => item.id === a.id)?.contentHash, crypto.createHmac('sha256', KEY_A).update(collection('A')).digest('hex'))
  const again = await maintenance.migrateLibrary(libraryDir, state.keys)
  assert.deepEqual([again.encrypted, again.rotated, again.alreadyCurrent], [0, 0, 2])
})

test('key rotation rewrites records sealed with the previous key', async () => {
  useKey(KEY_A)
  const meta = await store.saveCollection(collection('Old key'), 'Old key')
  useKey(KEY_B, { LIBRARY_ENCRYPTION_KEY_PREVIOUS: KEY_A.toString('hex') })
  store.resetLibraryCache()
  assert.equal((await store.getCollection(meta.id))?.name, 'Old key', 'the previous key still decrypts')
  const state = getLibraryEncryption()
  if (!(state.enabled && 'keys' in state)) throw new Error('keys expected')
  const report = await maintenance.migrateLibrary(libraryDir, state.keys)
  assert.deepEqual([report.rotated, report.encrypted, report.failed.length], [1, 0, 0])
  assert.equal(JSON.parse(read(meta.id)).kid, crypt.keyId(KEY_B))

  useKey(KEY_B)
  store.resetLibraryCache()
  assert.equal((await store.getCollection(meta.id))?.name, 'Old key', 'works without the retired key')
  assert.equal((await store.listCollections())[0].contentHash, crypto.createHmac('sha256', KEY_B).update(collection('Old key')).digest('hex'))
})

test('migration reports records it cannot read and leaves them alone', async () => {
  useKey(KEY_A)
  const meta = await store.saveCollection(collection('Sealed'), 'Sealed')
  const before = read(meta.id)
  useKey(KEY_B)
  const state = getLibraryEncryption()
  if (!(state.enabled && 'keys' in state)) throw new Error('keys expected')
  const report = await maintenance.migrateLibrary(libraryDir, state.keys)
  assert.equal(report.failed.length, 1)
  assert.match(report.failed[0].reason, /not configured/)
  assert.equal(read(meta.id), before)
  assert.equal((await maintenance.libraryStatus(libraryDir)).byKey[crypt.keyId(KEY_A)], 1)
})

function request(headers: Record<string, string | string[]>) {
  return { headers, socket: { remoteAddress: '10.0.0.1' } } as unknown as IncomingMessage
}

test('the proxy user header is only honored behind a trusted proxy and is sanitized', () => {
  process.env.TRUSTED_USER_HEADER = 'X-Forwarded-User'
  assert.equal(getProxyUser(request({ 'x-forwarded-user': 'alice' })), null, 'ignored without TRUST_PROXY')
  process.env.TRUST_PROXY = 'true'
  assert.equal(getProxyUser(request({ 'x-forwarded-user': 'alice@example.com' })), 'alice@example.com')
  assert.equal(getProxyUser(request({ 'x-forwarded-user': ['bob', 'mallory'] })), 'bob')
  assert.equal(getProxyUser(request({ 'x-forwarded-user': 'ev\u0000il\r\nname‮' })), 'evilname')
  assert.equal(getProxyUser(request({ 'x-forwarded-user': 'x'.repeat(500) }))?.length, 200)
  assert.equal(getProxyUser(request({ 'x-forwarded-user': '   ' })), null)
  assert.equal(getProxyUser(request({})), null)
  process.env.TRUSTED_USER_HEADER = 'bad header!'
  assert.equal(getProxyUser(request({ 'bad header!': 'x' })), null)
  delete process.env.TRUSTED_USER_HEADER
  assert.equal(getProxyUser(request({ 'x-forwarded-user': 'alice' })), null)
})

test('the savedBy user is stored with the collection', async () => {
  const meta = await store.saveCollection(collection('Mine'), 'Mine', undefined, { savedBy: 'alice@example.com' })
  assert.equal(meta.savedBy, 'alice@example.com')
  store.resetLibraryCache()
  assert.equal((await store.listCollections())[0].savedBy, 'alice@example.com')
  assert.equal((await store.saveCollection(collection('Anon'), 'Anon')).savedBy, undefined)
})

test('audit entries are appended as JSON lines without any collection content', async () => {
  const when = new Date('2026-10-15T08:30:00Z')
  await audit.recordAudit({ action: 'save', id: 'id-1', name: 'My API', user: 'alice', ip: '203.0.113.9', requestId: 'req-1', redactedCount: 2 }, when)
  await audit.recordAudit({ action: 'open', id: 'id-1', name: 'My API', ip: '203.0.113.10' }, when)
  await audit.recordAudit({ action: 'delete', id: 'id-1', name: 'My API', user: 'bob', ip: '203.0.113.9', deduplicated: false }, new Date('2026-11-01T00:00:00Z'))
  await audit.flushAuditLog()
  const october = fs.readFileSync(path.join(tmpRoot, 'audit', 'library-2026-10.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  assert.deepEqual(october, [
    { ts: '2026-10-15T08:30:00.000Z', action: 'save', id: 'id-1', name: 'My API', user: 'alice', ip: '203.0.113.9', requestId: 'req-1', redactedCount: 2 },
    { ts: '2026-10-15T08:30:00.000Z', action: 'open', id: 'id-1', name: 'My API', user: null, ip: '203.0.113.10' },
  ])
  assert.ok(fs.existsSync(path.join(tmpRoot, 'audit', 'library-2026-11.jsonl')), 'a new file each month')
  process.env.LIBRARY_AUDIT_LOG = 'false'
  await audit.recordAudit({ action: 'save', id: 'id-2', ip: '1.1.1.1' }, when)
  await audit.flushAuditLog()
  assert.equal(fs.readFileSync(path.join(tmpRoot, 'audit', 'library-2026-10.jsonl'), 'utf8').trim().split('\n').length, 2)
})
