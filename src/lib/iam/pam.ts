import type { ParsedCollection, ParsedRequest } from '../parser'
import { parseTemplatedJson } from '../jsonBody'
import { evidencePreview, isLikelySecretValue } from '../secretPatterns'
import { hasVariableReference } from '../variables'
import { PLATFORM_FINGERPRINTS, fingerprintRequest } from './fingerprints'
import type { FindingSink } from './sink'
import type { IdentityEndpoint, IdentityProfile, PlatformId } from './types'
import { requestParams, splitUrl } from './url'

const RETRIEVAL_CLASSES = new Set(['pam.retrieve', 'vault.read'])
const ACCESS_CLASSES = new Set(['pam.retrieve', 'pam.checkout'])

/** Keys that hold the secret in the responses of PAM and vault retrieval endpoints. */
export const SECRET_LEAF_KEYS =
  /^(?:content|password|passphrase|secret|secretstring|secretbinary|value|privatekey|apikey|api_key|credential|credentials|key|token|data)$/i
const REASON_KEYS =
  /^(?:reason|comment|comments|justification|business_?justification|ticket(?:_?id|_?number|_?no)?|ticketing_?system_?(?:name|id)|ticket_?system_?(?:name|id))$/i

const PRIVILEGED_ACCOUNT = /^(?:administrator|admin|root|sa|krbtgt|sysadmin|superuser|domain\\admin|enterprise\\admin)$/i
const BREAK_GLASS = /break[-_. ]?glass|fire[-_. ]?call|emergency[-_. ]?(?:admin|access|user)|\bbg[-_.]?admin\b/i
const USERNAME_KEYS = /^(?:username|user_?name|user|login|login_?name|account|account_?name|principal|x-openam-username)$/i

const ROOT_TOKEN_VALUES = /^(?:root|myroot|dev-?root|dev-?only-?token|root-?token|vault-?root)$/i
const ROOT_TOKEN_SHAPED = /\broot\b.*token|token.*\broot\b/i

const platformNames = new Map<string, string>(PLATFORM_FINGERPRINTS.map((fingerprint) => [fingerprint.id, fingerprint.name]))

function bodyJson(request: ParsedRequest): unknown {
  const raw = request.bodyRaw
  if (!raw || raw.length > 1_000_000) return null
  return parseTemplatedJson(raw)?.value ?? null
}

/** Leaf strings under secret-like keys, or the string itself for a body that is only a quoted value. */
function secretLeaves(value: unknown, key = '', depth = 0, found: string[] = []): string[] {
  if (depth > 8 || found.length >= 5) return found
  if (typeof value === 'string') {
    if (isLikelySecretValue(value) && value.trim().length >= 4 && (depth === 0 || SECRET_LEAF_KEYS.test(key))) found.push(value)
    return found
  }
  if (Array.isArray(value)) {
    for (const entry of value.slice(0, 20)) secretLeaves(entry, key, depth + 1, found)
    return found
  }
  if (value && typeof value === 'object') {
    for (const [childKey, entry] of Object.entries(value as Record<string, unknown>)) secretLeaves(entry, childKey, depth + 1, found)
  }
  return found
}

/** The secret a retrieval response carries, or null. CyberArk and Delinea return the bare value as a JSON string or plain text. */
function retrievedSecret(body: string | undefined, endpoint: IdentityEndpoint): string | null {
  const text = body?.trim()
  if (!text) return null
  if (text[0] === '{' || text[0] === '[' || text[0] === '"') {
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      return null
    }
    return secretLeaves(value)[0] ?? null
  }
  if (
    endpoint.class === 'pam.retrieve' &&
    !text.startsWith('<') &&
    text.length >= 4 &&
    text.length <= 512 &&
    isLikelySecretValue(text) &&
    !/\s/.test(text)
  )
    return text
  return null
}

