export interface SavedCollectionMeta {
  id: string
  name: string
  requestCount: number
  savedAt: number
  sizeBytes: number
  contentHash: string
}

export interface SavedCollection extends SavedCollectionMeta {
  rawJson: string
}

const API_BASE = '/api/collections'
const MAX_COLLECTION_BYTES = 15_000_000

async function parseError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string }
    return body.error ?? res.statusText
  } catch {
    return res.statusText || 'Request failed'
  }
}

/** List collections stored on the app server (shared across all users). */
export async function listSavedCollections(): Promise<SavedCollectionMeta[]> {
  const res = await fetch(API_BASE)
  if (!res.ok) throw new Error(await parseError(res))
  const body = (await res.json()) as { collections: SavedCollectionMeta[] }
  return body.collections
}

export async function getSavedCollection(id: string): Promise<SavedCollection | null> {
  const res = await fetch(`${API_BASE}/${encodeURIComponent(id)}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(await parseError(res))
  return (await res.json()) as SavedCollection
}

export async function findLibraryIdForContent(rawJson: string): Promise<string | null> {
  const collections = await listSavedCollections()
  const data = new TextEncoder().encode(rawJson)
  const buf = await crypto.subtle.digest('SHA-256', data)
  const contentHash = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, 'hex'))
    .join('')
  return collections.find((item) => item.contentHash === contentHash)?.id ?? null
}

/** Save a collection to the app's filesystem storage (not the browser). */
export async function saveToLibrary(
  rawJson: string,
  name: string,
  requestCount: number
): Promise<SavedCollectionMeta> {
  if (rawJson.length > MAX_COLLECTION_BYTES) {
    throw new Error('Collection is too large to store.')
  }

  const res = await fetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rawJson, name, requestCount }),
  })

  if (!res.ok) throw new Error(await parseError(res))
  return (await res.json()) as SavedCollectionMeta
}

export async function removeFromLibrary(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await parseError(res))
}

export function downloadCollectionJson(name: string, rawJson: string): void {
  const safeName = name.replace(/[^\w.-]+/g, '_') || 'collection'
  const blob = new Blob([rawJson], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${safeName}.postman_collection.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

export function formatSavedAt(timestamp: number): string {
  const date = new Date(timestamp)
  const now = Date.now()
  const diffMs = now - timestamp
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date)
  }
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays} days ago`

  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date)
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
