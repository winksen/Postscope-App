import { ensureAppEnv } from './loadEnv'

export type LoggingMode = 'on' | 'hybrid' | 'off'

export { parseLoggingMode } from './parseLoggingMode'
import { parseLoggingMode } from './parseLoggingMode'

/** Single deployment setting — read from LOGGING_MODE in .env */
export function getLoggingMode(): LoggingMode {
  ensureAppEnv()
  return parseLoggingMode(process.env.LOGGING_MODE)
}

export function isUploadAllowed(): boolean {
  return getLoggingMode() !== 'off'
}

export function isLibraryVisible(): boolean {
  return getLoggingMode() !== 'off'
}
