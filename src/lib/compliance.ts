import type { Finding } from './auditor'
import { RULES, type RuleReferences } from './rules'
import { severityRank, type Severity } from './severity'

/** Frameworks a report can be grouped by. The values are the ones the CLI accepts for `--compliance`. */
export const COMPLIANCE_FRAMEWORKS = ['nist-800-53', 'iso-27001', 'cis-v8'] as const
export type ComplianceFramework = (typeof COMPLIANCE_FRAMEWORKS)[number]

export const FRAMEWORK_LABELS: Record<ComplianceFramework, string> = {
  'nist-800-53': 'NIST SP 800-53 Rev. 5',
  'iso-27001': 'ISO/IEC 27001:2022 Annex A',
  'cis-v8': 'CIS Controls v8',
}

const FIELD: Record<ComplianceFramework, keyof RuleReferences> = { 'nist-800-53': 'nist80053', 'iso-27001': 'iso27001', 'cis-v8': 'cisV8' }

export function isComplianceFramework(value: unknown): value is ComplianceFramework {
  return typeof value === 'string' && (COMPLIANCE_FRAMEWORKS as readonly string[]).includes(value)
}

/** Control ids of a framework that a rule maps to. */
export function controlsOf(ruleId: string, framework: ComplianceFramework): string[] {
  return RULES[ruleId as keyof typeof RULES]?.references?.[FIELD[framework]] ?? []
}

export interface ControlFinding {
  ruleId: string
  title: string
  severity: Severity
  /** Requests, or evidence entries for collection-level findings. */
  count: number
}

export interface ControlGroup {
  control: string
  findings: ControlFinding[]
}

function compareControls(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true })
}

/** The findings of a report grouped by the controls they map to, controls in natural order and the worst finding first. */
export function groupByControl(findings: readonly Finding[], framework: ComplianceFramework): ControlGroup[] {
  const groups = new Map<string, ControlFinding[]>()
  for (const finding of findings) {
    const entry: ControlFinding = {
      ruleId: finding.ruleId,
      title: finding.title,
      severity: finding.severity,
      count: finding.affected.length || finding.evidence?.length || 1,
    }
    for (const control of controlsOf(finding.ruleId, framework)) groups.set(control, [...(groups.get(control) ?? []), entry])
  }
  return [...groups.entries()]
    .sort(([a], [b]) => compareControls(a, b))
    .map(([control, list]) => ({ control, findings: list.sort((a, b) => severityRank(a.severity) - severityRank(b.severity)) }))
}

export interface ComplianceRow {
  ruleId: string
  title: string
  severity: Severity
  nist80053: string[]
  iso27001: string[]
  cisV8: string[]
  rfc: string[]
}

/** One row per finding with the controls of every framework. Rules without references are left out. */
export function complianceRows(findings: readonly Finding[]): ComplianceRow[] {
  const rows: ComplianceRow[] = []
  for (const finding of findings) {
    const references = RULES[finding.ruleId]?.references
    if (!references) continue
    rows.push({
      ruleId: finding.ruleId,
      title: finding.title,
      severity: finding.severity,
      nist80053: references.nist80053 ?? [],
      iso27001: references.iso27001 ?? [],
      cisV8: references.cisV8 ?? [],
      rfc: references.rfc ?? [],
    })
  }
  return rows
}
