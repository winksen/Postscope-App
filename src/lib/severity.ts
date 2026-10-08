export type Severity = 'critical' | 'warning' | 'info'
export type FindingCategory = 'secrets' | 'variables' | 'auth' | 'hygiene'

/** Single source of truth for score penalties (collection score and per-request health). */
export const SEVERITY_PENALTY: Record<Severity, number> = { critical: 20, warning: 8, info: 2 }

export const SEVERITY_ORDER: Severity[] = ['critical', 'warning', 'info']

export const CATEGORY_ORDER: FindingCategory[] = ['secrets', 'variables', 'auth', 'hygiene']

export function isSeverity(value: unknown): value is Severity {
  return value === 'critical' || value === 'warning' || value === 'info'
}

export function severityRank(severity: Severity): number {
  return SEVERITY_ORDER.indexOf(severity)
}

/** Penalty-based 0-100 score shared by the collection scorer and request health score. */
export function penaltyScore(findings: Array<{ severity: Severity }>): number {
  let score = 100
  for (const finding of findings) {
    score -= SEVERITY_PENALTY[finding.severity] ?? 0
  }
  return Math.max(0, Math.min(100, score))
}
