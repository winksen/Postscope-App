import type { StorageMode } from './storagePreferences'
import { parseLoggingMode, type LoggingMode } from './parseLoggingMode'
import { sanitizeAuditOptions, type AuditOptions } from './auditor'
import { DEFAULT_SCORE_WEIGHTS, sanitizeScoreWeights, type ScoreWeights } from './severity'

export type { LoggingMode }
export { parseLoggingMode }

export const DEFAULT_FEEDBACK_URL = 'https://github.com/winksen/Postscope-App/issues/new'
export const DEFAULT_MAX_COLLECTION_BYTES = 15_000_000
const CONFIG_TIMEOUT_MS = 8_000

export interface AppConfig {
  appVersion: string
  loggingMode: LoggingMode
  publicLandingPage: boolean
  showGitHubLink: boolean
  showFeedbackLink: boolean
  feedbackUrl: string
  /** Largest collection the server will store; also used as the client-side import guard. */
  maxCollectionBytes: number
  libraryAllowDelete: boolean
  libraryRedactSecrets: boolean
  /** The server encrypts stored collections at rest (LIBRARY_ENCRYPTION_KEY). */
  libraryEncrypted: boolean
  /** Stored collections are deleted after this many days (0 keeps them until removed). */
  libraryRetentionDays: number
  /** Team audit policy defaults (disabled rules, severity overrides). */
  auditPolicy: AuditOptions
  /** Points per finding severity used by the score (scoring model v2). */
  scoreWeights: ScoreWeights
}

export const DEFAULT_APP_CONFIG: AppConfig = {
  appVersion: 'unknown',
  loggingMode: 'off',
  publicLandingPage: false,
  showGitHubLink: true,
  showFeedbackLink: true,
  feedbackUrl: DEFAULT_FEEDBACK_URL,
  maxCollectionBytes: DEFAULT_MAX_COLLECTION_BYTES,
  libraryAllowDelete: true,
  libraryRedactSecrets: false,
  libraryEncrypted: false,
  libraryRetentionDays: 0,
  auditPolicy: {},
  scoreWeights: DEFAULT_SCORE_WEIGHTS,
}

function parseBooleanFlag(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return false
  const normalized = value.trim().toLowerCase()
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on'
}

/** Only http(s) links are rendered, so a bad config value can never become a `javascript:` URL. */
export function sanitizeHttpUrl(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value.trim()) return fallback
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : fallback
  } catch {
    return fallback
  }
}

/** Fetch deployment config from the app server (LOGGING_MODE, PUBLIC_LANDING_PAGE, policies). */
export async function fetchAppConfig(): Promise<AppConfig> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CONFIG_TIMEOUT_MS)
  try {
    const res = await fetch('/api/config', { signal: controller.signal, credentials: 'same-origin' })
    if (!res.ok) throw new Error('Failed to load app config')
    const body = (await res.json()) as Partial<AppConfig>
    const maxBytes = Number(body.maxCollectionBytes)
    return {
      appVersion: typeof body.appVersion === 'string' ? body.appVersion : 'unknown',
      loggingMode: parseLoggingMode(body.loggingMode),
      publicLandingPage: parseBooleanFlag(body.publicLandingPage),
      showGitHubLink: body.showGitHubLink !== false,
      showFeedbackLink: body.showFeedbackLink !== false,
      feedbackUrl: sanitizeHttpUrl(body.feedbackUrl, DEFAULT_FEEDBACK_URL),
      maxCollectionBytes: Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : DEFAULT_MAX_COLLECTION_BYTES,
      libraryAllowDelete: body.libraryAllowDelete !== false,
      libraryRedactSecrets: body.libraryRedactSecrets === true,
      libraryEncrypted: body.libraryEncrypted === true,
      libraryRetentionDays: Number.isFinite(Number(body.libraryRetentionDays)) ? Math.max(0, Number(body.libraryRetentionDays)) : 0,
      auditPolicy: sanitizeAuditOptions(body.auditPolicy),
      scoreWeights: sanitizeScoreWeights(body.scoreWeights),
    }
  } finally {
    clearTimeout(timer)
  }
}

export function canChoosePrivacyMode(loggingMode: LoggingMode): boolean {
  return loggingMode === 'hybrid'
}

export function isTeamLoggingRequired(loggingMode: LoggingMode): boolean {
  return loggingMode === 'on'
}

export function isPublicDeployment(loggingMode: LoggingMode): boolean {
  return loggingMode === 'off'
}

export function getForcedStorageMode(loggingMode: LoggingMode): StorageMode | null {
  if (loggingMode === 'on') return 'history'
  if (loggingMode === 'off') return 'incognito'
  return null
}

export function shouldShowTeamLibrary(loggingMode: LoggingMode): boolean {
  return loggingMode !== 'off'
}

export function requiresUploadConsent(loggingMode: LoggingMode, storageMode: StorageMode): boolean {
  return loggingMode === 'hybrid' && storageMode === 'history'
}

export function canSaveToAppStorage(loggingMode: LoggingMode, storageMode: StorageMode, hasConsent: boolean): boolean {
  if (loggingMode === 'on') return true
  if (loggingMode === 'off') return false
  return storageMode === 'history' && hasConsent
}

/**
 * Whether a copy of the collection and environment files is kept in this tab's session storage. The deployment mode
 * decides whether a copy is allowed at all; the person must also have turned on "keep for refresh".
 */
export function shouldPersistSession(loggingMode: LoggingMode, storageMode: StorageMode, keepSession: boolean): boolean {
  if (!keepSession) return false
  if (loggingMode === 'on') return true
  if (loggingMode === 'off') return false
  return storageMode === 'history'
}

export function getPrivacyModeDescription(loggingMode: LoggingMode, storageMode: StorageMode): string {
  if (loggingMode === 'on') {
    return 'Team logging is enabled. Every imported collection is saved to the app storage.'
  }
  if (loggingMode === 'off') {
    return 'Public mode: collections are analyzed in your browser and never stored on the app.'
  }
  return storageMode === 'history'
    ? 'Collections are saved to the app storage so your team can browse and reopen them.'
    : 'Incognito: your imports are not stored, but you can still browse the team library.'
}
