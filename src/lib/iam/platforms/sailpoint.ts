import type { PlatformFingerprint, PlatformProfile } from './types'

const fingerprint: PlatformFingerprint = {
  id: 'sailpoint',
  name: 'SailPoint Identity Security Cloud and IdentityIQ',
  family: 'governance',
  hosts: [/(?:^|\.)identitynow(?:-demo)?\.com$/, /(?:^|\.)api\.identitynow\.com$/],
  strongPaths: [
    /^\/identityiq\//i,
    /^\/(?:v3|beta|v2024|v2025)\/(?:access-requests|certifications|campaigns|sod-polic|sod-violation|identities|accounts|sources|entitlements|access-profiles|roles|search)\b/i,
  ],
  paths: [/^\/cc\/api\//i],
  headers: [],
  tokens: [],
  ports: [],
  variables: [/sailpoint|identitynow|identityiq/i],
  authTypes: [],
}

const TENANT_HOST = /^([a-z0-9-]+)\.(?:api\.)?identitynow(?:-demo)?\.com$/

export const sailpointProfile: PlatformProfile = {
  id: 'sailpoint',
  fingerprint,
  tokenFormats: [
    'Personal access token client id and secret (client credentials)',
    'OAuth 2.0 access token (JWT)',
    'IdentityIQ session or SCIM bearer',
  ],
  expectedVariables: ['sailpointTenant', 'sailpointClientId', 'sailpointClientSecret'],
  recommendation:
    'Use {{sailpointTenant}} for the tenant host, and a personal access token that belongs to a dedicated service identity with the smallest authority group.',
  tenantIdentifiers: (url) =>
    url.host && TENANT_HOST.test(url.host) ? [{ kind: 'org-domain', value: url.host, variable: 'sailpointTenant' }] : [],
  deprecated: (_request, url) => {
    if (/^\/cc\/api\//i.test(url.path)) return ['SailPoint legacy /cc/api endpoints, replaced by the /v3 and beta APIs']
    if (url.host && TENANT_HOST.test(url.host) && /^\/v2\//i.test(url.path)) return ['SailPoint /v2 API, replaced by the /v3 API']
    return []
  },
}
