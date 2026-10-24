import type { RuleId } from '../rules'
import type { Severity } from '../severity'

/** What the identity checks need from the finding collector. `FindingCollector` in `auditor.ts` implements it. */
export interface FindingSink {
  add(ruleId: RuleId, requestId?: string, evidence?: { location: string; preview?: string }): void
  touch(ruleId: RuleId, description?: string): void
  setSeverity(ruleId: RuleId, severity: Severity): void
  /** `requestId|location` keys already reported by any of the given rules. */
  flaggedLocations(ruleIds: RuleId[]): Set<string>
}
