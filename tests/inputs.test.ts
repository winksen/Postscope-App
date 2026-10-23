import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expandInput, expandInputs, findSiblingEnvironments, globToPathRegExp, hasGlobMagic, NoMatchError } from '../cli/inputs'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'postscope-inputs-'))
after(() => fs.rmSync(root, { recursive: true, force: true }))

const files = [
  'collections/a.postman_collection.json',
  'collections/team/b.postman_collection.json',
  'collections/team/deep/c.postman_collection.json',
  'collections/team/b.postman_environment.json',
  'collections/team/b.postman_globals.json',
  'collections/team/notes.json',
  'node_modules/pkg/x.postman_collection.json',
  '.git/y.postman_collection.json',
  'other/d.postman_collection.json',
]
for (const file of files) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
  fs.writeFileSync(path.join(root, file), '{}')
}
const at = (...parts: string[]) => path.join(root, ...parts)
const rel = (list: string[]) => list.map((file) => path.relative(root, file).split(path.sep).join('/'))

test('detects glob syntax and compiles it to path regular expressions', () => {
  assert.equal(hasGlobMagic('a/b.json'), false)
  for (const value of ['*.json', 'a/**/b', 'file?.json', '{a,b}.json', '[ab].json']) assert.equal(hasGlobMagic(value), true, value)
  const matches = (glob: string, value: string) => globToPathRegExp(glob).test(value)
  assert.ok(matches('collections/*.json', 'collections/a.json'))
  assert.ok(!matches('collections/*.json', 'collections/team/a.json'))
  assert.ok(matches('collections/**/*.json', 'collections/a.json'), '** also matches zero folders')
  assert.ok(matches('collections/**/*.json', 'collections/team/deep/a.json'))
  assert.ok(matches('**/x.json', 'x.json'))
  assert.ok(matches('a?.json', 'ab.json') && !matches('a?.json', 'a/.json'))
  assert.ok(matches('*.{json,yaml}', 'a.yaml') && !matches('*.{json,yaml}', 'a.txt'))
  assert.ok(matches('[ab].json', 'a.json') && !matches('[ab].json', 'c.json'))
  assert.ok(matches('a.b+c(1).json', 'a.b+c(1).json') && !matches('a.b.json', 'aXb.json'))
})

test('a folder is searched recursively for collections and skips node_modules and .git', () => {
  assert.deepEqual(rel(expandInput(at('collections'))), [
    'collections/a.postman_collection.json',
    'collections/team/b.postman_collection.json',
    'collections/team/deep/c.postman_collection.json',
  ])
  fs.mkdirSync(at('empty'))
  assert.throws(() => expandInput(at('empty')), NoMatchError)
})

test('globs are expanded by the tool, relative to the working folder or absolute', () => {
  const pattern = at('collections', '**', '*.postman_collection.json')
  assert.deepEqual(rel(expandInput(pattern)), [
    'collections/a.postman_collection.json',
    'collections/team/b.postman_collection.json',
    'collections/team/deep/c.postman_collection.json',
  ])
  assert.deepEqual(rel(expandInput(at('collections', '*', '*.postman_collection.json'))), ['collections/team/b.postman_collection.json'])
  assert.deepEqual(rel(expandInput(at('{collections,other}', '*.postman_collection.json').replace(root, `${root}`))), ['collections/a.postman_collection.json', 'other/d.postman_collection.json'])
  assert.throws(() => expandInput(at('collections', '**', '*.nothing')), NoMatchError)

  const previous = process.cwd()
  process.chdir(root)
  try {
    assert.deepEqual(rel(expandInput('./collections/team/*.postman_collection.json').map((file) => path.resolve(file))), ['collections/team/b.postman_collection.json'])
    assert.deepEqual(rel(expandInput('other/*.json').map((file) => path.resolve(file))), ['other/d.postman_collection.json'])
  } finally {
    process.chdir(previous)
  }
})

test('plain paths, stdin and missing files pass through, and duplicates are removed', () => {
  assert.deepEqual(expandInput('-'), ['-'])
  assert.deepEqual(expandInput(at('missing.json')), [at('missing.json')])
  const list = expandInputs([at('collections'), at('collections', 'a.postman_collection.json'), at('other', '*.json'), '-', '-'])
  assert.deepEqual(rel(list.filter((file) => file !== '-')), [
    'collections/a.postman_collection.json',
    'collections/team/b.postman_collection.json',
    'collections/team/deep/c.postman_collection.json',
    'other/d.postman_collection.json',
  ])
  assert.equal(list.filter((file) => file === '-').length, 1)
})

test('sibling environment and globals files are found next to a collection only', () => {
  assert.deepEqual(rel(findSiblingEnvironments(at('collections', 'team', 'b.postman_collection.json'))), ['collections/team/b.postman_environment.json', 'collections/team/b.postman_globals.json'])
  assert.deepEqual(findSiblingEnvironments(at('collections', 'a.postman_collection.json')), [])
  assert.deepEqual(findSiblingEnvironments('-'), [])
  assert.deepEqual(findSiblingEnvironments(at('nowhere', 'x.postman_collection.json')), [])
})
