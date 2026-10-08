import crypto from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  getAllowedOrigins,
  getBasicAuthConfig,
  getRateLimits,
  isHstsEnabled,
  isTrustProxyEnabled,
} from './runtimeConfig'

/**
 * Content Security Policy for the production bundle. The app ships no inline scripts; inline styles
 * are needed by Radix/Recharts/framer-motion. `blob:` workers are used by the confetti effect.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

export function applySecurityHeaders(res: ServerResponse, { csp }: { csp: boolean }): void {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), clipboard-read=()')
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
  res.setHeader('X-DNS-Prefetch-Control', 'off')
  if (csp) res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY)
  if (isHstsEnabled()) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
}

export function getClientIp(req: IncomingMessage): string {
  if (isTrustProxyEnabled()) {
    const forwarded = req.headers['x-forwarded-for']
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim()
    if (first) return first
  }
  return req.socket.remoteAddress ?? 'unknown'
}

// ---------------------------------------------------------------------------
// Rate limiting (fixed window per client and bucket, in memory)
// ---------------------------------------------------------------------------

interface Window {
  count: number
  resetAt: number
}

export class RateLimiter {
  private windows = new Map<string, Window>()

  constructor(private readonly maxEntries = 50_000) {}

  /** Returns seconds to wait when the limit is exceeded, otherwise 0. */
  hit(key: string, limit: number, windowMs: number, now = Date.now()): number {
    if (limit <= 0) return 0
    let window = this.windows.get(key)
    if (!window || window.resetAt <= now) {
      if (!window && this.windows.size >= this.maxEntries) this.sweep(now)
      window = { count: 0, resetAt: now + windowMs }
      this.windows.set(key, window)
    }
    window.count += 1
    return window.count > limit ? Math.max(1, Math.ceil((window.resetAt - now) / 1000)) : 0
  }

  /** Drops expired windows; called periodically by the server's background maintenance job. */
  sweep(now = Date.now()): number {
    let removed = 0
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) {
        this.windows.delete(key)
        removed += 1
      }
    }
    // Still full (sustained flood from many clients): drop the oldest half to bound memory.
    if (this.windows.size >= this.maxEntries) {
      const keys = [...this.windows.keys()].slice(0, Math.floor(this.maxEntries / 2))
      keys.forEach((key) => this.windows.delete(key))
      removed += keys.length
    }
    return removed
  }

  get size(): number {
    return this.windows.size
  }
}

export const rateLimiter = new RateLimiter()

export type RateBucket = 'read' | 'write'

/** Counts one API request; returns seconds to wait when the client exceeded its budget, else 0. */
export function checkRateLimit(req: IncomingMessage, bucket: RateBucket): number {
  const limits = getRateLimits()
  const ip = getClientIp(req)
  if (bucket === 'write') return rateLimiter.hit(`w:${ip}`, limits.writesPerMinute, 60_000)
  return rateLimiter.hit(`r:${ip}`, limits.readsPerMinute, 60_000)
}

const authFailures = new Map<string, Window>()

function peekAuthFailures(ip: string, now = Date.now()): number {
  const window = authFailures.get(ip)
  if (!window || window.resetAt <= now) return 0
  return window.count
}

function recordAuthFailure(ip: string, now = Date.now()): void {
  const window = authFailures.get(ip)
  if (!window || window.resetAt <= now) {
    if (authFailures.size > 50_000) authFailures.clear()
    authFailures.set(ip, { count: 1, resetAt: now + 15 * 60_000 })
  } else {
    window.count += 1
  }
}

export function sweepAuthFailures(now = Date.now()): void {
  for (const [ip, window] of authFailures) if (window.resetAt <= now) authFailures.delete(ip)
}

// ---------------------------------------------------------------------------
// Optional HTTP Basic auth
// ---------------------------------------------------------------------------

function digest(value: string): Buffer {
  return crypto.createHash('sha256').update(value, 'utf8').digest()
}

/** Constant-time comparison (hashing first makes lengths equal). */
export function safeEqual(a: string, b: string): boolean {
  return crypto.timingSafeEqual(digest(a), digest(b))
}

export type AuthResult = 'disabled' | 'ok' | 'challenge' | 'locked'

/** Verifies Basic auth when BASIC_AUTH_USER/BASIC_AUTH_PASSWORD are configured. */
export function checkBasicAuth(req: IncomingMessage): AuthResult {
  const config = getBasicAuthConfig()
  if (!config) return 'disabled'
  const ip = getClientIp(req)
  if (peekAuthFailures(ip) >= getRateLimits().authFailuresPer15Min) return 'locked'

  const header = req.headers.authorization ?? ''
  const match = header.match(/^Basic\s+([A-Za-z0-9+/=]+)\s*$/i)
  if (match) {
    const decoded = Buffer.from(match[1], 'base64').toString('utf8')
    const separator = decoded.indexOf(':')
    if (separator !== -1) {
      const userOk = safeEqual(decoded.slice(0, separator), config.username)
      const passOk = safeEqual(decoded.slice(separator + 1), config.password)
      if (userOk && passOk) return 'ok'
    }
    recordAuthFailure(ip)
  }
  return 'challenge'
}

export function sendAuthChallenge(res: ServerResponse, locked: boolean): void {
  res.statusCode = locked ? 429 : 401
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  if (locked) res.setHeader('Retry-After', '900')
  else res.setHeader('WWW-Authenticate', 'Basic realm="PostScope", charset="UTF-8"')
  res.end(locked ? 'Too many failed sign-in attempts. Try again later.' : 'Authentication required.')
}

// ---------------------------------------------------------------------------
// Cross-site request protection for mutating APIs
// ---------------------------------------------------------------------------

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/**
 * Rejects cross-site browser requests (CSRF). Browsers always send Sec-Fetch-Site and/or Origin on
 * POST/DELETE; non-browser clients (curl, CI) send neither and are allowed (protect them with Basic auth).
 */
export function isSameOriginRequest(req: IncomingMessage): boolean {
  const site = headerValue(req.headers['sec-fetch-site'])
  if (site) return site === 'same-origin' || site === 'none'

  const origin = headerValue(req.headers.origin)
  if (!origin) return true
  if (origin === 'null') return false

  let originUrl: URL
  try {
    originUrl = new URL(origin)
  } catch {
    return false
  }
  const normalized = `${originUrl.protocol}//${originUrl.host}`.toLowerCase()
  if (getAllowedOrigins().includes(normalized)) return true

  const hosts = [headerValue(req.headers.host)]
  if (isTrustProxyEnabled()) hosts.push(headerValue(req.headers['x-forwarded-host'])?.split(',')[0]?.trim())
  return hosts.some((host) => !!host && host.toLowerCase() === originUrl.host.toLowerCase())
}

export function newRequestId(): string {
  return crypto.randomUUID()
}
