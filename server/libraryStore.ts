import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

export interface StoredCollectionMeta {
  id: string
  name: string
  requestCount: number
  savedAt: number
  sizeBytes: number
  contentHash: string
}

export interface StoredCollection extends StoredCollectionMeta {
  rawJson: string
}

const DATA_DIR = path.join(process.cwd(), 'data', 'library')
const MAX_COLLECTION_BYTES = 15_000_000

function collectionPath(id: string): string {
  return path.join(DATA_DIR, `${id}.json`)
}

function hashContent(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex')
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true })
}

async function readCollection(id: string): Promise<StoredCollection | null> {
  try {
    const raw = await fs.readFile(collectionPath(id), 'utf8')
    return JSON.parse(raw) as StoredCollection
  } catch {
    return null
  }
}

export async function listCollections(): Promise<StoredCollectionMeta[]> {
  await ensureDir()
  const files = await fs.readdir(DATA_DIR)
  const items: StoredCollectionMeta[] = []

  for (const file of files) {
    if (!file.endsWith('.json')) continue
    const record = await readCollection(file.replace(/\.json$/, ''))
    if (!record) continue
    const { rawJson: _raw, ...meta } = record
    items.push(meta)
  }

  return items.sort((a, b) => b.savedAt - a.savedAt)
}

export async function getCollection(id: string): Promise<StoredCollection | null> {
  return readCollection(id)
}

export async function saveCollection(
  rawJson: string,
  name: string,
  requestCount: number
): Promise<StoredCollectionMeta> {
  if (rawJson.length > MAX_COLLECTION_BYTES) {
    throw new Error('Collection is too large to store.')
  }

  await ensureDir()
  const contentHash = hashContent(rawJson)

  const record: StoredCollection = {
    id: crypto.randomUUID(),
    name,
    rawJson,
    requestCount,
    savedAt: Date.now(),
    sizeBytes: rawJson.length,
    contentHash,
  }

  await fs.writeFile(collectionPath(record.id), JSON.stringify(record), 'utf8')
  const { rawJson: _raw, ...meta } = record
  return meta
}

export async function deleteCollection(id: string): Promise<boolean> {
  try {
    await fs.unlink(collectionPath(id))
    return true
  } catch {
    return false
  }
}
