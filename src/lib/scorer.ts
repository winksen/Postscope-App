import type { Finding } from './auditor'
import type { ParsedCollection } from './parser'
import { penaltyScore } from './severity'

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

function categoryScore(findings: Finding[], category: Finding['category']): number {
  return penaltyScore(findings.filter((f) => f.category === category))
}

export function grade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
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
  const total = penaltyScore(findings)
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
