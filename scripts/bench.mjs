/**
 * Performance budgets: how long parse + audit takes on a large collection, and how big the JavaScript is that
 * the browser has to download.
 *
 *   npm run bench                  print the measurements
 *   npm run bench -- --check       also fail when a number is more than 20 percent worse than scripts/bench-baseline.json
 *   npm run bench -- --update      record the current numbers as the baseline (do this in the commit that changes them on purpose)
 *   npm run bench -- --report f    write the measurements as JSON (CI uploads it as an artifact)
 *
 * The input is public/samples/messy-large.postman_collection.json (written by scripts/generate-heavy-demo-collection.mjs),
 * repeated until it has about 6000 requests. Timings are divided by a fixed CPU calibration loop, so the budget compares
 * ratios and holds on machines of different speed. Bundle sizes need `npm run build` first.
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { parseCollection } from '../src/lib/parser.ts'
import { runAuditDetailed } from '../src/lib/auditor.ts'
import { compactParsed } from '../src/lib/compactResult.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE_FILE = path.join(root, 'scripts', 'bench-baseline.json')
const TOLERANCE = 0.2
const RUNS = 9
const WARMUP = 2

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const reportPath = args.includes('--report') ? args[args.indexOf('--report') + 1] : undefined

/** The fastest run: the least disturbed by other work on the machine, so the most repeatable number. */
function best(values) {
  return Math.min(...values)
}

function time(fn) {
  const started = performance.now()
  const value = fn()
  return { ms: performance.now() - started, value }
}

/** Fixed CPU work (hashing and sorting) that scales with machine speed the way parsing does. */
function calibrate() {
  const numbers = Array.from({ length: 200_000 }, (_, index) => (index * 2654435761) % 1000003)
  numbers.sort((a, b) => a - b)
  let digest = 'seed'
  for (let round = 0; round < 3000; round += 1) digest = createHash('sha256').update(digest).digest('hex')
  return digest.length + numbers[0]
}

function heavyCollection(copies) {
  const base = JSON.parse(fs.readFileSync(path.join(root, 'public/samples/messy-large.postman_collection.json'), 'utf8'))
  const item = []
  for (let copy = 0; copy < copies; copy += 1) {
    for (const folder of JSON.parse(JSON.stringify(base.item))) item.push({ ...folder, name: `${folder.name} ${copy}` })
  }
  return { ...base, item }
}

function measureEngine() {
  const json = heavyCollection(40)
  const text = JSON.stringify(json)
  for (let run = 0; run < WARMUP; run += 1) calibrate()
  const calibration = best(Array.from({ length: RUNS }, () => time(calibrate).ms))
  const parse = []
  const audit = []
  const compact = []
  let requests = 0
  for (let run = 0; run < RUNS + WARMUP; run += 1) {
    const parsed = time(() => parseCollection(JSON.parse(text)))
    const audited = time(() => runAuditDetailed(parsed.value))
    const compacted = time(() => compactParsed(parsed.value))
    if (run >= WARMUP) {
      parse.push(parsed.ms)
      audit.push(audited.ms)
      compact.push(compacted.ms)
    }
    requests = parsed.value.requests.length
  }
  const parseMs = best(parse)
  const auditMs = best(audit)
  return {
    requests,
    collectionKB: Math.round(text.length / 1024),
    calibrationMs: round(calibration),
    parseMs: round(parseMs),
    auditMs: round(auditMs),
    compactMs: round(best(compact)),
    parseAuditRatio: round((parseMs + auditMs) / calibration, 3),
  }
}

const round = (value, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits

function gzipSize(file) {
  return zlib.gzipSync(fs.readFileSync(file), { level: 9 }).length
}

/** JavaScript the browser downloads for a set of entry chunks: the chunks and everything they import statically. */
function closure(dist, entries) {
  const seen = new Set()
  const visit = (name) => {
    if (seen.has(name)) return
    seen.add(name)
    const source = fs.readFileSync(path.join(dist, 'assets', name), 'utf8')
    for (const match of source.matchAll(/(?:from|import)\s*"\.\/([^"]+\.js)"/g)) {
      // Dynamic imports are written import("./x.js"); only static ones are followed.
      if (source.slice(match.index - 1, match.index) === '(') continue
      visit(match[1])
    }
  }
  entries.forEach(visit)
  return [...seen]
}

