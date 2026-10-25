import type { PlatformFingerprint, PlatformProfile } from './types'

const fingerprint: PlatformFingerprint = {
  id: 'azure-iam',
  name: 'Azure resource IAM and Key Vault',
  family: 'cloud-iam',
  hosts: [/^management\.azure\.com$/, /(?:^|\.)vault\.azure\.net$/, /^management\.usgovcloudapi\.net$/],
  strongPaths: [/\/providers\/microsoft\.authorization\//i, /\/roleassignments\b/i],
  paths: [],
  headers: [],
  tokens: [],
  ports: [],
  variables: [],
  authTypes: [],
}

export const azureIamProfile: PlatformProfile = {
  id: 'azure-iam',
  fingerprint,
  tokenFormats: [
    'Entra ID access token for https://management.azure.com (JWT)',
    'Key Vault access token for https://vault.azure.net (JWT)',
  ],
  expectedVariables: ['subscriptionId', 'tenantId', 'keyVaultName'],
  recommendation:
    'Use {{subscriptionId}} and {{tenantId}}, and assign Owner and User Access Administrator only through a reviewed process.',
  tenantIdentifiers: () => [],
}
