import type { Finding } from './auditor'
import type { ParsedCollection, ParsedRequest } from './parser'
import type { ScoreBreakdown } from './scorer'
import { RULES, RULE_LIST } from './rules'
import { SEVERITY_ORDER } from './severity'

export type ReportFormat = 'json' | 'sarif' | 'markdown'

export interface ReportContext {
  parsed: ParsedCollection
  findings: Finding[]
  score: ScoreBreakdown
  appVersion?: string
  generatedAt?: Date
  /** File name used as the SARIF artifact location (defaults to a name derived from the collection). */
  sourceName?: string
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
  return `${stem}.json`
}

export function reportMimeType(format: ReportFormat): string {
  if (format === 'markdown') return 'text/markdown'
  if (format === 'sarif') return 'application/sarif+json'
  return 'application/json'
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
        affected: finding.affected.map((id) => ({ id, label: labels.get(id) ?? id })),
        evidence: finding.evidence ?? [],
      })),
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

  const results: unknown[] = []
  for (const finding of ctx.findings) {
    const targets = finding.affected.length ? finding.affected : [null]
    for (const requestId of targets) {
      if (results.length >= MAX_SARIF_RESULTS) break
      const label = requestId ? labels.get(requestId) ?? requestId : null
      const evidence = finding.evidence?.find((entry) => (requestId ? entry.requestId === requestId : !entry.requestId))
      const message = [label ? `${finding.title}: ${label}.` : `${finding.title}.`, evidence ? `Location: ${evidence.location}.` : '', finding.recommendation]
        .filter(Boolean)
        .join(' ')
      results.push({
        ruleId: finding.ruleId,
        ruleIndex: ruleIndex.get(finding.ruleId),
        level: sarifLevel(finding.severity),
        message: { text: message },
        locations: [
          {
            physicalLocation: { artifactLocation: { uri } },
            ...(label ? { logicalLocations: [{ fullyQualifiedName: label, kind: 'member' }] } : {}),
          },
        ],
        partialFingerprints: { 'postscope/v1': fingerprint(`${finding.ruleId}|${requestId ?? 'collection'}`) },
      })
    }
  }

  const severityByRule = new Map(ctx.findings.map((finding) => [finding.ruleId, finding.severity]))
  return JSON.stringify(
    {
      $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
      version: '2.1.0',
      runs: [
        {
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
                    tags: ['security', rule.category, ...(rule.cwe ? [rule.cwe] : [])],
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

function escapeMarkdown(text: string): string {
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
  lines.push(`| Requests | ${ctx.parsed.totalRequests} in ${ctx.parsed.totalFolders} folder(s) |`)
  lines.push(`| Findings | ${counts.critical} critical, ${counts.warning} warning, ${counts.info} info |`)
  lines.push(
    `| Category scores | Secrets ${ctx.score.categories.secrets}, Variables ${ctx.score.categories.variables}, Auth ${ctx.score.categories.auth}, Hygiene ${ctx.score.categories.hygiene} |`
  )
  lines.push('', `> ${ctx.score.summary}`, '')

  if (ctx.parsed.parseWarnings?.length) {
    lines.push('## Parse warnings', '', ...ctx.parsed.parseWarnings.map((warning) => `- ${escapeMarkdown(warning)}`), '')
  }

  if (!ctx.findings.length) {
    lines.push('No findings. 🎉', '')
    return lines.join('\n')
  }

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

  return lines.join('\n')
}

export function buildReport(format: ReportFormat, ctx: ReportContext): string {
  if (format === 'sarif') return buildSarifReport(ctx)
  if (format === 'markdown') return buildMarkdownReport(ctx)
  return buildJsonReport(ctx)
}
