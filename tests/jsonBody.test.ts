import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectIndent, parseTemplatedJson } from '../src/lib/jsonBody'
import { replaceRawBodyFields, scanRawBodyFields } from '../src/lib/rawBody'

test('parses and restores unquoted variables', () => {
  const raw = '{"id": {{userId}}, "items": [{{a}}, {{b-c}}], "name": "{{quoted}}", "n": 1}'
  const parsed = parseTemplatedJson(raw)
  assert.ok(parsed?.templated)
  const value = parsed?.value as { id: string; items: string[]; name: string; n: number }
  assert.equal(value.n, 1)
  assert.equal(value.name, '{{quoted}}')
  assert.match(value.id, /\{\{|__postscope_var_/)
  assert.equal(parsed?.restore(JSON.stringify(parsed.value)), '{"id":{{userId}},"items":[{{a}},{{b-c}}],"name":"{{quoted}}","n":1}')
})

test('leaves variables inside strings alone and returns plain JSON unchanged', () => {
  const plain = parseTemplatedJson('{"a": "x {{y}} z", "b": "\\"{{q}}\\""}')
  assert.equal(plain?.templated, false)
  assert.deepEqual(plain?.value, { a: 'x {{y}} z', b: '"{{q}}"' })
  assert.equal(plain?.restore('{"a":1}'), '{"a":1}')
})

test('rejects non-JSON text and malformed templates', () => {
  assert.equal(parseTemplatedJson('plain text'), null)
  assert.equal(parseTemplatedJson('<xml>{{a}}</xml>'), null)
  assert.equal(parseTemplatedJson('{"a": {{x}}5}'), null)
  assert.equal(parseTemplatedJson('{"a": {{x}'), null)
  assert.equal(parseTemplatedJson(''), null)
})

test('a value the caller replaced is not resurrected by restore', () => {
  const parsed = parseTemplatedJson('{"id": {{userId}}, "password": "secret-value"}')!
  ;(parsed.value as Record<string, unknown>).id = 'literal'
  assert.equal(parsed.restore(JSON.stringify(parsed.value)), '{"id":"literal","password":"secret-value"}')
})

test('scanning stays linear on hostile input', () => {
  const hostile = `{"a": ${'{{x'.repeat(50_000)}`
  const started = Date.now()
  parseTemplatedJson(hostile)
  parseTemplatedJson(`{"a": "${'\\"'.repeat(100_000)}`)
  scanRawBodyFields('<a '.repeat(50_000) + '='.repeat(50_000) + '"k":"'.repeat(20_000))
  assert.ok(Date.now() - started < 3000)
})

test('detects indentation', () => {
  assert.equal(detectIndent('{"a":1}'), 0)
  assert.equal(detectIndent('{\n  "a": 1\n}'), 2)
  assert.equal(detectIndent('{\n    "a": 1\n}'), 4)
  assert.equal(detectIndent('{\n\t"a": 1\n}'), '\t')
})

test('raw body scanner finds pairs, XML elements and JSON fragments with exact ranges', () => {
  const raw = 'a=1&token=abc123def <x:Pass Type="t">hunter22</x:Pass> {"password": "p4ss-word",}'
  const fields = scanRawBodyFields(raw)
  assert.deepEqual(
    fields.map((field) => [field.kind, field.key, field.value]),
    [
      ['pair', 'a', '1'],
      ['pair', 'token', 'abc123def'],
      ['xml', 'Pass', 'hunter22'],
      ['json', 'password', 'p4ss-word'],
    ]
  )
  for (const field of fields) assert.equal(raw.slice(field.start, field.end), field.value)
  const replaced = replaceRawBodyFields(
    raw,
    fields.filter((field) => field.key !== 'a').map((field) => ({ field, value: '{{v}}' }))
  )
  assert.equal(replaced, 'a=1&token={{v}} <x:Pass Type="t">{{v}}</x:Pass> {"password": "{{v}}",}')
})
