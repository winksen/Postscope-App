import type { PlatformFingerprint, PlatformProfile } from './types'

const fingerprint: PlatformFingerprint = {
  id: 'vault',
  name: 'HashiCorp Vault',
  family: 'privileged-access',
  hosts: [/(?:^|\.)vault\.hashicorp\.cloud$/],
  strongPaths: [/^\/v1\/sys\//i, /^\/v1\/auth\/[^/]+\/(?:login|token|role)/i],
  paths: [/^\/v1\/[^/]+\/data\//i, /^\/v1\/(?:secret|kv|cubbyhole|transit|pki|database)\b/i],
  headers: [{ name: /^x-vault-token$/i, label: 'X-Vault-Token' }],
  tokens: [{ pattern: /\bhv[sbr]\.[A-Za-z0-9_-]{16,}/, label: 'Vault token (hvs.)' }],
  ports: ['8200'],
  variables: [/vault/i],
  authTypes: [],
}

const KV_MOUNT = /^\/v1\/(?:secret|kv[\w-]*)\//i

function jsonObject(raw: string | undefined): Record<string, unknown> | null {
  if (!raw || raw.length > 1_000_000) return null
  try {
    const value = JSON.parse(raw) as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export const vaultProfile: PlatformProfile = {
  id: 'vault',
  fingerprint,
  tokenFormats: [
    'Service token (hvs. prefix), batch token (hvb.), recovery token (hvr.)',
    'Legacy tokens (s. prefix) from Vault before 1.10',
  ],
  expectedVariables: ['vaultAddr', 'vaultToken', 'vaultNamespace'],
  recommendation:
    'Use {{vaultAddr}} and log in at runtime with AppRole, JWT or OIDC auth, and keep the resulting token in a variable that is never exported.',
  tenantIdentifiers: () => [],
  deprecated: (request, url) => {
    if (!KV_MOUNT.test(url.path) || (request.method !== 'POST' && request.method !== 'PUT')) return []
    const body = jsonObject(request.bodyRaw)
    if (!body) return []
    const isV2Path = /^\/v1\/[^/]+\/data\//i.test(url.path)
    const hasEnvelope = 'data' in body && typeof body.data === 'object'
    if (hasEnvelope && !isV2Path) return ['Vault KV v2 body with a data envelope sent to a KV v1 style path (missing /data/)']
    if (isV2Path && !hasEnvelope) return ['Vault KV v1 body sent to a KV v2 path (the data envelope is missing)']
    return []
  },
}
