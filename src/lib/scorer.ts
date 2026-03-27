import type { Finding } from './auditor'
import type { ParsedCollection } from './parser'

export interface ScoreBreakdown {
  total: number;
  categories: {
    secrets: number;
    variables: number;
    auth: number;
    hygiene: number;
  };
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  summary: string;
}

const SEVERITY_PENALTY = { critical: 20, warning: 8, info: 2 } as const

function categoryScore(findings: Finding[], category: Finding['category']): number {
  const catFindings = findings.filter((f) => f.category === category)
  let score = 100
  for (const f of catFindings) {
    score -= SEVERITY_PENALTY[f.severity]
  }
  return Math.max(0, Math.min(100, score))
}

function totalScore(findings: Finding[]): number {
  let score = 100
  for (const f of findings) {
    score -= SEVERITY_PENALTY[f.severity]
  }
  return Math.max(0, Math.min(100, score))
}

function grade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (score >= 90) return 'A'
  if (score >= 75) return 'B'
  if (score >= 55) return 'C'
  if (score >= 35) return 'D'
  return 'F'
}

function summary(score: number, findings: Finding[]): string {
  const criticalCount = findings.filter((f) => f.severity === 'critical').length
  const warningCount = findings.filter((f) => f.severity === 'warning').length

  if (criticalCount > 0) {
    return `Critical issues found. Address hardcoded secrets and tokens before production use.`
  }
  if (warningCount > 0 && score < 75) {
    return `Several warnings. Improve variable usage and auth consistency.`
  }
  if (score >= 90) {
    return `Collection is well-structured with good security practices.`
  }
  if (score >= 75) {
    return `Solid foundation. Minor improvements recommended.`
  }
  return `Review findings and apply recommendations to improve collection health.`
}

export function calculateScore(_parsed: ParsedCollection, findings: Finding[]): ScoreBreakdown {
  const total = totalScore(findings)
  return {
    total,
    categories: {
      secrets: categoryScore(findings, 'secrets'),
      variables: categoryScore(findings, 'variables'),
      auth: categoryScore(findings, 'auth'),
      hygiene: categoryScore(findings, 'hygiene'),
    },
    grade: grade(total),
    summary: summary(total, findings),
  }
}
