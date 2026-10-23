import type { Finding } from './auditor'
import { resolveLeadingVariable, urlHostname } from './auditor'
import { findingOccurrences, occurrenceFingerprint } from './occurrences'
import type { ParsedCollection, ParsedRequest } from './parser'
import { calculateScore, type ScoreBreakdown } from './scorer'
import { severityRank, type FindingCategory, type Severity } from './severity'

/** One side of a comparison: a parsed collection and the findings that apply to it. */
export interface CompareInput {
  parsed: ParsedCollection
  findings: Finding[]
  /** Calculated from the findings when omitted. */
  score?: ScoreBreakdown
}

export interface CompareSide {
  name: string
  totalRequests: number
  score: number
  security: number
  hygiene: number
  grade: ScoreBreakdown['grade']
  findingCount: number
}

/** A request as it is shown in a comparison. The URL has no query string, which can carry credentials. */
export interface ComparedRequest {
  id: string
  name: string
  method: string
  url: string
  folder: string
}

export type RequestChangeField = 'name' | 'folder' | 'method' | 'url' | 'auth' | 'body' | 'headers' | 'scripts'

export interface RequestChange {
  before: ComparedRequest
  after: ComparedRequest
  /** `id` when the ids are equal, otherwise `url` (same method and normalized URL). */
  matchedBy: 'id' | 'url'
  fields: RequestChangeField[]
}

export interface ComparedFinding {
  /** Occurrence fingerprint, expressed in the ids of the older collection. */
  fingerprint: string
  ruleId: string
  title: string
  severity: Severity
  category: FindingCategory
  /** Id of the request in the collection the finding was seen in. */
  requestId?: string
  requestName?: string
  location?: string
}

export interface Comparison {
  before: CompareSide
  after: CompareSide
  /** `after - before`; positive means the collection improved. */
  scoreDelta: { total: number; security: number; hygiene: number }
  requests: {
    added: ComparedRequest[]
    removed: ComparedRequest[]
    changed: RequestChange[]
    unchanged: number
  }
  findings: {
    added: ComparedFinding[]
    resolved: ComparedFinding[]
    unchanged: number
  }
  newHosts: string[]
  removedHosts: string[]
  newAuthTypes: string[]
  removedAuthTypes: string[]
}

