import { NON_PRODUCTION_LABEL, type PlatformFingerprint, type PlatformProfile } from './types'

const fingerprint: PlatformFingerprint = {
  id: 'auth0',
  name: 'Auth0',
  family: 'ciam',
  hosts: [/(?:^|\.)auth0\.com$/],
  strongPaths: [/^\/api\/v2\/(?:users|clients|connections|roles|resource-servers|guardian|tenants|client-grants|rules|actions)\b/i],
  paths: [/^\/oauth\/token$/i, /^\/api\/v2\//i],
  headers: [],
  tokens: [],
  ports: [],
  variables: [/auth0/i],
  authTypes: [],
}

const TENANT_HOST = /^([a-z0-9-]+)(?:\.[a-z]{2})?\.auth0\.com$/

export const auth0Profile: PlatformProfile = {
  id: 'auth0',
  fingerprint,
  tokenFormats: ['Access and ID tokens (JWT; Management API tokens have an audience ending in /api/v2/)', 'Refresh token (opaque)'],
  expectedVariables: ['auth0Domain', 'auth0ClientId', 'auth0ClientSecret'],
  recommendation:
    'Use {{auth0Domain}} for the tenant, and a machine-to-machine application limited to the Management API scopes the job needs.',
  tenantIdentifiers: (url) =>
    url.host && TENANT_HOST.test(url.host) ? [{ kind: 'org-domain', value: url.host, variable: 'auth0Domain' }] : [],
  environmentOf: (url) => {
    const label = url.host ? TENANT_HOST.exec(url.host)?.[1] : undefined
    if (!label) return undefined
    return NON_PRODUCTION_LABEL.test(label) ? 'development' : 'production'
  },
  deprecated: (_request, url) => {
    if (/^\/oauth\/ro$/i.test(url.path)) return ['Auth0 /oauth/ro (resource owner endpoint), deprecated']
    if (/^\/delegation$/i.test(url.path)) return ['Auth0 /delegation endpoint, deprecated']
    if (/^\/tokeninfo$/i.test(url.path)) return ['Auth0 /tokeninfo endpoint, deprecated']
    return []
  },
}
