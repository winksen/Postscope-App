type Level = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }

function threshold(): number {
  const configured = (process.env.LOG_LEVEL ?? 'info').trim().toLowerCase() as Level
  return LEVELS[configured] ?? LEVELS.info
}

function useJson(): boolean {
  return (process.env.LOG_FORMAT ?? '').trim().toLowerCase() === 'json'
}

/** Never log request bodies or headers: collections and credentials must not leak into logs. */
function write(level: Level, message: string, fields?: Record<string, unknown>): void {
  if (LEVELS[level] < threshold()) return
  const time = new Date().toISOString()
  const line = useJson()
    ? JSON.stringify({ time, level, message, ...fields })
    : `${time} ${level.toUpperCase().padEnd(5)} ${message}${
        fields && Object.keys(fields).length
          ? ` ${Object.entries(fields)
              .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
              .join(' ')}`
          : ''
      }`
  if (level === 'error' || level === 'warn') console.error(line)
  else console.log(line)
}

export const log = {
  debug: (message: string, fields?: Record<string, unknown>) => write('debug', message, fields),
  info: (message: string, fields?: Record<string, unknown>) => write('info', message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => write('warn', message, fields),
  error: (message: string, fields?: Record<string, unknown>) => write('error', message, fields),
}

export function errorFields(error: unknown): Record<string, unknown> {
  if (error instanceof Error) return { error: error.message, ...(process.env.LOG_LEVEL === 'debug' ? { stack: error.stack } : {}) }
  return { error: String(error) }
}
