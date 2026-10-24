import type { Finding } from './auditor'
import type { ParsedCollection, ParsedRequest } from './parser'
import type { ScoreBreakdown } from './scorer'
import { RULES, RULE_LIST, type RuleReferences } from './rules'
import { SEVERITY_ORDER } from './severity'
import { findingOccurrences, occurrenceFingerprint } from './occurrences'
import type { SuppressedFinding } from './suppressions'
import { locatePointers } from './jsonPositions'
import { buildHtmlReport } from './htmlReport'

export type ReportFormat = 'json' | 'sarif' | 'markdown' | 'html'

/** Version of the JSON report layout; the schema lives in docs/schemas/postscope-report.v2.schema.json. */
export const REPORT_VERSION = 2

export interface ReportContext {
  parsed: ParsedCollection
  findings: Finding[]
  score: ScoreBreakdown
  appVersion?: string
  generatedAt?: Date
  /** File name used as the SARIF artifact location (defaults to a name derived from the collection). */
  sourceName?: string
  /** Occurrences hidden by reviewed suppressions. Reported, but not scored. */
  suppressed?: SuppressedFinding[]
  /** Occurrences hidden because they are in the baseline file. */
  baselined?: number
  /**
   * Text of the collection file as scanned. With evidence pointers (`attachEvidencePointers`) it lets SARIF carry
   * a line and column for each result.
   */
  sourceText?: string
}

const TOOL_NAME = 'PostScope'
const TOOL_URI = 'https://github.com/winksen/Postscope-App'
const MAX_SARIF_RESULTS = 5000
const MAX_MARKDOWN_AFFECTED = 20
const MAX_MARKDOWN_EVIDENCE = 5

function labelMap(requests: ParsedRequest[]): Map<string, string> {
  return new Map(
    requests.map((request) => [
      request.id,
      request.folderPath.length ? `${request.folderPath.join(' / ')} / ${request.name}` : request.name,
    ])
  )
}

export function safeFileStem(name: string): string {
  return (
    name
      .replace(/[^\w.-]+/g, '_')
      .replace(/\.{2,}/g, '.')
      .replace(/^[._-]+|[._-]+$/g, '') || 'collection'
  )
}

export function reportFileName(collectionName: string, format: ReportFormat): string {
  const stem = `${safeFileStem(collectionName)}.postscope`
  if (format === 'sarif') return `${stem}.sarif`
  if (format === 'markdown') return `${stem}.md`
  if (format === 'html') return `${stem}.html`
  return `${stem}.json`
}

export function reportMimeType(format: ReportFormat): string {
  if (format === 'markdown') return 'text/markdown'
  if (format === 'sarif') return 'application/sarif+json'
  if (format === 'html') return 'text/html'
  return 'application/json'
}

/** Framework control ids as SARIF tags, such as `NIST-800-53:IA-5` or `CIS-v8:5.2`. */
export function frameworkTags(rule: { references?: RuleReferences }): string[] {
  const references = rule.references
  if (!references) return []
  return [
    ...(references.nist80053 ?? []).map((id) => `NIST-800-53:${id}`),
    ...(references.iso27001 ?? []).map((id) => `ISO-27001:${id}`),
    ...(references.cisV8 ?? []).map((id) => `CIS-v8:${id}`),
    ...(references.rfc ?? []).map((id) => `RFC:${id}`),
  ]
}

function severityCounts(findings: Finding[]): Record<Finding['severity'], number> {
  return {
    critical: findings.filter((finding) => finding.severity === 'critical').length,
    warning: findings.filter((finding) => finding.severity === 'warning').length,
    info: findings.filter((finding) => finding.severity === 'info').length,
  }
}

