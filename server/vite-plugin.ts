import type { Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createRequestHandler } from './requestPipeline'
import { ensureAppEnv } from './loadEnv'

const handle = createRequestHandler({ mode: 'dev' })

function handleRequest(req: IncomingMessage, res: ServerResponse, next: () => void): void {
  ensureAppEnv()
  void handle(req, res, next)
}

export function appStoragePlugin(): Plugin {
  return {
    name: 'postscope-app-storage',
    configureServer(server) {
      server.middlewares.use(handleRequest)
    },
    configurePreviewServer(server) {
      server.middlewares.use(handleRequest)
    },
  }
}
