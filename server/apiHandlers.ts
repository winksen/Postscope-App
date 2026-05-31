import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  deleteCollection,
  getCollection,
  listCollections,
  saveCollection,
} from './libraryStore'
import { getLoggingMode, isLibraryVisible, isUploadAllowed } from './loggingConfig'

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export async function handleConfigApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (url.pathname !== '/api/config' || req.method !== 'GET') return false
  sendJson(res, 200, { loggingMode: getLoggingMode() })
  return true
}

export async function handleLibraryApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (!url.pathname.startsWith('/api/collections')) return false

  const idMatch = url.pathname.match(/^\/api\/collections\/([^/]+)$/)
  const id = idMatch?.[1] ? decodeURIComponent(idMatch[1]) : null

  try {
    if (req.method === 'GET' && !id) {
      if (!isLibraryVisible()) {
        sendJson(res, 200, { collections: [] })
        return true
      }
      sendJson(res, 200, { collections: await listCollections() })
      return true
    }

    if (req.method === 'GET' && id) {
      if (!isLibraryVisible()) {
        sendJson(res, 404, { error: 'Collection not found' })
        return true
      }
      const collection = await getCollection(id)
      if (!collection) {
        sendJson(res, 404, { error: 'Collection not found' })
        return true
      }
      sendJson(res, 200, collection)
      return true
    }

    if (req.method === 'POST' && !id) {
      if (!isUploadAllowed()) {
        sendJson(res, 403, { error: 'Collection storage is disabled in public mode.' })
        return true
      }

      const body = JSON.parse(await readBody(req)) as {
        rawJson?: string
        name?: string
        requestCount?: number
      }

      if (!body.rawJson || !body.name || typeof body.requestCount !== 'number') {
        sendJson(res, 400, { error: 'rawJson, name, and requestCount are required' })
        return true
      }

      sendJson(res, 201, await saveCollection(body.rawJson, body.name, body.requestCount))
      return true
    }

    if (req.method === 'DELETE' && id) {
      if (!isUploadAllowed()) {
        sendJson(res, 403, { error: 'Collection removal is disabled in public mode.' })
        return true
      }
      const removed = await deleteCollection(id)
      sendJson(res, removed ? 200 : 404, { ok: removed })
      return true
    }

    sendJson(res, 405, { error: 'Method not allowed' })
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error'
    sendJson(res, 500, { error: message })
    return true
  }
}