/** Machine-readable report. Evidence previews are already masked by the auditor. */
export function buildJsonReport(ctx: ReportContext): string {
  const labels = labelMap(ctx.parsed.requests)
  return JSON.stringify(
    {
      reportVersion: REPORT_VERSION,
      tool: { name: TOOL_NAME, version: ctx.appVersion ?? 'unknown', informationUri: TOOL_URI },
      generatedAt: (ctx.generatedAt ?? new Date()).toISOString(),
      collection: {
        name: ctx.parsed.name,
        schemaVersion: ctx.parsed.version,
        totalRequests: ctx.parsed.totalRequests,
        totalFolders: ctx.parsed.totalFolders,
        methods: ctx.parsed.methods,
        authTypes: ctx.parsed.authTypes,
        parseWarnings: ctx.parsed.parseWarnings ?? [],
        environments: ctx.parsed.environments?.map((environment, index) => ({
          name: environment.name,
          kind: environment.kind,
          variableCount: environment.variables.length,
          active: environment.kind === 'environment' && index === ctx.parsed.activeEnvironment,
        })),
      },
      score: ctx.score,
      summary: severityCounts(ctx.findings),
      findings: ctx.findings.map((finding) => ({
        ruleId: finding.ruleId,
        severity: finding.severity,
        category: finding.category,
        title: finding.title,
        description: finding.description,
        recommendation: finding.recommendation,
        cwe: finding.cwe,
        owasp: finding.owasp,
        pack: RULES[finding.ruleId].pack,
        references: RULES[finding.ruleId].references,
        affected: finding.affected.map((id) => ({ id, label: labels.get(id) ?? id })),
        evidence: finding.evidence ?? [],
        occurrences: findingOccurrences(finding).map(({ fingerprint, requestId, location }) => ({ fingerprint, requestId, location })),
      })),
      suppressed: (ctx.suppressed ?? []).map((finding) => ({
        ruleId: finding.ruleId,
        severity: finding.severity,
        category: finding.category,
        title: finding.title,
        suppressed: true,
        affected: finding.affected.map((id) => ({ id, label: labels.get(id) ?? id })),
        suppressions: finding.suppressions.map((item) => ({
          fingerprint: occurrenceFingerprint(finding.ruleId, item.requestId, item.location),
          requestId: item.requestId,
          location: item.location,
          reason: item.reason,
          source: item.source,
          expires: item.expires,
        })),
      })),
      baseline: ctx.baselined === undefined ? undefined : { hiddenOccurrences: ctx.baselined },
    },
    null,
    2
  )
}

function sarifLevel(severity: Finding['severity']): 'error' | 'warning' | 'note' {
  if (severity === 'critical') return 'error'
  if (severity === 'warning') return 'warning'
  return 'note'
}

const SECURITY_SEVERITY: Record<Finding['severity'], string> = { critical: '9.0', warning: '5.0', info: '2.0' }

