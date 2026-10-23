import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCollection } from '../src/lib/parser'
import { runAudit, type Finding } from '../src/lib/auditor'
import { SCORE_MODEL, calculateScore, getActiveScoreWeights, setActiveScoreWeights } from '../src/lib/scorer'
import { DEFAULT_SCORE_WEIGHTS, findingAffectedCount, findingPenalty, parseScoreWeights, penaltyScore, sanitizeScoreWeights } from '../src/lib/severity'
import { requestHealthScore } from '../src/lib/requestFindings'
import { FAKE, cleanCollection, kitchenSinkCollection } from './fixtures'

const empty = parseCollection({ info: { name: 'x' }, item: [] })

function finding(severity: Finding['severity'], category: Finding['category'], affected: number, extra: Partial<Finding> = {}): Finding {
  return {
    id: `${category}-${severity}-${affected}`,
    ruleId: 'HARDCODED_TOKEN',
    severity,
    category,
    title: `${severity} ${category}`,
    description: '',
    recommendation: '',
    affected: Array.from({ length: affected }, (_, index) => `r${index}`),
    ...extra,
  }
}

function secretCollection(requests: number) {
  return {
    info: { name: 'Many' },
    variable: [{ key: 'baseUrl', value: 'https://api.example.com' }],
    item: Array.from({ length: requests }, (_, index) => ({
      name: `R${index}`,
      request: { method: 'GET', url: '{{baseUrl}}/x', description: 'd', header: [{ key: 'X-API-Key', value: FAKE.apiKey }] },
    })),
  }
}

test('a finding costs weight * (1 + log2(affected)) up to a per-rule cap', () => {
  assert.equal(findingPenalty(finding('critical', 'secrets', 1)), 20)
  assert.equal(findingPenalty(finding('critical', 'secrets', 2)), 35)
  assert.equal(findingPenalty(finding('critical', 'secrets', 50)), 35)
  assert.equal(findingPenalty(finding('warning', 'variables', 1)), 8)
  assert.equal(findingPenalty(finding('warning', 'variables', 2)), 15)
  assert.equal(findingPenalty(finding('info', 'hygiene', 1)), 2)
  assert.equal(findingPenalty(finding('info', 'hygiene', 4)), 4)
})

test('collection-level findings use their evidence count, capped at eight', () => {
  const evidence = (count: number) => Array.from({ length: count }, (_, index) => ({ location: `v${index}` }))
  assert.equal(findingAffectedCount(finding('critical', 'secrets', 0)), 1)
  assert.equal(findingAffectedCount(finding('critical', 'secrets', 0, { evidence: evidence(3) })), 3)
  assert.equal(findingAffectedCount(finding('critical', 'secrets', 0, { evidence: evidence(40) })), 8)
  assert.equal(findingAffectedCount(finding('critical', 'secrets', 2, { evidence: evidence(40) })), 2)
})

test('more affected requests never raise the score', () => {
  const scores = [1, 2, 3, 5, 8, 20, 100].map((count) => {
    const parsed = parseCollection(secretCollection(count))
    return calculateScore(parsed, runAudit(parsed)).total
  })
  for (let i = 1; i < scores.length; i += 1) assert.ok(scores[i] <= scores[i - 1], `${scores}`)
  assert.ok(scores[0] > scores[scores.length - 1] || scores[0] === scores[scores.length - 1])
})

test('security and hygiene are scored separately and combined 85/15', () => {
  const security = calculateScore(empty, [finding('critical', 'secrets', 1)], DEFAULT_SCORE_WEIGHTS)
  assert.deepEqual([security.security, security.hygiene, security.total], [80, 100, 83])
  const hygiene = calculateScore(empty, [finding('info', 'hygiene', 4)], DEFAULT_SCORE_WEIGHTS)
  assert.deepEqual([hygiene.security, hygiene.hygiene, hygiene.total], [100, 96, 99])
  assert.equal(security.scoreModel, SCORE_MODEL)
  assert.equal(SCORE_MODEL, 2)
  assert.equal(calculateScore(empty, [], DEFAULT_SCORE_WEIGHTS).total, 100)
})

