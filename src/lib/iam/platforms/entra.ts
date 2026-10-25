import { GUID, type PlatformFingerprint, type PlatformProfile } from './types'

const fingerprint: PlatformFingerprint = {
  id: 'entra',
  name: 'Microsoft Entra ID',
  family: 'access-management',
  hosts: [/^login\.microsoftonline\.(?:com|us|de)$/, /^graph\.microsoft\.(?:com|us)$/, /^graph\.windows\.net$/, /^sts\.windows\.net$/],
  strongPaths: [
    /\/oauth2\/(?:v2\.0\/)?(?:token|authorize|devicecode)$/i,
    /^\/(?:v1\.0|beta)\/(?:users|groups|applications|serviceprincipals|directoryroles|rolemanagement|identity)\b/i,
  ],
  paths: [],
  headers: [],
  tokens: [{ pattern: /[A-Za-z0-9_.~-]{3}\dQ~[A-Za-z0-9_.~-]{20,}/, label: 'client secret (Q~)' }],
  ports: [],
  variables: [/tenant(?:id)?\b/i, /entra|azuread|msgraph/i],
  authTypes: [],
}

const LOGIN_HOST = /^login\.microsoftonline\.(?:com|us|de)$/
const WELL_KNOWN_TENANTS = new Set(['common', 'organizations', 'consumers'])

/** The tenant segment of a `login.microsoftonline.com/{tenant}/...` path, when it is a GUID or a verified domain. */
function tenantSegment(url: { host?: string; path: string }): string | null {
  if (!url.host || !LOGIN_HOST.test(url.host)) return null
  const segment = url.path.split('/')[1] ?? ''
  if (!segment || segment === '*' || WELL_KNOWN_TENANTS.has(segment.toLowerCase())) return null
  return GUID.test(segment) || /\.[a-z]{2,}$/i.test(segment) ? segment : null
}

export const entraProfile: PlatformProfile = {
  id: 'entra',
  fingerprint,
  tokenFormats: [
    'OAuth 2.0 access and ID tokens (JWT, with tid, oid and wids claims)',
    'Client secret (Q~ format, 40 characters)',
    'Refresh token (opaque)',
  ],
  expectedVariables: ['tenantId', 'clientId', 'clientSecret'],
  recommendation:
    'Use {{tenantId}} in the authority URL, and a certificate or federated credential for the app instead of a client secret.',
  tenantIdentifiers: (url) => {
    const tenant = tenantSegment(url)
    return tenant ? [{ kind: 'tenant-id', value: tenant, variable: 'tenantId' }] : []
  },
  deprecated: (_request, url) => {
    const found: string[] = []
    if (url.host === 'graph.windows.net') found.push('Azure AD Graph API (graph.windows.net), retired in favor of Microsoft Graph')
    if (url.host && LOGIN_HOST.test(url.host) && /^\/[^/]+\/oauth2\/(?:token|authorize|logout)$/i.test(url.path))
      found.push('Entra v1.0 endpoint (/oauth2/token without /v2.0), replaced by the v2.0 endpoint')
    return found
  },
}
