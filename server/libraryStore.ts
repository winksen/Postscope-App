import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { getDataDir, getLibraryDir, getLibraryEncryption, getLibraryLimits, getMaxCollectionBytes } from './runtimeConfig'
import { log } from './logger'
import { DecryptionError, decryptRecord, encryptRecord, isEnvelope, keyedHash, warnOnce, type EncryptionKeys } from './libraryCrypto'

export interface StoredCollectionMeta {
  id: string
  name: string
  requestCount: number
  savedAt: number
  sizeBytes: number
  contentHash: string
  /** True when the save matched an existing collection with identical content. */
  deduplicated?: boolean
  /** Number of credentials scrubbed on the server (LIBRARY_REDACT_SECRETS). */
  redactedCount?: number
  /** Signed-in user reported by the trusted reverse proxy when the collection was saved (TRUSTED_USER_HEADER). */
  savedBy?: string
}

export interface StoredCollection extends StoredCollectionMeta {
  rawJson: string
}

export class LibraryError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'LibraryError'
  }
}

/** Collection ids are server-generated UUIDs; anything else is rejected before touching the filesystem. */
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_NAME_LENGTH = 200

export function isValidCollectionId(id: string): boolean {
  return ID_PATTERN.test(id)
}

function collectionPath(dir: string, id: string): string {
  if (!isValidCollectionId(id)) throw new LibraryError(400, 'Invalid collection id.')
  return path.join(dir, `${id.toLowerCase()}.json`)
}

export function hashContent(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex')
}

/**
 * Hash used to spot duplicate saves. With encryption on it is an HMAC keyed with the encryption key, so a stolen
 * metadata cache or API listing cannot be used to confirm that a known collection is stored.
 */
function contentHashFor(raw: string, keys: EncryptionKeys | null): string {
  return keys ? keyedHash(raw, keys.current) : hashContent(raw)
}

/** Keys for this request, `null` when encryption is off. A configured but unusable key stops saves instead of storing plaintext. */
function activeKeys(): EncryptionKeys | null {
  const state = getLibraryEncryption()
  if (!state.enabled) return null
  if ('error' in state) {
    warnOnce('library-key', `Library encryption is misconfigured: ${state.error}`)
    throw new LibraryError(500, 'Library encryption is misconfigured. An operator must fix LIBRARY_ENCRYPTION_KEY.')
  }
  return state.keys
}

/** What encryption looks like right now, for the startup banner and the config endpoint. */
export function libraryEncryptionStatus(): { enabled: boolean; keyId?: string; error?: string } {
  const state = getLibraryEncryption()
  if (!state.enabled) return { enabled: false }
  if ('error' in state) return { enabled: true, error: state.error }
  return { enabled: true, keyId: state.keys.current.id }
}

/** Control, zero-width, and bidi-override characters (used for spoofing names in lists). */
function isUnsafeNameChar(code: number): boolean {
  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x2028 && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0xfeff
  )
}

/** Strips control characters and collapses whitespace so names render safely in lists and logs. */
export function sanitizeCollectionName(name: unknown): string {
  const text = typeof name === 'string' ? name : ''
  const cleaned = [...text]
    .map((char) => (isUnsafeNameChar(char.codePointAt(0) ?? 0) ? ' ' : char))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  return (cleaned || 'Untitled collection').slice(0, MAX_NAME_LENGTH)
}

/** Counts request items exactly like the client parser (items that carry a `request`). */
export function countRequests(json: unknown): number {
  let count = 0
  const stack: Array<{ items: unknown; depth: number }> = [{ items: (json as { item?: unknown })?.item, depth: 0 }]
  while (stack.length) {
    const { items, depth } = stack.pop()!
    if (!Array.isArray(items) || depth > 100) continue
    for (const item of items) {
      if (!item || typeof item !== 'object') continue
      const record = item as { request?: unknown; item?: unknown }
      if (record.request) count += 1
      if (record.item) stack.push({ items: record.item, depth: depth + 1 })
    }
  }
  return count
}

export function assertPostmanCollection(json: unknown): void {
  if (!json || typeof json !== 'object' || Array.isArray(json) || !Array.isArray((json as { item?: unknown }).item)) {
    throw new LibraryError(422, 'rawJson must be a Postman collection with an item array.')
  }
}

// ---------------------------------------------------------------------------
// Metadata cache: listing never re-reads every (possibly multi-MB) collection file.
// ---------------------------------------------------------------------------

interface CacheState {
  dir: string
  items: Map<string, StoredCollectionMeta>
  /** Unreadable files, remembered so they are not re-parsed (and re-logged) on every listing. */
  unreadable: Set<string>
}

let cache: CacheState | null = null
let mutationQueue: Promise<unknown> = Promise.resolve()

/** Serializes writes/deletes/pruning so concurrent requests cannot interleave filesystem changes. */
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = mutationQueue.then(task, task)
  mutationQueue = run.catch(() => undefined)
  return run
}

