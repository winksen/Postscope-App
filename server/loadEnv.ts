import fs from 'node:fs'
import path from 'node:path'
import { loadEnv } from 'vite'

let loaded = false

/** Load `.env` into `process.env` for the Node server (incl. non-VITE_ keys). */
export function ensureAppEnv(): void {
  if (loaded) return
  loaded = true

  const root = process.cwd()
  const mode = process.env.NODE_ENV === 'production' ? 'production' : 'development'
  const fromVite = loadEnv(mode, root, '')

  for (const [key, value] of Object.entries(fromVite)) {
    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }

  if (process.env.LOGGING_MODE !== undefined) return

  const envPath = path.join(root, '.env')
  if (!fs.existsSync(envPath)) return

  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (key === 'LOGGING_MODE') {
      process.env.LOGGING_MODE = value
      return
    }
  }
}
