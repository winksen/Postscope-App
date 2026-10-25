import type { ParsedCollection, ParsedRequest } from '../parser'
import { parseTemplatedJson } from '../jsonBody'
import type { FindingSink } from './sink'
import type { EndpointClass, IdentityEndpoint, IdentityProfile, PrivilegedGroup, PrivilegedKind, PrivilegedOperation } from './types'

const KIND_BY_CLASS: Partial<Record<EndpointClass, PrivilegedKind>> = {
  'admin.role-assignment': 'role-assignment',
  'admin.policy': 'policy-change',
  'admin.credential-mint': 'credential-mint',
  'pam.admin': 'safe-admin',
  'pam.retrieve': 'secret-retrieval',
  'pam.checkout': 'secret-retrieval',
  'vault.write': 'secret-write',
}

/** Top-tier roles whose literal assignment is a risk. Ids are the well-known role definition ids of each platform. */
const TOP_TIER_ROLES: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bSUPER_ADMIN\b/, label: 'Okta SUPER_ADMIN' },
  { pattern: /\bORG_ADMIN\b/, label: 'Okta ORG_ADMIN' },
  { pattern: /62e90394-69f5-4237-9190-012177145e10/i, label: 'Entra Global Administrator' },
  { pattern: /e8611ab8-c189-46e8-94e1-60213ab1f814/i, label: 'Entra Privileged Role Administrator' },
  { pattern: /\brealm-admin\b/i, label: 'Keycloak realm-admin' },
  { pattern: /arn:aws[a-z-]*:iam::aws:policy\/AdministratorAccess\b|\bAdministratorAccess\b/, label: 'AWS AdministratorAccess' },
  { pattern: /8e3af657-a8ff-443c-a75c-2fe8c4bcb635/i, label: 'Azure Owner' },
  { pattern: /18d7d88d-d35e-4fb5-a5c3-7773c20a72d9/i, label: 'Azure User Access Administrator' },
]
const AUTH0_ADMIN_ROLE = /\b(?:tenant[-_ ]?admin|super[-_ ]?admin|admin(?:istrator)?)\b/i

export function privilegedKindOf(endpointClass: EndpointClass): PrivilegedKind | undefined {
  return KIND_BY_CLASS[endpointClass]
}

/** The top-tier role a request assigns as a literal, or null. Variables are never read: only the written text counts. */
export function topTierRole(request: ParsedRequest, platform?: string): string | null {
  const text = `${request.url}\n${request.bodyRaw ?? ''}\n${(request.bodyFields ?? []).map((field) => `${field.key}=${field.value}`).join('\n')}`
  const withoutVariables = text.replace(/\{\{[^}]*\}\}/g, '')
  for (const role of TOP_TIER_ROLES) if (role.pattern.test(withoutVariables)) return role.label
  if (platform === 'auth0' && request.method !== 'GET' && AUTH0_ADMIN_ROLE.test(withoutVariables.replace(/\/api\/v2\/[a-z/*-]*/gi, '')))
    return 'Auth0 admin role'
  return null
}

/** One entry of the privileged operations inventory. `danger` marks state-changing admin operations and secret retrievals for the Identity page. */
export function privilegedOperation(endpoint: IdentityEndpoint, request: ParsedRequest): PrivilegedOperation | null {
  const kind = privilegedKindOf(endpoint.class)
  if (!kind) return null
  const readOnly = request.method === 'GET' || request.method === 'HEAD'
  const reason = endpoint.class === 'admin.role-assignment' && !readOnly ? topTierRole(request, endpoint.platform) : null
  const danger = kind === 'secret-retrieval' || !readOnly
  return {
    requestId: endpoint.requestId,
    platform: endpoint.platform,
    kind,
    method: request.method,
    path: endpoint.path,
    danger,
    ...(reason ? { topTier: reason } : {}),
  }
}

/** Groups the inventory by platform, danger zone entries first. */
export function groupPrivileged(operations: readonly PrivilegedOperation[]): PrivilegedGroup[] {
  const groups = new Map<string, PrivilegedGroup>()
  for (const operation of operations) {
    const key = operation.platform ?? 'unspecified'
    const group = groups.get(key) ?? { platform: key as PrivilegedGroup['platform'], dangerCount: 0, operations: [] }
    group.operations.push(operation)
    if (operation.danger) group.dangerCount += 1
    groups.set(key, group)
  }
  for (const group of groups.values()) group.operations.sort((a, b) => Number(b.danger) - Number(a.danger))
  return [...groups.values()].sort((a, b) => b.dangerCount - a.dangerCount || a.platform.localeCompare(b.platform))
}

function readJson(request: ParsedRequest): unknown {
  const raw = request.bodyRaw
  if (!raw || raw.length > 1_000_000) return null
  return parseTemplatedJson(raw)?.value ?? null
}

