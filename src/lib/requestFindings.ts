import type { Finding } from './auditor'
import type { ParsedRequest } from './parser'

export function findingsForRequest(request: ParsedRequest, findings: Finding[]): Finding[] {
  return findings.filter((f) => f.affected.includes(request.id))
}

const PENALTY = { critical: 20, warning: 8, info: 2 } as const

export function requestHealthScore(findings: Finding[]): number {
  let score = 100
  for (const f of findings) {
    score -= PENALTY[f.severity]
  }
  return Math.max(0, score)
}
