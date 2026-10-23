import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  LibraryError,
  checkLibraryWritable,
  deleteCollection,
  getCollection,
  libraryEncryptionStatus,
  isValidCollectionId,
  listCollections,
  saveCollection,
} from './libraryStore'
import { getAppVersion } from './appVersion'
import { getExternalLinksConfig } from './externalLinksConfig'
import { isPublicLandingEnabled } from './landingConfig'
import { getLoggingMode, isLibraryVisible, isUploadAllowed } from './loggingConfig'
import { HttpError, readJsonBody, sendJson } from './http'
import { checkRateLimit, getClientIp, getProxyUser, isSameOriginRequest } from './security'
import { recordAudit } from './auditLog'
import { getAuditPolicy, getMaxCollectionBytes, getScoreWeights, isHealthVersionExposed, isLibraryDeleteAllowed, isLibraryRedactionEnabled } from './runtimeConfig'
import { errorFields, log } from './logger'
import { redactCollection } from '../src/lib/redaction'

const startedAt = Date.now()

function requestIdOf(res: ServerResponse): string | undefined {
  const value = res.getHeader('X-Request-Id')
  return typeof value === 'string' ? value : undefined
}

function sendError(res: ServerResponse, error: unknown): void {
  if (error instanceof HttpError || error instanceof LibraryError) {
    sendJson(res, error.status, { error: error.message }, error instanceof HttpError ? error.headers : {})
    return
  }
  const requestId = requestIdOf(res)
  log.error('Unhandled API error', { requestId, ...errorFields(error) })
  // Never echo internal error messages (paths, stack details) to clients.
  sendJson(res, 500, { error: 'Unexpected server error.', requestId })
}

function isReadMethod(method: string | undefined): boolean {
  return method === 'GET' || method === 'HEAD'
}

export async function handleConfigApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (url.pathname !== '/api/config') return false
  if (!isReadMethod(req.method)) {
    sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'GET, HEAD' })
    return true
  }
  sendJson(res, 200, {
    appVersion: getAppVersion(),
    loggingMode: getLoggingMode(),
    publicLandingPage: isPublicLandingEnabled(),
    ...getExternalLinksConfig(),
    maxCollectionBytes: getMaxCollectionBytes(),
    libraryAllowDelete: isLibraryDeleteAllowed(),
    libraryRedactSecrets: isLibraryRedactionEnabled(),
    libraryEncrypted: libraryEncryptionStatus().enabled,
    auditPolicy: getAuditPolicy(),
    scoreWeights: getScoreWeights(),
  })
  return true
}

/** Liveness/readiness probe. Exempt from auth so container orchestrators can call it. */
export async function handleHealthApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (url.pathname !== '/api/health') return false
  if (!isReadMethod(req.method)) {
    sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'GET, HEAD' })
    return true
  }
  const storageEnabled = isUploadAllowed()
  const storageWritable = storageEnabled ? await checkLibraryWritable() : null
  const healthy = storageWritable !== false
  sendJson(res, healthy ? 200 : 503, {
    status: healthy ? 'ok' : 'degraded',
    ...(isHealthVersionExposed() ? { version: getAppVersion() } : {}),
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    storage: storageEnabled ? (storageWritable ? 'writable' : 'unwritable') : 'disabled',
  })
  return true
}

interface SaveBody {
  rawJson?: unknown
  name?: unknown
  requestCount?: unknown
}

export async function handleLibraryApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (url.pathname !== '/api/collections' && !url.pathname.startsWith('/api/collections/')) return false

  const idMatch = url.pathname.match(/^\/api\/collections\/([^/]+)$/)
  let id: string | null = null
  if (idMatch) {
    try {
      id = decodeURIComponent(idMatch[1])
    } catch {
      sendJson(res, 400, { error: 'Invalid collection id.' })
      return true
    }
  } else if (url.pathname !== '/api/collections') {
    sendJson(res, 404, { error: 'Not found' })
    return true
  }

  if (id !== null && !isValidCollectionId(id)) {
    sendJson(res, 400, { error: 'Invalid collection id.' })
    return true
  }

  try {
    const mutating = req.method === 'POST' || req.method === 'DELETE'
    if (mutating) {
      if (!isSameOriginRequest(req)) {
        sendJson(res, 403, { error: 'Cross-site request blocked.' })
        return true
      }
      const retryAfter = checkRateLimit(req, 'write')
      if (retryAfter) {
        sendJson(res, 429, { error: 'Too many requests. Slow down and try again.' }, { 'Retry-After': String(retryAfter) })
        return true
      }
    }

    if (isReadMethod(req.method) && !id) {
      sendJson(res, 200, { collections: isLibraryVisible() ? await listCollections() : [] })
      return true
    }

    if (isReadMethod(req.method) && id) {
      const collection = isLibraryVisible() ? await getCollection(id) : null
      if (!collection) {
        sendJson(res, 404, { error: 'Collection not found' })
        return true
      }
      void recordAudit({ action: 'open', id: collection.id, name: collection.name, user: getProxyUser(req), ip: getClientIp(req), requestId: requestIdOf(res) })
      sendJson(res, 200, collection)
      return true
    }

    if (req.method === 'POST' && !id) {
      if (!isUploadAllowed()) {
        sendJson(res, 403, { error: 'Collection storage is disabled in public mode.' })
        return true
      }

      // rawJson is a JSON string inside JSON, so escaping can roughly double its size on the wire.
      const body = await readJsonBody<SaveBody>(req, getMaxCollectionBytes() * 2 + 1_000_000)
      if (!body || typeof body !== 'object' || typeof body.rawJson !== 'string' || !body.rawJson) {
        sendJson(res, 400, { error: 'rawJson is required.' })
        return true
      }

      const user = getProxyUser(req)
      const meta = await saveCollection(body.rawJson, typeof body.name === 'string' ? body.name : '', undefined, {
        transform: isLibraryRedactionEnabled() ? redactCollection : undefined,
        savedBy: user,
      })
      void recordAudit({
        action: 'save',
        id: meta.id,
        name: meta.name,
        user,
        ip: getClientIp(req),
        requestId: requestIdOf(res),
        redactedCount: meta.redactedCount,
        deduplicated: meta.deduplicated,
      })
      sendJson(res, meta.deduplicated ? 200 : 201, meta)
      return true
    }

    if (req.method === 'DELETE' && id) {
      if (!isUploadAllowed()) {
        sendJson(res, 403, { error: 'Collection removal is disabled in public mode.' })
        return true
      }
      if (!isLibraryDeleteAllowed()) {
        sendJson(res, 403, { error: 'Collection removal is disabled by the operator.' })
        return true
      }
      const name = (await listCollections()).find((item) => item.id.toLowerCase() === id!.toLowerCase())?.name
      const removed = await deleteCollection(id)
      if (removed) void recordAudit({ action: 'delete', id: id.toLowerCase(), name, user: getProxyUser(req), ip: getClientIp(req), requestId: requestIdOf(res) })
      sendJson(res, removed ? 200 : 404, { ok: removed })
      return true
    }

    sendJson(res, 405, { error: 'Method not allowed' }, { Allow: id ? 'GET, HEAD, DELETE' : 'GET, HEAD, POST' })
    return true
  } catch (error) {
    sendError(res, error)
    return true
  }
}
