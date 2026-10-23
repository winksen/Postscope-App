/**
 * PostScope CLI: audit Postman collections in CI with the same engine as the web app.
 *
 *   npm run scan -- collection.json --format sarif --output postscope.sarif --fail-on critical
 *
 * Exit codes: 0 = passed, 1 = policy failed (findings at/above --fail-on or score below --min-score),
 * 2 = usage or input error.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCollection } from '../src/lib/parser'
import { runAudit, sanitizeAuditOptions, type AuditOptions, type Finding } from '../src/lib/auditor'
import { calculateScore } from '../src/lib/scorer'
import { buildJsonReport, buildMarkdownReport, buildSarifReport, type ReportContext } from '../src/lib/reportExport'
import { redactCollection } from '../src/lib/redaction'
import { RULE_LIST } from '../src/lib/rules'
import { readPackageVersion } from '../server/appVersion'
import { isSeverity, severityRank, type Severity } from '../src/lib/severity'

type Format = 'text' | 'json' | 'sarif' | 'markdown'
type FailOn = Severity | 'none'

interface CliOptions {
  inputs: string[]
  format: Format
  output?: string
  failOn: FailOn
  minScore?: number
  audit: AuditOptions
  sanitize?: string
  quiet: boolean
}

const HELP = `PostScope CLI: audit Postman collections for secrets, auth gaps, and hygiene.

Usage: npm run scan -- [options] <collection.json ...>   (use "-" to read stdin)

Options:
  -f, --format <text|json|sarif|markdown>  Report format (default: text)
  -o, --output <file>                      Write the report to a file instead of stdout
      --fail-on <critical|warning|info|none>
                                           Exit 1 when a finding at or above this severity exists (default: critical)
      --min-score <0-100>                  Exit 1 when any collection scores below this value
      --disable <RULE,RULE>                Disable rules (see --list-rules)
      --severity <RULE=level,...>          Override rule severities (critical, warning, info)
      --sanitize <file>                    Write a copy with credentials replaced by {{variables}} (single input)
      --list-rules                         Print every rule id and exit
  -q, --quiet                              Only print the report (no summary on stderr)
  -v, --version                            Print the version
  -h, --help                               Show this help
`

class UsageError extends Error {}

function readVersion(): string {
  return readPackageVersion() ?? process.env.APP_VERSION ?? 'unknown'
}

function parseArgs(argv: string[]): CliOptions | 'help' | 'version' | 'rules' {
  const options: CliOptions = { inputs: [], format: 'text', failOn: 'critical', audit: {}, quiet: false }
  const disabled: string[] = []
  const overrides: Record<string, string> = {}

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const value = () => {
      const next = argv[++i]
      if (next === undefined) throw new UsageError(`Missing value for ${arg}`)
      return next
    }
    switch (arg) {
      case '-h':
      case '--help':
        return 'help'
      case '-v':
      case '--version':
        return 'version'
      case '--list-rules':
        return 'rules'
      case '-f':
      case '--format': {
        const format = value()
        if (!['text', 'json', 'sarif', 'markdown'].includes(format)) throw new UsageError(`Unknown format "${format}"`)
        options.format = format as Format
        break
      }
      case '-o':
      case '--output':
        options.output = value()
        break
      case '--fail-on': {
        const level = value()
        if (level !== 'none' && !isSeverity(level)) throw new UsageError(`Unknown --fail-on level "${level}"`)
        options.failOn = level as FailOn
        break
      }
      case '--min-score': {
        const score = Number(value())
        if (!Number.isFinite(score) || score < 0 || score > 100) throw new UsageError('--min-score must be between 0 and 100')
        options.minScore = score
        break
      }
      case '--disable':
        disabled.push(...value().split(',').map((rule) => rule.trim().toUpperCase()).filter(Boolean))
        break
      case '--severity':
        for (const pair of value().split(',')) {
          const [rule, level] = pair.split('=').map((part) => part.trim())
          if (!rule || !level || !isSeverity(level)) throw new UsageError(`Invalid --severity entry "${pair}"`)
          overrides[rule.toUpperCase()] = level
        }
        break
      case '--sanitize':
        options.sanitize = value()
        break
      case '-q':
      case '--quiet':
        options.quiet = true
        break
      default:
        if (arg.startsWith('-') && arg !== '-') throw new UsageError(`Unknown option "${arg}"`)
        options.inputs.push(arg)
    }
  }

  const known = new Set<string>(RULE_LIST.map((rule) => rule.id))
  const unknownRules = [...disabled, ...Object.keys(overrides)].filter((rule) => !known.has(rule))
  if (unknownRules.length) throw new UsageError(`Unknown rule id(s): ${unknownRules.join(', ')}`)
  options.audit = sanitizeAuditOptions({ disabledRules: disabled, severityOverrides: overrides })

  if (!options.inputs.length) throw new UsageError('Provide at least one collection file.')
  if (options.sanitize && options.inputs.length > 1) throw new UsageError('--sanitize works with a single input.')
  return options
}

function readInput(input: string): string {
  if (input === '-') return fs.readFileSync(0, 'utf8')
  return fs.readFileSync(input, 'utf8')
}

interface AnalyzedFile {
  input: string
  ctx: ReportContext
}

function analyzeFile(input: string, audit: AuditOptions, appVersion: string): { result: AnalyzedFile; json: unknown } {
  let json: unknown
  try {
    json = JSON.parse(readInput(input))
  } catch (error) {
    throw new UsageError(`${input}: not valid JSON (${error instanceof Error ? error.message : String(error)})`)
  }
  // Accept PostScope library records ({ rawJson }) as well as plain exports.
  if (json && typeof json === 'object' && typeof (json as { rawJson?: unknown }).rawJson === 'string') {
    json = JSON.parse((json as { rawJson: string }).rawJson)
  }
  let parsed
  try {
    parsed = parseCollection(json)
  } catch {
    throw new UsageError(`${input}: not a Postman collection (missing item array)`)
  }
  const findings = runAudit(parsed, audit)
  const score = calculateScore(parsed, findings)
  return {
    result: { input, ctx: { parsed, findings, score, appVersion, sourceName: input === '-' ? undefined : path.basename(input) } },
    json,
  }
}

function textReport(files: AnalyzedFile[], appVersion: string): string {
  const lines: string[] = []
  for (const { input, ctx } of files) {
    const counts = { critical: 0, warning: 0, info: 0 }
    ctx.findings.forEach((finding) => (counts[finding.severity] += 1))
    lines.push(`PostScope ${appVersion}  ${ctx.parsed.name}  (${input === '-' ? 'stdin' : input}, ${ctx.parsed.totalRequests} requests)`)
    lines.push(`Score ${ctx.score.total}/100 (grade ${ctx.score.grade})  ·  ${counts.critical} critical, ${counts.warning} warning, ${counts.info} info`)
    const labels = new Map(ctx.parsed.requests.map((r) => [r.id, r.folderPath.length ? `${r.folderPath.join(' / ')} / ${r.name}` : r.name]))
    for (const finding of ctx.findings) {
      lines.push(`  ${finding.severity.toUpperCase().padEnd(8)} ${finding.ruleId.padEnd(30)} ${finding.title}${finding.affected.length ? ` (${finding.affected.length})` : ''}`)
      for (const evidence of (finding.evidence ?? []).slice(0, 3)) {
        const where = evidence.requestId ? labels.get(evidence.requestId) ?? evidence.requestId : 'collection'
        lines.push(`           ↳ ${where}: ${evidence.location}${evidence.preview ? ` = ${evidence.preview}` : ''}`)
      }
    }
    lines.push('')
  }
  return lines.join('\n')
}

function render(files: AnalyzedFile[], format: Format, appVersion: string): string {
  if (format === 'text') return textReport(files, appVersion)
  if (format === 'markdown') return files.map(({ ctx }) => buildMarkdownReport(ctx)).join('\n\n---\n\n')
  if (format === 'json') {
    const reports = files.map(({ ctx }) => JSON.parse(buildJsonReport(ctx)) as unknown)
    return JSON.stringify(reports.length === 1 ? reports[0] : reports, null, 2)
  }
  const logs = files.map(({ ctx }) => JSON.parse(buildSarifReport(ctx)) as { runs: unknown[] })
  const merged = { ...logs[0], runs: logs.flatMap((log) => log.runs) }
  return JSON.stringify(merged, null, 2)
}

function failingFindings(findings: Finding[], failOn: FailOn): Finding[] {
  if (failOn === 'none') return []
  return findings.filter((finding) => severityRank(finding.severity) <= severityRank(failOn))
}

export function main(argv: string[]): number {
  const appVersion = readVersion()
  let options: ReturnType<typeof parseArgs>
  try {
    options = parseArgs(argv)
  } catch (error) {
    process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n\n${HELP}`)
    return 2
  }
  if (options === 'help') {
    process.stdout.write(HELP)
    return 0
  }
  if (options === 'version') {
    process.stdout.write(`${appVersion}\n`)
    return 0
  }
  if (options === 'rules') {
    for (const rule of RULE_LIST) process.stdout.write(`${rule.id.padEnd(30)} ${rule.severity.padEnd(8)} ${rule.category.padEnd(9)} ${rule.title}\n`)
    return 0
  }

  const files: AnalyzedFile[] = []
  try {
    for (const input of options.inputs) {
      const { result, json } = analyzeFile(input, options.audit, appVersion)
      files.push(result)
      if (options.sanitize) {
        const { json: sanitized, redactedCount } = redactCollection(json)
        fs.writeFileSync(options.sanitize, JSON.stringify(sanitized, null, 2))
        if (!options.quiet) process.stderr.write(`Sanitized copy written to ${options.sanitize} (${redactedCount} value(s) replaced)\n`)
      }
    }
  } catch (error) {
    process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`)
    return 2
  }

  const report = render(files, options.format, appVersion)
  if (options.output) fs.writeFileSync(options.output, report)
  else process.stdout.write(report.endsWith('\n') ? report : `${report}\n`)

  const failures = files.flatMap(({ ctx }) => failingFindings(ctx.findings, options.failOn))
  const lowScores = options.minScore === undefined ? [] : files.filter(({ ctx }) => ctx.score.total < (options.minScore ?? 0))
  const passed = failures.length === 0 && lowScores.length === 0

  if (!options.quiet) {
    const reasons = [
      failures.length ? `${failures.length} finding(s) at or above "${options.failOn}"` : '',
      lowScores.length ? `${lowScores.length} collection(s) below score ${options.minScore}` : '',
    ].filter(Boolean)
    process.stderr.write(passed ? 'PostScope: PASS\n' : `PostScope: FAIL (${reasons.join('; ')})\n`)
  }
  return passed ? 0 : 1
}

const invokedDirectly = !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) process.exitCode = main(process.argv.slice(2))
