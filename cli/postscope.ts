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
import { runAuditDetailed, sanitizeAuditOptions, type AuditOptions, type Finding } from '../src/lib/auditor'
import { calculateScore } from '../src/lib/scorer'
import { buildJsonReport, buildMarkdownReport, buildSarifReport, type ReportContext } from '../src/lib/reportExport'
import { renderHtmlReports } from '../src/lib/htmlReport'
import { buildJunitReport } from '../src/lib/junitReport'
import { expandInputs, findSiblingEnvironments } from './inputs'
import { attachEvidencePointers } from '../src/lib/evidencePointers'
import { redactCollection, redactEnvironment } from '../src/lib/redaction'
import { CONFIG_FILE_NAME, parseProjectConfig, type ProjectConfig } from '../src/lib/projectConfig'
import { applyBaseline, buildBaseline, parseBaseline, type Baseline } from '../src/lib/baseline'
import { attachEnvironments, detectEnvironmentKind, parseEnvironment, type EnvironmentKind } from '../src/lib/environment'
import { RULE_LIST } from '../src/lib/rules'
import { parseRulePacks, type RulePackSettings } from '../src/lib/rulePacks'
import { compareCollections, newFindingsAtOrAbove } from '../src/lib/compare'
import { buildComparisonJson, buildComparisonMarkdown, buildComparisonText } from '../src/lib/compareReport'
import { readPackageVersion } from '../server/appVersion'
import { isSeverity, parseScoreWeights, severityRank, type ScoreWeights, type Severity } from '../src/lib/severity'

type Format = 'text' | 'json' | 'sarif' | 'markdown' | 'html' | 'junit'
type FailOn = Severity | 'none'

interface CliOptions {
  inputs: string[]
  format: Format
  output?: string
  failOn: FailOn
  minScore?: number
  audit: AuditOptions
  weights?: ScoreWeights
  /** Project config file (`.postscope.json`); discovered upward from each input when omitted. */
  config?: string
  noConfig: boolean
  baseline?: string
  writeBaseline?: string
  sanitize?: string
  /** Also remove personal data from the sanitized copy (`--redact-pii`). */
  redactPii: boolean
  /** Postman environment and globals export files (applied to every collection). */
  environments: Array<{ file: string; globals: boolean }>
  /** Also analyze the environment and globals files stored next to each collection. */
  autoEnv: boolean
  quiet: boolean
}

const HELP = `PostScope CLI: audit Postman collections for secrets, auth gaps, and hygiene.

Usage: postscope [scan] [options] <collection.json | folder | glob ...>   (use "-" to read stdin)
       postscope diff <old.json> <new.json> [options]   (compare two versions, see "postscope diff --help")
       npm run scan -- [options] <...>

Folders are searched for *.postman_collection.json. Quote globs so the tool expands them on every shell:
  postscope scan "collections/**/*.postman_collection.json" --fail-on warning

Options:
  -f, --format <text|json|sarif|markdown|html|junit>
                                           Report format (default: text). html is one self-contained file without scripts;
                                           junit is for the tests tab of GitLab, Azure DevOps and Jenkins
  -o, --output <file>                      Write the report to a file instead of stdout
      --fail-on <critical|warning|info|none>
                                           Exit 1 when a finding at or above this severity exists (default: critical)
      --min-score <0-100>                  Exit 1 when any collection scores below this value
      --disable <RULE,RULE>                Disable rules (see --list-rules)
      --severity <RULE=level,...>          Override rule severities (critical, warning, info)
      --packs <auto|none|PACK,-PACK,...>   Rule packs: auto (default) turns the identity packs on when the collection shows identity
                                           signals; list packs to force them on, prefix with - to force them off, none switches them
                                           all off (packs: iam-am, iam-iga, iam-pam, iam-platform)
      --config <file>                      Project config (default: the nearest .postscope.json above the input file)
      --no-config                          Ignore any .postscope.json
      --baseline <file>                    Report and fail only on findings that are not in this baseline file
      --write-baseline <file>              Write the current findings as a baseline and exit 0
      --weights <critical=N,warning=N,info=N>
                                           Points deducted per finding severity (default critical=20,warning=8,info=2)
      --sanitize <file>                    Write a copy with credentials replaced by {{variables}} (single input).
                                           Environment files are written next to it as <name>.sanitized.postman_environment.json
      --redact-pii                         With --sanitize, also replace personal data (emails, phone and card numbers, IBANs, national ids,
                                           dates of birth, employee ids) in request bodies and saved examples
      --auto-env                           Also use the *.postman_environment.json and *.postman_globals.json next to each collection
  -e, --environment <file>                 Postman environment export to analyze with the collections (repeatable)
      --globals <file>                     Postman globals export to analyze with the collections (repeatable)
      --list-rules                         Print every rule id and exit
  -q, --quiet                              Only print the report (no summary on stderr)
  -v, --version                            Print the version
  -h, --help                               Show this help
`

