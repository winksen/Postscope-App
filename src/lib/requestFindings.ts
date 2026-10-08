import type { Finding } from './auditor'
import type { ParsedRequest } from './parser'
import { penaltyScore } from './severity'

export function findingsForRequest(request: ParsedRequest, findings: Finding[]): Finding[] {
  return findings.filter((f) => f.affected.includes(request.id))
}

/** Same penalty table as the collection scorer (see `severity.ts`). */
export function requestHealthScore(findings: Finding[]): number {
  return penaltyScore(findings)
}
