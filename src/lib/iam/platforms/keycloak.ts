import type { PlatformFingerprint, PlatformProfile } from './types'

const fingerprint: PlatformFingerprint = {
  id: 'keycloak',
  name: 'Keycloak',
  family: 'access-management',
  hosts: [],
  strongPaths: [/^(?:\/auth)?\/realms\/[^/]+\/protocol\/openid-connect\//i, /^(?:\/auth)?\/admin\/realms\b/i],
  paths: [/^(?:\/auth)?\/realms\/[^/]+\/(?:\.well-known|account|clients-registrations)\b/i],
  headers: [],
  tokens: [],
  ports: [],
  variables: [/keycloak/i],
  authTypes: [],
}

const REALM_PATH = /^(?:\/auth)?(?:\/admin)?\/realms\/([^/*]+)/i

export const keycloakProfile: PlatformProfile = {
  id: 'keycloak',
  fingerprint,
  tokenFormats: [
    'OAuth 2.0 access, ID and refresh tokens (JWT, with realm_access and resource_access claims)',
    'Admin REST API bearer token from the master or a service realm',
  ],
  expectedVariables: ['keycloakUrl', 'realm', 'keycloakClientId'],
  recommendation:
    'Use {{keycloakUrl}} and {{realm}} in every URL, and a service account client with only the realm-management roles it needs.',
  endpointRules: [
    // Creating a client in the admin API is where client secrets come from.
    ['admin.credential-mint', (context) => context.method === 'POST' && /^(?:\/auth)?\/admin\/realms\/[^/]+\/clients$/i.test(context.path)],
  ],
  tenantIdentifiers: (url) => {
    const realm = REALM_PATH.exec(url.path)?.[1]
    return realm ? [{ kind: 'realm', value: realm, variable: 'realm' }] : []
  },
  deprecated: (_request, url) =>
    /^\/auth\/(?:realms|admin)\b/i.test(url.path) ? ['Keycloak legacy /auth path prefix, removed in Keycloak 17 and later'] : [],
}
