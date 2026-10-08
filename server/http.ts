import type { IncomingMessage, ServerResponse } from 'node:http'

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly headers: Record<string, string> = {}
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (res.headersSent || res.writableEnded || res.destroyed) return
  const payload = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Length', Buffer.byteLength(payload))
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value)
  res.end(payload)
}

function isJsonContentType(req: IncomingMessage): boolean {
  const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
  return type === 'application/json' || type.endsWith('+json')
}

/**
 * Reads a JSON request body with a hard byte limit. Requiring `application/json` also blocks
 * "simple" cross-site form/text POSTs, which browsers can send without a CORS preflight.
 * Oversized uploads answer 413 with `Connection: close` so a half-sent body never poisons a reused keep-alive socket.
 */
export async function readJsonBody<T = unknown>(req: IncomingMessage, maxBytes: number): Promise<T> {
  if (!isJsonContentType(req)) {
    throw new HttpError(415, 'Content-Type must be application/json.')
  }

  const declared = Number(req.headers['content-length'])
  if (Number.isFinite(declared) && declared > maxBytes) {
    req.resume()
    throw new HttpError(413, 'Request body is too large.', { Connection: 'close' })
  }

  const chunks: Buffer[] = []
  let received = 0
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer)
    received += buffer.length
    if (received > maxBytes) {
      req.resume()
      throw new HttpError(413, 'Request body is too large.', { Connection: 'close' })
    }
    chunks.push(buffer)
  }

  const text = Buffer.concat(chunks).toString('utf8')
  if (!text.trim()) throw new HttpError(400, 'Request body is empty.')
  try {
    return JSON.parse(text) as T
  } catch {
    throw new HttpError(400, 'Request body is not valid JSON.')
  }
}

/** Parses the request target without letting `//host/...` style paths change the authority. */
export function parseRequestUrl(req: IncomingMessage): URL | null {
  const target = req.url ?? '/'
  if (!target.startsWith('/')) return null
  try {
    return new URL(`http://localhost${target}`)
  } catch {
    return null
  }
}
