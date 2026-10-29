import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureAppEnv } from './loadEnv'
import { createRequestHandler } from './requestPipeline'
import { cleanupTempFiles, flushLibraryWrites, libraryEncryptionStatus, pruneLibrary } from './libraryStore'
import { flushAuditLog } from './auditLog'
import { rateLimiter, sweepAuthFailures } from './security'
import { isUploadAllowed, getLoggingMode } from './loggingConfig'
import {
  getAuditPolicy,
  getBasicAuthConfig,
  getDataDir,
  getLibraryLimits,
  getMaxCollectionBytes,
  isHstsEnabled,
  getTrustedUserHeader,
  isLibraryAuditLogEnabled,
  isLibraryDeleteAllowed,
  isLibraryRedactionEnabled,
  isTrustProxyEnabled,
} from './runtimeConfig'
import { validateRuntimeSettings } from './startupValidation'
import { getAppVersion } from './appVersion'
import { errorFields, log } from './logger'

ensureAppEnv()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST_DIR = path.join(__dirname, '..', 'dist')
const PORT = Number(process.env.PORT ?? 3010)
const HOST = process.env.HOST?.trim() || undefined
const MAINTENANCE_INTERVAL_MS = 10 * 60_000
const SHUTDOWN_TIMEOUT_MS = 10_000

const startup = validateRuntimeSettings()
for (const warning of startup.warnings) log.warn(warning)
if (startup.errors.length > 0) {
  for (const issue of startup.errors) log.error(`[${issue.code}] ${issue.message}`)
  log.error('Refusing to start because of the settings above.')
  process.exit(1)
}

const handle = createRequestHandler({ mode: 'production', distDir: DIST_DIR })
const server = http.createServer((req, res) => {
  void handle(req, res)
})

// Bound slow or abusive clients (slowloris, giant headers).
server.headersTimeout = 20_000
server.requestTimeout = 120_000
server.keepAliveTimeout = 5_000
server.maxHeadersCount = 100
server.on('clientError', (_error, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
  else socket.destroy()
})

/** Background maintenance: expire rate-limit windows, apply library retention, remove orphaned temp files. */
async function runMaintenance(): Promise<void> {
  try {
    rateLimiter.sweep()
    sweepAuthFailures()
    if (isUploadAllowed()) {
      await pruneLibrary()
      await cleanupTempFiles()
    }
  } catch (error) {
    log.warn('Maintenance task failed', errorFields(error))
  }
}

const maintenanceTimer = setInterval(() => void runMaintenance(), MAINTENANCE_INTERVAL_MS)
maintenanceTimer.unref()

function logStartupSummary(): void {
  const limits = getLibraryLimits()
  const policy = getAuditPolicy()
  const encryption = libraryEncryptionStatus()
  log.info(`PostScope ${getAppVersion()} running at http://${HOST ?? 'localhost'}:${PORT}`, {
    loggingMode: getLoggingMode(),
    basicAuth: getBasicAuthConfig() ? 'enabled' : 'disabled',
    dataDir: isUploadAllowed() ? getDataDir() : 'n/a',
    maxCollectionMB: getMaxCollectionBytes() / 1_000_000,
    libraryMaxItems: limits.maxItems || 'unlimited',
    libraryRetentionDays: limits.retentionDays || 'forever',
    libraryDelete: isLibraryDeleteAllowed() ? 'allowed' : 'disabled',
    libraryRedaction: isLibraryRedactionEnabled() ? 'on' : 'off',
    libraryEncryption: encryption.enabled ? (encryption.error ? 'misconfigured' : `aes-256-gcm (key ${encryption.keyId})`) : 'off',
    libraryAuditLog: isUploadAllowed() && isLibraryAuditLogEnabled() ? 'on' : 'off',
    trustedUserHeader: isTrustProxyEnabled() ? (getTrustedUserHeader() ?? 'none') : 'ignored (TRUST_PROXY is off)',
    trustProxy: isTrustProxyEnabled(),
    hsts: isHstsEnabled(),
    disabledRules: policy.disabledRules?.length ? policy.disabledRules.join(',') : 'none',
  })
  if (encryption.error) {
    log.error(`Library encryption is misconfigured, so saving collections is refused until it is fixed: ${encryption.error}`)
  }
  if (getTrustedUserHeader() && !isTrustProxyEnabled()) {
    log.warn('TRUSTED_USER_HEADER is ignored because TRUST_PROXY is not enabled.')
  }
}

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') log.error(`Port ${PORT} is already in use. Set PORT to a free port.`)
  else log.error('Server error', errorFields(error))
  process.exit(1)
})

server.listen(PORT, HOST, () => {
  logStartupSummary()
  void runMaintenance()
})

let shuttingDown = false

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  log.info(`Received ${signal}; shutting down gracefully.`)
  clearInterval(maintenanceTimer)

  const forceExit = setTimeout(() => {
    log.warn('Shutdown timed out; forcing exit.')
    process.exit(1)
  }, SHUTDOWN_TIMEOUT_MS)
  forceExit.unref()

  server.close()
  server.closeIdleConnections?.()
  try {
    await flushLibraryWrites()
    await flushAuditLog()
  } catch (error) {
    log.warn('Pending library writes failed during shutdown', errorFields(error))
  }
  await new Promise<void>((resolve) => {
    if (!server.listening) resolve()
    else server.once('close', () => resolve())
  })
  log.info('Shutdown complete.')
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('unhandledRejection', (reason) => log.error('Unhandled promise rejection', errorFields(reason)))
process.on('uncaughtException', (error) => {
  log.error('Uncaught exception; exiting', errorFields(error))
  process.exit(1)
})
