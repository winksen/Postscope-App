import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { handleConfigApi, handleLibraryApi } from './apiHandlers'
import { ensureAppEnv } from './loadEnv'

ensureAppEnv()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST_DIR = path.join(__dirname, '..', 'dist')
const PORT = Number(process.env.PORT ?? 3010)

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): void {
  const pathname = req.url?.split('?')[0] ?? '/'
  const filePath = path.join(DIST_DIR, pathname === '/' ? 'index.html' : pathname)

  fs.readFile(filePath, (err, data) => {
    if (err) {
      fs.readFile(path.join(DIST_DIR, 'index.html'), (fallbackErr, fallback) => {
        if (fallbackErr) {
          res.statusCode = 404
          res.end('Not found')
          return
        }
        res.setHeader('Content-Type', 'text/html')
        res.end(fallback)
      })
      return
    }

    const ext = path.extname(filePath)
    res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream')
    res.end(data)
  })
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
  void handleConfigApi(req, res, url).then((handled) => {
    if (handled) return
    void handleLibraryApi(req, res, url).then((libraryHandled) => {
      if (!libraryHandled) serveStatic(req, res)
    })
  })
})

server.listen(PORT, () => {
  console.log(`PostScope running at http://localhost:${PORT}`)
})
