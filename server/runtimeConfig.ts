import path from 'node:path'
import { ensureAppEnv } from './loadEnv'
import { log } from './logger'
import { resolveEncryptionState, type EncryptionState } from './libraryCrypto'
import { sanitizeAuditOptions, type AuditOptions } from '../src/lib/auditor'
import { isSeverity, parseScoreWeights, type ScoreWeights } from '../src/lib/severity'
import { parseRulePacks } from '../src/lib/rulePacks'

/**
 * Optional hardening and operations settings. Every value is read lazily from the environment
 * (so tests and the Vite dev server see live values) and validated with safe defaults.
 */

const warned = new Set<string>()

function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return
  warned.add(key)
  log.warn(message)
}

export function parseFlag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback
  const normalized = value.trim().toLowerCase()
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true
  if (['false', '0', 'no', 'off'].includes(normalized)) return false
  return fallback
}

function parseNumber(name: string, fallback: number, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}): number {
  ensureAppEnv()
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value < min || value > max) {
    warnOnce(name, `Ignoring invalid ${name}=${raw}; using ${fallback}.`)
    return fallback
  }
  return value
}

function env(name: string): string | undefined {
  ensureAppEnv()
  const value = process.env[name]
  return value === undefined ? undefined : value.trim()
}

export function getDataDir(): string {
  const configured = env('DATA_DIR')
  return configured ? path.resolve(configured) : path.join(process.cwd(), 'data')
}

export function getLibraryDir(): string {
  return path.join(getDataDir(), 'library')
}

/** Maximum stored collection size (rawJson characters). Default 15 MB, capped at 100 MB. */
export function getMaxCollectionBytes(): number {
  return Math.round(parseNumber('MAX_COLLECTION_MB', 15, { min: 0.1, max: 100 }) * 1_000_000)
}

export function getLibraryLimits() {
  return {
    /** 0 = unlimited. Oldest collections are pruned beyond this count. */
    maxItems: Math.floor(parseNumber('LIBRARY_MAX_ITEMS', 0, { min: 0, max: 1_000_000 })),
    /** 0 = keep forever. */
    retentionDays: parseNumber('LIBRARY_RETENTION_DAYS', 0, { min: 0, max: 36_500 }),
    /** 0 = unlimited. New saves are rejected once the library would exceed this size. */
    maxTotalBytes: Math.round(parseNumber('LIBRARY_MAX_TOTAL_MB', 0, { min: 0, max: 1_000_000 }) * 1_000_000),
  }
}

export function isLibraryDeleteAllowed(): boolean {
  return parseFlag(env('LIBRARY_ALLOW_DELETE'), true)
}

export function isLibraryRedactionEnabled(): boolean {
  return parseFlag(env('LIBRARY_REDACT_SECRETS'), false)
}

export interface BasicAuthConfig {
  username: string
  password: string
}

/** Optional HTTP Basic auth for the whole app. Both variables must be set to enable it. */
export function getBasicAuthConfig(): BasicAuthConfig | null {
  const username = env('BASIC_AUTH_USER')
  const password = env('BASIC_AUTH_PASSWORD')
  if (!username && !password) return null
  if (!username || !password) {
    warnOnce('BASIC_AUTH', 'BASIC_AUTH_USER and BASIC_AUTH_PASSWORD must both be set; Basic auth is disabled.')
    return null
  }
  if (password.length < 12) warnOnce('BASIC_AUTH_WEAK', 'BASIC_AUTH_PASSWORD is shorter than 12 characters; use a long random value.')
  return { username, password }
}

export function getRateLimits() {
  return {
    /** Mutating API requests (save/delete) per client per minute. 0 disables. */
    writesPerMinute: Math.floor(parseNumber('RATE_LIMIT_WRITES_PER_MIN', 30, { min: 0, max: 100_000 })),
    /** Read API requests per client per minute. 0 disables. */
    readsPerMinute: Math.floor(parseNumber('RATE_LIMIT_READS_PER_MIN', 600, { min: 0, max: 1_000_000 })),
    /** Failed Basic auth attempts per client per 15 minutes before 429. */
    authFailuresPer15Min: Math.floor(parseNumber('RATE_LIMIT_AUTH_FAILURES', 20, { min: 1, max: 100_000 })),
  }
}

export function isTrustProxyEnabled(): boolean {
  return parseFlag(env('TRUST_PROXY'), false)
}

/**
 * Number of trusted reverse proxies in front of the app (only used with TRUST_PROXY=true). The client address
 * is taken that many entries from the right of X-Forwarded-For; entries further left are client-controlled.
 */
export function getTrustProxyHops(): number {
  return Math.floor(parseNumber('TRUST_PROXY_HOPS', 1, { min: 1, max: 10 }))
}

/** When false, the unauthenticated /api/health endpoint omits the application version. */
export function isHealthVersionExposed(): boolean {
  return parseFlag(env('HEALTH_EXPOSE_VERSION'), true)
}

export function isHstsEnabled(): boolean {
  return parseFlag(env('ENABLE_HSTS'), false)
}

