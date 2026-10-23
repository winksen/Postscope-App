import { escapeMarkdown } from './reportExport'
import type { ComparedFinding, ComparedRequest, Comparison } from './compare'

/** Version of the JSON comparison document. */
export const COMPARISON_REPORT_VERSION = 1

const MAX_LISTED = 50

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value)
}

function requestLabel(request: ComparedRequest): string {
  return `${request.method} ${request.folder ? `${request.folder} / ` : ''}${request.name}`
}

function findingLabel(finding: ComparedFinding): string {
  const where = finding.requestName ?? finding.requestId
  return `${finding.severity.toUpperCase()} ${finding.ruleId}${where ? ` in ${where}` : ''}${finding.location ? ` (${finding.location})` : ''}`
}

function capped<T>(items: T[], render: (item: T) => string, indent: string): string[] {
  const lines = items.slice(0, MAX_LISTED).map((item) => `${indent}${render(item)}`)
  if (items.length > MAX_LISTED) lines.push(`${indent}... and ${items.length - MAX_LISTED} more`)
  return lines
}

export function buildComparisonText(comparison: Comparison): string {
  const { before, after, scoreDelta, requests, findings } = comparison
  const lines: string[] = []
  lines.push(`PostScope comparison: ${before.name} -> ${after.name}`)
  lines.push(`Score ${before.score} -> ${after.score} (${signed(scoreDelta.total)}), security ${signed(scoreDelta.security)}, hygiene ${signed(scoreDelta.hygiene)}`)
  lines.push(`Requests ${before.totalRequests} -> ${after.totalRequests}: ${requests.added.length} added, ${requests.removed.length} removed, ${requests.changed.length} changed, ${requests.unchanged} unchanged`)
  lines.push(`Findings: ${findings.added.length} new, ${findings.resolved.length} resolved, ${findings.unchanged} unchanged`)
  if (findings.added.length) lines.push('', 'New findings', ...capped(findings.added, findingLabel, '  '))
  if (findings.resolved.length) lines.push('', 'Resolved findings', ...capped(findings.resolved, findingLabel, '  '))
  if (requests.added.length) lines.push('', 'Added requests', ...capped(requests.added, requestLabel, '  '))
  if (requests.removed.length) lines.push('', 'Removed requests', ...capped(requests.removed, requestLabel, '  '))
  if (requests.changed.length) {
    lines.push('', 'Changed requests', ...capped(requests.changed, (change) => `${requestLabel(change.after)} (${change.fields.join(', ')})`, '  '))
  }
  if (comparison.newHosts.length) lines.push('', `New hosts: ${comparison.newHosts.join(', ')}`)
  if (comparison.removedHosts.length) lines.push('', `Removed hosts: ${comparison.removedHosts.join(', ')}`)
  if (comparison.newAuthTypes.length) lines.push('', `New auth types: ${comparison.newAuthTypes.join(', ')}`)
  if (comparison.removedAuthTypes.length) lines.push('', `Removed auth types: ${comparison.removedAuthTypes.join(', ')}`)
  return `${lines.join('\n')}\n`
}

function table(headers: string[], rows: string[][]): string[] {
  return [`| ${headers.join(' | ')} |`, `|${headers.map(() => '---').join('|')}|`, ...rows.map((row) => `| ${row.join(' | ')} |`)]
}

function bulletList(title: string, items: string[]): string[] {
  if (!items.length) return []
  const shown = items.slice(0, MAX_LISTED).map((item) => `- ${item}`)
  if (items.length > MAX_LISTED) shown.push(`- ... and ${items.length - MAX_LISTED} more`)
  return [`## ${title}`, '', ...shown, '']
}

/** Markdown for a pull request comment or job summary. */
export function buildComparisonMarkdown(comparison: Comparison): string {
  const { before, after, scoreDelta, requests, findings } = comparison
  const lines: string[] = [`# PostScope comparison: ${escapeMarkdown(before.name)} to ${escapeMarkdown(after.name)}`, '']
  lines.push(
    ...table(
      ['', 'Before', 'After', 'Change'],
      [
        ['Score', `${before.score} (${before.grade})`, `${after.score} (${after.grade})`, signed(scoreDelta.total)],
        ['Security', String(before.security), String(after.security), signed(scoreDelta.security)],
        ['Hygiene', String(before.hygiene), String(after.hygiene), signed(scoreDelta.hygiene)],
        ['Requests', String(before.totalRequests), String(after.totalRequests), signed(after.totalRequests - before.totalRequests)],
        ['Findings', String(before.findingCount), String(after.findingCount), signed(after.findingCount - before.findingCount)],
      ]
    ),
    ''
  )
  lines.push(`${findings.added.length} new, ${findings.resolved.length} resolved and ${findings.unchanged} unchanged finding occurrence(s).`, '')
  lines.push(...bulletList('New findings', findings.added.map((finding) => escapeMarkdown(findingLabel(finding)))))
  lines.push(...bulletList('Resolved findings', findings.resolved.map((finding) => escapeMarkdown(findingLabel(finding)))))
  lines.push(...bulletList('Added requests', requests.added.map((request) => escapeMarkdown(requestLabel(request)))))
  lines.push(...bulletList('Removed requests', requests.removed.map((request) => escapeMarkdown(requestLabel(request)))))
  lines.push(...bulletList('Changed requests', requests.changed.map((change) => `${escapeMarkdown(requestLabel(change.after))} (${change.fields.join(', ')})`)))
  lines.push(...bulletList('New hosts', comparison.newHosts.map((host) => `\`${host}\``)))
  lines.push(...bulletList('New auth types', comparison.newAuthTypes.map((type) => `\`${type}\``)))
  return `${lines.join('\n').trimEnd()}\n`
}

export function buildComparisonJson(comparison: Comparison, appVersion?: string): string {
  return JSON.stringify({ tool: 'PostScope', version: appVersion, reportVersion: COMPARISON_REPORT_VERSION, kind: 'comparison', ...comparison }, null, 2)
}