function stripQueryAndFragment(url: string): string {
  const cut = url.search(/[?#]/)
  return cut === -1 ? url : url.slice(0, cut)
}

/**
 * Key used to recognize the same endpoint after a rename: the method plus the URL without query string and fragment,
 * a trailing slash or letter case in the scheme and host. Variables are kept as written.
 */
export function normalizeRequestUrl(url: string): string {
  const bare = stripQueryAndFragment(url.trim()).replace(/\/+$/, '')
  const match = bare.match(/^([a-z][a-z0-9+.-]*:\/\/)?([^/]*)(.*)$/i)
  if (!match) return bare
  return `${(match[1] ?? '').toLowerCase()}${match[2].toLowerCase()}${match[3]}`
}

function describeRequest(request: ParsedRequest): ComparedRequest {
  return {
    id: request.id,
    name: request.name,
    method: request.method,
    url: stripQueryAndFragment(request.url),
    folder: request.folderPath.join(' / '),
  }
}

function headerSignature(request: ParsedRequest): string {
  return request.headers
    .map((header) => `${header.key.toLowerCase()}:${header.value}`)
    .sort()
    .join('\n')
}

function scriptSignature(request: ParsedRequest): string {
  const scripts = request.scripts
  return scripts ? [scripts.prerequest, scripts.test, scripts.disabledPrerequest, scripts.disabledTest].map((source) => source ?? '').join('\u0000') : ''
}

function changedFields(before: ParsedRequest, after: ParsedRequest): RequestChangeField[] {
  const fields: RequestChangeField[] = []
  if (before.name !== after.name) fields.push('name')
  if (before.folderPath.join('/') !== after.folderPath.join('/')) fields.push('folder')
  if (before.method !== after.method) fields.push('method')
  if (before.url !== after.url) fields.push('url')
  if (before.auth !== after.auth) fields.push('auth')
  if ((before.bodyMode ?? '') !== (after.bodyMode ?? '') || (before.bodyRaw ?? '') !== (after.bodyRaw ?? '') || (before.bodySize ?? 0) !== (after.bodySize ?? 0)) fields.push('body')
  if (headerSignature(before) !== headerSignature(after)) fields.push('headers')
  if (scriptSignature(before) !== scriptSignature(after)) fields.push('scripts')
  return fields
}

interface RequestMatch {
  before: ParsedRequest
  after: ParsedRequest
  matchedBy: 'id' | 'url'
}

/** Pairs requests by id first, then by method and normalized URL (in order of appearance when several share one). */
function matchRequests(before: ParsedRequest[], after: ParsedRequest[]): { matches: RequestMatch[]; added: ParsedRequest[]; removed: ParsedRequest[] } {
  const matches: RequestMatch[] = []
  const afterById = new Map(after.map((request) => [request.id, request]))
  const usedAfter = new Set<ParsedRequest>()
  const unmatchedBefore: ParsedRequest[] = []
  for (const request of before) {
    const sameId = afterById.get(request.id)
    if (sameId && !usedAfter.has(sameId)) {
      usedAfter.add(sameId)
      matches.push({ before: request, after: sameId, matchedBy: 'id' })
    } else {
      unmatchedBefore.push(request)
    }
  }

  const urlKey = (request: ParsedRequest) => `${request.method} ${normalizeRequestUrl(request.url)}`
  const candidates = new Map<string, ParsedRequest[]>()
  for (const request of after) {
    if (usedAfter.has(request)) continue
    const key = urlKey(request)
    candidates.set(key, [...(candidates.get(key) ?? []), request])
  }
  const removed: ParsedRequest[] = []
  for (const request of unmatchedBefore) {
    const list = candidates.get(urlKey(request))
    const found = list?.shift()
    if (found) {
      usedAfter.add(found)
      matches.push({ before: request, after: found, matchedBy: 'url' })
    } else {
      removed.push(request)
    }
  }
  const added = after.filter((request) => !usedAfter.has(request))
  return { matches, added, removed }
}

interface KeyedFinding extends ComparedFinding {
  key: string
}

function keyFindings(findings: Finding[], parsed: ParsedCollection, idMap: Map<string, string>): KeyedFinding[] {
  const names = new Map(parsed.requests.map((request) => [request.id, request.name]))
  const keyed: KeyedFinding[] = []
  const seen = new Set<string>()
  for (const finding of findings) {
    for (const occurrence of findingOccurrences(finding)) {
      const stableId = occurrence.requestId === undefined ? undefined : idMap.get(occurrence.requestId) ?? occurrence.requestId
      const key = occurrenceFingerprint(finding.ruleId, stableId, occurrence.location)
      if (seen.has(key)) continue
      seen.add(key)
      keyed.push({
        key,
        fingerprint: key,
        ruleId: finding.ruleId,
        title: finding.title,
        severity: finding.severity,
        category: finding.category,
        requestId: occurrence.requestId,
        requestName: occurrence.requestId === undefined ? undefined : names.get(occurrence.requestId),
        location: occurrence.location,
      })
    }
  }
  return keyed
}

function compareFindings(a: ComparedFinding, b: ComparedFinding): number {
  return (
    severityRank(a.severity) - severityRank(b.severity) ||
    a.ruleId.localeCompare(b.ruleId) ||
    (a.requestId ?? '').localeCompare(b.requestId ?? '') ||
    (a.location ?? '').localeCompare(b.location ?? '')
  )
}

function stripKey({ key: _key, ...rest }: KeyedFinding): ComparedFinding {
  return rest
}

function hostsOf(parsed: ParsedCollection): Set<string> {
  const hosts = new Set<string>()
  for (const request of parsed.requests) {
    const host = urlHostname(resolveLeadingVariable(request.url, parsed))
    if (host) hosts.add(host)
  }
  return hosts
}

function authTypesOf(parsed: ParsedCollection): Set<string> {
  return new Set(Object.entries(parsed.authTypes).filter(([, count]) => count > 0).map(([type]) => type))
}

function difference(from: Set<string>, other: Set<string>): string[] {
  return [...from].filter((value) => !other.has(value)).sort((a, b) => a.localeCompare(b))
}

function side(input: CompareInput, score: ScoreBreakdown): CompareSide {
  return {
    name: input.parsed.name,
    totalRequests: input.parsed.totalRequests,
    score: score.total,
    security: score.security,
    hygiene: score.hygiene,
    grade: score.grade,
    findingCount: input.findings.length,
  }
}

/**
 * Compares two versions of a collection. Requests are matched by id, then by method and normalized URL, so a
 * renamed or moved request is still the same request. Findings are matched by occurrence fingerprint using the
 * older collection's request ids, so a rename does not turn every finding of that request into a new one. The
 * result holds no secret values and its lists are in a deterministic order.
 */
export function compareCollections(before: CompareInput, after: CompareInput): Comparison {
  const beforeScore = before.score ?? calculateScore(before.parsed, before.findings)
  const afterScore = after.score ?? calculateScore(after.parsed, after.findings)

  const { matches, added, removed } = matchRequests(before.parsed.requests, after.parsed.requests)
  const idMap = new Map(matches.map((match) => [match.after.id, match.before.id]))

  const changed: RequestChange[] = []
  let unchanged = 0
  for (const match of matches) {
    const fields = changedFields(match.before, match.after)
    if (fields.length === 0) unchanged += 1
    else changed.push({ before: describeRequest(match.before), after: describeRequest(match.after), matchedBy: match.matchedBy, fields })
  }
  const byName = (a: ComparedRequest, b: ComparedRequest) => a.folder.localeCompare(b.folder) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)

  const beforeFindings = keyFindings(before.findings, before.parsed, new Map())
  const afterFindings = keyFindings(after.findings, after.parsed, idMap)
  const beforeKeys = new Set(beforeFindings.map((finding) => finding.key))
  const afterKeys = new Set(afterFindings.map((finding) => finding.key))

  const beforeHosts = hostsOf(before.parsed)
  const afterHosts = hostsOf(after.parsed)
  const beforeAuth = authTypesOf(before.parsed)
  const afterAuth = authTypesOf(after.parsed)

  return {
    before: side(before, beforeScore),
    after: side(after, afterScore),
    scoreDelta: {
      total: afterScore.total - beforeScore.total,
      security: afterScore.security - beforeScore.security,
      hygiene: afterScore.hygiene - beforeScore.hygiene,
    },
    requests: {
      added: added.map(describeRequest).sort(byName),
      removed: removed.map(describeRequest).sort(byName),
      changed: changed.sort((a, b) => byName(a.after, b.after)),
      unchanged,
    },
    findings: {
      added: afterFindings.filter((finding) => !beforeKeys.has(finding.key)).map(stripKey).sort(compareFindings),
      resolved: beforeFindings.filter((finding) => !afterKeys.has(finding.key)).map(stripKey).sort(compareFindings),
      unchanged: afterFindings.filter((finding) => beforeKeys.has(finding.key)).length,
    },
    newHosts: difference(afterHosts, beforeHosts),
    removedHosts: difference(beforeHosts, afterHosts),
    newAuthTypes: difference(afterAuth, beforeAuth),
    removedAuthTypes: difference(beforeAuth, afterAuth),
  }
}

/** New findings at or above a severity: what a pull request check fails on. */
export function newFindingsAtOrAbove(comparison: Comparison, level: Severity | 'none'): ComparedFinding[] {
  if (level === 'none') return []
  return comparison.findings.added.filter((finding) => severityRank(finding.severity) <= severityRank(level))
}
