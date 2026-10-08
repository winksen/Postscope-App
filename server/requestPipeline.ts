import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleConfigApi, handleHealthApi, handleLibraryApi } from './apiHandlers'
import { parseRequestUrl, sendJson } from './http'
import { applySecurityHeaders, checkBasicAuth, checkRateLimit, getClientIp, newRequestId, sendAuthChallenge } from './security'
import { serveStatic } from './staticFiles'
import { isAccessLogEnabled } from './runtimeConfig'
import { errorFields, log } from './logger'

export interface PipelineOptions {
  /** `production` serves the built SPA with a strict CSP; `dev` hands non-API requests to Vite. */
  mode: 'production' | 'dev'
  distDir?: string
}

type Next = () => void

/**
 * One request pipeline for the production server and the Vite dev/preview servers:
 * security headers → health → optional Basic auth → rate limits → API → static files.
 */
export function createRequestHandler(options: PipelineOptions) {
  return async function handle(req: IncomingMessage, res: ServerResponse, next?: Next): Promise<void> {
    const started = Date.now()
    const url = parseRequestUrl(req)
    const isApi = !!url && (url.pathname === '/api' || url.pathname.startsWith('/api/'))

    if (isApi) res.setHeader('X-Request-Id', newRequestId())
    if (options.mode === 'production' || isApi) applySecurityHeaders(res, { csp: options.mode === 'production' })

    if (isAccessLogEnabled()) {
      res.once('finish', () => {
        log.info('request', {
          method: req.method,
          path: url?.pathname ?? '?',
          status: res.statusCode,
          ms: Date.now() - started,
          ip: getClientIp(req),
        })
      })
    }

    try {
      if (!url) {
        res.statusCode = 400
        res.end('Bad request')
        return
      }

      if (await handleHealthApi(req, res, url)) return

      const auth = checkBasicAuth(req)
      if (auth === 'challenge' || auth === 'locked') {
        sendAuthChallenge(res, auth === 'locked')
        return
      }

      if (isApi) {
        if (req.method === 'GET' || req.method === 'HEAD') {
          const retryAfter = checkRateLimit(req, 'read')
          if (retryAfter) {
            sendJson(res, 429, { error: 'Too many requests. Slow down and try again.' }, { 'Retry-After': String(retryAfter) })
            return
          }
        }
        if (await handleConfigApi(req, res, url)) return
        if (await handleLibraryApi(req, res, url)) return
        sendJson(res, 404, { error: 'Not found' })
        return
      }

      if (options.mode === 'dev' || !options.distDir) {
        next?.()
        return
      }
      serveStatic(req, res, options.distDir, url.pathname)
    } catch (error) {
      log.error('Request failed', { path: url?.pathname, ...errorFields(error) })
      if (!res.headersSent) {
        if (isApi) sendJson(res, 500, { error: 'Unexpected server error.' })
        else {
          res.statusCode = 500
          res.end('Internal server error')
        }
      } else {
        res.destroy()
      }
    }
  }
}