class UsageError extends Error {}

function readVersion(): string {
  return readPackageVersion() ?? process.env.APP_VERSION ?? 'unknown'
}

function parseArgs(rawArgv: string[]): CliOptions | 'help' | 'version' | 'rules' {
  // `postscope scan <paths>` is the documented form; the bare form keeps working for existing scripts.
  const argv = rawArgv[0] === 'scan' ? rawArgv.slice(1) : rawArgv
  const options: CliOptions = {
    inputs: [],
    format: 'text',
    failOn: 'critical',
    audit: {},
    environments: [],
    autoEnv: false,
    noConfig: false,
    quiet: false,
    redactPii: false,
  }
  const disabled: string[] = []
  const overrides: Record<string, string> = {}
  let rulePacks: RulePackSettings | undefined

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
        if (!['text', 'json', 'sarif', 'markdown', 'html', 'junit'].includes(format)) throw new UsageError(`Unknown format "${format}"`)
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
        disabled.push(
          ...value()
            .split(',')
            .map((rule) => rule.trim().toUpperCase())
            .filter(Boolean)
        )
        break
      case '--severity':
        for (const pair of value().split(',')) {
          const [rule, level] = pair.split('=').map((part) => part.trim())
          if (!rule || !level || !isSeverity(level)) throw new UsageError(`Invalid --severity entry "${pair}"`)
          overrides[rule.toUpperCase()] = level
        }
        break
      case '--packs': {
        const parsed = parseRulePacks(value())
        if (parsed.errors.length) throw new UsageError(`Invalid --packs: ${parsed.errors.join('; ')}`)
        rulePacks = parsed.settings
        break
      }
      case '--config':
        options.config = value()
        break
      case '--no-config':
        options.noConfig = true
        break
      case '--baseline':
        options.baseline = value()
        break
      case '--write-baseline':
        options.writeBaseline = value()
        break
      case '--weights': {
        const parsed = parseScoreWeights(value())
        if (parsed.errors.length) throw new UsageError(`Invalid --weights: ${parsed.errors.join('; ')}`)
        options.weights = parsed.weights
        break
      }
      case '--sanitize':
        options.sanitize = value()
        break
      case '--redact-pii':
        options.redactPii = true
        break
      case '-e':
      case '--environment':
        options.environments.push({ file: value(), globals: false })
        break
      case '--globals':
        options.environments.push({ file: value(), globals: true })
        break
      case '--auto-env':
        options.autoEnv = true
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
  options.audit = sanitizeAuditOptions({ disabledRules: disabled, severityOverrides: overrides, rulePacks })

  if (!options.inputs.length) throw new UsageError('Provide at least one collection file.')
  if (options.redactPii && !options.sanitize) throw new UsageError('--redact-pii needs --sanitize <file>.')
  if (options.baseline && options.writeBaseline) throw new UsageError('Use either --baseline or --write-baseline, not both.')
  if (options.config && options.noConfig) throw new UsageError('Use either --config or --no-config, not both.')
  return options
}

function readInput(input: string): string {
  if (input === '-') return fs.readFileSync(0, 'utf8')
  return fs.readFileSync(input, 'utf8')
}

interface AnalyzedFile {
  input: string
  ctx: ReportContext
  /** Project config file that applied to this input, if any. */
  configFile?: string
  /** Active findings before the baseline was applied (what `--write-baseline` records). */
  beforeBaseline: Finding[]
}