/** Resolves once every queued mutation has finished (used for graceful shutdown). */
export function flushLibraryWrites(): Promise<void> {
  return mutationQueue.then(() => undefined)
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 })
}

function toMeta(record: StoredCollection): StoredCollectionMeta {
  return {
    id: record.id,
    name: record.name,
    requestCount: record.requestCount,
    savedAt: record.savedAt,
    sizeBytes: record.sizeBytes,
    contentHash: record.contentHash,
    ...(record.redactedCount ? { redactedCount: record.redactedCount } : {}),
    ...(record.savedBy ? { savedBy: record.savedBy } : {}),
  }
}

function isStoredCollection(value: unknown, id: string): value is StoredCollection {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<StoredCollection>
  return (
    typeof record.rawJson === 'string' &&
    typeof record.name === 'string' &&
    typeof record.savedAt === 'number' &&
    typeof record.id === 'string' &&
    record.id.toLowerCase() === id.toLowerCase()
  )
}

async function readRecord(dir: string, id: string): Promise<StoredCollection | null> {
  let raw: string
  try {
    raw = await fs.readFile(collectionPath(dir, id), 'utf8')
  } catch {
    return null
  }
  try {
    let parsed = JSON.parse(raw) as unknown
    if (isEnvelope(parsed)) {
      const state = getLibraryEncryption()
      if (!state.enabled || 'error' in state) {
        warnOnce(
          'library-encrypted-no-key',
          'The library contains encrypted records but no usable LIBRARY_ENCRYPTION_KEY is configured; they are skipped.'
        )
        return null
      }
      try {
        parsed = JSON.parse(decryptRecord(parsed, id, state.keys)) as unknown
      } catch (error) {
        if (error instanceof DecryptionError) {
          log.warn('Skipping library record that cannot be decrypted', { id, reason: error.message })
          return null
        }
        throw error
      }
    }
    const record = parsed
    if (!isStoredCollection(record, id)) {
      log.warn('Skipping malformed library record', { id })
      return null
    }
    return {
      ...record,
      requestCount: typeof record.requestCount === 'number' ? record.requestCount : 0,
      sizeBytes: typeof record.sizeBytes === 'number' ? record.sizeBytes : record.rawJson.length,
      contentHash: typeof record.contentHash === 'string' ? record.contentHash : hashContent(record.rawJson),
    }
  } catch {
    log.warn('Skipping unreadable library record', { id })
    return null
  }
}

/**
 * Reconciles cached metadata with the directory listing. Only file names are read on each call;
 * record contents are parsed once per new file (records are immutable after they are written).
 */
async function loadCache(): Promise<CacheState> {
  const dir = getLibraryDir()
  await ensureDir(dir)
  if (!cache || cache.dir !== dir) cache = { dir, items: new Map(), unreadable: new Set() }
  const state = cache

  const present = new Set<string>()
  for (const file of await fs.readdir(dir)) {
    if (!file.endsWith('.json')) continue
    const id = file.slice(0, -'.json'.length).toLowerCase()
    if (!isValidCollectionId(id)) continue
    present.add(id)
    if (state.items.has(id) || state.unreadable.has(id)) continue
    const record = await readRecord(dir, id)
    if (record) state.items.set(id, toMeta(record))
    else state.unreadable.add(id)
  }
  for (const id of state.items.keys()) if (!present.has(id)) state.items.delete(id)
  for (const id of state.unreadable) if (!present.has(id)) state.unreadable.delete(id)
  return state
}

/** Test hook: forget cached metadata (e.g. after DATA_DIR changes). */
export function resetLibraryCache(): void {
  cache = null
}

