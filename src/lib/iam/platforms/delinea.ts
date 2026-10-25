import type { PlatformFingerprint, PlatformProfile } from './types'

const fingerprint: PlatformFingerprint = {
  id: 'delinea',
  name: 'Delinea Secret Server',
  family: 'privileged-access',
  hosts: [/(?:^|\.)secretservercloud\.(?:com|eu|ca|com\.au)$/, /(?:^|\.)delinea\.app$/],
  strongPaths: [/^\/secretserver\/api\/v1\//i, /^\/api\/v1\/secrets\b/i],
  paths: [],
  headers: [],
  tokens: [],
  ports: [],
  variables: [/delinea|secretserver/i],
  authTypes: [],
}

const CLOUD_HOST = /^([a-z0-9-]+)\.secretservercloud\.(?:com|eu|ca|com\.au)$/

export const delineaProfile: PlatformProfile = {
  id: 'delinea',
  fingerprint,
  tokenFormats: ['OAuth 2.0 bearer token from /oauth2/token (short-lived)', 'Application account credentials'],
  expectedVariables: ['delineaUrl', 'delineaUser', 'delineaPassword'],
  recommendation:
    'Use {{delineaUrl}}, request tokens at runtime, and send comment and ticket fields when reading secrets that require them.',
  tenantIdentifiers: (url) =>
    url.host && CLOUD_HOST.test(url.host) ? [{ kind: 'org-domain', value: url.host, variable: 'delineaUrl' }] : [],
}
