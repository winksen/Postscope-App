import type { Finding } from '../auditor'
import type { ParsedCollection } from '../parser'
import { getItemAtPath, type PatchResult, type RepairFix, type RepairTarget } from '../repairEngine'
import { findJwts } from './jwt'
import { describeSamlAssertion } from './saml'
import { splitUrl } from './url'
import { PLATFORM_PROFILES } from './platforms'
import { SECRET_LEAF_KEYS } from './pam'

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

const REDACTED = '{{REDACTED}}'

/** Rules whose finding is fixed by removing a captured credential from saved examples. */
export const CAPTURED_RULES: Record<string, 'jwt' | 'saml' | 'secret'> = {
  SAML_ASSERTION_CAPTURED: 'saml',
  PAM_RETRIEVED_SECRET_CAPTURED: 'secret',
  JWT_ALG_NONE: 'jwt',
  JWT_LONG_LIVED: 'jwt',
  JWT_SENSITIVE_CLAIMS: 'jwt',
  JWT_EXPIRED_STORED: 'jwt',
  ID_TOKEN_AS_BEARER: 'jwt',
}

/** Manual migration advice for the rules that cannot be repaired safely without knowing the application. */
export const IDENTITY_GUIDANCE: Record<string, { title: string; reason: string }> = {
  OAUTH_IMPLICIT_GRANT: {
    title: 'Move from the implicit grant to the authorization code flow with PKCE',
    reason:
      'Change response_type=token to response_type=code, add code_challenge with code_challenge_method=S256 to the authorize request and code_verifier to the token request, and register the client as a public client with PKCE. The application that receives the redirect has to change as well.',
  },
  OAUTH_PASSWORD_GRANT: {
    title: 'Replace the password grant',
    reason:
      'For a signed-in user, use the authorization code flow with PKCE so the application never sees the password. For a service, use client credentials with a certificate or private_key_jwt. Both need a client registration on the identity platform.',
  },
  OAUTH_BROAD_SCOPE: {
    title: 'Reduce OAuth scopes to least privilege',
    reason:
      'Replace wildcard and administrative scopes with the narrowest scopes each request needs, and use separate clients for administration and for ordinary calls. Check the API documentation for the scope each endpoint accepts.',
  },
  OAUTH_PKCE_MISSING: {
    title: 'Add PKCE to the authorization code flow',
    reason:
      'No OAuth 2.0 helper was found to upgrade. Add code_challenge and code_challenge_method=S256 to the authorize request, and the matching code_verifier to the token request.',
  },
  OAUTH_PKCE_PLAIN: {
    title: 'Use the S256 PKCE method',
    reason:
      'Set code_challenge_method=S256 on the authorize request and derive the challenge as the base64url SHA-256 hash of the verifier.',
  },
}

function targetItem(collection: unknown, target: RepairTarget) {
  return getItemAtPath(collection, target.itemPath)
}

function oauthBlock(auth: unknown): UnknownRecord[] | null {
  if (!isRecord(auth) || String(auth.type ?? '').toLowerCase() !== 'oauth2') return null
  return Array.isArray(auth.oauth2) ? (auth.oauth2 as UnknownRecord[]) : null
}

/** The OAuth 2.0 helpers of the collection with their real entry arrays, so a repair can add entries. */
function oauthHelpers(collection: unknown): Array<{ entries: UnknownRecord[] }> {
  const found: Array<{ entries: UnknownRecord[] }> = []
  const visit = (auth: unknown) => {
    const entries = oauthBlock(auth)
    if (entries) found.push({ entries })
  }
  const walk = (items: unknown, depth = 0) => {
    if (!Array.isArray(items) || depth > 100) return
    for (const item of items) {
      if (!isRecord(item)) continue
      visit(item.auth)
      if (isRecord(item.request)) visit(item.request.auth)
      walk(item.item, depth + 1)
    }
  }
  if (isRecord(collection)) {
    visit(collection.auth)
    walk(collection.item)
  }
  return found
}

function entryOf(entries: UnknownRecord[], key: string): UnknownRecord | undefined {
  return entries.find((entry) => isRecord(entry) && String(entry.key ?? '').toLowerCase() === key.toLowerCase())
}

