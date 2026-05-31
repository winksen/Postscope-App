const STORAGE_KEY = 'postscope:collection-session'
const MAX_BYTES = 4_500_000

export interface CollectionSession {
  rawJson: string
  collectionName: string
  savedAt: number
}

export function saveCollectionSession(rawJson: string, collectionName: string): boolean {
  try {
    if (rawJson.length > MAX_BYTES) return false
    const payload: CollectionSession = {
      rawJson,
      collectionName,
      savedAt: Date.now(),
    }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    return true
  } catch {
    return false
  }
}

export function loadCollectionSession(): CollectionSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const session = JSON.parse(raw) as CollectionSession
    if (!session?.rawJson) return null
    return session
  } catch {
    return null
  }
}

export function clearCollectionSession(): void {
  sessionStorage.removeItem(STORAGE_KEY)
}
