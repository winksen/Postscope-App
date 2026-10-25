import type { PlatformFingerprint, PlatformProfile } from './types'

const fingerprint: PlatformFingerprint = {
  id: 'gcp-iam',
  name: 'Google Cloud IAM',
  family: 'cloud-iam',
  hosts: [
    /^iam\.googleapis\.com$/,
    /^secretmanager\.googleapis\.com$/,
    /^admin\.googleapis\.com$/,
    /^cloudresourcemanager\.googleapis\.com$/,
  ],
  strongPaths: [],
  paths: [],
  headers: [],
  tokens: [],
  ports: [],
  variables: [],
  authTypes: [],
}

export const gcpIamProfile: PlatformProfile = {
  id: 'gcp-iam',
  fingerprint,
  tokenFormats: ['OAuth 2.0 access token for a service account (short-lived)', 'Service account key (JSON, long-lived)'],
  expectedVariables: ['gcpProject', 'gcpAccessToken', 'gcpServiceAccount'],
  recommendation:
    'Use {{gcpProject}}, short-lived tokens from workload identity or impersonation, and avoid creating service account keys.',
  tenantIdentifiers: () => [],
}
