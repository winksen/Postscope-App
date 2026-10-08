import { readStorage, removeStorage, writeStorage } from './safeStorage'

const STORAGE_KEY = 'postscope:collection-session'
const MAX_BYTES = 4_500_000

export interface CollectionSession {
  rawJson: string
  collectionName: string
  savedAt: number
}

export function saveCollectionSession(rawJson: string, collectionName: string): boolean {
  if (rawJson.length > MAX_BYTES) return false
  const payload: CollectionSession = {
    rawJson,
    collectionName,
    savedAt: Date.now(),
  }
  return writeStorage(STORAGE_KEY, JSON.stringify(payload), 'session')
}

export function loadCollectionSession(): CollectionSession | null {
  const raw = readStorage(STORAGE_KEY, 'session')
  if (!raw) return null
  try {
    const session = JSON.parse(raw) as CollectionSession
    if (!session || typeof session.rawJson !== 'string' || !session.rawJson) return null
    return session
  } catch {
    removeStorage(STORAGE_KEY, 'session')
    return null
  }
}

export function clearCollectionSession(): void {
  removeStorage(STORAGE_KEY, 'session')
}
