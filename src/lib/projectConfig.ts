import { isRuleId } from './rules'
import { isRulePackId, RULE_PACKS, sanitizeRulePacks, type RulePackSettings } from './rulePacks'
import { isSeverity, type ScoreWeights, type Severity, SEVERITY_ORDER, sanitizeScoreWeights } from './severity'
import { isValidDate, type ConfigSuppression } from './suppressions'

/** Name of the project file the CLI looks for, from the scanned file's folder upwards. */
export const CONFIG_FILE_NAME = '.postscope.json'

export interface ProjectConfig {
  disabledRules?: string[]
  severityOverrides?: Record<string, Severity>
  weights?: ScoreWeights
  /** Rule pack selection: `{ "enabled": ["iam-am"], "disabled": ["iam-pam"] }`. Packs in neither list follow `auto`. */
  rulePacks?: RulePackSettings
  suppressions?: ConfigSuppression[]
}

const KEYS = new Set(['disabledRules', 'severityOverrides', 'weights', 'rulePacks', 'suppressions'])
const SUPPRESSION_KEYS = new Set(['ruleId', 'request', 'location', 'reason', 'expires'])

/**
 * Validates a `.postscope.json` document. Unknown keys and unknown rule ids are errors, because a typo would
 * otherwise silently disable nothing (or everything), and suppressions without a reason are rejected.
 */
export function parseProjectConfig(input: unknown): { config: ProjectConfig; errors: string[] } {
  const errors: string[] = []
  const config: ProjectConfig = {}
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { config, errors: ['the config must be a JSON object'] }
  const raw = input as Record<string, unknown>

  for (const key of Object.keys(raw)) if (!KEYS.has(key)) errors.push(`unknown key "${key}"`)

  if (raw.disabledRules !== undefined) {
    if (!Array.isArray(raw.disabledRules) || raw.disabledRules.some((rule) => typeof rule !== 'string'))
      errors.push('"disabledRules" must be an array of rule ids')
    else {
      const rules = raw.disabledRules.map((rule) => String(rule).toUpperCase())
      for (const rule of rules) if (!isRuleId(rule)) errors.push(`"disabledRules" has unknown rule "${rule}"`)
      config.disabledRules = rules
    }
  }

  if (raw.severityOverrides !== undefined) {
    const overrides = raw.severityOverrides
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides))
      errors.push('"severityOverrides" must be an object of rule id to severity')
    else {
      config.severityOverrides = {}
      for (const [rule, severity] of Object.entries(overrides as Record<string, unknown>)) {
        const id = rule.toUpperCase()
        if (!isRuleId(id)) errors.push(`"severityOverrides" has unknown rule "${rule}"`)
        else if (!isSeverity(severity)) errors.push(`"severityOverrides.${rule}" must be one of ${SEVERITY_ORDER.join(', ')}`)
        else config.severityOverrides[id] = severity
      }
    }
  }

  if (raw.weights !== undefined) {
    const weights = raw.weights
    if (!weights || typeof weights !== 'object' || Array.isArray(weights))
      errors.push('"weights" must be an object such as {"critical": 20, "warning": 8, "info": 2}')
    else {
      for (const [severity, value] of Object.entries(weights as Record<string, unknown>)) {
        if (!isSeverity(severity)) errors.push(`"weights" has unknown severity "${severity}"`)
        else if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100)
          errors.push(`"weights.${severity}" must be a number from 0 to 100`)
      }
      config.weights = sanitizeScoreWeights(weights)
    }
  }

  if (raw.rulePacks !== undefined) {
    const packs = raw.rulePacks
    if (!packs || typeof packs !== 'object' || Array.isArray(packs))
      errors.push('"rulePacks" must be an object such as {"enabled": ["iam-am"], "disabled": ["iam-pam"]}')
    else {
      for (const [key, value] of Object.entries(packs as Record<string, unknown>)) {
        if (key !== 'enabled' && key !== 'disabled') {
          errors.push(`"rulePacks" has unknown key "${key}"`)
          continue
        }
        if (!Array.isArray(value)) {
          errors.push(`"rulePacks.${key}" must be an array of pack ids`)
          continue
        }
        for (const id of value) {
          if (!isRulePackId(id)) errors.push(`"rulePacks.${key}" has unknown pack "${String(id)}"`)
          else if (!RULE_PACKS[id].optional) errors.push(`"rulePacks.${key}" cannot list "${id}": it is always on`)
        }
      }
      config.rulePacks = sanitizeRulePacks(packs)
    }
  }

  if (raw.suppressions !== undefined) {
    if (!Array.isArray(raw.suppressions)) errors.push('"suppressions" must be an array')
    else {
      config.suppressions = []
      raw.suppressions.forEach((entry, index) => {
        const where = `suppressions[${index}]`
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          errors.push(`${where} must be an object`)
          return
        }
        const item = entry as Record<string, unknown>
        for (const key of Object.keys(item)) if (!SUPPRESSION_KEYS.has(key)) errors.push(`${where} has unknown key "${key}"`)
        const ruleId = typeof item.ruleId === 'string' ? item.ruleId.toUpperCase() : ''
        if (!ruleId || !isRuleId(ruleId)) errors.push(`${where}.ruleId must be a known rule id`)
        if (typeof item.reason !== 'string' || !item.reason.trim())
          errors.push(`${where}.reason is required: explain why the finding is accepted`)
        for (const key of ['request', 'location'] as const) {
          if (item[key] !== undefined && (typeof item[key] !== 'string' || !String(item[key]).trim()))
            errors.push(`${where}.${key} must be a non-empty string`)
        }
        if (item.expires !== undefined && (typeof item.expires !== 'string' || !isValidDate(item.expires)))
          errors.push(`${where}.expires must be a date such as 2027-01-31`)
        if (ruleId && isRuleId(ruleId) && typeof item.reason === 'string' && item.reason.trim()) {
          config.suppressions!.push({
            ruleId,
            reason: item.reason.trim(),
            ...(typeof item.request === 'string' ? { request: item.request.trim() } : {}),
            ...(typeof item.location === 'string' ? { location: item.location.trim() } : {}),
            ...(typeof item.expires === 'string' ? { expires: item.expires } : {}),
          })
        }
      })
    }
  }

  return { config, errors }
}
