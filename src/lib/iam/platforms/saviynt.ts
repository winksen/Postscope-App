import type { PlatformFingerprint, PlatformProfile } from './types'

const fingerprint: PlatformFingerprint = {
  id: 'saviynt',
  name: 'Saviynt Enterprise Identity Cloud',
  family: 'governance',
  hosts: [/(?:^|\.)saviyntcloud\.com$/],
  strongPaths: [/^\/ecm\/api\/v5\//i],
  paths: [],
  headers: [],
  tokens: [],
  ports: [],
  variables: [/saviynt/i],
  authTypes: [],
}

const TENANT_HOST = /^([a-z0-9-]+)\.saviyntcloud\.com$/

export const saviyntProfile: PlatformProfile = {
  id: 'saviynt',
  fingerprint,
  tokenFormats: ['Bearer token from /ECM/api/login (short-lived)', 'Basic credentials of the integration user'],
  expectedVariables: ['saviyntHost', 'saviyntUser', 'saviyntPassword'],
  recommendation: 'Use {{saviyntHost}} for the tenant host, and keep the integration user credentials in a private environment.',
  tenantIdentifiers: (url) =>
    url.host && TENANT_HOST.test(url.host) ? [{ kind: 'org-domain', value: url.host, variable: 'saviyntHost' }] : [],
}
