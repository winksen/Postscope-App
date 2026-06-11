import fs from 'node:fs'
import path from 'node:path'

let cachedVersion: string | null = null

export function getAppVersion(): string {
  if (process.env.APP_VERSION) return process.env.APP_VERSION
  if (cachedVersion) return cachedVersion

  try {
    const packageJsonPath = path.join(process.cwd(), 'package.json')
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { version?: string }
    cachedVersion = packageJson.version ?? 'unknown'
  } catch {
    cachedVersion = 'unknown'
  }

  return cachedVersion
}