export function isAccessLogEnabled(): boolean {
  return parseFlag(env('ACCESS_LOG'), false)
}

/** Extra origins allowed to call mutating APIs (comma-separated, e.g. https://postscope.example.com). */
export function getAllowedOrigins(): string[] {
  return (env('ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, '').toLowerCase())
    .filter(Boolean)
}

/**
 * Team audit policy defaults sent to every browser:
 * AUDIT_DISABLED_RULES=GET_WITH_BODY,INSECURE_HTTP
 * AUDIT_SEVERITY_OVERRIDES=INSECURE_HTTP=critical,MISSING_AUTH=info
 * AUDIT_RULE_PACKS=auto (default), none, or a list such as iam-am,-iam-pam (a leading - switches a pack off)
 */
export function getAuditPolicy(): AuditOptions {
  const disabledRules = (env('AUDIT_DISABLED_RULES') ?? '')
    .split(',')
    .map((rule) => rule.trim().toUpperCase())
    .filter(Boolean)
  const severityOverrides: Record<string, string> = {}
  for (const pair of (env('AUDIT_SEVERITY_OVERRIDES') ?? '').split(',')) {
    const [rule, severity] = pair.split('=').map((part) => part?.trim())
    if (!rule || !severity) continue
    if (!isSeverity(severity.toLowerCase())) {
      warnOnce(`AUDIT_SEVERITY_${rule}`, `Ignoring invalid severity "${severity}" for ${rule} in AUDIT_SEVERITY_OVERRIDES.`)
      continue
    }
    severityOverrides[rule.toUpperCase()] = severity.toLowerCase()
  }
  const packs = parseRulePacks(env('AUDIT_RULE_PACKS'))
  if (packs.errors.length) warnOnce('AUDIT_RULE_PACKS', `Ignoring invalid AUDIT_RULE_PACKS entries: ${packs.errors.join('; ')}.`)
  const sanitized = sanitizeAuditOptions({ disabledRules, severityOverrides, rulePacks: packs.settings })
  const unknown = disabledRules.filter((rule) => !sanitized.disabledRules?.includes(rule as never))
  if (unknown.length) warnOnce('AUDIT_DISABLED_RULES', `Unknown rule ids in AUDIT_DISABLED_RULES: ${unknown.join(', ')}`)
  return sanitized
}

/**
 * Score weights shared with every browser: SCORE_WEIGHTS=critical=20,warning=8,info=2 (any subset, 0 to 100).
 * Invalid entries are ignored with a warning.
 */
export function getScoreWeights(): ScoreWeights {
  const { weights, errors } = parseScoreWeights(env('SCORE_WEIGHTS'))
  if (errors.length) warnOnce('SCORE_WEIGHTS', `Ignoring invalid SCORE_WEIGHTS entries: ${errors.join('; ')}.`)
  return weights
}

/**
 * Library encryption at rest. `LIBRARY_ENCRYPTION_KEY` (or `LIBRARY_ENCRYPTION_KEY_FILE`, for Docker secrets) holds a
 * 32 byte key as 64 hex characters or base64. `LIBRARY_ENCRYPTION_KEY_PREVIOUS[_FILE]` lists older keys that may
 * still decrypt records until they are rewritten with `library.js encrypt`.
 */
export function getLibraryEncryption(): EncryptionState {
  return resolveEncryptionState({
    key: env('LIBRARY_ENCRYPTION_KEY'),
    keyFile: env('LIBRARY_ENCRYPTION_KEY_FILE'),
    previous: env('LIBRARY_ENCRYPTION_KEY_PREVIOUS'),
    previousFile: env('LIBRARY_ENCRYPTION_KEY_PREVIOUS_FILE'),
  })
}

/** Append-only audit log of library saves, opens and removals. On by default whenever the library is enabled. */
export function isLibraryAuditLogEnabled(): boolean {
  return parseFlag(env('LIBRARY_AUDIT_LOG'), true)
}

export function getAuditLogDir(): string {
  return path.join(getDataDir(), 'audit')
}

/**
 * Name of the request header a trusted reverse proxy sets to the signed-in user (for example `X-Forwarded-User` or
 * `X-Auth-Request-Email`). Only used when TRUST_PROXY=true; anything that is not a valid header name is ignored.
 */
export function getTrustedUserHeader(): string | null {
  const name = env('TRUSTED_USER_HEADER')
  if (!name) return null
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(name)) {
    warnOnce('TRUSTED_USER_HEADER', `Ignoring invalid TRUSTED_USER_HEADER "${name}".`)
    return null
  }
  return name.toLowerCase()
}

/** Only http(s) URLs are allowed for outbound links so a misconfiguration cannot inject `javascript:` URLs. */
export function sanitizeExternalUrl(value: string | undefined, fallback: string): string {
  if (!value) return fallback
  try {
    const url = new URL(value)
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.toString()
  } catch {
    /* fall through */
  }
  warnOnce(`URL_${value}`, `Ignoring non-http(s) URL "${value}"; using the default.`)
  return fallback
}
