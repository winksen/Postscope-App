export type Severity = 'critical' | 'warning' | 'info'
export type FindingCategory = 'secrets' | 'variables' | 'auth' | 'hygiene'

/** Points deducted for one finding of each severity before the affected-request scaling (scoring model v2). */
export interface ScoreWeights {
  critical: number
  warning: number
  info: number
}

export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = { critical: 20, warning: 8, info: 2 }

/** Default penalty table; kept under its original name for existing imports. */
export const SEVERITY_PENALTY: Record<Severity, number> = DEFAULT_SCORE_WEIGHTS

export const SEVERITY_ORDER: Severity[] = ['critical', 'warning', 'info']

export const CATEGORY_ORDER: FindingCategory[] = ['secrets', 'variables', 'auth', 'hygiene']

export function isSeverity(value: unknown): value is Severity {
  return value === 'critical' || value === 'warning' || value === 'info'
}

export function severityRank(severity: Severity): number {
  return SEVERITY_ORDER.indexOf(severity)
}

const MAX_WEIGHT = 100

/** Normalizes untrusted weights (server config, CLI): invalid or missing entries keep their defaults. */
export function sanitizeScoreWeights(input: unknown): ScoreWeights {
  const weights = { ...DEFAULT_SCORE_WEIGHTS }
  if (!input || typeof input !== 'object') return weights
  for (const severity of SEVERITY_ORDER) {
    const value = Number((input as Record<string, unknown>)[severity])
    if (Number.isFinite(value) && value >= 0 && value <= MAX_WEIGHT) weights[severity] = value
  }
  return weights
}

/** Parses `critical=20,warning=8,info=2` (any subset). Problems are returned instead of thrown. */
export function parseScoreWeights(text: string | undefined): { weights: ScoreWeights; errors: string[] } {
  const errors: string[] = []
  const entries: Record<string, number> = {}
  for (const pair of (text ?? '').split(',')) {
    if (!pair.trim()) continue
    const [name, raw] = pair.split('=').map((part) => part.trim())
    const value = Number(raw)
    if (!isSeverity(name?.toLowerCase())) errors.push(`unknown severity "${name}"`)
    else if (raw === undefined || raw === '' || !Number.isFinite(value) || value < 0 || value > MAX_WEIGHT) errors.push(`"${pair.trim()}" needs a number from 0 to ${MAX_WEIGHT}`)
    else entries[name.toLowerCase()] = value
  }
  return { weights: sanitizeScoreWeights(entries), errors }
}

/** Per-rule caps (as a multiple of the weight) so one noisy rule cannot take the whole score alone. */
const CAP_FACTOR: Record<Severity, number> = { critical: 1.75, warning: 1.875, info: 2 }
const MAX_COLLECTION_LEVEL_COUNT = 8

/** How many places a finding touches: affected requests, or the evidence entries for collection-level findings. */
export function findingAffectedCount(finding: { affected: readonly unknown[]; evidence?: readonly unknown[] }): number {
  if (finding.affected.length > 0) return finding.affected.length
  return Math.min(MAX_COLLECTION_LEVEL_COUNT, Math.max(1, finding.evidence?.length ?? 0))
}

/**
 * Scoring model v2: `weight * (1 + log2(affectedCount))`, capped per rule. More affected requests never lower
 * the penalty, and one rule can never cost more than its cap.
 */
export function findingPenalty(finding: { severity: Severity; affected: readonly unknown[]; evidence?: readonly unknown[] }, weights: ScoreWeights = DEFAULT_SCORE_WEIGHTS): number {
  const weight = weights[finding.severity] ?? 0
  const scaled = weight * (1 + Math.log2(findingAffectedCount(finding)))
  const cap = weight * CAP_FACTOR[finding.severity]
  return Math.round(Math.min(scaled, cap) * 10) / 10
}

/** Flat 0-100 score where every finding costs its weight once. Used for one request (affected count 1). */
export function penaltyScore(findings: Array<{ severity: Severity }>, weights: ScoreWeights = DEFAULT_SCORE_WEIGHTS): number {
  let score = 100
  for (const finding of findings) {
    score -= weights[finding.severity] ?? 0
  }
  return Math.max(0, Math.min(100, score))
}
