import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

let cachedVersion: string | null = null

/** Version from the package.json that ships next to this module, independent of the working directory. */
export function readPackageVersion(): string | null {
  try {
    const packageJsonPath = fileURLToPath(new URL('../package.json', import.meta.url))
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { version?: string }
    return packageJson.version ?? null
  } catch {
    return null
  }
}

export function getAppVersion(): string {
  if (process.env.APP_VERSION) return process.env.APP_VERSION
  if (cachedVersion) return cachedVersion
  cachedVersion = readPackageVersion() ?? 'unknown'
  return cachedVersion
}
