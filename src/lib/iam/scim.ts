import type { ParsedCollection, ParsedRequest } from '../parser'
import { parseTemplatedJson } from '../jsonBody'
import { hasVariableReference } from '../variables'
import type { FindingSink } from './sink'
import type { EndpointClass, IdentityProfile, IdentityEndpoint, ScimTarget } from './types'
import { requestParams, splitUrl, type SplitUrl } from './url'

const SCIM_CLASSES: EndpointClass[] = ['scim.users', 'scim.groups', 'scim.bulk', 'scim.schemas']

const URN = {
  user: 'urn:ietf:params:scim:schemas:core:2.0:user',
  group: 'urn:ietf:params:scim:schemas:core:2.0:group',
  patch: 'urn:ietf:params:scim:api:messages:2.0:patchop',
  bulk: 'urn:ietf:params:scim:api:messages:2.0:bulkrequest',
}

/** Bulk requests with at least this many operations should say what happens when one fails. */
const LARGE_BULK_OPERATIONS = 20

/** Attributes whose change alters who can do what, or whether an account works. */
const PRIVILEGE_ATTRIBUTES = new Set(['roles', 'entitlements', 'groups', 'members', 'active'])
const ADMIN_VALUE = /\b(?:admins?|administrators?|owners?|root|superusers?|super[-_ ]?admins?|privileged)\b/i

export function isScimEndpoint(endpointClass: EndpointClass): boolean {
  return SCIM_CLASSES.includes(endpointClass)
}

function resourceOf(endpointClass: EndpointClass): string {
  return endpointClass === 'scim.users'
    ? 'Users'
    : endpointClass === 'scim.groups'
      ? 'Groups'
      : endpointClass === 'scim.bulk'
        ? 'Bulk'
        : 'Schemas'
}

/** Adds one SCIM request to the per-target inventory. */
export function addToScimInventory(targets: Map<string, ScimTarget>, endpoint: IdentityEndpoint, url: SplitUrl): void {
  if (!isScimEndpoint(endpoint.class)) return
  const key = url.host ?? (url.hostVariable ? `{{${url.hostVariable}}}` : 'unspecified host')
  const target = targets.get(key) ?? { target: key, platform: endpoint.platform, resources: [], operations: {}, requestIds: [] }
  const resource = resourceOf(endpoint.class)
  if (!target.resources.includes(resource)) target.resources.push(resource)
  target.operations[endpoint.method] = (target.operations[endpoint.method] ?? 0) + 1
  if (target.requestIds.length < 100) target.requestIds.push(endpoint.requestId)
  target.platform ??= endpoint.platform
  targets.set(key, target)
}

function readJsonBody(request: ParsedRequest): Record<string, unknown> | null {
  const raw = request.bodyRaw
  if (!raw || raw.length > 1_000_000) return null
  const value = parseTemplatedJson(raw)?.value
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function schemasOf(body: Record<string, unknown>): string[] {
  return Array.isArray(body.schemas)
    ? body.schemas.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.toLowerCase())
    : []
}

function operationsOf(body: Record<string, unknown>): Array<Record<string, unknown>> {
  const list = body.Operations ?? body.operations
  return Array.isArray(list)
    ? list.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object' && !Array.isArray(entry))
    : []
}

/** `members[value eq "x"]` and `urn:...:User:roles` both name the attribute `members` or `roles`. */
function attributeOf(path: unknown): string {
  if (typeof path !== 'string') return ''
  const withoutFilter = path.replace(/\[[^\]]*\]/g, '')
  const last = withoutFilter.split(/[.:]/).filter(Boolean).pop() ?? ''
  return last.toLowerCase()
}

function touchedAttributes(operation: Record<string, unknown>): string[] {
  const path = attributeOf(operation.path)
  if (path) return PRIVILEGE_ATTRIBUTES.has(path) ? [path] : []
  const value = operation.value
  if (value && typeof value === 'object' && !Array.isArray(value))
    return Object.keys(value)
      .map((key) => key.toLowerCase())
      .filter((key) => PRIVILEGE_ATTRIBUTES.has(key))
  return []
}