async function writeAtomic(filePath: string, contents: string): Promise<void> {
  const tmp = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
  await fs.writeFile(tmp, contents, { encoding: 'utf8', mode: 0o600 })
  try {
    await fs.rename(tmp, filePath)
  } catch (error) {
    await fs.rm(tmp, { force: true })
    throw error
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function listCollections(): Promise<StoredCollectionMeta[]> {
  const state = await loadCache()
  return [...state.items.values()].sort((a, b) => b.savedAt - a.savedAt)
}

export async function getCollection(id: string): Promise<StoredCollection | null> {
  if (!isValidCollectionId(id)) return null
  return readRecord(getLibraryDir(), id)
}

export interface SaveOptions {
  /** Optional transform applied before hashing/storing (server-side secret redaction). */
  transform?: (json: unknown) => { json: unknown; redactedCount: number }
  /** Signed-in user from the trusted proxy, stored as `savedBy`. */
  savedBy?: string | null
}

export async function saveCollection(
  rawJson: string,
  name: string,
  _requestCount?: number,
  options: SaveOptions = {}
): Promise<StoredCollectionMeta> {
  if (typeof rawJson !== 'string' || !rawJson.trim()) throw new LibraryError(400, 'rawJson is required.')
  const maxBytes = getMaxCollectionBytes()
  if (rawJson.length > maxBytes) throw new LibraryError(413, 'Collection is too large to store.')

  let json: unknown
  try {
    json = JSON.parse(rawJson)
  } catch {
    throw new LibraryError(422, 'rawJson is not valid JSON.')
  }
  assertPostmanCollection(json)

  let stored = rawJson
  let redactedCount = 0
  if (options.transform) {
    const result = options.transform(json)
    redactedCount = result.redactedCount
    if (redactedCount > 0) {
      json = result.json
      stored = JSON.stringify(json, null, 2)
    }
  }

  const keys = activeKeys()
  const contentHash = contentHashFor(stored, keys)
  const requestCount = countRequests(json)
  const safeName = sanitizeCollectionName(name)

  return serialize(async () => {
    const state = await loadCache()
    const existing = [...state.items.values()].find((item) => item.contentHash === contentHash)
    if (existing) return { ...existing, deduplicated: true }

    const { maxTotalBytes } = getLibraryLimits()
    if (maxTotalBytes > 0) {
      const used = [...state.items.values()].reduce((sum, item) => sum + item.sizeBytes, 0)
      if (used + stored.length > maxTotalBytes) {
        throw new LibraryError(
          507,
          'Library storage quota is full. Remove saved collections or ask an operator to raise LIBRARY_MAX_TOTAL_MB.'
        )
      }
    }

    const record: StoredCollection = {
      id: crypto.randomUUID(),
      name: safeName,
      rawJson: stored,
      requestCount,
      savedAt: Date.now(),
      sizeBytes: stored.length,
      contentHash,
      ...(redactedCount ? { redactedCount } : {}),
      ...(options.savedBy ? { savedBy: options.savedBy } : {}),
    }

    await ensureDir(state.dir)
    const serialized = JSON.stringify(record)
    await writeAtomic(
      collectionPath(state.dir, record.id),
      keys ? JSON.stringify(encryptRecord(serialized, record.id, keys.current)) : serialized
    )
    state.items.set(record.id, toMeta(record))
    await pruneUnlocked()
    return toMeta(record)
  })
}

export async function deleteCollection(id: string): Promise<boolean> {
  if (!isValidCollectionId(id)) return false
  return serialize(async () => {
    const state = await loadCache()
    try {
      await fs.unlink(collectionPath(state.dir, id))
    } catch {
      return false
    }
    state.items.delete(id.toLowerCase())
    return true
  })
}

async function pruneUnlocked(now = Date.now()): Promise<number> {
  const { maxItems, retentionDays } = getLibraryLimits()
  if (maxItems <= 0 && retentionDays <= 0) return 0
  const state = await loadCache()
  const sorted = [...state.items.values()].sort((a, b) => b.savedAt - a.savedAt)
  const cutoff = retentionDays > 0 ? now - retentionDays * 86_400_000 : -Infinity
  const doomed = sorted.filter((item, index) => item.savedAt < cutoff || (maxItems > 0 && index >= maxItems))

  let removed = 0
  for (const item of doomed) {
    try {
      await fs.unlink(collectionPath(state.dir, item.id))
      state.items.delete(item.id.toLowerCase())
      removed += 1
    } catch (error) {
      log.warn('Failed to prune library record', { id: item.id, error: error instanceof Error ? error.message : String(error) })
    }
  }
  if (removed) log.info('Pruned library collections', { removed, maxItems, retentionDays })
  return removed
}

/** Applies LIBRARY_MAX_ITEMS / LIBRARY_RETENTION_DAYS. Run after saves and by the background job. */
export function pruneLibrary(now = Date.now()): Promise<number> {
  return serialize(() => pruneUnlocked(now))
}

/** Removes temp files left behind by a crash mid-write. */
export async function cleanupTempFiles(maxAgeMs = 3_600_000): Promise<number> {
  const dir = getLibraryDir()
  let removed = 0
  try {
    for (const file of await fs.readdir(dir)) {
      if (!file.endsWith('.tmp')) continue
      const filePath = path.join(dir, file)
      const stat = await fs.stat(filePath)
      if (Date.now() - stat.mtimeMs > maxAgeMs) {
        await fs.rm(filePath, { force: true })
        removed += 1
      }
    }
  } catch {
    /* directory may not exist yet */
  }
  return removed
}

/** Health probe: confirms the data volume is writable (probe file lives in DATA_DIR, outside the library). */
export async function checkLibraryWritable(): Promise<boolean> {
  try {
    await ensureDir(getLibraryDir())
    const probe = path.join(getDataDir(), `.health-${process.pid}.tmp`)
    await fs.writeFile(probe, 'ok', { mode: 0o600 })
    await fs.rm(probe, { force: true })
    return true
  } catch {
    return false
  }
}
