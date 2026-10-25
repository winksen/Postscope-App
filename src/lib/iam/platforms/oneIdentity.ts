import type { PlatformFingerprint, PlatformProfile } from './types'

const fingerprint: PlatformFingerprint = {
  id: 'oneidentity',
  name: 'One Identity Manager',
  family: 'governance',
  hosts: [/(?:^|\.)oneidentity\.com$/],
  strongPaths: [/^\/appserver\/api\//i, /^\/apiserver\//i],
  paths: [],
  headers: [],
  tokens: [],
  ports: [],
  variables: [/oneidentity|identitymanager/i],
  authTypes: [],
}

export const oneIdentityProfile: PlatformProfile = {
  id: 'oneidentity',
  fingerprint,
  tokenFormats: ['Session cookie from the application server login', 'Basic or OAuth 2.0 bearer for the REST API'],
  expectedVariables: ['oimHost', 'oimUser', 'oimPassword'],
  recommendation: 'Use {{oimHost}} for the application server, and a service account that has only the permission groups the job needs.',
  tenantIdentifiers: () => [],
}
