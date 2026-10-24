import type { ParsedCollection, ParsedRequest } from '../parser'

/** Tokens longer than this are not decoded: real identity tokens are a few KB, anything bigger is not worth reading. */
export const MAX_JWT_LENGTH = 16 * 1024
const MAX_OCCURRENCES = 200
const MAX_PER_VALUE = 5

const JWT_PATTERN = /eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g

/** Claims that identify or describe a person. */
export const PERSONAL_CLAIMS = [
  'email',
  'phone_number',
  'phone',
  'name',
  'given_name',
  'family_name',
  'middle_name',
  'nickname',
  'preferred_username',
  'birthdate',
  'address',
  'gender',
  'upn',
  'unique_name',
  'employeeid',
  'employee_id',
] as const

/** Claims that describe what the holder may do. `scp` and `scope` are shown in the inspector but do not raise a finding. */
export const PRIVILEGE_CLAIMS = [
  'roles',
  'role',
  'groups',
  'wids',
  'entitlements',
  'permissions',
  'realm_access',
  'resource_access',
  'is_admin',
  'admin',
] as const

const SCOPE_CLAIMS = ['scp', 'scope']
const TIME_CLAIMS = ['exp', 'iat', 'nbf', 'auth_time']
const ID_CLAIMS = ['sub', 'jti', 'tid', 'oid', 'azp', 'client_id', 'cid', 'uid', 'sid', 'appid']
const ACCESS_TOKEN_LIFETIME_LIMIT_SECONDS = 24 * 60 * 60

export interface MaskedClaim {
  name: string
  /** Masked display value. Never the raw value of a personal or identifying claim. */
  preview: string
  kind: 'personal' | 'privilege' | 'scope' | 'time' | 'id' | 'other'
}

export interface JwtInspection {
  alg: string
  typ?: string
  kid?: string
  /** Host of the issuer URL, or a masked issuer when it is not a URL. */
  issuer?: string
  hasExp: boolean
  /** ISO date of `exp`. */
  expiresAt?: string
  expired: boolean
  /** `exp - iat` in seconds, when both exist. */
  lifetimeSeconds?: number
  /** The token has the shape of an ID token (nonce, at_hash, c_hash, or typ ID). */
  idToken: boolean
  /** The token is a refresh or offline token, which is long-lived by design. */
  refreshToken: boolean
  personalClaims: string[]
  privilegeClaims: string[]
  claims: MaskedClaim[]
}

export interface JwtOccurrence {
  requestId?: string
  location: string
  token: string
  /** The token is sent as `Authorization: Bearer` (header or auth helper). */
  bearer: boolean
}

