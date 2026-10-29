import { getLoggingMode } from './loggingConfig'
import {
  getAllowedOrigins,
  getBasicAuthConfig,
  getDataDir,
  getInternalIdentifiers,
  getLibraryEncryption,
  getLibraryLimits,
  getMaxCollectionBytes,
  getRateLimits,
  getTrustedProxyPeerEntries,
  getTrustedUserHeader,
  getTrustProxyHops,
  isHstsEnabled,
  isLibraryAuditLogEnabled,
  isLibraryDeleteAllowed,
  isLibraryRedactionEnabled,
  isTrustProxyEnabled,
  isUnauthenticatedTeamStorageAllowed,
} from './runtimeConfig'
import { isProxyIdentityConfigured } from './security'
import { validateRuntimeSettings } from './startupValidation'

export type DeploymentKind = 'browser-only' | 'isolated-team' | 'authenticated-team'

export interface DoctorIssue {
  level: 'error' | 'warning'
  code: string
  message: string
}

export interface DoctorReport {
  deployment: DeploymentKind
  /** Effective settings that carry no secret. Credentials and keys appear only as `set` or `not set`. */
  settings: Record<string, string | number | boolean | string[]>
  issues: DoctorIssue[]
}

/** Values copied from the documentation examples. A deployment that still uses one is not protected. */
const EXAMPLE_PASSWORDS = new Set(['change-me-to-a-long-random-value', 'changeme', 'change-me', 'password', 'postscope', 'admin', 'secret'])
const EXAMPLE_KEY_FRAGMENT = /^(0{64}|(0123456789abcdef){4})$/i

function env(name: string): string {
  return (process.env[name] ?? '').trim()
}

/**
 * Reads the effective runtime settings the same way the server does and reports what is unsafe or inconsistent.
 * It prints names and yes/no states only: passwords, keys and identifiers are never part of the result.
 */
