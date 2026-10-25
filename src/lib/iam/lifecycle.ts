import type { ParsedCollection, ParsedRequest } from '../parser'
import { parseTemplatedJson } from '../jsonBody'
import type { FindingSink } from './sink'
import type { EndpointClass, IdentityProfile, LifecycleAction, LifecycleEntry, LifecycleRow, LifecycleStage, PlatformId } from './types'

interface LifecycleContext {
  method: string
  /** Normalized path (variables and `:params` replaced by `*`). */
  path: string
  endpointClass: EndpointClass
  platform?: PlatformId
}

interface Classification {
  stage: LifecycleStage
  action: LifecycleAction
}

const DISABLED_STATES = new Set(['suspended', 'deprovisioned', 'inactive', 'disabled', 'locked'])

/** True when a JSON body switches an account off: `active: false`, `accountEnabled: false`, `enabled: false`, `blocked: true` or a disabled status. */
export function bodyDisablesAccount(body: unknown, depth = 0): boolean {
  if (depth > 4 || !body || typeof body !== 'object') return false
  if (Array.isArray(body)) return body.some((entry) => bodyDisablesAccount(entry, depth + 1))
  const record = body as Record<string, unknown>
  if (record.active === false || record.accountEnabled === false || record.enabled === false || record.blocked === true) return true
  if (typeof record.status === 'string' && DISABLED_STATES.has(record.status.toLowerCase())) return true
  // SCIM PatchOp: { op: 'replace', path: 'active', value: false }
  if (
    typeof record.path === 'string' &&
    /^(?:active|accountEnabled|enabled)$/i.test(record.path.split(':').pop() ?? '') &&
    record.value === false
  )
    return true
  return Object.values(record).some((value) => value && typeof value === 'object' && bodyDisablesAccount(value, depth + 1))
}

function readBody(request: ParsedRequest): unknown {
  const raw = request.bodyRaw
  if (!raw || raw.length > 1_000_000) return null
  return parseTemplatedJson(raw)?.value ?? null
}

const USERS_COLLECTION = /\/users$/i
const USER_ITEM = /\/users\/\*$/i
const GROUP_MEMBERSHIP = /\/groups\/\*\/(?:users|members)(?:\/\*)?(?:\/\$ref)?$|\/users\/\*\/groups(?:\/\*)?$/i
const SCIM_GROUP_ITEM = /\/scim(?:\/v[12])?\/groups\/\*$/i

/**
 * Classifies a request as a joiner, mover or leaver action. Requests only count when an identity platform or SCIM
 * endpoint is involved, so `DELETE /users/{id}` of an ordinary application API is not an identity lifecycle step.
 */
export function classifyLifecycle(context: LifecycleContext, request: ParsedRequest): Classification | null {
  const { method, path, endpointClass, platform } = context
  const identity = !!platform || endpointClass.startsWith('scim.')
  if (endpointClass === 'session.terminate' || endpointClass === 'oauth.revoke' || endpointClass === 'oidc.logout')
    return { stage: 'leaver', action: 'revoke' }
  if (!identity) return null

  if (/\/api\/v1\/users\/\*\/lifecycle\/clear_sessions$/i.test(path)) return { stage: 'leaver', action: 'revoke' }
  if (/\/api\/v1\/users\/\*\/lifecycle\/(?:deactivate|suspend)$/i.test(path)) return { stage: 'leaver', action: 'disable' }
  if (/\/ecm\/api\/v5\/(?:disable|deactivate|suspend)user/i.test(path)) return { stage: 'leaver', action: 'disable' }

  if (endpointClass === 'admin.role-assignment') {
    if (method === 'DELETE') return { stage: 'leaver', action: 'remove-access' }
    return { stage: 'mover', action: 'role-change' }
  }

  if (GROUP_MEMBERSHIP.test(path) || (endpointClass === 'scim.groups' && SCIM_GROUP_ITEM.test(path))) {
    if (method === 'DELETE') return { stage: 'leaver', action: 'remove-access' }
    if (method === 'GET') return null
    return { stage: 'mover', action: 'group-change' }
  }

  if (USER_ITEM.test(path) || (endpointClass === 'scim.users' && /\/users\/\*$/i.test(path))) {
    if (method === 'DELETE') return { stage: 'leaver', action: 'delete' }
    if (method === 'PATCH' || method === 'PUT' || method === 'POST')
      return bodyDisablesAccount(readBody(request))
        ? { stage: 'leaver', action: 'disable' }
        : { stage: 'mover', action: 'attribute-update' }
    return null
  }

  if (method === 'POST' && (USERS_COLLECTION.test(path) || /\/ecm\/api\/v5\/createuser$/i.test(path)))
    return { stage: 'joiner', action: 'create' }
  if (method === 'POST' && /\/ecm\/api\/v5\/updateuser$/i.test(path)) return { stage: 'mover', action: 'attribute-update' }
  return null
}

