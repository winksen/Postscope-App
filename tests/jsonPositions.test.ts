import { test } from 'node:test'
import assert from 'node:assert/strict'
import { escapePointerSegment, itemPointer, locatePointers } from '../src/lib/jsonPositions'

/** Reference implementation: the pointers of every value, found by walking the parsed tree. */
function allPointers(value: unknown, prefix = '', out: string[] = []): string[] {
  out.push(prefix)
  if (Array.isArray(value)) value.forEach((child, index) => allPointers(child, `${prefix}/${index}`, out))
  else if (value && typeof value === 'object')
    for (const [key, child] of Object.entries(value)) allPointers(child, `${prefix}/${escapePointerSegment(key)}`, out)
  return out
}

/** Line and column of the first character of the value, by searching the text the slow way. */
function at(text: string, offset: number) {
  const before = text.slice(0, offset)
  const lines = before.split(/\r\n|\n|\r/)
  return { line: lines.length, column: lines[lines.length - 1].length + 1 }
}

test('finds values in pretty-printed JSON', () => {
  const text = `{\n  "item": [\n    {\n      "name": "A",\n      "request": {\n        "header": [\n          { "key": "Authorization", "value": "Bearer x" }\n        ]\n      }\n    }\n  ]\n}`
  const found = locatePointers(text, new Set(['', '/item', '/item/0', '/item/0/name', '/item/0/request/header/0/value', '/missing']))
  assert.deepEqual(found.get(''), { line: 1, column: 1 })
  assert.deepEqual(found.get('/item'), { line: 2, column: 11 })
  assert.deepEqual(found.get('/item/0'), { line: 3, column: 5 })
  assert.deepEqual(found.get('/item/0/name'), { line: 4, column: 15 })
  assert.deepEqual(found.get('/item/0/request/header/0/value'), { line: 7, column: text.split('\n')[6].indexOf('"Bearer x"') + 1 })
  assert.equal(text.split('\n')[6].indexOf('"Bearer x"') + 1, 46)
  assert.equal(found.has('/missing'), false)
})

test('matches a brute force search on a generated document with every kind of value', () => {
  const doc = {
    a: 1,
    'b/c': { 'd~e': [true, null, -1.5e3, 'text with "quotes" and \\ backslash', { z: [] }], '': 'empty key' },
    ключ: ['日本語', { nested: { deep: [[1, 2], [3]] } }],
    esc: { 'a"b': 1, 'tab\tkey': 2 },
  }
  for (const [name, text] of [
    ['minified', JSON.stringify(doc)],
    ['indented', JSON.stringify(doc, null, 2)],
    ['tabs', JSON.stringify(doc, null, '\t')],
    ['crlf', JSON.stringify(doc, null, 2).replace(/\n/g, '\r\n')],
    ['cr', JSON.stringify(doc, null, 2).replace(/\n/g, '\r')],
  ] as const) {
    const pointers = allPointers(JSON.parse(text))
    const found = locatePointers(text, new Set(pointers))
    assert.equal(found.size, pointers.length, name)
    for (const [pointer, position] of found) {
      const value = pointer
        .split('/')
        .slice(1)
        .reduce<unknown>(
          (current, segment) => (current as Record<string, unknown>)[segment.replace(/~1/g, '/').replace(/~0/g, '~')],
          JSON.parse(text)
        )
      const serialized = JSON.stringify(value)
      // The value must start exactly where the scanner says it does.
      const lines = text.split(/\r\n|\n|\r/)
      const startOfLine = lines
        .slice(0, position.line - 1)
        .reduce((total, current) => total + current.length + (name === 'crlf' ? 2 : 1), 0)
      const offset = startOfLine + position.column - 1
      assert.equal(text[offset], serialized[0], `${name} ${pointer}`)
      assert.deepEqual(at(text, offset), position, `${name} ${pointer}`)
    }
  }
})

test('counts columns in UTF-16 code units and ignores values it was not asked for', () => {
  const text = '{"emoji": "😀😀", "after": 1}'
  const found = locatePointers(text, new Set(['/after']))
  assert.deepEqual(found.get('/after'), { line: 1, column: text.indexOf('1') + 1 })
  assert.equal(found.size, 1)
  assert.equal(locatePointers(text, new Set()).size, 0)
})

test('keys with escapes and slashes use RFC 6901 pointers', () => {
  const text = '{"a/b": {"c~d": [10, 20]}, "\\u0041x": 5}'
  const found = locatePointers(text, new Set(['/a~1b/c~0d/1', '/Ax']))
  assert.deepEqual(found.get('/a~1b/c~0d/1'), { line: 1, column: text.indexOf('20') + 1 })
  assert.deepEqual(found.get('/Ax'), { line: 1, column: text.lastIndexOf('5') + 1 })
  assert.equal(itemPointer([0, 3]), '/item/0/item/3')
  assert.equal(itemPointer([]), '')
})

test('large documents are scanned in linear time with a tiny wanted set', () => {
  const doc = {
    item: Array.from({ length: 20_000 }, (_, index) => ({
      name: `Request ${index}`,
      request: { header: [{ key: 'X', value: String(index) }], url: 'https://example.com/' + index },
    })),
  }
  const text = JSON.stringify(doc, null, 2)
  const started = Date.now()
  const found = locatePointers(text, new Set(['/item/19999/request/header/0/value', '/item/10/name']))
  assert.equal(found.size, 2)
  assert.ok(Date.now() - started < 2000)
  assert.equal(text.split('\n')[found.get('/item/10/name')!.line - 1].trim(), '"name": "Request 10",')
})

test('malformed input does not throw or loop forever', () => {
  for (const text of ['', '{', '{"a":', '[1,2', '{"a": "unterminated', '}}]]', '\u0000\u0001', '{"a": [}']) {
    assert.doesNotThrow(() => locatePointers(text, new Set(['/a', '/0'])))
  }
})
