import fs from 'node:fs'
import path from 'node:path'

let loaded = false

/** Parses the text of a `.env` file: `KEY=value`, optional `export`, quotes, `#` comments. No variable expansion. */
export function parseEnvFile(text: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/)
    if (!match) continue
    let value = match[2].trim()
    const quote = value[0]
    if ((quote === '"' || quote === "'" || quote === '`') && value.lastIndexOf(quote) > 0) {
      value = value.slice(1, value.lastIndexOf(quote))
      if (quote === '"') value = value.replace(/\\n/g, '\n')
    } else {
      value = value.replace(/\s+#.*$/, '')
    }
    values[match[1]] = value
  }
  return values
}

/**
 * Reads `.env`, `.env.local`, `.env.<mode>` and `.env.<mode>.local` from `root` (later files win, like Vite does),
 * without depending on Vite so the compiled server runs with no node_modules.
 */
export function readEnvFiles(root: string, mode: string): Record<string, string> {
  const merged: Record<string, string> = {}
  for (const name of ['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`]) {
    try {
      Object.assign(merged, parseEnvFile(fs.readFileSync(path.join(root, name), 'utf8')))
    } catch {
      /* missing or unreadable file */
    }
  }
  return merged
}

/** Load `.env` into `process.env` for the Node server (incl. non-VITE_ keys). */
export function ensureAppEnv(): void {
  if (loaded) return
  loaded = true

  const root = process.cwd()
  const mode = process.env.NODE_ENV === 'production' ? 'production' : 'development'
  const fromFiles = readEnvFiles(root, mode)

  for (const [key, value] of Object.entries(fromFiles)) {
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