function isLiteralAdmin(operation: Record<string, unknown>): boolean {
  if (typeof operation.op === 'string' && operation.op.toLowerCase() === 'remove') return false
  const text = JSON.stringify(operation.value ?? '')
  return !hasVariableReference(text) && ADMIN_VALUE.test(text)
}

function contentType(request: ParsedRequest): string | undefined {
  return request.headers.find((header) => header.key.trim().toLowerCase() === 'content-type')?.value
}

/** SCIM provisioning checks of the `iam-iga` pack (V0.2.5). Values in bodies are never copied into evidence. */
export function checkScim(parsed: ParsedCollection, profile: IdentityProfile, out: FindingSink): void {
  const requestsById = new Map(parsed.requests.map((request) => [request.id, request]))
  let adminPatch = false
  let patchHits = 0

  for (const endpoint of profile.endpoints) {
    if (!isScimEndpoint(endpoint.class)) continue
    const request = requestsById.get(endpoint.requestId)
    if (!request) continue
    const url = splitUrl(request.url, parsed)
    const body = readJsonBody(request)
    const method = request.method
    const hasBody = !!request.bodyRaw?.trim()
    const route = `${method} ${endpoint.path}`

    if (endpoint.class === 'scim.bulk' && body) {
      const operations = operationsOf(body)
      const deletes = operations.filter((operation) => String(operation.method ?? '').toUpperCase() === 'DELETE').length
      if (deletes > 0)
        out.add('SCIM_BULK_DESTRUCTIVE', request.id, { location: route, preview: `${deletes} DELETE of ${operations.length} operations` })
      else if (operations.length >= LARGE_BULK_OPERATIONS && body.failOnErrors === undefined)
        out.add('SCIM_BULK_DESTRUCTIVE', request.id, { location: route, preview: `${operations.length} operations without failOnErrors` })
    }

    if (
      method === 'GET' &&
      (endpoint.class === 'scim.users' || endpoint.class === 'scim.groups') &&
      /\/(?:users|groups)$/i.test(endpoint.path)
    ) {
      const params = requestParams(request)
      if (!params.has('filter') && !params.has('count') && !params.has('startindex'))
        out.add('SCIM_UNBOUNDED_LIST', request.id, { location: route, preview: 'no filter, count or startIndex' })
    }

    if (method === 'PATCH' && body) {
      for (const operation of operationsOf(body)) {
        const attributes = touchedAttributes(operation)
        if (!attributes.length) continue
        const admin = isLiteralAdmin(operation)
        patchHits += 1
        adminPatch ||= admin
        const op = typeof operation.op === 'string' ? operation.op.toLowerCase() : 'op'
        out.add('SCIM_PRIVILEGE_PATCH', request.id, {
          location: route,
          preview: `${op} ${attributes.join(', ')}${admin ? ' (literal admin value)' : ''}`,
        })
      }
    }

    if ((method === 'POST' || method === 'PUT' || method === 'PATCH') && hasBody && endpoint.class !== 'scim.schemas') {
      const type = contentType(request)
      if (!type || !/scim\+json/i.test(type))
        out.add('SCIM_CONTENT_TYPE', request.id, { location: 'header Content-Type', preview: type ? type.split(';')[0].trim() : 'not set' })
    }

    // SCIM 1.1 uses other schema URNs, so only version 2 (or unversioned) paths are checked.
    if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH') && !/\/scim\/v1\b/i.test(url.path)) {
      const schemas = schemasOf(body)
      const wanted =
        method === 'PATCH'
          ? URN.patch
          : endpoint.class === 'scim.bulk'
            ? URN.bulk
            : endpoint.class === 'scim.users'
              ? URN.user
              : endpoint.class === 'scim.groups'
                ? URN.group
                : ''
      if (wanted && !schemas.includes(wanted) && !(method === 'PATCH' && endpoint.class === 'scim.bulk'))
        out.add('SCIM_SCHEMA_MISMATCH', request.id, {
          location: `body schemas (${route})`,
          preview: schemas.length ? `missing ${wanted.split(':').slice(-1)[0]} URN` : 'schemas not set',
        })
    }
  }

  if (patchHits > 0) out.setSeverity('SCIM_PRIVILEGE_PATCH', adminPatch ? 'warning' : 'info')
}
