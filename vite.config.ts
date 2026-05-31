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
})