function fingerprint(value: string): string {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** SARIF 2.1.0 log for GitHub code scanning, Azure DevOps, and other CI dashboards. */
export function buildSarifReport(ctx: ReportContext): string {
  const labels = labelMap(ctx.parsed.requests)
  const uri = ctx.sourceName ?? `${safeFileStem(ctx.parsed.name)}.postman_collection.json`
  const ruleIndex = new Map(RULE_LIST.map((rule, index) => [rule.id, index]))

  // Positions of every pointer the results need, found in one pass over the original text.
  const wanted = new Set<string>()
  const requestPointers = new Map(ctx.parsed.requests.map((request) => [request.id, request.pointer]))
  for (const finding of [...ctx.findings, ...(ctx.suppressed ?? [])]) {
    for (const entry of finding.evidence ?? []) if (entry.pointer) wanted.add(entry.pointer)
    for (const id of finding.affected) {
      const pointer = requestPointers.get(id)
      if (pointer) wanted.add(`${pointer}/request`)
    }
  }
  const positions = ctx.sourceText ? locatePointers(ctx.sourceText, wanted) : new Map()
  let truncated = 0

  const results: unknown[] = []
  const addResults = (finding: Finding, suppressions?: SuppressedFinding['suppressions']) => {
    const targets = finding.affected.length ? finding.affected : [null]
    for (const requestId of targets) {
      if (results.length >= MAX_SARIF_RESULTS) {
        truncated += 1
        continue
      }
      const label = requestId ? (labels.get(requestId) ?? requestId) : null
      const evidence = finding.evidence?.find((entry) => (requestId ? entry.requestId === requestId : !entry.requestId))
      const position =
        positions.get(evidence?.pointer ?? '') ?? (requestId ? positions.get(`${requestPointers.get(requestId)}/request`) : undefined)
      const message = [
        label ? `${finding.title}: ${label}.` : `${finding.title}.`,
        evidence ? `Location: ${evidence.location}.` : '',
        finding.recommendation,
      ]
        .filter(Boolean)
        .join(' ')
      const reasons = suppressions?.filter((item) => (requestId ? item.requestId === requestId : !item.requestId))
      results.push({
        ruleId: finding.ruleId,
        ruleIndex: ruleIndex.get(finding.ruleId),
        level: sarifLevel(finding.severity),
        message: { text: message },
        locations: [
          {
            physicalLocation: {
              artifactLocation: { uri },
              ...(position ? { region: { startLine: position.line, startColumn: position.column } } : {}),
            },
            ...(label ? { logicalLocations: [{ fullyQualifiedName: label, kind: 'member' }] } : {}),
          },
        ],
        partialFingerprints: {
          'postscope/v1': fingerprint(`${finding.ruleId}|${requestId ?? 'collection'}`),
          'postscope/v2': occurrenceFingerprint(finding.ruleId, requestId ?? undefined, evidence?.location),
        },
        ...(suppressions
          ? {
              suppressions: (reasons?.length ? reasons : suppressions).slice(0, 1).map((item) => ({
                kind: item.source === 'inline' ? 'inSource' : 'external',
                status: 'accepted',
                justification: item.reason,
              })),
            }
          : {}),
      })
    }
  }
  for (const finding of ctx.findings) addResults(finding)
  for (const finding of ctx.suppressed ?? []) addResults(finding, finding.suppressions)

  const severityByRule = new Map(ctx.findings.map((finding) => [finding.ruleId, finding.severity]))
  return JSON.stringify(
    {
      $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
      version: '2.1.0',
      runs: [
        {
          automationDetails: {
            id: `postscope/${safeFileStem(ctx.parsed.name)}/${(ctx.generatedAt ?? new Date()).toISOString().slice(0, 10)}`,
          },
          columnKind: 'utf16CodeUnits',
          invocations: [
            {
              executionSuccessful: true,
              ...(truncated > 0
                ? {
                    toolExecutionNotifications: [
                      {
                        level: 'warning',
                        message: { text: `Results were truncated at ${MAX_SARIF_RESULTS}; ${truncated} more result(s) were not written.` },
                      },
                    ],
                  }
                : {}),
            },
          ],
          tool: {
            driver: {
              name: TOOL_NAME,
              version: ctx.appVersion ?? 'unknown',
              informationUri: TOOL_URI,
              rules: RULE_LIST.map((rule) => {
                const severity = severityByRule.get(rule.id) ?? rule.severity
                return {
                  id: rule.id,
                  name: rule.title,
                  shortDescription: { text: rule.title },
                  fullDescription: { text: rule.description },
                  help: { text: rule.recommendation },
                  defaultConfiguration: { level: sarifLevel(severity) },
                  properties: {
                    tags: [
                      'security',
                      rule.category,
                      `pack:${rule.pack}`,
                      ...rule.tags,
                      ...(rule.cwe ? [rule.cwe] : []),
                      ...frameworkTags(rule),
                    ],
                    'security-severity': SECURITY_SEVERITY[severity],
                  },
                }
              }),
            },
          },
          results,
        },
      ],
    },
    null,
    2
  )
}

export function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_{}[\]<>|#])/g, '\\$1')
}

