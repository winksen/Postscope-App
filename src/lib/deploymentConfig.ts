import type { StorageMode } from './storagePreferences'
import { parseLoggingMode, type LoggingMode } from './parseLoggingMode'

export type { LoggingMode }
export { parseLoggingMode }

export interface AppConfig {
  loggingMode: LoggingMode
  publicLandingPage: boolean
}

function parseBooleanFlag(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return false
  const normalized = value.trim().toLowerCase()
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on'
}

/** Fetch deployment config from the app server (LOGGING_MODE, PUBLIC_LANDING_PAGE). */
export async function fetchAppConfig(): Promise<AppConfig> {
  const res = await fetch('/api/config')
  if (!res.ok) throw new Error('Failed to load app config')
  const body = (await res.json()) as Partial<AppConfig>
  return {
    loggingMode: parseLoggingMode(body.loggingMode),
    publicLandingPage: parseBooleanFlag(body.publicLandingPage),
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

export function canSaveToAppStorage(
  loggingMode: LoggingMode,
  storageMode: StorageMode,
  hasConsent: boolean
): boolean {
  if (loggingMode === 'on') return true
  if (loggingMode === 'off') return false
  return storageMode === 'history' && hasConsent
}

export function shouldPersistSession(loggingMode: LoggingMode, storageMode: StorageMode): boolean {
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