function measureBundle() {
  const dist = path.join(root, 'dist')
  const indexHtml = path.join(dist, 'index.html')
  if (!fs.existsSync(indexHtml)) return null
  const html = fs.readFileSync(indexHtml, 'utf8')
  const entry = /src="\/assets\/([^"]+\.js)"/.exec(html)?.[1]
  if (!entry) return null
  const chunks = fs.readdirSync(path.join(dist, 'assets')).filter((name) => name.endsWith('.js'))
  const find = (prefix) => chunks.find((name) => name.startsWith(`${prefix}-`))
  const gz = (names) => names.reduce((total, name) => total + gzipSize(path.join(dist, 'assets', name)), 0)

  const landing = closure(dist, [entry])
  const analyzer = closure(dist, [entry, find('AnalyzeApp')].filter(Boolean))
  const dashboard = closure(dist, [entry, find('AnalyzeApp'), find('OverviewPage')].filter(Boolean))
  const worker = chunks.filter((name) => name.startsWith('analysis.worker-'))
  const css = fs.readdirSync(path.join(dist, 'assets')).filter((name) => name.endsWith('.css'))
  return {
    landingJsGzip: gz(landing),
    analyzerJsGzip: gz(analyzer),
    dashboardJsGzip: gz(dashboard),
    workerJsGzip: gz(worker),
    cssGzip: gz(css),
    totalJsGzip: gz(chunks),
    chunks: chunks.length,
  }
}

const BUDGETED = [
  ['engine', 'parseAuditRatio', 'parse + audit time, relative to the CPU calibration loop'],
  ['bundle', 'landingJsGzip', 'JavaScript for the landing page (gzip bytes)'],
  ['bundle', 'analyzerJsGzip', 'JavaScript to open the analyzer (gzip bytes)'],
  ['bundle', 'dashboardJsGzip', 'JavaScript for the first dashboard view (gzip bytes)'],
  ['bundle', 'workerJsGzip', 'Analysis worker (gzip bytes)'],
  ['bundle', 'cssGzip', 'CSS (gzip bytes)'],
]

const result = { node: process.version, engine: measureEngine(), bundle: measureBundle() }

const lines = ['| Metric | Value | Baseline | Change |', '|---|---|---|---|']
let baseline = null
if (fs.existsSync(BASELINE_FILE)) baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'))
const failures = []
for (const [group, key, label] of BUDGETED) {
  const value = result[group]?.[key]
  if (value === undefined) {
    lines.push(`| ${label} | not measured (run npm run build) | | |`)
    if (flag('--check') && group === 'bundle') failures.push(`${key}: no build found`)
    continue
  }
  const base = baseline?.[group]?.[key]
  const change = base ? (value - base) / base : null
  lines.push(`| ${label} | ${value} | ${base ?? '-'} | ${change === null ? '-' : `${change >= 0 ? '+' : ''}${round(change * 100)}%`} |`)
  if (flag('--check') && base && change > TOLERANCE)
    failures.push(`${key} is ${round(change * 100)}% above the baseline (${value} vs ${base}, limit +${TOLERANCE * 100}%)`)
}

const e = result.engine
console.log(
  `Engine: ${e.requests} requests (${e.collectionKB} KB): parse ${e.parseMs} ms, audit ${e.auditMs} ms, compact ${e.compactMs} ms, calibration ${e.calibrationMs} ms (fastest of ${RUNS})`
)
console.log(lines.join('\n'))

if (reportPath) fs.writeFileSync(reportPath, `${JSON.stringify(result, null, 2)}\n`)
if (process.env.GITHUB_STEP_SUMMARY)
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n### Performance budgets\n\n${lines.join('\n')}\n`)

if (flag('--update')) {
  // The slowest of three passes, so the baseline is not a lucky run and the 20 percent margin sits above normal noise.
  const slowest = Math.max(e.parseAuditRatio, ...Array.from({ length: 2 }, () => measureEngine().parseAuditRatio))
  const next = {
    note: 'Recorded by npm run bench -- --update. CI fails when a number is more than 20 percent above it.',
    engine: { parseAuditRatio: slowest },
    bundle: result.bundle,
  }
  fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(next, null, 2)}\n`)
  console.log(`Baseline written to ${path.relative(root, BASELINE_FILE)}`)
}

if (failures.length) {
  console.error(`\nBudget exceeded:\n- ${failures.join('\n- ')}`)
  process.exit(1)
}
