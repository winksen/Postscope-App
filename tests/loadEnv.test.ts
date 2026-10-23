import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseEnvFile, readEnvFiles } from '../server/loadEnv'

test('parses KEY=value lines, quotes, export and comments', () => {
  const parsed = parseEnvFile(
    [
      '# comment',
      'PLAIN=value',
      'SPACED = padded value  ',
      'export EXPORTED=yes',
      'DOUBLE="quoted # not a comment"',
      "SINGLE='single'",
      'MULTI="line1\\nline2"',
      'TRAILING=value # inline comment',
      'EMPTY=',
      'bad line without equals',
      '1BAD=nope',
    ].join('\r\n')
  )
  assert.deepEqual(parsed, {
    PLAIN: 'value',
    SPACED: 'padded value',
    EXPORTED: 'yes',
    DOUBLE: 'quoted # not a comment',
    SINGLE: 'single',
    MULTI: 'line1\nline2',
    TRAILING: 'value',
    EMPTY: '',
  })
  assert.deepEqual(parseEnvFile('﻿FIRST=1'), { FIRST: '1' })
})

test('later env files win, like Vite: .env, .env.local, .env.<mode>, .env.<mode>.local', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'postscope-env-'))
  try {
    fs.writeFileSync(path.join(dir, '.env'), 'A=base\nB=base\nC=base\nD=base\n')
    fs.writeFileSync(path.join(dir, '.env.local'), 'B=local\nC=local\nD=local\n')
    fs.writeFileSync(path.join(dir, '.env.production'), 'C=production\nD=production\n')
    fs.writeFileSync(path.join(dir, '.env.production.local'), 'D=production-local\n')
    fs.writeFileSync(path.join(dir, '.env.development'), 'A=development\n')
    assert.deepEqual(readEnvFiles(dir, 'production'), { A: 'base', B: 'local', C: 'production', D: 'production-local' })
    assert.equal(readEnvFiles(dir, 'development').A, 'development')
    assert.deepEqual(readEnvFiles(path.join(dir, 'missing'), 'production'), {})
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
