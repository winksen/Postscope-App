import crypto from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import net from 'node:net'
import { log } from './logger'
import {
  getAllowedOrigins,
  getBasicAuthConfig,
  getRateLimits,
  getTrustedUserHeader,
  getTrustProxyHops,
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

/** Canonical form of a client address: no port, no brackets, IPv4-mapped IPv6 as plain IPv4. Null when invalid. */
export function normalizeIp(value: string | undefined): string | null {
  if (!value) return null
  let candidate = value.trim()
  const bracketed = candidate.match(/^\[([^\]]+)\](?::\d+)?$/)
  if (bracketed) candidate = bracketed[1]
  else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(candidate)) candidate = candidate.slice(0, candidate.lastIndexOf(':'))
  const mapped = candidate.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i)
  if (mapped) candidate = mapped[1]
  return net.isIP(candidate) ? candidate.toLowerCase() : null
}

/**
 * The client address used for rate limits and lockouts. Without TRUST_PROXY it is the socket address.
 * With TRUST_PROXY=true only the trusted proxy hops are believed: every proxy appends the address it saw
 * to X-Forwarded-For, so the real client is the entry `TRUST_PROXY_HOPS` positions from the right. Entries to
 * the left of it are client-controlled and are ignored, so rotating the header cannot dodge a limit.
 */
export function getClientIp(req: IncomingMessage): string {
  const socketIp = normalizeIp(req.socket.remoteAddress) ?? req.socket.remoteAddress ?? 'unknown'
  if (!isTrustProxyEnabled()) return socketIp
  const header = req.headers['x-forwarded-for']
  const entries = (Array.isArray(header) ? header.join(',') : (header ?? ''))
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  const trusted = entries[entries.length - getTrustProxyHops()]
  return normalizeIp(trusted) ?? socketIp
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

/**
 * The signed-in user as reported by a trusted reverse proxy (TRUSTED_USER_HEADER, for example oauth2-proxy's
 * `X-Forwarded-User`). It is only believed when TRUST_PROXY=true, because otherwise any client could send it.
 * Control characters are stripped and the value is capped, so it is safe to store and to write to logs.
 */
export function getProxyUser(req: IncomingMessage): string | null {
  if (!isTrustProxyEnabled()) return null
  const header = getTrustedUserHeader()
  if (!header) return null
  const raw = req.headers[header]
  const value = (Array.isArray(raw) ? raw[0] : raw) ?? ''
  const cleaned = [...value]
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0
      return (
        code > 0x1f &&
        !(code >= 0x7f && code <= 0x9f) &&
        !(code >= 0x200b && code <= 0x200f) &&
        !(code >= 0x202a && code <= 0x202e) &&
        !(code >= 0x2066 && code <= 0x2069)
      )
    })
    .join('')
    .trim()
    .slice(0, 200)
  return cleaned || null
}

const AUTH_WINDOW_MS = 15 * 60_000
/** A flood of failures from many addresses (distributed guessing) triggers a short global back-off. */
const GLOBAL_FAILURE_FACTOR = 10
const GLOBAL_BACKOFF_MS = 60_000

/**
 * Failed Basic auth attempts per client address. Memory is bounded, and flooding it with spoofed or
 * distributed addresses can never evict an address that is currently locked out.
 */
export class AuthFailureTracker {
  private windows = new Map<string, Window>()
  private globalWindow: Window = { count: 0, resetAt: 0 }
  private backoffUntil = 0

  constructor(private readonly maxEntries = 50_000) {}

  /** Failures recorded for an address in its current window. */
  peek(ip: string, now = Date.now()): number {
    const window = this.windows.get(ip)
    return !window || window.resetAt <= now ? 0 : window.count
  }

  /** True while the global back-off is active. */
  inBackoff(now = Date.now()): boolean {
    return this.backoffUntil > now
  }

  record(ip: string, limit: number, now = Date.now()): void {
    this.recordGlobal(limit, now)
    const window = this.windows.get(ip)
    if (window && window.resetAt > now) {
      window.count += 1
      return
    }
    if (this.windows.size >= this.maxEntries) {
      this.sweep(now)
      if (this.windows.size >= this.maxEntries) this.evictUnlocked(limit, now)
    }
    // Everything left is locked: keep the lockouts and rely on the global ceiling for the newcomer.
    if (this.windows.size < this.maxEntries) this.windows.set(ip, { count: 1, resetAt: now + AUTH_WINDOW_MS })
  }

  private recordGlobal(limit: number, now: number): void {
    if (this.globalWindow.resetAt <= now) this.globalWindow = { count: 0, resetAt: now + AUTH_WINDOW_MS }
    this.globalWindow.count += 1
    if (this.globalWindow.count > limit * GLOBAL_FAILURE_FACTOR && !this.inBackoff(now)) {
      this.backoffUntil = now + GLOBAL_BACKOFF_MS
      this.globalWindow = { count: 0, resetAt: now + AUTH_WINDOW_MS }
      log.warn('Many failed sign-in attempts from different addresses; refusing credentials for one minute.', {
        failuresInWindow: limit * GLOBAL_FAILURE_FACTOR,
        trustProxy: isTrustProxyEnabled(),
      })
    }
  }

  /** Drops expired windows and an expired back-off. */
  sweep(now = Date.now()): void {
    for (const [ip, window] of this.windows) if (window.resetAt <= now) this.windows.delete(ip)
    if (this.globalWindow.resetAt <= now) this.globalWindow = { count: 0, resetAt: 0 }
    if (this.backoffUntil <= now) this.backoffUntil = 0
  }

  /** Removes the oldest entries that are not locked out until a tenth of the capacity is free again. */
  private evictUnlocked(limit: number, now: number): void {
    const target = Math.floor(this.maxEntries * 0.9)
    for (const [ip, window] of this.windows) {
      if (this.windows.size <= target) break
      if (window.count < limit || window.resetAt <= now) this.windows.delete(ip)
    }
  }

  get size(): number {
    return this.windows.size
  }
}

export const authFailures = new AuthFailureTracker()

export function sweepAuthFailures(now = Date.now()): void {
  authFailures.sweep(now)
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

export type AuthResult = 'disabled' | 'ok' | 'challenge' | 'locked' | 'backoff'

/** Verifies Basic auth when BASIC_AUTH_USER/BASIC_AUTH_PASSWORD are configured. */
export function checkBasicAuth(req: IncomingMessage): AuthResult {
  const config = getBasicAuthConfig()
  if (!config) return 'disabled'
  const ip = getClientIp(req)
  const limit = getRateLimits().authFailuresPer15Min
  if (authFailures.peek(ip) >= limit) return 'locked'

  const header = req.headers.authorization ?? ''
  // During a global back-off no credentials are evaluated; plain requests still get the normal challenge.
  if (header && authFailures.inBackoff()) return 'backoff'
  const match = header.match(/^Basic\s+([A-Za-z0-9+/=]+)\s*$/i)
  if (match) {
    const decoded = Buffer.from(match[1], 'base64').toString('utf8')
    const separator = decoded.indexOf(':')
    if (separator !== -1) {
      const userOk = safeEqual(decoded.slice(0, separator), config.username)
      const passOk = safeEqual(decoded.slice(separator + 1), config.password)
      if (userOk && passOk) return 'ok'
    }
    authFailures.record(ip, limit)
  }
  return 'challenge'
}

export function sendAuthChallenge(res: ServerResponse, locked: boolean, retryAfterSeconds = 900): void {
  res.statusCode = locked ? 429 : 401
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  if (locked) res.setHeader('Retry-After', String(retryAfterSeconds))
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
