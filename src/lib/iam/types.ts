/** Identity platforms PostScope can recognize from a collection export. */
export const PLATFORM_IDS = [
  'okta',
  'entra',
  'auth0',
  'ping',
  'forgerock',
  'keycloak',
  'sailpoint',
  'saviynt',
  'oneidentity',
  'omada',
  'cyberark',
  'beyondtrust',
  'delinea',
  'vault',
  'aws-iam',
  'azure-iam',
  'gcp-iam',
] as const
export type PlatformId = (typeof PLATFORM_IDS)[number]

export type PlatformFamily = 'access-management' | 'ciam' | 'governance' | 'privileged-access' | 'cloud-iam'

export interface DetectedPlatform {
  id: PlatformId
  name: string
  family: PlatformFamily
  /** 0 to 1. A host match is strong, a path or header alone is weaker; more matching requests add a little. */
  confidence: number
  /** Short descriptions of the signals that matched, for example `host *.okta.com`. */
  signals: string[]
  /** Requests with at least one signal (capped). */
  requestIds: string[]
  requestCount: number
  /** Literal hosts seen on those requests (capped). */
  hosts: string[]
}

/** Endpoint classes. Rules match on these instead of on raw URLs. */
export const ENDPOINT_CLASSES = [
  'oauth.token',
  'oauth.authorize',
  'oauth.par',
  'oauth.device',
  'oauth.introspect',
  'oauth.revoke',
  'oidc.userinfo',
  'oidc.discovery',
  'oidc.jwks',
  'oidc.logout',
  'session.terminate',
  'saml.acs',
  'saml.sso',
  'scim.users',
  'scim.groups',
  'scim.bulk',
  'scim.schemas',
  'iga.access-request',
  'iga.certification',
  'iga.sod',
  'admin.role-assignment',
  'admin.policy',
  'admin.credential-mint',
  'pam.retrieve',
  'pam.checkout',
  'pam.checkin',
  'pam.session',
  'pam.admin',
  'vault.read',
  'vault.write',
  'cloud-iam.sts',
  'cloud-iam.iam',
  'cloud-iam.azure',
  'cloud-iam.gcp',
  'unknown',
] as const
export type EndpointClass = (typeof ENDPOINT_CLASSES)[number]

export interface IdentityEndpoint {
  requestId: string
  class: EndpointClass
  platform?: PlatformId
  method: string
  /** Literal host, when the URL has one (or a variable that the selected environment resolves). */
  host?: string
  /** Path with variables and `:params` replaced by `*`. No query string. */
  path: string
}

export type GrantType =
  | 'authorization_code'
  | 'implicit'
  | 'password'
  | 'client_credentials'
  | 'refresh_token'
  | 'device_code'
  | 'token_exchange'
  | 'jwt_bearer'
  | 'saml_bearer'
  | 'unknown'

export type ClientAuthMethod = 'client_secret_basic' | 'client_secret_post' | 'private_key_jwt' | 'none' | 'unknown'

/** PKCE state of an OAuth flow. `present` means a verifier or challenge is sent but the method is not visible. */
export type PkceState = 'S256' | 'plain' | 'present' | 'absent' | 'not-applicable'

export interface OAuthClient {
  /** Stable within one profile. */
  key: string
  source: 'auth-helper' | 'request'
  /** `collection`, a folder path, or the request id the client is defined on. */
  owner: string
  requestIds: string[]
  grant: GrantType
  /** Client id, masked when it is a literal value. Variables are kept as written. */
  clientId?: string
  clientAuth: ClientAuthMethod
  pkce: PkceState
  redirectUris: string[]
  scopes: string[]
  tokenUrl?: string
  authUrl?: string
  platform?: PlatformId
}

export interface ScopeUsage {
  scope: string
  requestIds: string[]
  /** OAuth clients that ask for the scope. */
  clients: number
}

export interface GrantUsage {
  grant: GrantType
  requestIds: string[]
}

export type TokenKind = 'jwt' | 'okta-ssws' | 'vault-token' | 'ps-auth' | 'entra-client-secret' | 'bearer-opaque'

/** A literal token found in a header or an auth helper. Only a masked preview is stored. */
export interface IdentityToken {
  kind: TokenKind
  requestId?: string
  location: string
  preview: string
}

export interface IdentityProfile {
  platforms: DetectedPlatform[]
  endpoints: IdentityEndpoint[]
  oauthClients: OAuthClient[]
  scopes: ScopeUsage[]
  grants: GrantUsage[]
  tokens: IdentityToken[]
}

export function emptyIdentityProfile(): IdentityProfile {
  return { platforms: [], endpoints: [], oauthClients: [], scopes: [], grants: [], tokens: [] }
}

export function isEmptyProfile(profile: IdentityProfile | undefined): boolean {
  return (
    !profile ||
    (profile.platforms.length === 0 && profile.endpoints.length === 0 && profile.oauthClients.length === 0 && profile.tokens.length === 0)
  )
}
