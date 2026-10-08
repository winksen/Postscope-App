import { sanitizeAuditOptions, type AuditOptions } from './auditor'
import { readStorage, removeStorage, writeStorage } from './safeStorage'

const STORAGE_KEY = 'postscope:audit-rules'

/** The user's saved rule configuration, or null when they use the deployment defaults. */
export function loadAuditPreferences(): AuditOptions | null {
  const raw = readStorage(STORAGE_KEY)
  if (!raw) return null
  try {
    return sanitizeAuditOptions(JSON.parse(raw))
  } catch {
    removeStorage(STORAGE_KEY)
    return null
  }
}

export function saveAuditPreferences(options: AuditOptions): void {
  writeStorage(STORAGE_KEY, JSON.stringify(sanitizeAuditOptions(options)))
}

export function clearAuditPreferences(): void {
  removeStorage(STORAGE_KEY)
}

/** User preferences win; otherwise the team policy from the server applies. */
export function effectiveAuditOptions(serverPolicy: AuditOptions, userPreferences: AuditOptions | null): AuditOptions {
  return userPreferences ?? serverPolicy
}

export function isCustomized(options: AuditOptions): boolean {
  return (options.disabledRules?.length ?? 0) > 0 || Object.keys(options.severityOverrides ?? {}).length > 0
}
