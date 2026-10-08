import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import type { IncomingMessage, ServerResponse } from 'node:http'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
}

const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.map', '.svg', '.txt', '.webmanifest', '.ttf', '.otf'])
const MAX_COMPRESS_BYTES = 8_000_000
const gzipCache = new Map<string, { mtimeMs: number; size: number; data: Buffer }>()

/**
 * Maps a URL pathname to a file inside `rootDir`, or null when the path is invalid or escapes the root
 * (`/../.env`, encoded `%2e%2e%2f`, null bytes, backslashes) or targets a dotfile.
 */
export function resolveStaticPath(rootDir: string, pathname: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null
  const segments = decoded.split('/').filter(Boolean)
  if (segments.some((segment) => segment === '..' || segment.startsWith('.'))) return null

  const root = path.resolve(rootDir)
  const resolved = path.resolve(root, ...segments)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null
  return resolved
}

function cacheControl(relativePath: string): string {
  if (relativePath.startsWith(`assets${path.sep}`) || relativePath.startsWith('assets/')) {
    return 'public, max-age=31536000, immutable'
  }
  if (relativePath.endsWith('.html')) return 'no-cache'
  return 'public, max-age=3600'
}

function acceptsGzip(req: IncomingMessage): boolean {
  return /\bgzip\b/i.test(String(req.headers['accept-encoding'] ?? ''))
}

function gzipFor(filePath: string, stat: fs.Stats): Buffer | null {
  if (stat.size > MAX_COMPRESS_BYTES || stat.size < 1024) return null
  const cached = gzipCache.get(filePath)
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.data
  const data = zlib.gzipSync(fs.readFileSync(filePath), { level: 9 })
  gzipCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, data })
  return data
}

function sendFile(req: IncomingMessage, res: ServerResponse, filePath: string, stat: fs.Stats, rootDir: string): void {
  const ext = path.extname(filePath).toLowerCase()
  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`
  res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream')
  res.setHeader('Cache-Control', cacheControl(path.relative(rootDir, filePath)))
  res.setHeader('ETag', etag)
  res.setHeader('Last-Modified', stat.mtime.toUTCString())
  if (COMPRESSIBLE.has(ext)) res.setHeader('Vary', 'Accept-Encoding')

  if (req.headers['if-none-match'] === etag) {
    res.statusCode = 304
    res.end()
    return
  }

  const compressed = COMPRESSIBLE.has(ext) && acceptsGzip(req) ? gzipFor(filePath, stat) : null
  if (compressed) {
    res.setHeader('Content-Encoding', 'gzip')
    res.setHeader('Content-Length', compressed.length)
    res.end(req.method === 'HEAD' ? undefined : compressed)
    return
  }

  res.setHeader('Content-Length', stat.size)
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  const stream = fs.createReadStream(filePath)
  stream.on('error', () => res.destroy())
  stream.pipe(res)
}

function statFile(filePath: string): fs.Stats | null {
  try {
    const stat = fs.statSync(filePath)
    return stat.isFile() ? stat : null
  } catch {
    return null
  }
}

function sendText(res: ServerResponse, status: number, message: string): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(message)
}

/**
 * Serves the built SPA from `rootDir`. Unknown extension-less routes fall back to index.html so
 * client-side routes (`/analyze`, `/samples`) work; missing assets return 404 instead of HTML.
 */
export function serveStatic(req: IncomingMessage, res: ServerResponse, rootDir: string, pathname: string): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD')
    sendText(res, 405, 'Method not allowed')
    return
  }

  const resolved = resolveStaticPath(rootDir, pathname === '/' ? '/index.html' : pathname)
  if (!resolved) {
    sendText(res, 404, 'Not found')
    return
  }

  const stat = statFile(resolved)
  if (stat) {
    sendFile(req, res, resolved, stat, rootDir)
    return
  }

  const ext = path.extname(resolved)
  if (ext && ext !== '.html') {
    sendText(res, 404, 'Not found')
    return
  }

  const indexPath = path.join(rootDir, 'index.html')
  const indexStat = statFile(indexPath)
  if (!indexStat) {
    sendText(res, 404, 'Not found. Run `npm run build` first.')
    return
  }
  sendFile(req, res, indexPath, indexStat, rootDir)
}
