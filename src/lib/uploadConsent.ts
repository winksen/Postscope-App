import { readStorage, removeStorage, writeStorage } from './safeStorage'
import type { LoggingMode } from './parseLoggingMode'

/** The server settings that change what happens to an uploaded collection. Consent covers exactly this combination. */
export interface UploadPolicy {
  loggingMode: LoggingMode
  /** The server removes credentials before storing a collection. */
  redactsSecrets: boolean
  /** The server encrypts stored collections at rest. */
  encrypted: boolean
  /** Stored collections are deleted after this many days; 0 keeps them until someone removes them. */
  retentionDays: number
}

// The key predates policy binding. An old value of `true` carries no origin or policy, so it never counts as consent.
const CONSENT_KEY = 'postscope:upload-risk-accepted'

/** FNV-1a over the canonical policy text: short, stable and good enough to notice a change (not a security boundary). */
export function uploadPolicyDigest(policy: UploadPolicy): string {
  const text = JSON.stringify([policy.loggingMode, policy.redactsSecrets, policy.encrypted, Math.max(0, Math.floor(policy.retentionDays))])
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/** `stale` means the person accepted before, but for another origin or another policy, so they must accept again. */
export type ConsentState = 'accepted' | 'none' | 'stale'

export function getUploadConsentState(origin: string, digest: string): ConsentState {
  const raw = readStorage(CONSENT_KEY)
  if (!raw || raw === 'false') return 'none'
  try {
    const record = JSON.parse(raw) as { origin?: unknown; digest?: unknown }
    if (record && record.origin === origin && record.digest === digest) return 'accepted'
  } catch {
    /* an old plain value falls through to stale */
  }
  return 'stale'
}

export function recordUploadConsent(origin: string, digest: string): void {
  writeStorage(CONSENT_KEY, JSON.stringify({ origin, digest }))
}

export function revokeUploadConsent(): void {
  removeStorage(CONSENT_KEY)
}
