import type { Finding } from './auditor'
import type { ParsedRequest } from './parser'
import { penaltyScore, type ScoreWeights } from './severity'
import { getActiveScoreWeights } from './scorer'

export function findingsForRequest(request: ParsedRequest, findings: Finding[]): Finding[] {
  return findings.filter((f) => f.affected.includes(request.id))
}

/** Same weights as the collection scorer; one request counts as one affected request, so each finding costs its weight once. */
export function requestHealthScore(findings: Finding[], weights: ScoreWeights = getActiveScoreWeights()): number {
  return penaltyScore(findings, weights)
}
