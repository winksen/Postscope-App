/**
 * Storage access that never throws. Browsers block or throw on localStorage/sessionStorage in private
 * modes, sandboxed iframes, or when quota is exceeded; the app must keep working in all of those.
 */

type StorageKind = 'local' | 'session'

function storage(kind: StorageKind): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage
  } catch {
    return null
  }
}

export function readStorage(key: string, kind: StorageKind = 'local'): string | null {
  try {
    return storage(kind)?.getItem(key) ?? null
  } catch {
    return null
  }
}

export function writeStorage(key: string, value: string, kind: StorageKind = 'local'): boolean {
  try {
    const target = storage(kind)
    if (!target) return false
    target.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function removeStorage(key: string, kind: StorageKind = 'local'): void {
  try {
    storage(kind)?.removeItem(key)
  } catch {
    /* ignore */
  }
}
