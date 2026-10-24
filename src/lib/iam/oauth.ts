import type { ParsedCollection } from '../parser'
import { isLocalHost } from '../localHost'
import { evidencePreview, isLikelySecretValue } from '../secretPatterns'
import { hasVariableReference } from '../variables'
import type { OAuthClient, IdentityProfile } from './types'
import type { FindingSink } from './sink'
import { requestParams, safeDecode, splitUrl } from './url'

/** Scopes that are broad on any platform. */
const GENERIC_BROAD_SCOPE = /^(?:\*|all|admin|root)$|(?::admin|\.manage|\/\*|\.\*)$/i

/** Platform specific high-risk scopes (lowercase). */
const BROAD_SCOPES = new Set([
  // Microsoft Entra ID and Graph
  'directory.readwrite.all',
  'rolemanagement.readwrite.directory',
  'approleassignment.readwrite.all',
  'application.readwrite.all',
  'user.readwrite.all',
  // Okta
  'okta.users.manage',
  'okta.apps.manage',
  'okta.roles.manage',
  'okta.policies.manage',
  'okta.authorizationservers.manage',
  // Auth0 Management API
  'update:users',
  'delete:users',
  'create:client_grants',
  'update:clients',
  'read:client_keys',
])
const GRAPH_READWRITE_ALL = /^[a-z][\w.]*\.readwrite\.all$/i
const GOOGLE_BROAD_SCOPE = /(?:^|\/)(?:cloud-platform|admin\.directory\.user|admin\.directory\.rolemanagement)$/i
const DEFAULT_SCOPE = /(?:^|\/)\.default$/i

/** Returns why a scope is broad, or null. `.default` only counts for public clients, which cannot keep a secret. */
export function broadScopeReason(scope: string, client: Pick<OAuthClient, 'clientAuth'>): string | null {
  const value = scope.trim()
  const lower = value.toLowerCase()
  if (BROAD_SCOPES.has(lower)) return 'tenant-wide administrative scope'
  if (GRAPH_READWRITE_ALL.test(value)) return 'read and write access to all objects'
  if (GOOGLE_BROAD_SCOPE.test(value)) return 'whole-account or directory administration scope'
  if (GENERIC_BROAD_SCOPE.test(value)) return 'wildcard or administrative scope'
  if (DEFAULT_SCOPE.test(value) && (client.clientAuth === 'none' || client.clientAuth === 'unknown')) return '.default on a public client'
  return null
}

const NESTED_URL_PARAM = /^(?:url|redirect|redirect_uri|redirecturl|next|return|returnto|return_to|continue|dest|destination|target|goto)$/i

/** Returns why a redirect URI is unsafe, or null. Variables never reach this function. */
export function unsafeRedirectReason(uri: string): string | null {
  if (uri.includes('*')) return 'wildcard'
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return null
  }
  if (url.username || url.password) return 'user info in the URL'
  if (url.protocol === 'http:' && !isLocalHost(url.hostname)) return 'http to a non-local host'
  for (const [key, value] of url.searchParams)
    if (NESTED_URL_PARAM.test(key) && /^(?:https?:)?\/\//i.test(value)) return `nested URL in ${key}`
  return null
}