const INACTIVE = /^(?:inactive|disabled|off|none|never|deactivated)$/i
const NO_ENFORCEMENT = /^(?:none|never|off|disabled|notenforced|enabledforreportingbutnotenforced)$/i

/**
 * Why a policy or conditional access body weakens multi-factor authentication, or null: a factor or the policy turned
 * off, enforcement set to none, MFA not required, or every user excluded.
 */
export function weakensMfa(value: unknown, depth = 0): string | null {
  if (depth > 8 || !value || typeof value !== 'object') return null
  if (Array.isArray(value)) {
    for (const entry of value.slice(0, 100)) {
      const reason = weakensMfa(entry, depth + 1)
      if (reason) return reason
    }
    return null
  }
  const record = value as Record<string, unknown>
  for (const [key, entry] of Object.entries(record)) {
    const name = key.toLowerCase()
    if (typeof entry === 'boolean') {
      if (entry === false && /^(?:requiremfa|mfarequired|requirefactor|requiremultifactor|multifactorrequired|enforcemfa)$/.test(name))
        return `${key} is false`
      if (
        entry === false &&
        name === 'enabled' &&
        /factor|mfa|otp|authenticator/i.test(
          JSON.stringify(Object.keys(record)) + String(record.factorType ?? record.name ?? record.type ?? '')
        )
      )
        return 'a factor is disabled'
    }
    if (typeof entry === 'string') {
      if (
        /^(?:state|status)$/.test(name) &&
        INACTIVE.test(entry) &&
        /mfa|factor|policy|conditional|guardian|otp|signon|authenticat/i.test(
          JSON.stringify(Object.keys(record)) + String(record.type ?? record.name ?? '')
        )
      )
        return `${key} is ${entry}`
      if (/^(?:enforcement|mfa|mfaenforcement|requirement)$/.test(name) && NO_ENFORCEMENT.test(entry)) return `${key} is ${entry}`
      if (
        name === 'state' &&
        NO_ENFORCEMENT.test(entry) &&
        /conditional|grantcontrols|sessioncontrols/i.test(JSON.stringify(Object.keys(record)))
      )
        return `conditional access state is ${entry}`
    }
    if (
      /^exclude(?:users|groups)$/.test(name) &&
      Array.isArray(entry) &&
      entry.some((item) => typeof item === 'string' && /^all(?:users)?$/i.test(item))
    )
      return `${key} excludes everyone`
    if (name === 'excludeusers' && entry === '*') return 'excludeUsers excludes everyone'
    if (name === 'policies' && Array.isArray(entry) && entry.length === 0) return 'the policy list is empty'
    if (name === 'builtincontrols' && Array.isArray(entry) && entry.length === 0 && 'operator' in record)
      return 'no grant controls are required'
    const nested = weakensMfa(entry, depth + 1)
    if (nested) return nested
  }
  return null
}

/** Admin plane checks of the `iam-pam` pack (V0.2.9). Reads paths, methods and policy shapes only. */
export function checkAdminPlane(parsed: ParsedCollection, profile: IdentityProfile, out: FindingSink): void {
  const requestsById = new Map(parsed.requests.map((request) => [request.id, request]))
  let mintingWithExample = false
  let mintingHits = 0

  for (const endpoint of profile.endpoints) {
    const request = requestsById.get(endpoint.requestId)
    if (!request) continue
    const route = `${request.method} ${endpoint.path}`
    const changes = request.method !== 'GET' && request.method !== 'HEAD'

    if (endpoint.class === 'admin.role-assignment' && changes) {
      const role = topTierRole(request, endpoint.platform)
      if (role) out.add('PRIVILEGED_ROLE_ASSIGNMENT', request.id, { location: route, preview: role })
    }

    if (endpoint.class === 'admin.policy' && changes) {
      const body = readJson(request)
      // Auth0 stores the enabled MFA policies as a list; an empty list means MFA is never asked for.
      const reason =
        Array.isArray(body) && body.length === 0 && /\/guardian\/policies$/i.test(endpoint.path)
          ? 'the MFA policy list is empty'
          : weakensMfa(body)
      if (reason) out.add('MFA_POLICY_WEAKENING', request.id, { location: route, preview: reason })
    }

    if (endpoint.class === 'admin.credential-mint') {
      mintingHits += 1
      const saved = (request.savedResponses ?? []).some((response) => !!response.body?.trim())
      mintingWithExample ||= saved
      out.add('CREDENTIAL_MINTING_ENDPOINT', request.id, {
        location: route,
        preview: saved ? 'creates a credential, response saved in an example' : 'creates a credential',
      })
    }
  }
  if (mintingHits > 0) out.setSeverity('CREDENTIAL_MINTING_ENDPOINT', mintingWithExample ? 'warning' : 'info')
}
