import type { PlatformFingerprint, PlatformProfile } from './types'

const fingerprint: PlatformFingerprint = {
  id: 'omada',
  name: 'Omada Identity',
  family: 'governance',
  hosts: [/(?:^|\.)omada\.cloud$/],
  strongPaths: [/^\/odata\//i],
  paths: [],
  headers: [],
  tokens: [],
  ports: [],
  variables: [/omada/i],
  authTypes: [],
}

const TENANT_HOST = /^([a-z0-9-]+)\.omada\.cloud$/

export const omadaProfile: PlatformProfile = {
  id: 'omada',
  fingerprint,
  tokenFormats: ['OAuth 2.0 access token (JWT) for the OData API', 'Basic credentials of the integration account'],
  expectedVariables: ['omadaHost', 'omadaClientId', 'omadaClientSecret'],
  recommendation: 'Use {{omadaHost}} for the tenant host, and an OAuth client with the smallest scope for the data objects it reads.',
  tenantIdentifiers: (url) =>
    url.host && TENANT_HOST.test(url.host) ? [{ kind: 'org-domain', value: url.host, variable: 'omadaHost' }] : [],
}
