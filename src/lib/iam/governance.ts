import type { ParsedCollection, ParsedRequest } from '../parser'
import { parseTemplatedJson } from '../jsonBody'
import { hasVariableReference } from '../variables'
import { scanPiiJson, scanPiiText, scanPiiValue, type PiiMatch } from './pii'
import type { FindingSink } from './sink'
import type { IdentityProfile } from './types'

const MAX_BODY = 1_000_000

const APPROVER_KEYS =
  /^(?:approver|approver_?id|approver_?name|approved_?by|reviewer|reviewer_?id|decision_?by|decided_?by|certifier|certifier_?id)$/i
const SUBJECT_KEYS =
  /^(?:requester|requester_?id|requested_?by|requested_?for|requestee|recipient|recipient_?id|beneficiary|requester_?name)$/i
const APPROVE_DECISION = /^(?:approve|approved|certify|certified|keep|accept|accepted)$/i
const BULK_PATH = /\/(?:bulk-?(?:approve|decide|certify|decision)s?|approve-?all|certify-?all|decide-?all)\b/i
const DECISION_LISTS = ['decisions', 'items', 'certificationItems', 'certification_items', 'reviewItems']
/** Approve decisions in one call from this number on are a bulk approval. */
const BULK_APPROVE_THRESHOLD = 5

function jsonBody(request: ParsedRequest): unknown {
  const raw = request.bodyRaw
  if (!raw || raw.length > MAX_BODY) return null
  return parseTemplatedJson(raw)?.value ?? null
}

function literalOf(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() && !hasVariableReference(value) ? value.trim().toLowerCase() : null
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    for (const key of ['id', 'value', 'name', 'email', 'username', 'userName']) {
      const found = literalOf(record[key])
      if (found) return found
    }
  }
  return null
}

function collectByKey(value: unknown, pattern: RegExp, found: Set<string>, depth = 0): void {
  if (depth > 12 || !value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const entry of value.slice(0, 200)) collectByKey(entry, pattern, found, depth + 1)
    return
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (pattern.test(key)) {
      const literal = literalOf(entry)
      if (literal) found.add(literal)
    }
    collectByKey(entry, pattern, found, depth + 1)
  }
}

/** The largest number of approving decisions in one decision list of the body. */
function approvalCount(body: unknown): number {
  const lists: unknown[][] = []
  if (Array.isArray(body)) lists.push(body)
  else if (body && typeof body === 'object') {
    for (const name of DECISION_LISTS) {
      const list = (body as Record<string, unknown>)[name]
      if (Array.isArray(list)) lists.push(list)
    }
  }
  let best = 0
  for (const list of lists) {
    const approvals = list.filter((entry) => {
      if (!entry || typeof entry !== 'object') return false
      const record = entry as Record<string, unknown>
      const decision = record.decision ?? record.action ?? record.status
      return typeof decision === 'string' && APPROVE_DECISION.test(decision)
    }).length
    best = Math.max(best, approvals)
  }
  return best
}

interface PiiHit {
  label: string
  preview: string
}

function toHits(matches: Array<PiiMatch & { path?: string }>): PiiHit[] {
  return matches.map((match) => ({ label: match.path ? `${match.kind} at ${match.path}` : match.kind, preview: match.preview }))
}

function piiInBody(request: ParsedRequest): PiiHit[] {
  const matches: Array<PiiMatch & { path?: string }> = []
  for (const field of request.bodyFields ?? [])
    matches.push(...scanPiiValue(field.key, field.value).map((match) => ({ ...match, path: field.key.trim() })))
  const raw = request.bodyRaw
  if (raw && raw.length <= MAX_BODY) {
    const parsed = parseTemplatedJson(raw)
    if (parsed) matches.push(...scanPiiJson(parsed.value))
    else matches.push(...scanPiiText(raw))
  }
  return toHits(matches)
}

function piiInText(text: string | undefined): PiiHit[] {
  if (!text) return []
  const parsed = parseTemplatedJson(text)
  return toHits(parsed ? scanPiiJson(parsed.value) : scanPiiText(text))
}

/** Governance and personal data checks of the `iam-iga` pack (V0.2.7). Evidence shows the kind and a masked preview only. */
export function checkGovernance(parsed: ParsedCollection, profile: IdentityProfile, out: FindingSink): void {
  const requestsById = new Map(parsed.requests.map((request) => [request.id, request]))

  for (const request of parsed.requests) {
    for (const hit of piiInBody(request))
      out.add('PII_IN_REQUEST_BODY', request.id, { location: `body ${hit.label}`, preview: hit.preview })
    for (const response of request.savedResponses ?? []) {
      const label = `saved response "${response.name}"`
      for (const hit of piiInText(response.body))
        out.add('PII_IN_SAVED_RESPONSE', request.id, { location: `${label} body ${hit.label}`, preview: hit.preview })
      for (const hit of piiInText(response.requestBody))
        out.add('PII_IN_SAVED_RESPONSE', request.id, { location: `${label} original request body ${hit.label}`, preview: hit.preview })
    }
  }

  for (const endpoint of profile.endpoints) {
    if (!endpoint.class.startsWith('iga.')) continue
    const request = requestsById.get(endpoint.requestId)
    if (!request) continue
    const body = jsonBody(request)
    const route = `${request.method} ${endpoint.path}`

    if (body && (endpoint.class === 'iga.access-request' || endpoint.class === 'iga.certification')) {
      const approvers = new Set<string>()
      const subjects = new Set<string>()
      collectByKey(body, APPROVER_KEYS, approvers)
      collectByKey(body, SUBJECT_KEYS, subjects)
      if ([...approvers].some((name) => subjects.has(name)))
        out.add('GOVERNANCE_SELF_APPROVAL', request.id, { location: route, preview: 'approver and requester are the same literal' })
    }

    if (endpoint.class === 'iga.certification' && request.method !== 'GET') {
      const approvals = body ? approvalCount(body) : 0
      if (approvals >= BULK_APPROVE_THRESHOLD)
        out.add('CERTIFICATION_BULK_APPROVE', request.id, { location: route, preview: `${approvals} approve decisions in one call` })
      else if (BULK_PATH.test(endpoint.path))
        out.add('CERTIFICATION_BULK_APPROVE', request.id, { location: route, preview: 'bulk approval endpoint' })
    }
  }
}
