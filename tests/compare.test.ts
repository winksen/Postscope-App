import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { FAKE, cleanCollection } from './fixtures'
import { parseCollection } from '../src/lib/parser'
import { runAudit } from '../src/lib/auditor'
import { compareCollections, newFindingsAtOrAbove, normalizeRequestUrl, type Comparison } from '../src/lib/compare'
import { buildComparisonJson, buildComparisonMarkdown, buildComparisonText } from '../src/lib/compareReport'

type Item = { name: string; item?: Item[]; request?: Record<string, unknown> }

function compare(before: unknown, after: unknown): Comparison {
  const analyze = (json: unknown) => {
    const parsed = parseCollection(json)
    return { parsed, findings: runAudit(parsed) }
  }
  return compareCollections(analyze(before), analyze(after))
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function users(collection: Record<string, unknown>): Item[] {
  return ((collection.item as Item[])[0].item as Item[])
}

test('identical collections have no differences', () => {
  const result = compare(cleanCollection(), cleanCollection())
  assert.equal(result.scoreDelta.total, 0)
  assert.deepEqual(result.requests.added, [])
  assert.deepEqual(result.requests.removed, [])
  assert.deepEqual(result.requests.changed, [])
  assert.equal(result.requests.unchanged, 2)
  assert.deepEqual(result.findings.added, [])
  assert.deepEqual(result.findings.resolved, [])
  assert.deepEqual(result.newHosts, [])
  assert.deepEqual(result.newAuthTypes, [])
})

test('a new hardcoded secret is a new finding and lowers the score', () => {
  const next = clone(cleanCollection())
  users(next)[1].request = { ...users(next)[1].request, header: [{ key: 'X-API-Key', value: FAKE.apiKey }] }
  const result = compare(cleanCollection(), next)
  assert.ok(result.scoreDelta.total < 0)
  const added = result.findings.added
  assert.ok(added.some((finding) => finding.requestId === 'Users/Create user' && finding.severity === 'critical'))
  assert.equal(result.findings.resolved.length, 0)
  assert.equal(newFindingsAtOrAbove(result, 'critical').length > 0, true)
  assert.equal(newFindingsAtOrAbove(result, 'none').length, 0)
})

test('a resolved finding is reported and improves the score', () => {
  const risky = clone(cleanCollection())
  users(risky)[1].request = { ...users(risky)[1].request, header: [{ key: 'X-API-Key', value: FAKE.apiKey }] }
  const result = compare(risky, cleanCollection())
  assert.ok(result.scoreDelta.total > 0)
  assert.ok(result.findings.resolved.length > 0)
  assert.equal(result.findings.added.length, 0)
  assert.equal(newFindingsAtOrAbove(result, 'info').length, 0)
})

test('a renamed request is matched by URL and keeps its findings unchanged', () => {
  const risky = clone(cleanCollection())
  users(risky)[1].request = { ...users(risky)[1].request, header: [{ key: 'X-API-Key', value: FAKE.apiKey }] }
  const renamed = clone(risky)
  users(renamed)[1].name = 'Register user'

  const result = compare(risky, renamed)
  assert.deepEqual(result.requests.added, [])
  assert.deepEqual(result.requests.removed, [])
  assert.equal(result.requests.changed.length, 1)
  assert.equal(result.requests.changed[0].matchedBy, 'url')
  assert.deepEqual(result.requests.changed[0].fields, ['name'])
  assert.equal(result.requests.changed[0].before.name, 'Create user')
  assert.equal(result.requests.changed[0].after.name, 'Register user')
  // The same leak in the renamed request is not reported as new, and nothing is reported as resolved.
  assert.deepEqual(result.findings.added, [])
  assert.deepEqual(result.findings.resolved, [])
  assert.ok(result.findings.unchanged > 0)
  assert.equal(result.scoreDelta.total, 0)
})

test('changed methods, added and removed requests, hosts and auth types', () => {
  const next = clone(cleanCollection())
  const list = users(next)
  list[0].request = { ...list[0].request, method: 'POST' }
  list.splice(1, 1)
  list.push({ name: 'Health', request: { method: 'GET', url: 'https://status.example.org/health', auth: { type: 'noauth' }, description: 'Health.' } })

  const result = compare(cleanCollection(), next)
  assert.deepEqual(result.requests.added.map((request) => request.name), ['Health'])
  assert.deepEqual(result.requests.removed.map((request) => request.name), ['Create user'])
  assert.equal(result.requests.changed.length, 1)
  assert.deepEqual(result.requests.changed[0].fields, ['method'])
  assert.deepEqual(result.newHosts, ['status.example.org'])
  assert.deepEqual(result.newAuthTypes, ['noauth'])
})

test('normalizes URLs for matching', () => {
  assert.equal(normalizeRequestUrl('HTTPS://API.Example.com/users/?page=2#top'), 'https://api.example.com/users')
  assert.equal(normalizeRequestUrl('{{baseUrl}}/Users/'), '{{baseurl}}/Users')
})

test('output is deterministic and carries no secret values or query strings', () => {
  const risky = clone(cleanCollection())
  const list = users(risky)
  list[1].request = { ...list[1].request, header: [{ key: 'X-API-Key', value: FAKE.apiKey }] }
  list.push({ name: 'Zeta', request: { method: 'GET', url: `https://zeta.example.com/a?token=${FAKE.bearer}`, description: 'Z.' } })
  list.push({ name: 'Alpha', request: { method: 'GET', url: 'https://alpha.example.com/a', description: 'A.' } })

  const first = compare(cleanCollection(), risky)
  const second = compare(cleanCollection(), risky)
  assert.deepEqual(first, second)
  assert.deepEqual(first.requests.added.map((request) => request.name), ['Alpha', 'Zeta'])
  assert.deepEqual(first.newHosts, ['alpha.example.com', 'zeta.example.com'])

  const severities = first.findings.added.map((finding) => finding.severity)
  const rank = { critical: 0, warning: 1, info: 2 }
  assert.deepEqual([...severities].sort((a, b) => rank[a] - rank[b]), severities)

  for (const output of [buildComparisonJson(first), buildComparisonMarkdown(first), buildComparisonText(first)]) {
    assert.ok(!output.includes(FAKE.bearer))
    assert.ok(!output.includes(FAKE.apiKey))
    assert.ok(!output.includes('token='))
    assert.ok(!output.includes(String.fromCharCode(0x2014)))
  }
  assert.match(buildComparisonMarkdown(first), /^# PostScope comparison/)
  assert.equal(JSON.parse(buildComparisonJson(first)).kind, 'comparison')
})

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'postscope-diff-'))
after(() => fs.rmSync(tmp, { recursive: true, force: true }))

