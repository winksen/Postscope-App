import type { ParsedCollection, ParsedRequest } from '../parser'
import { evidencePreview, isLikelySecretValue } from '../secretPatterns'
import { hasVariableReference } from '../variables'
import { classifyEndpoint, endpointContext } from './endpoints'
import { fingerprintPlatforms } from './fingerprints'
import {
  emptyIdentityProfile,
  type ClientAuthMethod,
  type GrantType,
  type GrantUsage,
  type IdentityEndpoint,
  type IdentityProfile,
  type IdentityToken,
  type OAuthClient,
  type PkceState,
  type PlatformId,
  type ScimTarget,
  type ScopeUsage,
  type TokenKind,
} from './types'
import { classifyLifecycle } from './lifecycle'
import { addToScimInventory } from './scim'
import { requestParams, safeDecode, splitUrl, type SplitUrl } from './url'

const MAX_ENDPOINTS = 2000
const MAX_CLIENTS = 500
const MAX_TOKENS = 200
const MAX_REQUEST_IDS = 50

const JWT_SHAPE = /^eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*$/
const ENTRA_SECRET = /[A-Za-z0-9_.~-]{3}\dQ~[A-Za-z0-9_.~-]{20,}/
const VAULT_TOKEN = /^(?:hv[sbr]\.[A-Za-z0-9_-]{16,}|s\.[A-Za-z0-9]{20,})$/

/** Masks a client id: variables stay readable, literals keep only the first characters. */
export function maskClientId(value: string): string {
  const text = value.trim()
  if (!text) return ''
  if (hasVariableReference(text)) return text
  return text.length <= 6 ? `${text[0]}${'•'.repeat(Math.max(2, text.length - 1))}` : `${text.slice(0, 4)}${'•'.repeat(6)}`
}

function cap<T>(list: T[], value: T, max: number): void {
  if (list.length < max && !list.includes(value)) list.push(value)
}

function field(entries: ReadonlyArray<{ key: string; value: string }> | undefined, ...names: string[]): string | undefined {
  const wanted = names.map((name) => name.toLowerCase())
  return entries?.find((entry) => wanted.includes(entry.key.toLowerCase()))?.value
}

function grantFromName(name: string | undefined): GrantType {
  const value = (name ?? '').trim().toLowerCase()
  if (!value || hasVariableReference(value)) return 'unknown'
  if (value === 'authorization_code' || value === 'authorization_code_with_pkce') return 'authorization_code'
  if (value === 'implicit') return 'implicit'
  if (value === 'password' || value === 'password_credentials') return 'password'
  if (value === 'client_credentials') return 'client_credentials'
  if (value === 'refresh_token') return 'refresh_token'
  if (value === 'device_code' || value.endsWith(':device_code')) return 'device_code'
  if (value.endsWith(':token-exchange')) return 'token_exchange'
  if (value.endsWith(':jwt-bearer')) return 'jwt_bearer'
  if (value.endsWith(':saml2-bearer')) return 'saml_bearer'
  return 'unknown'
}

function grantFromResponseType(responseType: string | undefined): GrantType {
  const types = (responseType ?? '')
    .toLowerCase()
    .split(/[\s+]+/)
    .filter(Boolean)
  if (!types.length || types.some((type) => hasVariableReference(type))) return 'unknown'
  if (types.includes('token') || (types.includes('id_token') && !types.includes('code'))) return 'implicit'
  return types.includes('code') ? 'authorization_code' : 'unknown'
}

export function splitScopes(value: string | undefined): string[] {
  if (!value) return []
  return safeDecode(value)
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter((scope) => scope && !hasVariableReference(scope))
}

function pkceFromMethod(method: string | undefined, challenge: string | undefined): PkceState {
  const value = (method ?? '').trim().toLowerCase()
  if (value === 's256') return 'S256'
  if (value === 'plain') return 'plain'
  // RFC 7636: without a method the challenge is the verifier itself, which is `plain`.
  if (challenge) return method && hasVariableReference(method) ? 'present' : 'plain'
  return 'absent'
}

