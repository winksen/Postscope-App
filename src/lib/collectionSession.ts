import { readStorage, removeStorage, writeStorage } from './safeStorage'

const STORAGE_KEY = 'postscope:collection-session'
const MAX_BYTES = 4_500_000

export interface CollectionSession {
  rawJson: string
  collectionName: string
  savedAt: number
  /** Raw environment and globals exports loaded with the collection. */
  environments?: string[]
  /** Index of the selected environment inside `environments`. */
  activeEnvironment?: number
}

export function saveCollectionSession(
  rawJson: string,
  collectionName: string,
  environments: readonly string[] = [],
  activeEnvironment?: number
): boolean {
  if (rawJson.length + environments.reduce((total, text) => total + text.length, 0) > MAX_BYTES) return false
  const payload: CollectionSession = {
    rawJson,
    collectionName,
    savedAt: Date.now(),
    ...(environments.length ? { environments: [...environments], activeEnvironment } : {}),
  }
  return writeStorage(STORAGE_KEY, JSON.stringify(payload), 'session')
}

export function loadCollectionSession(): CollectionSession | null {
  const raw = readStorage(STORAGE_KEY, 'session')
  if (!raw) return null
  try {
    const session = JSON.parse(raw) as CollectionSession
    if (!session || typeof session.rawJson !== 'string' || !session.rawJson) return null
    const environments = Array.isArray(session.environments)
      ? session.environments.filter((text): text is string => typeof text === 'string')
      : []
    return {
      ...session,
      environments,
      activeEnvironment: Number.isInteger(session.activeEnvironment) ? session.activeEnvironment : undefined,
    }
  } catch {
    removeStorage(STORAGE_KEY, 'session')
    return null
  }
}

export function clearCollectionSession(): void {
  removeStorage(STORAGE_KEY, 'session')
}