function write(name: string, value: unknown): string {
  const file = path.join(tmp, name)
  fs.writeFileSync(file, JSON.stringify(value))
  return file
}

function cli(...args: string[]) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'cli/postscope.ts', ...args], { encoding: 'utf8', cwd: process.cwd() })
  return { code: result.status, stdout: result.stdout, stderr: result.stderr }
}

test('diff exits 1 when a new critical finding appears and 0 otherwise', () => {
  const oldFile = write('old.postman_collection.json', cleanCollection())
  const risky = clone(cleanCollection())
  users(risky)[1].request = { ...users(risky)[1].request, header: [{ key: 'X-API-Key', value: FAKE.apiKey }] }
  const newFile = write('new.postman_collection.json', risky)

  const failing = cli('diff', oldFile, newFile, '--fail-on-new', 'critical')
  assert.equal(failing.code, 1)
  assert.match(failing.stdout, /New findings/)
  assert.match(failing.stderr, /FAIL/)
  assert.ok(!failing.stdout.includes(FAKE.apiKey))

  assert.equal(cli('diff', oldFile, newFile, '--fail-on-new', 'none').code, 0)
  assert.equal(cli('diff', newFile, oldFile).code, 0)
  assert.equal(cli('diff', oldFile, oldFile).code, 0)

  const json = cli('diff', oldFile, newFile, '--format', 'json', '--fail-on-new', 'none', '--quiet')
  assert.equal(JSON.parse(json.stdout).findings.added.length > 0, true)
  const markdown = cli('diff', oldFile, newFile, '--format', 'markdown', '--fail-on-new', 'none', '--quiet')
  assert.match(markdown.stdout, /^# PostScope comparison/)
})

test('diff validates its input', () => {
  const oldFile = write('only.postman_collection.json', cleanCollection())
  assert.equal(cli('diff', oldFile).code, 2)
  assert.equal(cli('diff', oldFile, path.join(tmp, 'missing.json')).code, 2)
  assert.equal(cli('diff', oldFile, oldFile, '--fail-on-new', 'bogus').code, 2)
  assert.equal(cli('diff', oldFile, oldFile, '--format', 'sarif').code, 2)
  assert.match(cli('diff', '--help').stdout, /postscope diff/)
})
