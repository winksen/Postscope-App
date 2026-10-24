import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseCollection } from '../src/lib/parser'
import { runAuditDetailed, sanitizeAuditOptions, type Finding } from '../src/lib/auditor'
import { RULE_LIST, RULES } from '../src/lib/rules'
import {
  OPTIONAL_PACK_IDS,
  RULE_PACKS,
  RULE_PACK_IDS,
  packMode,
  parseRulePacks,
  resolveEnabledPacks,
  rulePacksFromModes,
  sanitizeRulePacks,
} from '../src/lib/rulePacks'
import { calculateScore } from '../src/lib/scorer'
import { CATEGORY_ORDER } from '../src/lib/severity'
import { parseProjectConfig } from '../src/lib/projectConfig'
import { detectIdentitySignals } from '../src/lib/iam/signals'
import { buildJsonReport, buildSarifReport } from '../src/lib/reportExport'
import { getAuditPolicy } from '../server/runtimeConfig'
import { cleanCollection } from './fixtures'
import { validate } from './schema'

const schema = JSON.parse(fs.readFileSync(new URL('../docs/schemas/postscope-report.v2.schema.json', import.meta.url), 'utf8')) as Record<
  string,
  unknown
>

function identityCollection() {
  return {
    info: { name: 'Okta lab', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    variable: [{ key: 'oktaDomain', value: 'https://example.okta.com' }],
    item: [
      {
        name: 'Token',
        request: { method: 'POST', url: '{{oktaDomain}}/oauth2/default/v1/token', description: 'Get a token' },
      },
    ],
  }
}

test('every rule belongs to a pack and carries tags', () => {
  for (const rule of RULE_LIST) {
    assert.ok(RULE_PACK_IDS.includes(rule.pack), `${rule.id} has a known pack`)
    assert.ok(Array.isArray(rule.tags) && rule.tags.length > 0, `${rule.id} has tags`)
  }
})

test('every security rule maps to at least one compliance reference', () => {
  for (const rule of RULE_LIST.filter((entry) => entry.category !== 'hygiene')) {
    const references = rule.references ?? {}
    const count = Object.values(references).reduce((total, list) => total + (list?.length ?? 0), 0)
    assert.ok(count > 0, `${rule.id} has references`)
    assert.ok((references.nist80053?.length ?? 0) > 0, `${rule.id} maps to NIST SP 800-53`)
    assert.ok((references.iso27001?.length ?? 0) > 0, `${rule.id} maps to ISO/IEC 27001`)
  }
})

test('identity is a finding category after auth and before hygiene', () => {
  assert.ok(CATEGORY_ORDER.includes('identity'))
  assert.ok(CATEGORY_ORDER.indexOf('identity') > CATEGORY_ORDER.indexOf('auth'))
  assert.ok(CATEGORY_ORDER.indexOf('identity') < CATEGORY_ORDER.indexOf('hygiene'))
})

test('pack lists parse with auto, none and a leading minus', () => {
  assert.deepEqual(parseRulePacks('iam-am,-iam-pam'), { settings: { enabled: ['iam-am'], disabled: ['iam-pam'] }, errors: [] })
  assert.deepEqual(parseRulePacks('auto').settings, undefined)
  assert.deepEqual(parseRulePacks(undefined).settings, undefined)
  assert.deepEqual(parseRulePacks('none').settings?.disabled, OPTIONAL_PACK_IDS)
  assert.deepEqual(parseRulePacks('iam-am,iam-am').settings, { enabled: ['iam-am'] })
  assert.equal(parseRulePacks('iam-nope').errors.length, 1)
  assert.match(parseRulePacks('core').errors[0], /always on/)
})

test('sanitizing drops unknown packs, core and contradictions', () => {
  assert.equal(sanitizeRulePacks('iam-am'), undefined)
  assert.equal(sanitizeRulePacks({ enabled: ['core', 'x'], disabled: [] }), undefined)
  assert.deepEqual(sanitizeRulePacks({ enabled: ['iam-am', 'iam-pam'], disabled: ['iam-pam'] }), {
    enabled: ['iam-am'],
    disabled: ['iam-pam'],
  })
  assert.deepEqual(sanitizeAuditOptions({ rulePacks: { enabled: ['iam-iga'] } }).rulePacks, { enabled: ['iam-iga'] })
  assert.equal(sanitizeAuditOptions({ rulePacks: 'everything' }).rulePacks, undefined)
})

test('packs resolve to core plus forced and detected packs, and off wins', () => {
  assert.deepEqual([...resolveEnabledPacks(undefined, false)], ['core'])
  assert.deepEqual([...resolveEnabledPacks(undefined, true)].sort(), [...RULE_PACK_IDS].sort())
  assert.deepEqual([...resolveEnabledPacks({ enabled: ['iam-pam'] }, false)].sort(), ['core', 'iam-pam'])
  const forcedOff = resolveEnabledPacks({ disabled: ['iam-am'] }, true)
  assert.ok(!forcedOff.has('iam-am') && forcedOff.has('iam-pam'))
  assert.ok(resolveEnabledPacks({ disabled: [...OPTIONAL_PACK_IDS] }, true).size === 1)
})

test('pack modes round trip through settings', () => {
  const settings = rulePacksFromModes({ 'iam-am': 'on', 'iam-pam': 'off', 'iam-iga': 'auto' })
  assert.equal(packMode(settings, 'iam-am'), 'on')
  assert.equal(packMode(settings, 'iam-pam'), 'off')
  assert.equal(packMode(settings, 'iam-iga'), 'auto')
  assert.equal(rulePacksFromModes({}), undefined)
})

test('identity signals are detected from hosts, paths and OAuth helpers', () => {
  assert.equal(detectIdentitySignals(parseCollection(identityCollection())), true)
  assert.equal(detectIdentitySignals(parseCollection(cleanCollection())), false)
  const oauth = {
    info: { name: 'x' },
    auth: { type: 'oauth2', oauth2: [{ key: 'grant_type', value: 'client_credentials' }] },
    item: [{ name: 'List', request: { method: 'GET', url: 'https://api.example.com/items' } }],
  }
  assert.equal(detectIdentitySignals(parseCollection(oauth)), true)
})

test('the audit reports which packs ran', () => {
  const plain = runAuditDetailed(parseCollection(cleanCollection()))
  assert.deepEqual(plain.packs, ['core'])
  const identity = runAuditDetailed(parseCollection(identityCollection()))
  assert.deepEqual([...identity.packs].sort(), [...RULE_PACK_IDS].sort())
  const forcedOff = runAuditDetailed(parseCollection(identityCollection()), { rulePacks: { disabled: [...OPTIONAL_PACK_IDS] } })
  assert.deepEqual(forcedOff.packs, ['core'])
})

function identityFinding(): Finding {
  return {
    id: 'X',
    ruleId: 'HARDCODED_TOKEN',
    severity: 'warning',
    category: 'identity',
    title: 'Identity finding',
    description: '',
    recommendation: '',
    affected: ['r1'],
  }
}

test('the identity score is left out unless there are identity findings', () => {
  const parsed = parseCollection(cleanCollection())
  assert.equal('identity' in calculateScore(parsed, []).categories, false)
  const score = calculateScore(parsed, [identityFinding()])
  assert.equal(typeof score.categories.identity, 'number')
  assert.ok(score.categories.identity! < 100)
  assert.ok(score.security < 100, 'identity findings count toward the security score')
  assert.equal(score.hygiene, 100)
})

test('project configs accept rule packs and reject typos', () => {
  const ok = parseProjectConfig({ rulePacks: { enabled: ['iam-am'], disabled: ['iam-pam'] } })
  assert.deepEqual(ok.errors, [])
  assert.deepEqual(ok.config.rulePacks, { enabled: ['iam-am'], disabled: ['iam-pam'] })
  assert.match(parseProjectConfig({ rulePacks: { enabled: ['iam-nope'] } }).errors.join(), /unknown pack/)
  assert.match(parseProjectConfig({ rulePacks: { enabled: ['core'] } }).errors.join(), /always on/)
  assert.match(parseProjectConfig({ rulePacks: { on: [] } }).errors.join(), /unknown key/)
  assert.match(parseProjectConfig({ rulePacks: ['iam-am'] }).errors.join(), /must be an object/)
})

test('the server policy reads AUDIT_RULE_PACKS', () => {
  const previous = process.env.AUDIT_RULE_PACKS
  try {
    process.env.AUDIT_RULE_PACKS = 'iam-am,-iam-pam'
    assert.deepEqual(getAuditPolicy().rulePacks, { enabled: ['iam-am'], disabled: ['iam-pam'] })
    process.env.AUDIT_RULE_PACKS = 'auto'
    assert.equal(getAuditPolicy().rulePacks, undefined)
  } finally {
    if (previous === undefined) delete process.env.AUDIT_RULE_PACKS
    else process.env.AUDIT_RULE_PACKS = previous
  }
})

test('reports carry the pack and compliance references of each rule', () => {
  const parsed = parseCollection({
    info: { name: 'Leaky' },
    item: [{ name: 'A', request: { method: 'GET', url: 'http://api.example.com/x', description: 'd' } }],
  })
  const { findings } = runAuditDetailed(parsed)
  const ctx = { parsed, findings, score: calculateScore(parsed, findings), appVersion: 'test' }
  const json = JSON.parse(buildJsonReport(ctx)) as {
    findings: Array<{ ruleId: string; pack: string; references?: { nist80053?: string[] } }>
  }
  const insecure = json.findings.find((finding) => finding.ruleId === 'INSECURE_HTTP')
  assert.equal(insecure?.pack, 'core')
  assert.ok(insecure?.references?.nist80053?.includes('SC-8'))
  assert.deepEqual(validate(schema, JSON.parse(buildJsonReport(ctx))), [])

  const sarif = JSON.parse(buildSarifReport(ctx)) as {
    runs: Array<{ tool: { driver: { rules: Array<{ id: string; properties: { tags: string[] } }> } } }>
  }
  const rule = sarif.runs[0].tool.driver.rules.find((entry) => entry.id === 'INSECURE_HTTP')
  assert.ok(rule?.properties.tags.includes('pack:core'))
  assert.ok(rule?.properties.tags.includes('NIST-800-53:SC-8'))
  assert.ok(rule?.properties.tags.includes('CIS-v8:3.10'))
  assert.equal(Object.keys(RULES).length, RULE_LIST.length)
  assert.ok(Object.values(RULE_PACKS).every((pack) => pack.title && pack.description))
})

test('the CLI lists packs, accepts --packs and rejects unknown packs', () => {
  const run = (...args: string[]) => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'cli/postscope.ts', ...args], { encoding: 'utf8', cwd: process.cwd() })
    return { code: result.status, stdout: result.stdout, stderr: result.stderr }
  }
  assert.match(run('--list-rules').stdout, /HARDCODED_TOKEN\s+critical\s+secrets\s+core/)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'postscope-packs-'))
  try {
    const file = path.join(dir, 'c.postman_collection.json')
    fs.writeFileSync(file, JSON.stringify(cleanCollection()))
    assert.equal(run(file, '--packs', 'none').code, 0)
    assert.equal(run(file, '--packs', 'iam-am,-iam-pam').code, 0)
    const bad = run(file, '--packs', 'iam-nope')
    assert.equal(bad.code, 2)
    assert.match(bad.stderr, /unknown pack/)
    const config = path.join(dir, '.postscope.json')
    fs.writeFileSync(config, JSON.stringify({ rulePacks: { enabled: ['iam-nope'] } }))
    assert.equal(run(file).code, 2)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
