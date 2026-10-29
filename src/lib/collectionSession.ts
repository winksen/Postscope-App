import { readStorage, removeStorage, writeStorage } from './safeStorage'

const STORAGE_KEY = 'postscope:collection-session'
const RETENTION_KEY = 'postscope:keep-session'
const MAX_BYTES = 4_500_000

/** How long a kept session copy stays in this tab's session storage. */
export const SESSION_TTL_MS = 60 * 60_000

export interface CollectionSession {
  rawJson: string
  collectionName: string
  savedAt: number
  /** When the copy expires (milliseconds since the epoch). A copy without a valid expiry is treated as expired. */
  expiresAt?: number
  /** Raw environment and globals exports loaded with the collection. */
  environments?: string[]
  /** Index of the selected environment inside `environments`. */
  activeEnvironment?: number
}

/** Keeping a copy for refresh is an explicit choice of the person at the keyboard; it is off until they turn it on. */
export function isSessionRetentionEnabled(): boolean {
  return readStorage(RETENTION_KEY) === 'true'
}

/** Turning retention off also removes any copy that is already stored. */
export function setSessionRetention(enabled: boolean): void {
  writeStorage(RETENTION_KEY, enabled ? 'true' : 'false')
  if (!enabled) clearCollectionSession()
}

/** Returns the expiry of the stored copy, or null when none is stored. */
export function saveCollectionSession(
  rawJson: string,
  collectionName: string,
  environments: readonly string[] = [],
  activeEnvironment?: number,
  now = Date.now()
): number | null {
  if (rawJson.length + environments.reduce((total, text) => total + text.length, 0) > MAX_BYTES) return null
  const expiresAt = now + SESSION_TTL_MS
  const payload: CollectionSession = {
    rawJson,
    collectionName,
    savedAt: now,
    expiresAt,
    ...(environments.length ? { environments: [...environments], activeEnvironment } : {}),
  }
  return writeStorage(STORAGE_KEY, JSON.stringify(payload), 'session') ? expiresAt : null
}

/** Reads the stored copy. An expired copy, or one from an older version without an expiry, is removed and not returned. */
export function loadCollectionSession(now = Date.now()): CollectionSession | null {
  const raw = readStorage(STORAGE_KEY, 'session')
  if (!raw) return null
  try {
    const session = JSON.parse(raw) as CollectionSession
    if (!session || typeof session.rawJson !== 'string' || !session.rawJson) {
      removeStorage(STORAGE_KEY, 'session')
      return null
    }
    if (typeof session.expiresAt !== 'number' || !(session.expiresAt > now)) {
      removeStorage(STORAGE_KEY, 'session')
      return null
    }
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