function hasReasonKey(value: unknown, depth = 0): boolean {
  if (depth > 6 || !value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.slice(0, 50).some((entry) => hasReasonKey(entry, depth + 1))
  return Object.entries(value as Record<string, unknown>).some(([key, entry]) => {
    if (REASON_KEYS.test(key)) return typeof entry === 'string' ? entry.trim() !== '' : entry !== null && entry !== undefined
    return hasReasonKey(entry, depth + 1)
  })
}

function privilegedAccountKind(value: string): string | null {
  const text = value.trim()
  if (!text || hasVariableReference(text)) return null
  if (BREAK_GLASS.test(text)) return 'break-glass account name'
  if (PRIVILEGED_ACCOUNT.test(text)) return 'built-in privileged account name'
  return null
}

/** True when a body grants everything: many permissions switched on, safe management rights, `sudo`, or a wildcard path. */
export function grantsFullPermissions(rawBody: string, value: unknown): boolean {
  // A policy sits inside a JSON string, so its quotes arrive escaped.
  const raw = rawBody.replace(/\\"/g, '"')
  if (/capabilities\s*[=:]\s*\[[^\]]*\bsudo\b/i.test(raw)) return true
  if (/path\s*["']\*["']/i.test(raw) && /capabilities/i.test(raw)) return true
  const walk = (node: unknown, depth = 0): boolean => {
    if (depth > 6 || !node || typeof node !== 'object') return false
    if (Array.isArray(node)) return node.slice(0, 50).some((entry) => walk(entry, depth + 1))
    const record = node as Record<string, unknown>
    const enabled = Object.values(record).filter((entry) => entry === true).length
    const keys = Object.keys(record).map((key) => key.toLowerCase())
    if (enabled >= 10) return true
    if (record.manageSafe === true && record.manageSafeMembers === true) return true
    if (
      keys.includes('permission') &&
      typeof record.permission === 'string' &&
      /^(?:owner|full|fullcontrol|admin)$/i.test(record.permission)
    )
      return true
    return Object.values(record).some((entry) => walk(entry, depth + 1))
  }
  return walk(value)
}

/** Platform of one request, or undefined. Only the checks that need it call this, so the cost stays small. */
function platformOf(request: ParsedRequest, parsed: ParsedCollection): PlatformId | undefined {
  return fingerprintRequest(request, splitUrl(request.url, parsed))[0]?.id
}

/** PAM and secrets vault checks of the `iam-pam` pack (V0.2.8). Secrets are never copied: previews are masked and bodies are only read. */
export function checkPam(parsed: ParsedCollection, profile: IdentityProfile, out: FindingSink): void {
  const requestsById = new Map(parsed.requests.map((request) => [request.id, request]))
  const checkouts = new Map<string, string[]>()
  const checkins = new Set<string>()
  let checkinAnywhere = false
  let fullPermissions = false
  let safeChanges = 0

  for (const endpoint of profile.endpoints) {
    const request = requestsById.get(endpoint.requestId)
    if (!request) continue
    const route = `${request.method} ${endpoint.path}`

    if (RETRIEVAL_CLASSES.has(endpoint.class)) {
      for (const response of request.savedResponses ?? []) {
        const secret = retrievedSecret(response.body, endpoint)
        if (secret)
          out.add('PAM_RETRIEVED_SECRET_CAPTURED', request.id, {
            location: `saved response "${response.name}" body`,
            preview: evidencePreview(secret),
          })
      }
    }

    if (ACCESS_CLASSES.has(endpoint.class)) {
      // BeyondTrust carries the reason on the request that opens access, not on the retrieval that follows it.
      const reasonOnCheckout = endpoint.platform === 'beyondtrust' && endpoint.class === 'pam.retrieve'
      if (!reasonOnCheckout) {
        const params = requestParams(request)
        const body = bodyJson(request)
        const given = [...params.keys()].some((key) => REASON_KEYS.test(key)) || hasReasonKey(body)
        if (!given) out.add('PAM_RETRIEVAL_WITHOUT_REASON', request.id, { location: route, preview: 'no reason, comment or ticket field' })
      }
    }

    if (endpoint.class === 'pam.checkout')
      checkouts.set(endpoint.platform ?? '', [...(checkouts.get(endpoint.platform ?? '') ?? []), request.id])
    if (endpoint.class === 'pam.checkin') {
      if (endpoint.platform) checkins.add(endpoint.platform)
      else checkinAnywhere = true
    }

    const safeAdmin = endpoint.class === 'pam.admin' || (endpoint.class === 'admin.policy' && /\/sys\/polic/i.test(endpoint.path))
    if (safeAdmin && request.method !== 'GET' && request.method !== 'HEAD') {
      const raw = request.bodyRaw ?? ''
      const full = grantsFullPermissions(raw, bodyJson(request))
      fullPermissions ||= full
      safeChanges += 1
      out.add('PAM_SAFE_ADMIN_CHANGE', request.id, {
        location: route,
        preview: full ? 'grants full permissions' : 'changes safe, policy or permissions',
      })
    }

    if (endpoint.class === 'pam.admin' && /\/sys\/generate-root\b/i.test(endpoint.path))
      out.add('PAM_ROOT_TOKEN_USAGE', request.id, { location: route, preview: 'generates a Vault root token' })
  }
  if (safeChanges > 0) out.setSeverity('PAM_SAFE_ADMIN_CHANGE', fullPermissions ? 'warning' : 'info')

  if (!checkinAnywhere) {
    for (const [platform, ids] of checkouts) {
      if (platform && checkins.has(platform)) continue
      if (!platform && checkins.size > 0) continue
      const name = platform ? (platformNames.get(platform) ?? platform) : 'the vault'
      out.add('PAM_CHECKOUT_WITHOUT_CHECKIN', undefined, {
        location: `checkout requests for ${name}`,
        preview: `${ids.length} checkout request${ids.length === 1 ? '' : 's'}, no check-in or release`,
      })
    }
  }

  for (const token of profile.tokens) {
    if (token.kind === 'vault-token' || token.kind === 'ps-auth')
      out.add('PAM_VAULT_TOKEN_LITERAL', token.requestId, { location: token.location, preview: token.preview })
  }

  for (const request of parsed.requests) {
    const header = (name: string) => request.headers.find((entry) => entry.key.trim().toLowerCase() === name)?.value.trim()
    const vault = header('x-vault-token')
    if (vault && !hasVariableReference(vault) && (ROOT_TOKEN_VALUES.test(vault) || ROOT_TOKEN_SHAPED.test(vault)))
      out.add('PAM_ROOT_TOKEN_USAGE', request.id, { location: 'header X-Vault-Token', preview: 'root token value' })

    const authorization = header('authorization')
    if (authorization && !hasVariableReference(authorization) && !/^basic\s/i.test(authorization)) {
      const platform = platformOf(request, parsed)
      const token = authorization.replace(/^bearer\s+/i, '')
      if ((platform === 'cyberark' || platform === 'delinea') && token.length >= 16 && !/\s/.test(token))
        out.add('PAM_VAULT_TOKEN_LITERAL', request.id, { location: 'header Authorization', preview: evidencePreview(token) })
    }

    const basic = request.basicAuth
    if (basic?.username) {
      const kind = privilegedAccountKind(basic.username)
      if (kind) out.add('PAM_PRIVILEGED_ACCOUNT_LITERAL', request.id, { location: 'basic auth username', preview: kind })
    }
    for (const field of request.bodyFields ?? []) {
      const kind = USERNAME_KEYS.test(field.key.trim()) ? privilegedAccountKind(field.value) : null
      if (kind) out.add('PAM_PRIVILEGED_ACCOUNT_LITERAL', request.id, { location: `body field ${field.key.trim()}`, preview: kind })
    }
    const json = bodyJson(request)
    if (json && typeof json === 'object' && !Array.isArray(json)) {
      for (const [key, value] of Object.entries(json as Record<string, unknown>)) {
        const kind = USERNAME_KEYS.test(key) && typeof value === 'string' ? privilegedAccountKind(value) : null
        if (kind) out.add('PAM_PRIVILEGED_ACCOUNT_LITERAL', request.id, { location: `body ${key}`, preview: kind })
      }
    }
    for (const entry of request.headers) {
      const kind = /^x-openam-username$/i.test(entry.key.trim()) ? privilegedAccountKind(entry.value) : null
      if (kind) out.add('PAM_PRIVILEGED_ACCOUNT_LITERAL', request.id, { location: `header ${entry.key.trim()}`, preview: kind })
    }
  }
}