const UNSPECIFIED = 'unspecified'

/** Counts lifecycle requests per platform. This is the map the Identity page and the reports show. */
export function buildLifecycleMatrix(entries: readonly LifecycleEntry[]): LifecycleRow[] {
  const rows = new Map<string, LifecycleRow>()
  for (const entry of entries) {
    const key = entry.platform ?? UNSPECIFIED
    const row = rows.get(key) ?? {
      platform: key as LifecycleRow['platform'],
      joiner: 0,
      mover: 0,
      disable: 0,
      removeAccess: 0,
      revoke: 0,
      delete: 0,
    }
    if (entry.stage === 'joiner') row.joiner += 1
    else if (entry.stage === 'mover') row.mover += 1
    else if (entry.action === 'disable') row.disable += 1
    else if (entry.action === 'remove-access') row.removeAccess += 1
    else if (entry.action === 'revoke') row.revoke += 1
    else if (entry.action === 'delete') row.delete += 1
    rows.set(key, row)
  }
  return [...rows.values()].sort(
    (a, b) => (a.platform === UNSPECIFIED ? 1 : 0) - (b.platform === UNSPECIFIED ? 1 : 0) || a.platform.localeCompare(b.platform)
  )
}

/** A request without a detected platform could belong to any platform, so it counts for all of them. */
function covers(entry: LifecycleEntry, platform: string, action: LifecycleAction): boolean {
  return entry.action === action && (!entry.platform || entry.platform === platform || platform === UNSPECIFIED)
}

function samePhase(a: ParsedRequest, b: ParsedRequest): boolean {
  const left = a.folderPath
  const right = b.folderPath
  return left.join('/') === right.join('/') || left.slice(0, -1).join('/') === right.slice(0, -1).join('/')
}

/** Joiner, mover and leaver checks of the `iam-iga` pack (V0.2.6). */
export function checkLifecycle(parsed: ParsedCollection, profile: IdentityProfile, out: FindingSink): void {
  const entries = profile.lifecycle
  if (!entries.length) return
  const requests = new Map(parsed.requests.map((request, index) => [request.id, { request, index }]))

  for (const row of buildLifecycleMatrix(entries)) {
    const platform = row.platform
    const hasDisable = entries.some((entry) => covers(entry, platform, 'disable'))
    if (row.joiner > 0 && !hasDisable) {
      const name = platform === UNSPECIFIED ? 'the provisioning target' : platform
      out.add('JML_LEAVER_NOT_COVERED', undefined, {
        location: `joiner requests for ${name}`,
        preview: `${row.joiner} joiner request${row.joiner === 1 ? '' : 's'}, no disable, deactivate or suspend`,
      })
    }
  }

  for (const entry of entries) {
    const found = requests.get(entry.requestId)
    if (!found) continue
    const route = `${found.request.method} ${found.request.url.split('?')[0]}`
    const platform = entry.platform ?? UNSPECIFIED

    if (entry.action === 'delete') {
      const disabledBefore = entries.some((other) => {
        if (!covers(other, platform, 'disable')) return false
        const earlier = requests.get(other.requestId)
        return !!earlier && earlier.index < found.index && samePhase(earlier.request, found.request)
      })
      if (!disabledBefore)
        out.add('LEAVER_DELETE_WITHOUT_DISABLE', entry.requestId, {
          location: route,
          preview: 'no disable or suspend earlier in the folder',
        })
    }

    if (entry.action === 'disable' && !entries.some((other) => covers(other, platform, 'revoke')))
      out.add('LEAVER_SESSION_NOT_REVOKED', entry.requestId, {
        location: route,
        preview: 'no session or token revocation for this platform',
      })
  }
}