/** Finds the nearest `.postscope.json` at or above the input's folder (the working folder for stdin). */
function discoverConfig(input: string): string | undefined {
  let dir = input === '-' ? process.cwd() : path.dirname(path.resolve(input))
  for (;;) {
    const candidate = path.join(dir, CONFIG_FILE_NAME)
    if (fs.existsSync(candidate)) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

function loadProjectConfig(file: string): ProjectConfig {
  let json: unknown
  try {
    json = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw new UsageError(`${file}: cannot read project config (${error instanceof Error ? error.message : String(error)})`)
  }
  const { config, errors } = parseProjectConfig(json)
  if (errors.length) throw new UsageError(`${file}: invalid project config\n  - ${errors.join('\n  - ')}`)
  return config
}

/** Config file values are defaults; command line flags add to them or override them. */
function mergeAuditOptions(cli: AuditOptions, config: ProjectConfig | undefined): AuditOptions {
  if (!config) return cli
  const merged = sanitizeAuditOptions({
    disabledRules: [...new Set([...(config.disabledRules ?? []), ...(cli.disabledRules ?? [])])],
    severityOverrides: { ...config.severityOverrides, ...cli.severityOverrides },
    rulePacks: cli.rulePacks ?? config.rulePacks,
  })
  return { ...merged, suppressions: config.suppressions }
}

function loadBaseline(file: string): Baseline {
  try {
    return parseBaseline(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch (error) {
    throw new UsageError(`${file}: cannot read baseline (${error instanceof Error ? error.message : String(error)})`)
  }
}

interface LoadedEnvironment {
  file: string
  text: string
  json: unknown
  kind: EnvironmentKind
  name: string
}

function loadEnvironments(entries: CliOptions['environments']): LoadedEnvironment[] {
  return entries.map(({ file, globals }) => {
    let text: string
    let json: unknown
    try {
      text = fs.readFileSync(file, 'utf8')
      json = JSON.parse(text)
    } catch (error) {
      throw new UsageError(`${file}: cannot read environment file (${error instanceof Error ? error.message : String(error)})`)
    }
    const kind = detectEnvironmentKind(json, file)
    if (!kind) throw new UsageError(`${file}: not a Postman environment or globals export (missing values array)`)
    if (globals && kind !== 'globals')
      throw new UsageError(`${file}: --globals expects a globals export; use --environment for environment files`)
    return { file, text, json, kind, name: parseEnvironment(json, file).name }
  })
}

/** `dev.postman_environment.json` becomes `dev`. */
function environmentStem(file: string): string {
  return path
    .basename(file)
    .replace(/\.postman_(?:environment|globals)\.json$/i, '')
    .replace(/\.json$/i, '')
}

function analyzeFile(
  input: string,
  options: CliOptions,
  appVersion: string,
  environments: LoadedEnvironment[],
  baseline?: Baseline
): { result: AnalyzedFile; json: unknown } {
  let json: unknown
  let sourceText = ''
  try {
    sourceText = readInput(input)
    json = JSON.parse(sourceText)
  } catch (error) {
    throw new UsageError(`${input}: not valid JSON (${error instanceof Error ? error.message : String(error)})`)
  }
  // Accept PostScope library records ({ rawJson }) as well as plain exports.
  if (json && typeof json === 'object' && typeof (json as { rawJson?: unknown }).rawJson === 'string') {
    sourceText = (json as { rawJson: string }).rawJson
    json = JSON.parse(sourceText)
  }
  let parsed
  try {
    parsed = attachEnvironments(
      parseCollection(json),
      environments.map((environment) => environment.text)
    )
  } catch {
    throw new UsageError(`${input}: not a Postman collection (missing item array)`)
  }
  const configFile = options.noConfig ? undefined : (options.config ?? discoverConfig(input))
  const config = configFile ? loadProjectConfig(configFile) : undefined
  const { findings: allActive, suppressed } = runAuditDetailed(parsed, mergeAuditOptions(options.audit, config))
  const applied = baseline ? applyBaseline(allActive, baseline) : undefined
  const findings = applied ? applied.findings : allActive
  const score = calculateScore(parsed, findings, options.weights ?? config?.weights)
  const located = attachEvidencePointers(json, parsed, findings)
  return {
    result: {
      input,
      configFile,
      beforeBaseline: allActive,
      ctx: {
        parsed,
        findings: located,
        score,
        appVersion,
        sourceName: input === '-' ? undefined : path.basename(input),
        suppressed: attachEvidencePointers(json, parsed, suppressed),
        baselined: applied?.hidden,
        sourceText,
      },
    },
    json,
  }
}

function textReport(files: AnalyzedFile[], appVersion: string): string {
  const lines: string[] = []
  for (const { input, ctx } of files) {
    const counts = { critical: 0, warning: 0, info: 0 }
    ctx.findings.forEach((finding) => (counts[finding.severity] += 1))
    lines.push(`PostScope ${appVersion}  ${ctx.parsed.name}  (${input === '-' ? 'stdin' : input}, ${ctx.parsed.totalRequests} requests)`)
    if (ctx.parsed.environments?.length)
      lines.push(`Environments: ${ctx.parsed.environments.map((environment) => `${environment.name} (${environment.kind})`).join(', ')}`)
    lines.push(
      `Score ${ctx.score.total}/100 (grade ${ctx.score.grade}, security ${ctx.score.security}, hygiene ${ctx.score.hygiene})  ·  ${counts.critical} critical, ${counts.warning} warning, ${counts.info} info`
    )
    const labels = new Map(ctx.parsed.requests.map((r) => [r.id, r.folderPath.length ? `${r.folderPath.join(' / ')} / ${r.name}` : r.name]))
    for (const finding of ctx.findings) {
      lines.push(
        `  ${finding.severity.toUpperCase().padEnd(8)} ${finding.ruleId.padEnd(30)} ${finding.title}${finding.affected.length ? ` (${finding.affected.length})` : ''}`
      )
      for (const evidence of (finding.evidence ?? []).slice(0, 3)) {
        const where = evidence.requestId ? (labels.get(evidence.requestId) ?? evidence.requestId) : 'collection'
        lines.push(`           ↳ ${where}: ${evidence.location}${evidence.preview ? ` = ${evidence.preview}` : ''}`)
      }
    }
    lines.push('')
  }
  return lines.join('\n')
}

function render(files: AnalyzedFile[], format: Format, appVersion: string, failOn: FailOn): string {
  if (format === 'text') return textReport(files, appVersion)
  if (format === 'markdown') return files.map(({ ctx }) => buildMarkdownReport(ctx)).join('\n\n---\n\n')
  if (format === 'html') return renderHtmlReports(files.map(({ ctx }) => ctx))
  if (format === 'junit')
    return buildJunitReport(
      files.map(({ ctx }) => ctx),
      { failOn }
    )
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

const DIFF_HELP = `PostScope diff: compare two versions of a Postman collection.

Usage: postscope diff <old.json> <new.json> [options]

Requests are matched by id, then by method and URL (so a rename is not a change of request). Findings are matched by
occurrence, so only findings that really appeared or disappeared are listed. Library records are accepted.

Options:
  -f, --format <text|json|markdown>        Output format (default: text)
  -o, --output <file>                      Write the comparison to a file instead of stdout
      --fail-on-new <critical|warning|info|none>
                                           Exit 1 when a finding at or above this severity is new (default: critical)
      --disable <RULE,RULE>                Disable rules for both collections
      --severity <RULE=level,...>          Override rule severities for both collections
      --config <file>                      Project config (default: the nearest .postscope.json above each file)
      --no-config                          Ignore any .postscope.json
  -q, --quiet                              Only print the comparison (no summary on stderr)
  -h, --help                               Show this help

Exit codes: 0 passed, 1 new findings at or above --fail-on-new, 2 usage or input error.
`

type DiffFormat = 'text' | 'json' | 'markdown'

interface DiffOptions {
  before: string
  after: string
  format: DiffFormat
  output?: string
  failOnNew: FailOn
  audit: AuditOptions
  config?: string
  noConfig: boolean
  quiet: boolean
}

function parseDiffArgs(argv: string[]): DiffOptions | 'help' {
  const paths: string[] = []
  const disabled: string[] = []
  const overrides: Record<string, string> = {}
  const options: Omit<DiffOptions, 'before' | 'after' | 'audit'> = { format: 'text', failOnNew: 'critical', noConfig: false, quiet: false }
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
      case '-f':
      case '--format': {
        const format = value()
        if (!['text', 'json', 'markdown'].includes(format))
          throw new UsageError(`Unknown diff format "${format}" (use text, json or markdown)`)
        options.format = format as DiffFormat
        break
      }
      case '-o':
      case '--output':
        options.output = value()
        break
      case '--fail-on-new': {
        const level = value()
        if (level !== 'none' && !isSeverity(level)) throw new UsageError(`Unknown --fail-on-new level "${level}"`)
        options.failOnNew = level as FailOn
        break
      }
      case '--disable':
        disabled.push(
          ...value()
            .split(',')
            .map((rule) => rule.trim().toUpperCase())
            .filter(Boolean)
        )
        break
      case '--severity':
        for (const pair of value().split(',')) {
          const [rule, level] = pair.split('=').map((part) => part.trim())
          if (!rule || !level || !isSeverity(level)) throw new UsageError(`Invalid --severity entry "${pair}"`)
          overrides[rule.toUpperCase()] = level
        }
        break
      case '--config':
        options.config = value()
        break
      case '--no-config':
        options.noConfig = true
        break
      case '-q':
      case '--quiet':
        options.quiet = true
        break
      default:
        if (arg.startsWith('-')) throw new UsageError(`Unknown option "${arg}"`)
        paths.push(arg)
    }
  }
  const known = new Set<string>(RULE_LIST.map((rule) => rule.id))
  const unknownRules = [...disabled, ...Object.keys(overrides)].filter((rule) => !known.has(rule))
  if (unknownRules.length) throw new UsageError(`Unknown rule id(s): ${unknownRules.join(', ')}`)
  if (paths.length !== 2) throw new UsageError('Provide exactly two collection files: the old one and the new one.')
  if (options.config && options.noConfig) throw new UsageError('Use either --config or --no-config, not both.')
  return {
    ...options,
    before: paths[0],
    after: paths[1],
    audit: sanitizeAuditOptions({ disabledRules: disabled, severityOverrides: overrides }),
  }
}

function runDiff(argv: string[], appVersion: string): number {
  let options: DiffOptions | 'help'
  try {
    options = parseDiffArgs(argv)
  } catch (error) {
    process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n\n${DIFF_HELP}`)
    return 2
  }
  if (options === 'help') {
    process.stdout.write(DIFF_HELP)
    return 0
  }

  let output: string
  let newFindings: number
  try {
    // Reuses the scan pipeline, so config, suppressions, severity overrides and library records behave the same way.
    const scanOptions: CliOptions = {
      inputs: [],
      format: 'json',
      failOn: 'none',
      audit: options.audit,
      environments: [],
      autoEnv: false,
      noConfig: options.noConfig,
      config: options.config,
      quiet: true,
      redactPii: false,
    }
    const [older, newer] = [options.before, options.after].map((input) => analyzeFile(input, scanOptions, appVersion, []).result.ctx)
    const comparison = compareCollections(older, newer)
    output =
      options.format === 'json'
        ? buildComparisonJson(comparison, appVersion)
        : options.format === 'markdown'
          ? buildComparisonMarkdown(comparison)
          : buildComparisonText(comparison)
    newFindings = newFindingsAtOrAbove(comparison, options.failOnNew).length
    if (!options.quiet) {
      const { scoreDelta, findings } = comparison
      process.stderr.write(
        `PostScope diff: score ${comparison.before.score} -> ${comparison.after.score} (${scoreDelta.total > 0 ? '+' : ''}${scoreDelta.total}), ${findings.added.length} new and ${findings.resolved.length} resolved finding(s)\n`
      )
    }
  } catch (error) {
    process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`)
    return 2
  }

  if (options.output) fs.writeFileSync(options.output, output)
  else process.stdout.write(output.endsWith('\n') ? output : `${output}\n`)
  const passed = newFindings === 0
  if (!options.quiet)
    process.stderr.write(
      passed ? 'PostScope: PASS\n' : `PostScope: FAIL (${newFindings} new finding(s) at or above "${options.failOnNew}")\n`
    )
  return passed ? 0 : 1
}

export function main(argv: string[]): number {
  const appVersion = readVersion()
  if (argv[0] === 'diff') return runDiff(argv.slice(1), appVersion)
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
    for (const rule of RULE_LIST)
      process.stdout.write(
        `${rule.id.padEnd(30)} ${rule.severity.padEnd(8)} ${rule.category.padEnd(9)} ${rule.pack.padEnd(12)} ${rule.title}\n`
      )
    return 0
  }

  const files: AnalyzedFile[] = []
  try {
    const explicit = options.environments
    const baseline = options.baseline ? loadBaseline(options.baseline) : undefined
    const inputs = expandInputs(options.inputs)
    if (options.sanitize && inputs.length > 1) throw new UsageError('--sanitize works with a single input.')
    for (const input of inputs) {
      const extra = options.autoEnv
        ? findSiblingEnvironments(input)
            .filter((file) => !explicit.some((entry) => path.resolve(entry.file) === path.resolve(file)))
            .map((file) => ({ file, globals: /\.postman_globals\.json$/i.test(file) }))
        : []
      const environments = loadEnvironments([...explicit, ...extra])
      const { result, json } = analyzeFile(input, options, appVersion, environments, baseline)
      files.push(result)
      if (options.sanitize) {
        const { json: sanitized, redactedCount } = redactCollection(json, { scrubPii: options.redactPii })
        fs.writeFileSync(options.sanitize, JSON.stringify(sanitized, null, 2))
        if (!options.quiet) process.stderr.write(`Sanitized copy written to ${options.sanitize} (${redactedCount} value(s) replaced)\n`)
        for (const environment of environments) {
          const target = path.join(
            path.dirname(options.sanitize),
            `${environmentStem(environment.file)}.sanitized.postman_${environment.kind}.json`
          )
          const sanitizedEnvironment = redactEnvironment(environment.json)
          fs.writeFileSync(target, JSON.stringify(sanitizedEnvironment.json, null, 2))
          if (!options.quiet)
            process.stderr.write(
              `Sanitized ${environment.kind} written to ${target} (${sanitizedEnvironment.redactedCount} value(s) emptied)\n`
            )
        }
      }
    }
  } catch (error) {
    process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`)
    return 2
  }

  const report = render(files, options.format, appVersion, options.failOn)
  if (options.output) fs.writeFileSync(options.output, report)
  else process.stdout.write(report.endsWith('\n') ? report : `${report}\n`)

  if (options.writeBaseline) {
    const baseline = buildBaseline(files.flatMap((file) => file.beforeBaseline))
    try {
      fs.writeFileSync(options.writeBaseline, `${JSON.stringify(baseline, null, 2)}\n`)
    } catch (error) {
      process.stderr.write(`Error: cannot write baseline (${error instanceof Error ? error.message : String(error)})\n`)
      return 2
    }
    if (!options.quiet)
      process.stderr.write(`PostScope: baseline of ${baseline.entries.length} occurrence(s) written to ${options.writeBaseline}\n`)
    return 0
  }

  const failures = files.flatMap(({ ctx }) => failingFindings(ctx.findings, options.failOn))
  const lowScores = options.minScore === undefined ? [] : files.filter(({ ctx }) => ctx.score.total < (options.minScore ?? 0))
  const passed = failures.length === 0 && lowScores.length === 0

  if (!options.quiet) {
    const suppressedCount = files.reduce(
      (total, { ctx }) => total + (ctx.suppressed ?? []).reduce((sum, finding) => sum + finding.suppressions.length, 0),
      0
    )
    const baselinedCount = files.reduce((total, { ctx }) => total + (ctx.baselined ?? 0), 0)
    for (const file of files) if (file.configFile) process.stderr.write(`Config: ${file.configFile}\n`)
    if (suppressedCount) process.stderr.write(`Suppressed: ${suppressedCount} occurrence(s) with a reviewed reason (not scored)\n`)
    if (baselinedCount) process.stderr.write(`Baseline: ${baselinedCount} known occurrence(s) hidden\n`)
    const reasons = [
      failures.length ? `${failures.length} finding(s) at or above "${options.failOn}"` : '',
      lowScores.length ? `${lowScores.length} collection(s) below score ${options.minScore}` : '',
    ].filter(Boolean)
    process.stderr.write(passed ? 'PostScope: PASS\n' : `PostScope: FAIL (${reasons.join('; ')})\n`)
  }
  return passed ? 0 : 1
}

/** True when this file is the program being run, also when started through a symlink such as node_modules/.bin/postscope. */
function isEntryPoint(): boolean {
  if (!process.argv[1]) return false
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  }
}

const invokedDirectly = isEntryPoint()
if (invokedDirectly) process.exitCode = main(process.argv.slice(2))
