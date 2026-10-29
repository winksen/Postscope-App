import { ensureAppEnv } from './loadEnv'
import { getLoggingMode } from './loggingConfig'
import { getBasicAuthConfig, isUnauthenticatedTeamStorageAllowed } from './runtimeConfig'

export interface StartupIssue {
  /** Stable identifier used by documentation and tests. */
  code: 'BASIC_AUTH_PARTIAL' | 'TEAM_STORAGE_UNAUTHENTICATED' | 'PORT_INVALID'
  message: string
}

export interface StartupReport {
  errors: StartupIssue[]
  warnings: string[]
}

function rawBasicAuth(): { user: string; password: string } {
  ensureAppEnv()
  return { user: (process.env.BASIC_AUTH_USER ?? '').trim(), password: (process.env.BASIC_AUTH_PASSWORD ?? '').trim() }
}

/**
 * Checks the effective runtime settings before the server listens. Anything that would leave stored collections
 * reachable without authentication, or silently disable a configured control, is an error rather than a warning.
 * Static mode (`LOGGING_MODE=off`) stores nothing on the server and needs no credentials.
 */
export function validateRuntimeSettings(): StartupReport {
  const errors: StartupIssue[] = []
  const warnings: string[] = []

  const { user, password } = rawBasicAuth()
  if ((user && !password) || (!user && password)) {
    errors.push({
      code: 'BASIC_AUTH_PARTIAL',
      message: `${user ? 'BASIC_AUTH_PASSWORD' : 'BASIC_AUTH_USER'} is missing. Set both BASIC_AUTH_USER and BASIC_AUTH_PASSWORD, or neither.`,
    })
  }

  const rawPort = process.env.PORT
  if (rawPort !== undefined && rawPort.trim() !== '') {
    const port = Number(rawPort)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      errors.push({ code: 'PORT_INVALID', message: `Invalid PORT "${rawPort}". Use a number between 1 and 65535.` })
    }
  }

  const mode = getLoggingMode()
  if (mode !== 'off') {
    if (!getBasicAuthConfig() && !(user && password)) {
      if (isUnauthenticatedTeamStorageAllowed()) {
        warnings.push(
          `LOGGING_MODE=${mode} stores collections on the server without authentication because ALLOW_UNAUTHENTICATED_TEAM_STORAGE=true. Keep the network isolated.`
        )
      } else {
        errors.push({
          code: 'TEAM_STORAGE_UNAUTHENTICATED',
          message: `LOGGING_MODE=${mode} stores collections on the server but no authentication is configured. Set BASIC_AUTH_USER and BASIC_AUTH_PASSWORD, use LOGGING_MODE=off, or set ALLOW_UNAUTHENTICATED_TEAM_STORAGE=true on an isolated network.`,
        })
      }
    }
  }
  return { errors, warnings }
}
