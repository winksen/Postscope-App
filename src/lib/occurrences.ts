import type { Finding } from './auditor'
import { sha256Hex } from './sha256'

/**
 * An occurrence is one place a rule fired: an evidence entry, or an affected request that has no evidence of its
 * own. Occurrences are what baselines and suppressions refer to, because a finding aggregates many of them.
 */
export interface Occurrence {
  /** `sha256(ruleId | requestId | location)`; the preview is left out so rotating a secret keeps the fingerprint. */
  fingerprint: string
  ruleId: string
  requestId?: string
  location?: string
}

export function occurrenceFingerprint(ruleId: string, requestId?: string, location?: string): string {
  return sha256Hex(`${ruleId}|${requestId ?? ''}|${location ?? ''}`)
}

function occurrence(ruleId: string, requestId?: string, location?: string): Occurrence {
  return { fingerprint: occurrenceFingerprint(ruleId, requestId, location), ruleId, requestId, location }
}

/** Every occurrence of a finding, in a stable order. */
export function findingOccurrences(finding: Pick<Finding, 'ruleId' | 'affected' | 'evidence'>): Occurrence[] {
  const result: Occurrence[] = []
  const seen = new Set<string>()
  const push = (item: Occurrence) => {
    if (seen.has(item.fingerprint)) return
    seen.add(item.fingerprint)
    result.push(item)
  }
  const evidenced = new Set<string>()
  for (const entry of finding.evidence ?? []) {
    if (entry.requestId) evidenced.add(entry.requestId)
    push(occurrence(finding.ruleId, entry.requestId, entry.location))
  }
  for (const requestId of finding.affected) {
    if (!evidenced.has(requestId)) push(occurrence(finding.ruleId, requestId))
  }
  if (result.length === 0) push(occurrence(finding.ruleId))
  return result
}

export interface SplitResult<T> {
  /** The finding without the matched occurrences, or null when nothing is left. */
  kept: Finding | null
  /** The matched occurrences as a finding of their own, or null when nothing matched. */
  matched: { finding: Finding; matches: Array<{ occurrence: Occurrence; match: T }> } | null
}

/** `5 request(s) ...` style descriptions follow the number of requests that remain. */
function withCount(description: string, before: number, after: number): string {
  return before !== after && description.startsWith(`${before} `) ? `${after}${description.slice(String(before).length)}` : description
}

/**
 * Splits a finding in two by occurrence: the occurrences `match` returns a value for, and the rest. Used for
 * suppressions and baselines. Requests keep the finding when any of their occurrences remains.
 */
export function splitFindingByOccurrence<T>(finding: Finding, match: (occurrence: Occurrence) => T | undefined): SplitResult<T> {
  const matches: Array<{ occurrence: Occurrence; match: T }> = []
  const matchedFingerprints = new Set<string>()
  const keptRequests = new Set<string>()
  let keptAny = false
  for (const item of findingOccurrences(finding)) {
    const found = match(item)
    if (found === undefined) {
      keptAny = true
      if (item.requestId) keptRequests.add(item.requestId)
    } else {
      matches.push({ occurrence: item, match: found })
      matchedFingerprints.add(item.fingerprint)
    }
  }
  if (matches.length === 0) return { kept: finding, matched: null }

  const fingerprintOf = (requestId?: string, location?: string) => occurrenceFingerprint(finding.ruleId, requestId, location)
  const evidence = finding.evidence ?? []
  const keptEvidence = evidence.filter((entry) => !matchedFingerprints.has(fingerprintOf(entry.requestId, entry.location)))
  const matchedEvidence = evidence.filter((entry) => matchedFingerprints.has(fingerprintOf(entry.requestId, entry.location)))
  const keptAffected = finding.affected.filter((id) => keptRequests.has(id))
  const matchedAffected = finding.affected.filter((id) => !keptRequests.has(id))

  const kept: Finding | null = keptAny
    ? {
        ...finding,
        affected: keptAffected,
        evidence: keptEvidence.length ? keptEvidence : undefined,
        description: withCount(finding.description, finding.affected.length, keptAffected.length),
      }
    : null
  const matchedFinding: Finding = {
    ...finding,
    affected: matchedAffected,
    evidence: matchedEvidence.length ? matchedEvidence : undefined,
    description: withCount(finding.description, finding.affected.length, matchedAffected.length),
  }
  return { kept, matched: { finding: matchedFinding, matches } }
}
