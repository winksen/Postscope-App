import type { Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleConfigApi, handleLibraryApi } from './apiHandlers'
import { ensureAppEnv } from './loadEnv'

function handleRequest(req: IncomingMessage, res: ServerResponse, next: () => void): void {
  ensureAppEnv()
  const url = new URL(req.url ?? '/', 'http://localhost')
  void handleConfigApi(req, res, url).then((handled) => {
    if (handled) return
    void handleLibraryApi(req, res, url).then((libraryHandled) => {
      if (!libraryHandled) next()
    })
  })
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