function ownerLabel(request: ParsedRequest): string {
  if (request.authSource === 'request') return request.id
  if (request.authSource === 'collection') return 'collection'
  return request.folderPath.length ? request.folderPath.join(' / ') : 'collection'
}

function helperClient(request: ParsedRequest, platform: PlatformId | undefined): OAuthClient | null {
  const fields = request.authFields
  if (!fields?.length) return null
  const helperGrant = field(fields, 'grant_type', 'grantType')
  const grant = grantFromName(helperGrant)
  const withPkce = (helperGrant ?? '').toLowerCase() === 'authorization_code_with_pkce'
  const clientId = field(fields, 'clientId', 'client_id')
  const secret = field(fields, 'clientSecret', 'client_secret')
  const authentication = (field(fields, 'client_authentication', 'clientAuthentication') ?? '').toLowerCase()
  let clientAuth: ClientAuthMethod = 'unknown'
  if (authentication === 'body') clientAuth = 'client_secret_post'
  else if (authentication === 'header' || (!authentication && secret)) clientAuth = 'client_secret_basic'
  else if (!secret && grant === 'authorization_code') clientAuth = 'none'
  let pkce: PkceState = 'not-applicable'
  if (grant === 'authorization_code') {
    const method = (field(fields, 'challengeAlgorithm', 'code_challenge_method') ?? 'S256').trim().toLowerCase()
    pkce = !withPkce ? 'absent' : method === 'plain' ? 'plain' : hasVariableReference(method) ? 'present' : 'S256'
  }
  const redirect = field(fields, 'redirect_uri', 'redirectUri', 'callbackUrl')
  return {
    key: `helper:${ownerLabel(request)}`,
    source: 'auth-helper',
    owner: ownerLabel(request),
    requestIds: [request.id],
    grant,
    clientId: clientId ? maskClientId(clientId) : undefined,
    clientAuth,
    pkce,
    redirectUris: redirect && !hasVariableReference(redirect) ? [redirect] : [],
    scopes: splitScopes(field(fields, 'scope')),
    tokenUrl: field(fields, 'accessTokenUrl', 'access_token_url'),
    authUrl: field(fields, 'authUrl', 'auth_url'),
    platform,
  }
}

function requestClient(
  request: ParsedRequest,
  endpointClass: string,
  params: ReadonlyMap<string, string>,
  platform: PlatformId | undefined,
  url: SplitUrl
): OAuthClient | null {
  const isAuthorize = endpointClass === 'oauth.authorize' || endpointClass === 'oauth.par'
  const isToken = endpointClass === 'oauth.token' || endpointClass === 'oauth.device'
  if (!isAuthorize && !isToken) return null
  const grant = isAuthorize ? grantFromResponseType(params.get('response_type')) : grantFromName(params.get('grant_type'))
  const clientId = params.get('client_id')
  const basicHeader = request.headers.some(
    (header) => header.key.trim().toLowerCase() === 'authorization' && /^basic\s/i.test(header.value.trim())
  )
  let clientAuth: ClientAuthMethod = 'unknown'
  if (params.has('client_assertion')) clientAuth = 'private_key_jwt'
  else if (basicHeader) clientAuth = 'client_secret_basic'
  else if (params.has('client_secret')) clientAuth = 'client_secret_post'
  else if (isAuthorize || grant === 'authorization_code') clientAuth = clientId ? 'none' : 'unknown'
  let pkce: PkceState = 'not-applicable'
  if (grant === 'authorization_code') {
    if (isAuthorize) pkce = pkceFromMethod(params.get('code_challenge_method'), params.get('code_challenge'))
    else pkce = params.has('code_verifier') ? 'present' : 'absent'
  }
  const redirect = params.get('redirect_uri')
  const endpointUrl = `${url.host ?? ''}${url.path}`
  return {
    key: clientId ? `request:${platform ?? ''}:${clientId}:${grant}` : `request:${request.id}`,
    source: 'request',
    owner: request.id,
    requestIds: [request.id],
    grant,
    clientId: clientId ? maskClientId(clientId) : undefined,
    clientAuth,
    pkce,
    redirectUris: redirect && !hasVariableReference(redirect) ? [safeDecode(redirect)] : [],
    scopes: splitScopes(params.get('scope')),
    tokenUrl: isToken ? endpointUrl : undefined,
    authUrl: isAuthorize ? endpointUrl : undefined,
    platform,
  }
}