/** True when the collection has an OAuth 2.0 helper that the PKCE repair can upgrade. */
export function hasUpgradableOauthHelper(collection: unknown): boolean {
  return oauthHelpers(collection).some(({ entries }) => {
    const grant = String(entryOf(entries, 'grant_type')?.value ?? '')
    const method = String(entryOf(entries, 'challengeAlgorithm')?.value ?? '')
    return grant === 'authorization_code' || (grant === 'authorization_code_with_pkce' && method.toLowerCase() === 'plain')
  })
}

/** OAuth 2.0 helpers on the authorization code grant use PKCE with S256, and `plain` becomes S256. */
export function patchOauthPkce(collection: unknown): PatchResult {
  let changed = 0
  for (const { entries } of oauthHelpers(collection)) {
    const grant = entryOf(entries, 'grant_type')
    const grantValue = String(grant?.value ?? '')
    const method = entryOf(entries, 'challengeAlgorithm')
    if (grantValue === 'authorization_code' && grant) {
      grant.value = 'authorization_code_with_pkce'
      if (method) method.value = 'S256'
      else entries.push({ key: 'challengeAlgorithm', value: 'S256', type: 'string' })
      changed += 1
    } else if (grantValue === 'authorization_code_with_pkce' && method && String(method.value).toLowerCase() === 'plain') {
      method.value = 'S256'
      changed += 1
    }
  }
  return { changed, skipped: [], variables: [] }
}

/** Adds `state={{$randomUUID}}` to the authorize requests of the fix. */
export function patchOauthState(collection: unknown, fix: RepairFix): PatchResult {
  let changed = 0
  const skipped: PatchResult['skipped'] = []
  for (const target of fix.affectedRequests) {
    const request = targetItem(collection, target)?.request
    if (!request?.url) {
      skipped.push({ fixId: fix.id, title: fix.title, requestId: target.requestId, reason: 'Request URL was not found.' })
      continue
    }
    const raw = typeof request.url === 'string' ? request.url : (request.url.raw ?? '')
    if (/[?&]state=/i.test(raw)) continue
    const hash = raw.indexOf('#')
    const base = hash === -1 ? raw : raw.slice(0, hash)
    const next = `${base}${base.includes('?') ? '&' : '?'}state={{$randomUUID}}${hash === -1 ? '' : raw.slice(hash)}`
    if (typeof request.url === 'string') request.url = next
    else {
      request.url.raw = next
      if (Array.isArray(request.url.query)) request.url.query.push({ key: 'state', value: '{{$randomUUID}}' })
    }
    changed += 1
  }
  return { changed, skipped, variables: [] }
}

export interface TenantReplacement {
  value: string
  variable: string
}

/** The literal tenant identifiers the requests of a finding share, with the variable that should replace them. */
export function tenantReplacementsFor(finding: Finding, parsed: ParsedCollection): TenantReplacement[] {
  const requests = new Map(parsed.requests.map((request) => [request.id, request]))
  const replacements = new Map<string, TenantReplacement>()
  for (const id of finding.affected) {
    const request = requests.get(id)
    if (!request) continue
    const url = splitUrl(request.url, parsed)
    for (const profile of PLATFORM_PROFILES) {
      for (const identifier of profile.tenantIdentifiers(url)) {
        if (request.url.includes(identifier.value))
          replacements.set(identifier.value, { value: identifier.value, variable: identifier.variable })
      }
    }
  }
  return [...replacements.values()]
}

/** Replaces literal tenant identifiers in the URLs of the fix with variables. The variables are added by the plan. */
export function patchTenantIdentifiers(collection: unknown, fix: RepairFix): PatchResult {
  let changed = 0
  const skipped: PatchResult['skipped'] = []
  const replace = (text: string) =>
    (fix.tenantReplacements ?? []).reduce((result, entry) => result.split(entry.value).join(`{{${entry.variable}}}`), text)
  for (const target of fix.affectedRequests) {
    const request = targetItem(collection, target)?.request
    if (!request?.url) {
      skipped.push({ fixId: fix.id, title: fix.title, requestId: target.requestId, reason: 'Request URL was not found.' })
      continue
    }
    if (typeof request.url === 'string') {
      const next = replace(request.url)
      if (next !== request.url) {
        request.url = next
        changed += 1
      }
      continue
    }
    const url = request.url
    let touched = false
    if (typeof url.raw === 'string') {
      const next = replace(url.raw)
      touched ||= next !== url.raw
      url.raw = next
    }
    if (Array.isArray(url.host)) {
      const joined = url.host.join('.')
      const next = replace(joined)
      if (next !== joined) {
        url.host = [next]
        touched = true
      }
    }
    if (Array.isArray(url.path))
      url.path = url.path.map((segment) => {
        if (typeof segment !== 'string') return segment
        const next = replace(segment)
        touched ||= next !== segment
        return next
      })
    if (touched) changed += 1
  }
  return { changed, skipped, variables: [] }
}