export function inspectDeployment(): DoctorReport {
  const mode = getLoggingMode()
  const basic = getBasicAuthConfig()
  const proxyIdentity = isProxyIdentityConfigured()
  const startup = validateRuntimeSettings()
  const encryption = getLibraryEncryption()
  const limits = getLibraryLimits()
  const rates = getRateLimits()
  const issues: DoctorIssue[] = []

  for (const issue of startup.errors) issues.push({ level: 'error', code: issue.code, message: issue.message })
  for (const warning of startup.warnings) issues.push({ level: 'warning', code: 'TEAM_STORAGE_OVERRIDE', message: warning })

  const team = mode !== 'off'
  const authenticated = !!basic || (proxyIdentity && getTrustedProxyPeerEntries().length > 0)
  const deployment: DeploymentKind = !team ? 'browser-only' : authenticated ? 'authenticated-team' : 'isolated-team'

  const warn = (code: string, message: string) => issues.push({ level: 'warning', code, message })

  if (basic) {
    if (EXAMPLE_PASSWORDS.has(basic.password.toLowerCase()))
      warn(
        'PASSWORD_IS_EXAMPLE',
        'BASIC_AUTH_PASSWORD is a value copied from documentation or a common default. Generate a long random one.'
      )
    else if (basic.password.length < 12) warn('PASSWORD_SHORT', 'BASIC_AUTH_PASSWORD is shorter than 12 characters.')
    if (basic.username.toLowerCase() === basic.password.toLowerCase())
      warn('PASSWORD_EQUALS_USER', 'BASIC_AUTH_PASSWORD is the same as BASIC_AUTH_USER.')
  }
  if (team) {
    if (!encryption.enabled)
      warn('ENCRYPTION_OFF', 'Stored collections are not encrypted at rest. Set LIBRARY_ENCRYPTION_KEY or LIBRARY_ENCRYPTION_KEY_FILE.')
    if (encryption.enabled && 'error' in encryption && encryption.error)
      issues.push({
        level: 'error',
        code: 'ENCRYPTION_KEY_INVALID',
        message: `The library encryption key is unusable: ${encryption.error}`,
      })
    if (encryption.enabled && EXAMPLE_KEY_FRAGMENT.test(env('LIBRARY_ENCRYPTION_KEY')))
      issues.push({
        level: 'error',
        code: 'ENCRYPTION_KEY_IS_EXAMPLE',
        message: 'LIBRARY_ENCRYPTION_KEY is an example value. Generate 32 random bytes.',
      })
    if (!isLibraryAuditLogEnabled()) warn('AUDIT_LOG_OFF', 'The library audit log is switched off, so reads and changes are not recorded.')
    if (!isLibraryRedactionEnabled())
      warn(
        'REDACTION_OFF',
        'Credentials are stored as imported (LIBRARY_REDACT_SECRETS=false). This is intended only when the library is encrypted and access is controlled.'
      )
    if (limits.retentionDays === 0)
      warn('RETENTION_UNLIMITED', 'Stored collections are kept until someone removes them (LIBRARY_RETENTION_DAYS=0).')
    if (authenticated && !isHstsEnabled()) warn('HSTS_OFF', 'ENABLE_HSTS is off. Turn it on when the app is served over HTTPS.')
    if (rates.writesPerMinute === 0 || rates.readsPerMinute === 0)
      warn('RATE_LIMIT_OFF', 'A rate limit is disabled (RATE_LIMIT_WRITES_PER_MIN or RATE_LIMIT_READS_PER_MIN is 0).')
  }
  if (isTrustProxyEnabled() && !getTrustedUserHeader() && !basic && team)
    warn(
      'PROXY_WITHOUT_IDENTITY',
      'TRUST_PROXY is on but there is neither TRUSTED_USER_HEADER nor Basic auth, so nothing identifies the caller.'
    )
  if (isTrustProxyEnabled() && getAllowedOrigins().length === 0 && team)
    warn('ALLOWED_ORIGINS_MISSING', 'Behind a proxy, add the public origin to ALLOWED_ORIGINS so saves from the browser are accepted.')
  if (env('HOST') === '0.0.0.0' && !authenticated && team)
    warn('LISTENING_ON_ALL_INTERFACES', 'HOST=0.0.0.0 with unauthenticated team storage exposes the library to every reachable network.')

  return {
    deployment,
    settings: {
      loggingMode: mode,
      basicAuth: basic ? 'set' : 'not set',
      proxyIdentity: proxyIdentity ? 'configured' : 'not configured',
      trustProxy: isTrustProxyEnabled(),
      trustProxyHops: getTrustProxyHops(),
      trustedUserHeader: getTrustedUserHeader() ?? 'not set',
      trustedProxyPeers: getTrustedProxyPeerEntries(),
      allowedOrigins: getAllowedOrigins(),
      hsts: isHstsEnabled(),
      allowUnauthenticatedTeamStorage: isUnauthenticatedTeamStorageAllowed(),
      libraryEncryption: encryption.enabled ? 'on' : 'off',
      libraryAuditLog: isLibraryAuditLogEnabled(),
      libraryRedactSecrets: isLibraryRedactionEnabled(),
      libraryDeleteAllowed: isLibraryDeleteAllowed(),
      libraryRetentionDays: limits.retentionDays,
      libraryMaxItems: limits.maxItems,
      maxCollectionMB: getMaxCollectionBytes() / 1_000_000,
      rateLimitWritesPerMinute: rates.writesPerMinute,
      rateLimitReadsPerMinute: rates.readsPerMinute,
      internalIdentifiers: `${getInternalIdentifiers().length} configured`,
      dataDir: team ? getDataDir() : 'not used',
    },
    issues,
  }
}

const DEPLOYMENT_LABEL: Record<DeploymentKind, string> = {
  'browser-only': 'browser only (nothing is stored on the server)',
  'isolated-team': 'isolated team (stores collections, no authentication: network access is the only control)',
  'authenticated-team': 'authenticated team (stores collections behind sign-in)',
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines = [`PostScope deployment check`, '', `Deployment: ${DEPLOYMENT_LABEL[report.deployment]}`, '', 'Effective settings:']
  for (const [key, value] of Object.entries(report.settings))
    lines.push(`  ${key.padEnd(30)} ${Array.isArray(value) ? (value.length ? value.join(', ') : 'none') : String(value)}`)
  lines.push('')
  if (!report.issues.length) lines.push('No problems found.')
  else {
    lines.push('Findings:')
    for (const issue of report.issues) lines.push(`  ${issue.level.toUpperCase().padEnd(7)} ${issue.code}: ${issue.message}`)
  }
  return lines.join('\n') + '\n'
}