const PKCE_RANK: Record<PkceState, number> = { 'not-applicable': 0, absent: 1, plain: 2, present: 3, S256: 4 }
const AUTH_RANK: Record<ClientAuthMethod, number> = {
  unknown: 0,
  none: 1,
  client_secret_post: 2,
  client_secret_basic: 3,
  private_key_jwt: 4,
}

/** Merges the authorize and token requests of one client into a single entry (the stronger signal wins). */
function mergeClient(into: OAuthClient, other: OAuthClient): void {
  for (const id of other.requestIds) cap(into.requestIds, id, MAX_REQUEST_IDS)
  if (into.grant === 'unknown') into.grant = other.grant
  if (PKCE_RANK[other.pkce] > PKCE_RANK[into.pkce]) into.pkce = other.pkce
  if (AUTH_RANK[other.clientAuth] > AUTH_RANK[into.clientAuth]) into.clientAuth = other.clientAuth
  for (const uri of other.redirectUris) cap(into.redirectUris, uri, 10)
  for (const scope of other.scopes) cap(into.scopes, scope, 100)
  into.tokenUrl ??= other.tokenUrl
  into.authUrl ??= other.authUrl
  into.clientId ??= other.clientId
}

function classifyToken(value: string): TokenKind | null {
  const text = value.trim()
  if (!text || hasVariableReference(text) || !isLikelySecretValue(text)) return null
  if (JWT_SHAPE.test(text)) return 'jwt'
  if (ENTRA_SECRET.test(text)) return 'entra-client-secret'
  if (VAULT_TOKEN.test(text)) return 'vault-token'
  return 'bearer-opaque'
}

function collectTokens(request: ParsedRequest, tokens: IdentityToken[]): void {
  const add = (kind: TokenKind | null, location: string, value: string) => {
    if (kind && tokens.length < MAX_TOKENS) tokens.push({ kind, requestId: request.id, location, preview: evidencePreview(value) })
  }
  for (const header of request.headers) {
    const name = header.key.trim().toLowerCase()
    const value = header.value.trim()
    if (name === 'authorization') {
      const bearer = value.match(/^Bearer\s+(.+)$/i)?.[1]
      const ssws = value.match(/^SSWS\s+(.+)$/i)?.[1]
      const psAuth = value.match(/^PS-Auth\s+(.+)$/i)
      if (bearer) add(classifyToken(bearer), 'header Authorization', bearer)
      else if (ssws && classifyToken(ssws)) add('okta-ssws', 'header Authorization', ssws)
      else if (psAuth && classifyToken(psAuth[1])) add('ps-auth', 'header Authorization', psAuth[1])
    } else if (name === 'x-vault-token' && classifyToken(value)) {
      add('vault-token', 'header X-Vault-Token', value)
    }
  }
  for (const entry of request.authFields ?? []) {
    const key = entry.key.toLowerCase()
    if (key === 'token' || key === 'accesstoken' || key === 'access_token')
      add(classifyToken(entry.value), `auth helper ${request.auth} ${entry.key}`, entry.value)
    else if ((key === 'clientsecret' || key === 'client_secret') && ENTRA_SECRET.test(entry.value) && !hasVariableReference(entry.value))
      add('entra-client-secret', `auth helper ${request.auth} ${entry.key}`, entry.value)
  }
}