function base64UrlDecode(part: string): string | null {
  try {
    const padded = part
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(part.length / 4) * 4, '=')
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

function decodePart(part: string): Record<string, unknown> | null {
  const text = base64UrlDecode(part)
  if (!text) return null
  try {
    const value = JSON.parse(text) as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function maskText(value: string): string {
  return value.length <= 1 ? '•' : `${value[0]}•••`
}

function maskEmail(value: string): string {
  const at = value.indexOf('@')
  return at > 0 ? `${value[0]}•••@•••` : maskText(value)
}

function issuerLabel(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined
  try {
    return new URL(value).host
  } catch {
    return maskText(value)
  }
}

function formatTime(seconds: unknown): string | undefined {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return undefined
  const date = new Date(seconds * 1000)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function maskClaim(name: string, value: unknown): MaskedClaim {
  const lower = name.toLowerCase()
  if (Array.isArray(value)) {
    const kind = (PRIVILEGE_CLAIMS as readonly string[]).includes(lower)
      ? 'privilege'
      : (PERSONAL_CLAIMS as readonly string[]).includes(lower)
        ? 'personal'
        : 'other'
    return { name, preview: `[${value.length} value${value.length === 1 ? '' : 's'}]`, kind }
  }
  if (value && typeof value === 'object') {
    const kind = (PRIVILEGE_CLAIMS as readonly string[]).includes(lower) ? 'privilege' : 'personal'
    return { name, preview: `{${Object.keys(value).length} field${Object.keys(value).length === 1 ? '' : 's'}}`, kind }
  }
  if (TIME_CLAIMS.includes(lower)) return { name, preview: formatTime(value) ?? 'invalid time', kind: 'time' }
  if (SCOPE_CLAIMS.includes(lower)) {
    const scopes = typeof value === 'string' ? value.split(/\s+/).filter(Boolean) : []
    return {
      name,
      preview: scopes.length
        ? scopes.slice(0, 12).join(' ') + (scopes.length > 12 ? ` (+${scopes.length - 12})` : '')
        : maskText(String(value ?? '')),
      kind: 'scope',
    }
  }
  if (lower === 'iss') return { name, preview: issuerLabel(value) ?? 'unknown', kind: 'other' }
  if (lower === 'aud') return { name, preview: typeof value === 'string' ? (issuerLabel(value) ?? maskText(value)) : 'set', kind: 'other' }
  if (typeof value === 'boolean') {
    return { name, preview: String(value), kind: (PRIVILEGE_CLAIMS as readonly string[]).includes(lower) ? 'privilege' : 'other' }
  }
  if (typeof value === 'number') return { name, preview: 'number', kind: 'other' }
  const text = typeof value === 'string' ? value : ''
  if (lower === 'email' || lower === 'upn' || (lower === 'preferred_username' && text.includes('@')))
    return { name, preview: maskEmail(text), kind: 'personal' }
  if (lower === 'phone_number' || lower === 'phone')
    return { name, preview: text.length > 2 ? `${'•'.repeat(4)}${text.slice(-2)}` : '••••', kind: 'personal' }
  if ((PERSONAL_CLAIMS as readonly string[]).includes(lower)) return { name, preview: maskText(text), kind: 'personal' }
  if (ID_CLAIMS.includes(lower)) return { name, preview: text.length > 4 ? `${text.slice(0, 4)}•••` : '•••', kind: 'id' }
  if ((PRIVILEGE_CLAIMS as readonly string[]).includes(lower)) return { name, preview: maskText(text), kind: 'privilege' }
  return { name, preview: text.length > 3 ? `${text.slice(0, 1)}•••` : '•••', kind: 'other' }
}

/**
 * Reads the header and payload of a JWT. The signature is never verified and never returned, nothing is fetched,
 * and tokens over 16 KB are not decoded. Returns null when the text is not a JWT.
 */
export function inspectJwt(token: string, now: Date = new Date()): JwtInspection | null {
  if (token.length > MAX_JWT_LENGTH) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const header = decodePart(parts[0])
  const payload = decodePart(parts[1])
  if (!header || !payload || typeof header.alg !== 'string') return null

  const exp = typeof payload.exp === 'number' && Number.isFinite(payload.exp) ? payload.exp : undefined
  const iat = typeof payload.iat === 'number' && Number.isFinite(payload.iat) ? payload.iat : undefined
  const typ = typeof payload.typ === 'string' ? payload.typ : typeof header.typ === 'string' ? header.typ : undefined
  const typLower = (typ ?? '').toLowerCase()
  const claims = Object.entries(payload).map(([name, value]) => maskClaim(name, value))
  const present = (names: readonly string[]) => Object.keys(payload).filter((name) => names.includes(name.toLowerCase()))

  return {
    alg: header.alg,
    typ,
    kid: typeof header.kid === 'string' ? `${header.kid.slice(0, 4)}•••` : undefined,
    issuer: issuerLabel(payload.iss),
    hasExp: exp !== undefined,
    expiresAt: formatTime(exp),
    expired: exp !== undefined && exp * 1000 < now.getTime(),
    lifetimeSeconds: exp !== undefined && iat !== undefined ? exp - iat : undefined,
    idToken: 'nonce' in payload || 'at_hash' in payload || 'c_hash' in payload || typLower === 'id' || typLower === 'id_token',
    refreshToken: typLower === 'refresh' || typLower === 'offline',
    personalClaims: present(PERSONAL_CLAIMS),
    privilegeClaims: present(PRIVILEGE_CLAIMS),
    claims,
  }
}

export function isLongLived(inspection: JwtInspection): boolean {
  if (inspection.idToken || inspection.refreshToken) return false
  return (
    !inspection.hasExp || (inspection.lifetimeSeconds !== undefined && inspection.lifetimeSeconds > ACCESS_TOKEN_LIFETIME_LIMIT_SECONDS)
  )
}

export function describeLifetime(seconds: number): string {
  if (seconds >= 86_400) return `${Math.round(seconds / 86_400)} days`
  if (seconds >= 3_600) return `${Math.round(seconds / 3_600)} hours`
  return `${Math.max(1, Math.round(seconds / 60))} minutes`
}

/** JWT-shaped substrings of a text, in order, without duplicates. */
export function findJwts(text: string | undefined): string[] {
  if (!text || !text.includes('eyJ')) return []
  const found: string[] = []
  for (const match of text.slice(0, 200_000).matchAll(JWT_PATTERN)) {
    if (!found.includes(match[0])) found.push(match[0])
    if (found.length >= MAX_PER_VALUE) break
  }
  return found
}

const DISABLED = ' (disabled)'

/** Tokens held by one request: headers, request-level auth helper, query, form and raw body, and saved examples. */
export function collectRequestJwts(request: ParsedRequest): JwtOccurrence[] {
  const out: JwtOccurrence[] = []
  const add = (location: string, text: string | undefined, bearer: boolean) => {
    for (const token of findJwts(text)) out.push({ requestId: request.id, location, token, bearer })
  }
  const bearerHeader = (key: string, value: string) => key.trim().toLowerCase() === 'authorization' && /^Bearer\s/i.test(value.trim())
  for (const header of request.headers) add(`header ${header.key.trim()}`, header.value, bearerHeader(header.key, header.value))
  for (const header of request.disabledHeaders ?? []) add(`header ${header.key.trim()}${DISABLED}`, header.value, false)
  if (request.authSource === 'request')
    for (const field of request.authFields ?? [])
      add(`auth helper ${request.auth} ${field.key}`, field.value, request.auth === 'bearer' || request.auth === 'oauth2')
  for (const param of request.queryParams ?? []) add(`query ${param.key.trim()}`, param.value, false)
  for (const field of request.bodyFields ?? []) add(`body field ${field.key.trim()}`, field.value, false)
  add('raw body', request.bodyRaw, false)
  for (const response of request.savedResponses ?? []) {
    const label = `saved response "${response.name}"`
    add(`${label} body`, response.body, false)
    for (const header of response.headers) add(`${label} header ${header.key.trim()}`, header.value, false)
    for (const header of response.requestHeaders)
      add(`${label} original request header ${header.key.trim()}`, header.value, bearerHeader(header.key, header.value))
    for (const field of response.requestAuthFields ?? []) add(`${label} original request auth ${field.key}`, field.value, false)
  }
  return out
}

/** Every JWT in the collection: requests, folder and collection auth helpers, and variables. */
export function collectJwts(parsed: ParsedCollection): JwtOccurrence[] {
  const out: JwtOccurrence[] = []
  const seen = new Set<string>()
  const push = (occurrence: JwtOccurrence) => {
    const key = `${occurrence.requestId ?? ''}|${occurrence.location}|${occurrence.token}`
    if (out.length >= MAX_OCCURRENCES || seen.has(key)) return
    seen.add(key)
    out.push(occurrence)
  }
  for (const request of parsed.requests) for (const occurrence of collectRequestJwts(request)) push(occurrence)
  for (const owner of parsed.authOwners ?? [])
    for (const field of owner.fields)
      for (const token of findJwts(field.value))
        push({ location: `auth helper ${owner.type} ${field.key} (${owner.owner})`, token, bearer: false })
  for (const variable of parsed.collectionVariables ?? [])
    if (!variable.disabled)
      for (const token of findJwts(variable.value)) push({ location: `collection variable ${variable.key}`, token, bearer: false })
  for (const variable of parsed.scopedVariables ?? [])
    if (!variable.disabled)
      for (const token of findJwts(variable.value))
        push({ requestId: variable.requestId, location: `${variable.scope} variable ${variable.key}`, token, bearer: false })
  return out
}