function redirectPreview(uri: string): string {
  const cut = uri.search(/[?#]/)
  return cut === -1 ? uri : `${uri.slice(0, cut)}?…`
}

/** Adds a hit for an OAuth client: the request for request-level clients, evidence only for collection or folder helpers. */
function reportClient(
  parsed: ParsedCollection,
  out: FindingSink,
  client: OAuthClient,
  ruleId:
    | 'OAUTH_IMPLICIT_GRANT'
    | 'OAUTH_PASSWORD_GRANT'
    | 'OAUTH_PKCE_MISSING'
    | 'OAUTH_PKCE_PLAIN'
    | 'OAUTH_REDIRECT_URI_UNSAFE'
    | 'OAUTH_BROAD_SCOPE'
    | 'OAUTH_CLIENT_SECRET_POST',
  location: string,
  preview: string
): void {
  const requestLevel = client.source === 'request' || parsed.requests.some((request) => request.id === client.owner)
  if (requestLevel) {
    const ids = client.source === 'request' ? client.requestIds : [client.owner]
    for (const id of ids) out.add(ruleId, id, { location, preview })
  } else {
    out.add(ruleId, undefined, { location: `${location} (${client.owner})`, preview })
  }
}

function clientLabel(client: OAuthClient): string {
  return client.source === 'auth-helper' ? 'oauth2 helper' : 'oauth request'
}

const LITERAL_TOKEN_PARAMS = new Set(['access_token', 'id_token', 'code'])
const TOKEN_ENDPOINT_CLASSES = new Set(['oauth.token', 'oauth.introspect', 'oauth.revoke'])

function urlPairs(url: string): Array<{ key: string; value: string; part: 'query' | 'fragment' }> {
  const pairs: Array<{ key: string; value: string; part: 'query' | 'fragment' }> = []
  const hash = url.indexOf('#')
  const beforeHash = hash === -1 ? url : url.slice(0, hash)
  const queryStart = beforeHash.indexOf('?')
  const parts: Array<['query' | 'fragment', string]> = []
  if (queryStart !== -1) parts.push(['query', beforeHash.slice(queryStart + 1)])
  if (hash !== -1) {
    const fragment = url.slice(hash + 1)
    // `#/route?access_token=...` single page apps keep the parameters after the `?`
    parts.push(['fragment', fragment.includes('?') ? fragment.slice(fragment.indexOf('?') + 1) : fragment])
  }
  for (const [part, text] of parts) {
    for (const pair of text.split('&')) {
      const index = pair.indexOf('=')
      if (index > 0)
        pairs.push({ key: safeDecode(pair.slice(0, index)).trim().toLowerCase(), value: safeDecode(pair.slice(index + 1)), part })
    }
  }
  return pairs
}

/** OAuth 2.0 and OpenID Connect checks of the `iam-am` pack (V0.2.2). */
export function checkOAuth(parsed: ParsedCollection, profile: IdentityProfile, out: FindingSink): void {
  for (const client of profile.oauthClients) {
    const label = clientLabel(client)
    if (client.grant === 'implicit') reportClient(parsed, out, client, 'OAUTH_IMPLICIT_GRANT', `${label} grant`, 'implicit grant')
    if (client.grant === 'password') reportClient(parsed, out, client, 'OAUTH_PASSWORD_GRANT', `${label} grant`, 'password grant')
    if (client.grant === 'authorization_code' && client.pkce === 'absent' && client.clientAuth === 'none')
      reportClient(parsed, out, client, 'OAUTH_PKCE_MISSING', `${label} PKCE`, 'no code_challenge')
    if (client.pkce === 'plain') reportClient(parsed, out, client, 'OAUTH_PKCE_PLAIN', `${label} PKCE`, 'code_challenge_method plain')
    for (const uri of client.redirectUris) {
      const reason = unsafeRedirectReason(uri)
      if (reason)
        reportClient(parsed, out, client, 'OAUTH_REDIRECT_URI_UNSAFE', `${label} redirect_uri`, `${reason}: ${redirectPreview(uri)}`)
    }
    for (const scope of client.scopes) {
      const reason = broadScopeReason(scope, client)
      if (reason) reportClient(parsed, out, client, 'OAUTH_BROAD_SCOPE', `${label} scope`, `${scope} (${reason})`)
    }
    if (client.clientAuth === 'client_secret_post')
      reportClient(parsed, out, client, 'OAUTH_CLIENT_SECRET_POST', `${label} client authentication`, 'client_secret_post')
  }

  const requestsById = new Map(parsed.requests.map((request) => [request.id, request]))
  for (const endpoint of profile.endpoints) {
    const request = requestsById.get(endpoint.requestId)
    if (!request) continue
    const url = splitUrl(request.url, parsed)

    if (TOKEN_ENDPOINT_CLASSES.has(endpoint.class) && url.scheme === 'http' && url.host && !isLocalHost(url.host)) {
      out.add('OAUTH_TOKEN_ENDPOINT_HTTP', request.id, {
        location: `${endpoint.class} ${endpoint.method}`,
        preview: `http://${url.host}${url.path}`,
      })
    }

    if (endpoint.class === 'oauth.authorize' || endpoint.class === 'oauth.par') {
      const params = requestParams(request)
      const hasState = (params.get('state') ?? '').trim() !== ''
      const hasPkce = params.has('code_challenge')
      const oidc = splitScopesSimple(params.get('scope')).includes('openid')
      const hasNonce = (params.get('nonce') ?? '').trim() !== ''
      const protectedByNonce = oidc && hasNonce
      if (!hasState && !hasPkce && !protectedByNonce && params.has('response_type'))
        out.add('OAUTH_STATE_MISSING', request.id, { location: 'authorize request', preview: 'no state, code_challenge or nonce' })
    }
  }

  // Tokens and codes with literal values in URLs, including the saved example requests.
  const reported = out.flaggedLocations(['SECRET_IN_QUERY'])
  for (const request of parsed.requests) {
    const sources: Array<{ url: string; prefix: string }> = [{ url: request.url, prefix: '' }]
    for (const response of request.savedResponses ?? [])
      if (response.requestUrl) sources.push({ url: response.requestUrl, prefix: `saved response "${response.name}" original request ` })
    for (const source of sources) {
      if (!/[?#]/.test(source.url)) continue
      for (const pair of urlPairs(source.url)) {
        if (!LITERAL_TOKEN_PARAMS.has(pair.key) || !pair.value.trim() || hasVariableReference(pair.value)) continue
        if (pair.key === 'code' ? pair.value.length < 8 : !isLikelySecretValue(pair.value)) continue
        const location = `${source.prefix}${pair.part === 'fragment' ? 'fragment' : 'query'} ${pair.key}`
        if (reported.has(`${request.id}|${location}`)) continue
        out.add('OAUTH_TOKEN_IN_URL', request.id, { location, preview: evidencePreview(pair.value) })
      }
    }
  }
}

function splitScopesSimple(value: string | undefined): string[] {
  return (value ?? '')
    .split(/[\s,+]+/)
    .map((scope) => scope.trim().toLowerCase())
    .filter(Boolean)
}
