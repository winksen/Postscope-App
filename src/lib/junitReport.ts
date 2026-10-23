import type { Finding } from './auditor'
import type { ReportContext } from './reportExport'
import { findingOccurrences } from './occurrences'
import { isSeverity, severityRank, type Severity } from './severity'

/**
 * JUnit XML for CI "tests" tabs (GitLab, Azure DevOps, Jenkins, CircleCI). One suite per collection and one test case
 * per finding: findings at or above the failing severity are failures, the rest pass with their details attached, and
 * suppressed findings are skipped with their reason. Only masked evidence is written.
 */
export type FailOn = Severity | 'none'

const MAX_DETAIL_LINES = 25

/** Removes characters XML 1.0 cannot carry, then escapes the five special ones. */
export function escapeXml(value: unknown): string {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char] as string)
}

function details(finding: Finding, labels: Map<string, string>): string {
  const lines = [finding.description, `Recommendation: ${finding.recommendation}`]
  const rows = findingOccurrences(finding)
  for (const occurrence of rows.slice(0, MAX_DETAIL_LINES)) {
    const evidence = finding.evidence?.find((entry) => entry.requestId === occurrence.requestId && entry.location === occurrence.location)
    const where = occurrence.requestId ? labels.get(occurrence.requestId) ?? occurrence.requestId : 'collection'
    lines.push(`- ${where}${occurrence.location ? `: ${occurrence.location}` : ''}${evidence?.preview ? ` = ${evidence.preview}` : ''}`)
  }
  if (rows.length > MAX_DETAIL_LINES) lines.push(`- and ${rows.length - MAX_DETAIL_LINES} more`)
  return lines.join('\n')
}

export function buildJunitReport(contexts: ReportContext[], { failOn = 'critical' }: { failOn?: FailOn } = {}): string {
  const failing = (severity: Severity) => failOn !== 'none' && isSeverity(failOn) && severityRank(severity) <= severityRank(failOn)
  let totalTests = 0
  let totalFailures = 0
  let totalSkipped = 0
  const suites: string[] = []

  for (const ctx of contexts) {
    const labels = new Map(ctx.parsed.requests.map((request) => [request.id, request.folderPath.length ? `${request.folderPath.join(' / ')} / ${request.name}` : request.name]))
    const classname = escapeXml(ctx.parsed.name)
    const cases: string[] = []
    let failures = 0
    let skipped = 0

    for (const finding of ctx.findings) {
      const name = escapeXml(`${finding.ruleId}: ${finding.title}${finding.affected.length ? ` (${finding.affected.length})` : ''}`)
      const text = escapeXml(details(finding, labels))
      if (failing(finding.severity)) {
        failures += 1
        cases.push(`    <testcase classname="${classname}" name="${name}"><failure message="${escapeXml(finding.title)}" type="${escapeXml(finding.severity)}">${text}</failure></testcase>`)
      } else {
        cases.push(`    <testcase classname="${classname}" name="${name}"><system-out>${text}</system-out></testcase>`)
      }
    }
    for (const finding of ctx.suppressed ?? []) {
      skipped += 1
      const reason = finding.suppressions[0]?.reason ?? 'accepted'
      cases.push(`    <testcase classname="${classname}" name="${escapeXml(`${finding.ruleId}: ${finding.title} (suppressed)`)}"><skipped message="${escapeXml(`Suppressed: ${reason}`)}"/></testcase>`)
    }
    if (cases.length === 0) cases.push(`    <testcase classname="${classname}" name="No findings"/>`)

    totalTests += cases.length
    totalFailures += failures
    totalSkipped += skipped
    suites.push(
      `  <testsuite name="${classname}" tests="${cases.length}" failures="${failures}" errors="0" skipped="${skipped}" timestamp="${(ctx.generatedAt ?? new Date()).toISOString()}"${ctx.sourceName ? ` file="${escapeXml(ctx.sourceName)}"` : ''}>
    <properties>
      <property name="score" value="${ctx.score.total}"/>
      <property name="security" value="${ctx.score.security}"/>
      <property name="hygiene" value="${ctx.score.hygiene}"/>
      <property name="grade" value="${escapeXml(ctx.score.grade)}"/>
      <property name="failOn" value="${escapeXml(failOn)}"/>
    </properties>
${cases.join('\n')}
  </testsuite>`
    )
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="PostScope" tests="${totalTests}" failures="${totalFailures}" errors="0" skipped="${totalSkipped}">
${suites.join('\n')}
</testsuites>
`
}
