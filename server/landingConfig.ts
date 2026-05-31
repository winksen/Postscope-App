import { ensureAppEnv } from './loadEnv'

function parseBooleanEnv(value: string | undefined): boolean {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on'
}

/** When true, `/` shows the public landing page and the analyzer lives at `/analyze`. */
export function isPublicLandingEnabled(): boolean {
  ensureAppEnv()
  return parseBooleanEnv(process.env.PUBLIC_LANDING_PAGE)
}
