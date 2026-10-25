import type { PlatformFingerprint, PlatformProfile } from './types'

const fingerprint: PlatformFingerprint = {
  id: 'cyberark',
  name: 'CyberArk',
  family: 'privileged-access',
  hosts: [/(?:^|\.)privilegecloud\.cyberark\.cloud$/, /(?:^|\.)cyberark\.cloud$/, /(?:^|\.)cyberark\.com$/],
  strongPaths: [/^\/passwordvault\/(?:api|webservices)\//i, /^\/aimwebservice\/api\//i, /^\/authn\/[^/]+\/[^/]+\/authenticate$/i],
  paths: [],
  headers: [],
  tokens: [],
  ports: [],
  variables: [/cyberark|pvwa|conjur/i],
  authTypes: [],
}

const CLOUD_HOST = /^([a-z0-9-]+)\.privilegecloud\.cyberark\.cloud$/

export const cyberarkProfile: PlatformProfile = {
  id: 'cyberark',
  fingerprint,
  tokenFormats: [
    'PVWA logon token (opaque, sent in Authorization without a scheme)',
    'Identity Security Platform OAuth access token (JWT)',
    'Conjur access token (base64 JSON)',
  ],
  expectedVariables: ['pvwaUrl', 'cyberarkToken', 'cyberarkUser'],
  recommendation:
    'Use {{pvwaUrl}} and log on at runtime with an application identity, and send the reason and ticket fields with every retrieval.',
  tenantIdentifiers: (url) => (url.host && CLOUD_HOST.test(url.host) ? [{ kind: 'org-domain', value: url.host, variable: 'pvwaUrl' }] : []),
  deprecated: (_request, url) =>
    /^\/passwordvault\/webservices\//i.test(url.path)
      ? ['CyberArk classic PasswordVault/WebServices (v1) API, replaced by PasswordVault/API']
      : [],
}