test('hygiene findings can no longer drag the security score down', () => {
  const many = Array.from({ length: 12 }, (_, index) => finding('info', 'hygiene', 5, { ruleId: 'MISSING_DESCRIPTION', id: `h${index}` }))
  const score = calculateScore(empty, many, DEFAULT_SCORE_WEIGHTS)
  assert.equal(score.security, 100)
  assert.ok(score.hygiene < 100 && score.total >= 85)
})

test('five critical rules no longer always produce zero', () => {
  const criticals = ['a', 'b', 'c', 'd', 'e'].map((id) => finding('critical', 'secrets', 1, { id }))
  const score = calculateScore(empty, criticals, DEFAULT_SCORE_WEIGHTS)
  assert.equal(score.categories.secrets, 0)
  assert.equal(score.security, 0)
  const two = calculateScore(empty, criticals.slice(0, 2), DEFAULT_SCORE_WEIGHTS)
  assert.equal(two.security, 60)
})

test('weights override the defaults and the score stays within 0 to 100', () => {
  const findings = [finding('critical', 'secrets', 1), finding('warning', 'auth', 1)]
  const heavy = calculateScore(empty, findings, { critical: 50, warning: 20, info: 5 })
  const light = calculateScore(empty, findings, { critical: 5, warning: 2, info: 1 })
  assert.equal(heavy.security, 30)
  assert.equal(light.security, 93)
  assert.equal(calculateScore(empty, findings, { critical: 0, warning: 0, info: 0 }).total, 100)
  for (const weights of [{ critical: 100, warning: 100, info: 100 }, DEFAULT_SCORE_WEIGHTS, { critical: 0, warning: 0, info: 0 }]) {
    const { total, security, hygiene } = calculateScore(empty, Array.from({ length: 30 }, (_, i) => finding('critical', 'secrets', 9, { id: String(i) })), weights)
    for (const value of [total, security, hygiene]) assert.ok(value >= 0 && value <= 100)
  }
})

test('the active weights apply when none are passed and invalid input falls back to defaults', () => {
  const findings = [finding('critical', 'secrets', 1)]
  try {
    setActiveScoreWeights({ critical: 40, warning: 'x', info: -1 })
    assert.deepEqual(getActiveScoreWeights(), { critical: 40, warning: 8, info: 2 })
    assert.equal(calculateScore(empty, findings).security, 60)
    assert.equal(requestHealthScore(findings), 60)
  } finally {
    setActiveScoreWeights(undefined)
  }
  assert.deepEqual(getActiveScoreWeights(), DEFAULT_SCORE_WEIGHTS)
  assert.equal(calculateScore(empty, findings).security, 80)
})

test('weights are parsed from text and sanitized from untrusted input', () => {
  assert.deepEqual(parseScoreWeights('critical=30, warning=10'), { weights: { critical: 30, warning: 10, info: 2 }, errors: [] })
  assert.deepEqual(parseScoreWeights(undefined).weights, DEFAULT_SCORE_WEIGHTS)
  const bad = parseScoreWeights('critical=abc,fatal=5,info=500,warning')
  assert.equal(bad.errors.length, 4)
  assert.deepEqual(bad.weights, DEFAULT_SCORE_WEIGHTS)
  assert.deepEqual(sanitizeScoreWeights(null), DEFAULT_SCORE_WEIGHTS)
  assert.deepEqual(sanitizeScoreWeights({ critical: '25', warning: Infinity }), { critical: 25, warning: 8, info: 2 })
})

test('request health keeps the flat table: one request, each finding costs its weight once', () => {
  assert.equal(penaltyScore([{ severity: 'critical' }, { severity: 'warning' }]), 72)
  assert.equal(penaltyScore([{ severity: 'critical' }], { critical: 10, warning: 8, info: 2 }), 90)
  assert.equal(penaltyScore(Array.from({ length: 20 }, () => ({ severity: 'critical' as const }))), 0)
})

test('the breakdown lists every finding with its points, largest first', () => {
  const parsed = parseCollection(kitchenSinkCollection())
  const findings = runAudit(parsed)
  const score = calculateScore(parsed, findings)
  assert.equal(score.penalties.length, findings.length)
  assert.deepEqual(score.penalties.map((penalty) => penalty.penalty), [...score.penalties.map((penalty) => penalty.penalty)].sort((a, b) => b - a))
  const clean = parseCollection(cleanCollection())
  assert.equal(calculateScore(clean, runAudit(clean)).total, 100)
})
