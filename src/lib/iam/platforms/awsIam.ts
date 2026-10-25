import type { PlatformFingerprint, PlatformProfile } from './types'

const fingerprint: PlatformFingerprint = {
  id: 'aws-iam',
  name: 'AWS IAM and STS',
  family: 'cloud-iam',
  hosts: [
    /^(?:iam|sts)(?:\.[a-z0-9-]+)?\.amazonaws\.com$/,
    /^secretsmanager\.[a-z0-9-]+\.amazonaws\.com$/,
    /^iam\.[a-z0-9-]+\.amazonaws\.com\.cn$/,
  ],
  strongPaths: [],
  paths: [],
  headers: [{ name: /^x-amz-target$/i, value: /iam|sts|secretsmanager/i, label: 'X-Amz-Target' }],
  tokens: [],
  ports: [],
  variables: [],
  authTypes: ['awsv4', 'aws'],
}

export const awsIamProfile: PlatformProfile = {
  id: 'aws-iam',
  fingerprint,
  tokenFormats: [
    'Access key id (AKIA, long-lived) and secret',
    'STS temporary credentials (ASIA key id and session token)',
    'SigV4 signature',
  ],
  expectedVariables: ['awsAccessKeyId', 'awsSecretAccessKey', 'awsSessionToken', 'awsRegion'],
  recommendation:
    'Use the AWS Signature helper with {{awsAccessKeyId}} and {{awsSecretAccessKey}}, prefer STS temporary credentials, and never attach AdministratorAccess in shared collections.',
  tenantIdentifiers: () => [],
}