/**
 * Builds the identity profile of a parsed collection: platforms, endpoint classes, OAuth clients, scopes, grants and
 * literal tokens. The profile is static analysis only, never contains a secret value (client ids and token previews
 * are masked) and is empty for collections that have nothing to do with identity.
 */
export function buildIdentityProfile(parsed: ParsedCollection): IdentityProfile {
  const profile = emptyIdentityProfile()
  const urls = new Map<string, SplitUrl>(parsed.requests.map((request) => [request.id, splitUrl(request.url, parsed)]))
  const { platforms, byRequest } = fingerprintPlatforms(parsed, urls)
  profile.platforms = platforms

  const clients = new Map<string, OAuthClient>()
  const scopeUse = new Map<string, { requestIds: string[]; clients: Set<string> }>()
  const grantUse = new Map<GrantType, string[]>()
  const scimTargets = new Map<string, ScimTarget>()

  const addClient = (client: OAuthClient | null) => {
    if (!client) return
    const existing = clients.get(client.key)
    if (existing) mergeClient(existing, client)
    else if (clients.size < MAX_CLIENTS) clients.set(client.key, client)
  }

  for (const request of parsed.requests) {
    const url = urls.get(request.id) ?? splitUrl(request.url, parsed)
    const params = requestParams(request)
    const platform = byRequest.get(request.id)?.[0]?.id
    const endpointClass = classifyEndpoint(endpointContext(request, url, params, platform))
    if (endpointClass !== 'unknown' && profile.endpoints.length < MAX_ENDPOINTS) {
      const endpoint: IdentityEndpoint = { requestId: request.id, class: endpointClass, method: request.method, path: url.path }
      if (platform) endpoint.platform = platform
      if (url.host) endpoint.host = url.host
      profile.endpoints.push(endpoint)
      addToScimInventory(scimTargets, endpoint, url)
    }
    const lifecycle = classifyLifecycle({ method: request.method, path: url.path, endpointClass, platform }, request)
    if (lifecycle && profile.lifecycle.length < MAX_ENDPOINTS) profile.lifecycle.push({ requestId: request.id, platform, ...lifecycle })
    if (request.auth === 'oauth2') addClient(helperClient(request, platform))
    addClient(requestClient(request, endpointClass, params, platform, url))
    collectTokens(request, profile.tokens)
  }

  for (const variable of parsed.collectionVariables ?? []) {
    if (variable.disabled || profile.tokens.length >= MAX_TOKENS) continue
    const kind = classifyToken(variable.value)
    if (kind === 'jwt' || kind === 'vault-token' || kind === 'entra-client-secret')
      profile.tokens.push({ kind, location: `collection variable ${variable.key}`, preview: evidencePreview(variable.value) })
  }

  profile.scim = [...scimTargets.values()]
  profile.oauthClients = [...clients.values()]
  for (const client of profile.oauthClients) {
    const grantRequests = grantUse.get(client.grant) ?? []
    for (const id of client.requestIds) cap(grantRequests, id, MAX_REQUEST_IDS)
    grantUse.set(client.grant, grantRequests)
    for (const scope of client.scopes) {
      const entry = scopeUse.get(scope) ?? { requestIds: [], clients: new Set<string>() }
      for (const id of client.requestIds) cap(entry.requestIds, id, MAX_REQUEST_IDS)
      entry.clients.add(client.key)
      scopeUse.set(scope, entry)
    }
  }
  const grants: GrantUsage[] = [...grantUse].map(([grant, requestIds]) => ({ grant, requestIds }))
  profile.grants = grants.sort((a, b) => b.requestIds.length - a.requestIds.length || a.grant.localeCompare(b.grant))
  const scopes: ScopeUsage[] = [...scopeUse].map(([scope, entry]) => ({ scope, requestIds: entry.requestIds, clients: entry.clients.size }))
  profile.scopes = scopes.sort((a, b) => b.clients - a.clients || a.scope.localeCompare(b.scope))
  return profile
}