function redactSecretLeaves(value: unknown, key = '', depth = 0): { value: unknown; count: number } {
  if (depth > 8) return { value, count: 0 }
  if (typeof value === 'string') {
    const isSecret = depth === 0 || SECRET_LEAF_KEYS.test(key)
    return isSecret && value.trim().length >= 4 && !value.includes('{{') ? { value: REDACTED, count: 1 } : { value, count: 0 }
  }
  if (Array.isArray(value)) {
    let count = 0
    const next = value.map((entry) => {
      const result = redactSecretLeaves(entry, key, depth + 1)
      count += result.count
      return result.value
    })
    return { value: next, count }
  }
  if (isRecord(value)) {
    let count = 0
    const next: UnknownRecord = {}
    for (const [childKey, entry] of Object.entries(value)) {
      const result = redactSecretLeaves(entry, childKey, depth + 1)
      count += result.count
      next[childKey] = result.value
    }
    return { value: next, count }
  }
  return { value, count: 0 }
}

/** Removes the kinds of captured credential from a saved example text. Returns the new text and how many values were replaced. */
export function scrubCapturedText(text: string, kinds: ReadonlySet<'jwt' | 'saml' | 'secret'>): { text: string; count: number } {
  let next = text
  let count = 0
  if (kinds.has('jwt'))
    for (const token of findJwts(next)) {
      next = next.split(token).join(REDACTED)
      count += 1
    }
  if (kinds.has('saml'))
    next = next.replace(
      /(SAMLResponse["']?\s*[=:]\s*["']?|SAMLResponse["'][^>]{0,80}?value\s*=\s*["'])([A-Za-z0-9+/=%_-]{80,})/gi,
      (match, prefix: string, value: string) => {
        if (!describeSamlAssertion(value)) return match
        count += 1
        return `${prefix}${REDACTED}`
      }
    )
  if (kinds.has('secret')) {
    const trimmed = next.trim()
    if (trimmed[0] === '{' || trimmed[0] === '[' || trimmed[0] === '"') {
      try {
        const result = redactSecretLeaves(JSON.parse(trimmed))
        if (result.count) {
          next = JSON.stringify(result.value)
          count += result.count
        }
      } catch {
        /* not JSON: leave it */
      }
    } else if (trimmed && !trimmed.startsWith('<') && !/\s/.test(trimmed) && trimmed.length <= 512 && !trimmed.includes('{{')) {
      next = REDACTED
      count += 1
    }
  }
  return { text: next, count }
}

/** Scrubs captured tokens, assertions and retrieved secrets from the saved examples of the requests of the fix. */
export function patchCapturedSecrets(collection: unknown, fix: RepairFix): PatchResult {
  const kinds = new Set(fix.capturedKinds ?? [])
  let changed = 0
  const skipped: PatchResult['skipped'] = []
  for (const target of fix.affectedRequests) {
    const item = targetItem(collection, target)
    if (!item) {
      skipped.push({ fixId: fix.id, title: fix.title, requestId: target.requestId, reason: 'Request item was not found.' })
      continue
    }
    for (const response of Array.isArray(item.response) ? item.response : []) {
      if (!isRecord(response)) continue
      if (typeof response.body === 'string' && response.body) {
        const result = scrubCapturedText(response.body, kinds)
        if (result.count) {
          response.body = result.text
          changed += result.count
        }
      }
      const original = isRecord(response.originalRequest) ? response.originalRequest : undefined
      const headerLists = [response.header, original?.header]
      for (const list of headerLists)
        for (const header of Array.isArray(list) ? list : []) {
          if (!isRecord(header) || typeof header.value !== 'string') continue
          const result = scrubCapturedText(header.value, new Set(kinds.has('jwt') ? ['jwt'] : []))
          if (result.count) {
            header.value = result.text
            changed += result.count
          }
        }
      if (original && isRecord(original.body) && typeof original.body.raw === 'string') {
        const result = scrubCapturedText(original.body.raw, new Set([...kinds].filter((kind) => kind !== 'secret')))
        if (result.count) {
          original.body.raw = result.text
          changed += result.count
        }
      }
    }
  }
  return { changed, skipped, variables: [] }
}
