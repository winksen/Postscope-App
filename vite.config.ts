import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { appStoragePlugin } from './server/vite-plugin'
import { ensureAppEnv } from './server/loadEnv'

ensureAppEnv()

export default defineConfig({
  plugins: [react(), appStoragePlugin()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // React is a long-lived vendor chunk: app releases no longer invalidate the browser cache for it. Everything
        // else is split by the dynamic imports in the app (analyzer, samples, one chunk per page), so Recharts and
        // framer-motion are only downloaded by the pages that use them.
        manualChunks(id: string) {
          if (/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(id)) return 'react'
          return undefined
        },
      },
    },
  },
})
