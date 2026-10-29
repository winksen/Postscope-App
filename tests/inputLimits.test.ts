import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  INPUT_LIMITS,
  type InputLimitError,
  checkInputBytes,
  checkInputText,
  isInputLimitError,
  jsonNestingDepth,
  utf8ByteLength,
} from '../src/lib/inputLimits'
import { analyzeCollectionText, describeAnalysisError } from '../src/lib/analyzeCollection'
import { parseCollection } from '../src/lib/parser'
import { cleanCollection } from './fixtures'

const deep = (levels: number) => `${'['.repeat(levels)}${']'.repeat(levels)}`

test('sizes are measured in UTF-8 bytes, not characters', () => {
  assert.equal(utf8ByteLength('abc'), 3)
  assert.equal(utf8ByteLength('é'), 2)
  assert.equal(utf8ByteLength('€'), 3)
  assert.equal(utf8ByteLength('\u{1F600}'), 4, 'a surrogate pair is one four byte code point')
  assert.equal(utf8ByteLength('\ud800'), 3, 'a lone surrogate is encoded as three bytes')
  for (const sample of ['', 'plain', 'café € \u{1F600} 中文']) assert.equal(utf8ByteLength(sample), Buffer.byteLength(sample, 'utf8'))
})

test('the byte check refuses empty and oversized inputs with stable codes', () => {
  assert.equal(checkInputBytes(1, 'collection'), null)
  assert.equal(checkInputBytes(0, 'collection', 'a.json')?.code, 'INPUT_EMPTY')
  const big = checkInputBytes(INPUT_LIMITS.collectionBytes + 1, 'collection', 'big.json')
  assert.equal(big?.code, 'INPUT_TOO_LARGE')
  assert.match(big?.message ?? '', /^INPUT_TOO_LARGE: Collection big\.json is 50\.\d MB; the limit is 50 MB\.$/)
  assert.equal(checkInputBytes(INPUT_LIMITS.environmentBytes + 1, 'environment')?.code, 'INPUT_TOO_LARGE')
  assert.equal(checkInputBytes(INPUT_LIMITS.environmentBytes, 'environment'), null)
})

test('nesting is counted outside strings and stops at the limit', () => {
  assert.equal(jsonNestingDepth('{"a":[{"b":[]}]}'), 4)
  assert.equal(jsonNestingDepth('{"text":"[[[[[[ {{{{ \\" ]]]"}'), 1, 'brackets inside strings and escaped quotes do not count')
  assert.equal(checkInputText(deep(INPUT_LIMITS.jsonDepth), 'collection'), null)
  const refusal = checkInputText(deep(INPUT_LIMITS.jsonDepth + 1), 'collection', 'deep.json')
  assert.equal(refusal?.code, 'INPUT_TOO_DEEP')
  assert.match(refusal?.message ?? '', /^INPUT_TOO_DEEP: Collection deep\.json is nested more than 256 levels deep\.$/)
  // A hostile input is cut off at the offending bracket rather than scanned to the end.
  assert.equal(jsonNestingDepth(deep(100_000)), INPUT_LIMITS.jsonDepth + 1)
})

test('analysis refuses the same inputs before any parsing and explains them in plain words', async () => {
  await assert.rejects(analyzeCollectionText(deep(1000)), (error: unknown) => {
    assert.ok(isInputLimitError(error))
    assert.equal((error as InputLimitError).code, 'INPUT_TOO_DEEP')
    assert.match(describeAnalysisError(error), /^Collection is nested more than 256 levels deep\.$/)
    return true
  })
  await assert.rejects(
    analyzeCollectionText('{"item":[]}', undefined, { environments: ['x'.repeat(INPUT_LIMITS.environmentBytes + 1)] }),
    /INPUT_TOO_LARGE/
  )
})

test('the parser stops at a structural limit and says so', () => {
  const items = Array.from({ length: 100_005 }, (_, index) => ({
    name: `r${index}`,
    request: { method: 'GET', url: 'https://example.com' },
  }))
  const parsed = parseCollection({ info: { name: 'Huge' }, item: items })
  assert.equal(parsed.requests.length, 100_000)
  assert.ok(parsed.parseWarnings?.some((warning) => /Unsupported size: only the first 100000 items were read/.test(warning)))
})

function cli(...args: string[]) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'cli/postscope.ts', ...args], { encoding: 'utf8', cwd: process.cwd() })
  return { code: result.status, stdout: result.stdout, stderr: result.stderr }
}

test('the CLI gives the same refusal for deep and oversized files and still reads a normal one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'postscope-limits-'))
  try {
    const ok = path.join(dir, 'ok.postman_collection.json')
    const tooDeep = path.join(dir, 'deep.postman_collection.json')
    const env = path.join(dir, 'huge.postman_environment.json')
    fs.writeFileSync(ok, JSON.stringify(cleanCollection()))
    fs.writeFileSync(tooDeep, deep(INPUT_LIMITS.jsonDepth + 5))
    fs.writeFileSync(env, JSON.stringify({ name: 'big', values: [{ key: 'k', value: 'x'.repeat(INPUT_LIMITS.environmentBytes) }] }))
    assert.equal(cli(ok, '--fail-on', 'none').code, 0)
    const refused = cli(tooDeep)
    assert.equal(refused.code, 2)
    assert.match(refused.stderr, /INPUT_TOO_DEEP: Collection .*deep\.postman_collection\.json is nested more than 256 levels deep\./)
    const oversizedEnvironment = cli(ok, '--environment', env)
    assert.equal(oversizedEnvironment.code, 2)
    assert.match(oversizedEnvironment.stderr, /INPUT_TOO_LARGE: Environment file .*huge\.postman_environment\.json is/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
