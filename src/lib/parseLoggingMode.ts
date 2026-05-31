export type LoggingMode = 'on' | 'hybrid' | 'off'

/** Default to `off` only when the env variable is absent (undefined / null). */
export function parseLoggingMode(value: string | undefined | null): LoggingMode {
  if (value === undefined || value === null) return 'off'

  const normalized = value.trim().toLowerCase()
  if (normalized === 'on') return 'on'
  if (normalized === 'hybrid') return 'hybrid'
  if (normalized === 'off' || normalized === 'public') return 'off'
  return 'off'
}
