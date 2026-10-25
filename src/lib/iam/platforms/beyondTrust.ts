import type { PlatformFingerprint, PlatformProfile } from './types'

const fingerprint: PlatformFingerprint = {
  id: 'beyondtrust',
  name: 'BeyondTrust Password Safe',
  family: 'privileged-access',
  hosts: [/(?:^|\.)beyondtrustcloud\.com$/],
  strongPaths: [/^\/beyondtrust\/api\/public\/v3\//i],
  paths: [],
  headers: [{ name: /^authorization$/i, value: /^PS-Auth\s/i, label: 'Authorization: PS-Auth' }],
  tokens: [],
  ports: [],
  variables: [/beyondtrust|psauth/i],
  authTypes: [],
}

export const beyondTrustProfile: PlatformProfile = {
  id: 'beyondtrust',
  fingerprint,
  tokenFormats: ['PS-Auth key and runas user (Authorization header)', 'Session cookie after /Auth/SignAppin'],
  expectedVariables: ['btHost', 'btApiKey', 'btRunAs'],
  recommendation:
    'Use {{btHost}} and {{btApiKey}}, restrict the API registration to known source addresses, and always send a reason with requests.',
  tenantIdentifiers: () => [],
}