/** Human-readable report for pull requests, tickets, and audits. */
export function buildMarkdownReport(ctx: ReportContext): string {
  const labels = labelMap(ctx.parsed.requests)
  const counts = severityCounts(ctx.findings)
  const lines: string[] = []

  lines.push(`# PostScope report: ${escapeMarkdown(ctx.parsed.name)}`, '')
  lines.push(`Generated ${(ctx.generatedAt ?? new Date()).toISOString()} by ${TOOL_NAME} ${ctx.appVersion ?? ''}`.trim(), '')
  lines.push('| Metric | Value |', '|---|---|')
  lines.push(`| Score | **${ctx.score.total}/100** (grade ${ctx.score.grade}) |`)
  lines.push(`| Security score | ${ctx.score.security}/100 |`)
  lines.push(`| Hygiene score | ${ctx.score.hygiene}/100 |`)
  lines.push(`| Requests | ${ctx.parsed.totalRequests} in ${ctx.parsed.totalFolders} folder(s) |`)
  lines.push(`| Findings | ${counts.critical} critical, ${counts.warning} warning, ${counts.info} info |`)
  if (ctx.parsed.environments?.length) {
    const names = ctx.parsed.environments.map((environment) => `${escapeMarkdown(environment.name)} (${environment.kind})`).join(', ')
    lines.push(`| Environments | ${names} |`)
  }
  lines.push(
    `| Category scores | Secrets ${ctx.score.categories.secrets}, Variables ${ctx.score.categories.variables}, Auth ${ctx.score.categories.auth}, Hygiene ${ctx.score.categories.hygiene} |`
  )
  lines.push('', `> ${ctx.score.summary}`, '')

  if (ctx.parsed.parseWarnings?.length) {
    lines.push('## Parse warnings', '', ...ctx.parsed.parseWarnings.map((warning) => `- ${escapeMarkdown(warning)}`), '')
  }

  if (!ctx.findings.length) lines.push('No findings.', '')

  for (const severity of SEVERITY_ORDER) {
    const group = ctx.findings.filter((finding) => finding.severity === severity)
    if (!group.length) continue
    lines.push(`## ${severity[0].toUpperCase()}${severity.slice(1)} (${group.length})`, '')
    for (const finding of group) {
      const rule = RULES[finding.ruleId]
      const refs = [finding.cwe, finding.owasp].filter(Boolean).join(' · ')
      lines.push(`### ${escapeMarkdown(finding.title)}`, '')
      lines.push(`\`${finding.ruleId}\` · ${finding.category}${refs ? ` · ${refs}` : ''}`, '')
      lines.push(escapeMarkdown(finding.description), '')
      lines.push(`**Recommendation:** ${escapeMarkdown(finding.recommendation || rule?.recommendation || '')}`, '')
      if (finding.affected.length) {
        lines.push(`**Affected requests (${finding.affected.length}):**`, '')
        for (const id of finding.affected.slice(0, MAX_MARKDOWN_AFFECTED)) lines.push(`- ${escapeMarkdown(labels.get(id) ?? id)}`)
        if (finding.affected.length > MAX_MARKDOWN_AFFECTED) lines.push(`- … and ${finding.affected.length - MAX_MARKDOWN_AFFECTED} more`)
        lines.push('')
      }
      if (finding.evidence?.length) {
        lines.push('**Evidence (masked):**', '')
        for (const entry of finding.evidence.slice(0, MAX_MARKDOWN_EVIDENCE)) {
          lines.push(`- ${escapeMarkdown(entry.location)}${entry.preview ? `: \`${entry.preview.replace(/`/g, "'")}\`` : ''}`)
        }
        lines.push('')
      }
    }
  }

  if (ctx.suppressed?.length) {
    lines.push(`## Suppressed (${ctx.suppressed.length}, not scored)`, '')
    for (const finding of ctx.suppressed) {
      lines.push(`### ${escapeMarkdown(finding.title)}`, '', `\`${finding.ruleId}\` · ${finding.category}`, '')
      for (const item of finding.suppressions.slice(0, MAX_MARKDOWN_AFFECTED)) {
        const where = [item.requestId ? (labels.get(item.requestId) ?? item.requestId) : 'collection', item.location]
          .filter(Boolean)
          .join(': ')
        lines.push(
          `- ${escapeMarkdown(where)}. Reason: ${escapeMarkdown(item.reason)} (${item.source}${item.expires ? `, expires ${item.expires}` : ''})`
        )
      }
      if (finding.suppressions.length > MAX_MARKDOWN_AFFECTED)
        lines.push(`- … and ${finding.suppressions.length - MAX_MARKDOWN_AFFECTED} more`)
      lines.push('')
    }
  }
  if (ctx.baselined) lines.push(`${ctx.baselined} known occurrence(s) are hidden by the baseline.`, '')

  return lines.join('\n')
}

export function buildReport(format: ReportFormat, ctx: ReportContext): string {
  if (format === 'sarif') return buildSarifReport(ctx)
  if (format === 'markdown') return buildMarkdownReport(ctx)
  if (format === 'html') return buildHtmlReport(ctx)
  return buildJsonReport(ctx)
}
