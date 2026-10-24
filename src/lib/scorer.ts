import type { Finding } from './auditor'
import type { ParsedCollection } from './parser'
import {
  DEFAULT_SCORE_WEIGHTS,
  findingAffectedCount,
  findingPenalty,
  sanitizeScoreWeights,
  type FindingCategory,
  type ScoreWeights,
  type Severity,
} from './severity'

/** Version of the scoring formula, written to reports so scores from different releases are not compared blindly. */
export const SCORE_MODEL = 2

/** Weight of the security score in the headline score; hygiene makes up the rest. */
const SECURITY_SHARE = 0.85

export interface ScorePenalty {
  ruleId: string
  title: string
  severity: Severity
  category: FindingCategory
  /** Requests (or evidence entries for collection-level findings) the finding touches. */
  affectedCount: number
  /** Points deducted from its score (security or hygiene). */
  penalty: number
}

export interface ScoreBreakdown {
  /** Headline score: `round(0.85 * security + 0.15 * hygiene)`. */
  total: number
  /** Secrets, variables, auth and identity findings only. */
  security: number
  /** Maintainability findings only. */
  hygiene: number
  categories: {
    secrets: number
    variables: number
    auth: number
    /** Only present when the collection has identity findings or an identity profile. */
    identity?: number
    hygiene: number
  }
  grade: 'A' | 'B' | 'C' | 'D' | 'F'
  summary: string
  scoreModel: typeof SCORE_MODEL
  /** Every finding's contribution, largest first. */
  penalties: ScorePenalty[]
}

let activeWeights: ScoreWeights = DEFAULT_SCORE_WEIGHTS

/** Sets the weights used when `calculateScore` is called without any (the deployment's `SCORE_WEIGHTS`). */
export function setActiveScoreWeights(weights: unknown): void {
  activeWeights = sanitizeScoreWeights(weights)
}

export function getActiveScoreWeights(): ScoreWeights {
  return activeWeights
}

function clampScore(penalty: number): number {
  return Math.max(0, Math.min(100, Math.round(100 - penalty)))
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

/** The identity category is scored only when there is something to score: an identity finding. */
function hasIdentityScope(_parsed: ParsedCollection, findings: Finding[]): boolean {
  return findings.some((finding) => finding.category === 'identity')
}

export function calculateScore(parsed: ParsedCollection, findings: Finding[], weights: ScoreWeights = activeWeights): ScoreBreakdown {
  const penalties: ScorePenalty[] = findings
    .map((finding) => ({
      ruleId: finding.ruleId,
      title: finding.title,
      severity: finding.severity,
      category: finding.category,
      affectedCount: findingAffectedCount(finding),
      penalty: findingPenalty(finding, weights),
    }))
    .sort((a, b) => b.penalty - a.penalty)

  const sum = (match: (penalty: ScorePenalty) => boolean) => penalties.filter(match).reduce((total, penalty) => total + penalty.penalty, 0)
  const security = clampScore(sum((penalty) => penalty.category !== 'hygiene'))
  const hygiene = clampScore(sum((penalty) => penalty.category === 'hygiene'))
  const total = Math.round(SECURITY_SHARE * security + (1 - SECURITY_SHARE) * hygiene)

  return {
    total,
    security,
    hygiene,
    categories: {
      secrets: clampScore(sum((penalty) => penalty.category === 'secrets')),
      variables: clampScore(sum((penalty) => penalty.category === 'variables')),
      auth: clampScore(sum((penalty) => penalty.category === 'auth')),
      ...(hasIdentityScope(parsed, findings) ? { identity: clampScore(sum((penalty) => penalty.category === 'identity')) } : {}),
      hygiene,
    },
    grade: grade(total),
    summary: summary(total, findings),
    scoreModel: SCORE_MODEL,
    penalties,
  }
}
