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
        // Long-lived vendor chunks: app releases no longer invalidate the browser cache for libraries.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          motion: ['framer-motion'],
        },
      },
    },
  },
})
