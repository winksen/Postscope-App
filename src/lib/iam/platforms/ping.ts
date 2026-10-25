import { GUID, type PlatformFingerprint, type PlatformProfile } from './types'

const fingerprint: PlatformFingerprint = {
  id: 'ping',
  name: 'Ping Identity',
  family: 'access-management',
  hosts: [/(?:^|\.)pingone\.(?:com|eu|asia|ca|com\.au)$/, /(?:^|\.)pingidentity\.(?:com|cloud)$/],
  strongPaths: [/^\/as\/(?:token|authorization|introspect|revoke|userinfo)\.oauth2$/i, /^\/pf-admin-api\//i, /^\/v1\/environments\//i],
  paths: [],
  headers: [],
  tokens: [],
  ports: [],
  variables: [/pingone|pingfederate|pingid/i],
  authTypes: [],
}

const AUTH_HOST = /^auth\.pingone\.(?:com|eu|asia|ca|com\.au)$/
const API_HOST = /^api\.pingone\.(?:com|eu|asia|ca|com\.au)$/

export const pingProfile: PlatformProfile = {
  id: 'ping',
  fingerprint,
  tokenFormats: [
    'OAuth 2.0 access and ID tokens (JWT)',
    'Worker application access token (JWT, client credentials)',
    'Reference access tokens (opaque)',
  ],
  expectedVariables: ['envId', 'pingClientId', 'pingClientSecret'],
  recommendation: 'Use {{envId}} for the PingOne environment id, and a worker application with the smallest role set for management calls.',
  endpointRules: [
    // PingFederate administration: creating or changing an OAuth client is where client secrets are issued.
    [
      'admin.credential-mint',
      (context) =>
        (context.method === 'POST' || context.method === 'PUT') && /^\/pf-admin-api\/v\d+\/oauth\/clients(?:\/|$)/i.test(context.path),
    ],
  ],
  tenantIdentifiers: (url) => {
    if (!url.host) return []
    const segments = url.path.split('/')
    const environment = AUTH_HOST.test(url.host)
      ? segments[1]
      : API_HOST.test(url.host) && segments[2] === 'environments'
        ? segments[3]
        : undefined
    return environment && GUID.test(environment) ? [{ kind: 'environment-id', value: environment, variable: 'envId' }] : []
  },
}
