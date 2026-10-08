import type { PostmanAuth } from '../types/postman'

export interface AuthEntry {
  key: string
  value: string
}

/**
 * Fields that hold credentials for each Postman auth helper type.
 * Basic auth is handled separately (username/password) by BASIC_AUTH_PLAINTEXT.
 */
export const AUTH_SECRET_FIELDS: Record<string, string[]> = {
  bearer: ['token'],
  apikey: ['value'],
  oauth1: ['consumerSecret', 'tokenSecret', 'token'],
  oauth2: ['accessToken', 'access_token', 'clientSecret', 'client_secret', 'password', 'refreshToken', 'refresh_token'],
  aws: ['secretKey', 'sessionToken'],
  digest: ['password'],
  ntlm: ['password'],
  hawk: ['authKey'],
  akamai: ['clientSecret', 'accessToken', 'clientToken'],
  edgegrid: ['clientSecret', 'accessToken', 'clientToken'],
  jwt: ['secret', 'privateKey'],
  asap: ['privateKey'],
}

/** Suggested variable name for each credential field when it is moved out of the collection. */
export const AUTH_FIELD_VARIABLES: Record<string, string> = {
  token: 'token',
  value: 'apiKey',
  consumerSecret: 'oauthConsumerSecret',
  tokenSecret: 'oauthTokenSecret',
  accessToken: 'accessToken',
  access_token: 'accessToken',
  clientSecret: 'clientSecret',
  client_secret: 'clientSecret',
  password: 'password',
  refreshToken: 'refreshToken',
  refresh_token: 'refreshToken',
  secretKey: 'awsSecretKey',
  sessionToken: 'awsSessionToken',
  authKey: 'hawkAuthKey',
  clientToken: 'clientToken',
  secret: 'jwtSecret',
  privateKey: 'privateKey',
}

export function normalizeAuthType(type: unknown): string {
  if (typeof type !== 'string' || !type.trim()) return 'noauth'
  const t = type.trim().toLowerCase()
  if (t === 'bearertoken' || t === 'bearer') return 'bearer'
  if (t === 'basic' || t === 'basicauth') return 'basic'
  if (t === 'apikey') return 'apikey'
  return t
}

/** True when an auth object defers to its parent (absent, or Postman's explicit `inherit`). */
export function isInheritedAuth(auth: unknown): boolean {
  if (!auth || typeof auth !== 'object') return true
  const type = (auth as PostmanAuth).type
  return typeof type !== 'string' || !type.trim() || type.trim().toLowerCase() === 'inherit'
}

/**
 * Reads the entries of an auth helper. Supports v2.1 (`[{ key, value }]`) and v2.0 (`{ key: value }`) shapes.
 */
export function getAuthEntries(auth: PostmanAuth | undefined | null, rawType?: string): AuthEntry[] {
  if (!auth || typeof auth !== 'object') return []
  const type = rawType ?? (typeof auth.type === 'string' ? auth.type : '')
  if (!type) return []
  const block = (auth as Record<string, unknown>)[type] ?? (auth as Record<string, unknown>)[type.toLowerCase()]
  if (Array.isArray(block)) {
    return block
      .filter((entry): entry is { key: unknown; value: unknown } => !!entry && typeof entry === 'object')
      .map((entry) => ({ key: String(entry.key ?? ''), value: stringifyAuthValue(entry.value) }))
      .filter((entry) => entry.key)
  }
  if (block && typeof block === 'object') {
    return Object.entries(block as Record<string, unknown>).map(([key, value]) => ({ key, value: stringifyAuthValue(value) }))
  }
  return []
}

function stringifyAuthValue(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

export function secretFieldsFor(type: string): string[] {
  return AUTH_SECRET_FIELDS[normalizeAuthType(type)] ?? []
}
