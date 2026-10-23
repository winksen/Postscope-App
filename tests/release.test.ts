import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string }

test('release versions agree across package, lockfile, Docker, compose and changelog', () => {
  const result = spawnSync(process.execPath, ['scripts/release-check.mjs'], { encoding: 'utf8', cwd: root })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, new RegExp(`agree: ${pkg.version.replace(/\./g, '\\.')}`))
})

test('CLI reports the package version from another working directory', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'postscope-version-'))
  try {
    const cli = path.join(root, 'cli', 'postscope.ts')
    const env = { ...process.env }
    delete env.APP_VERSION
    const result = spawnSync(process.execPath, ['--import', pathToFileURL(path.join(root, 'node_modules', 'tsx', 'dist', 'loader.mjs')).href, cli, '--version'], { encoding: 'utf8', cwd, env })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout.trim(), pkg.version)
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true })
  }
})

test('release check fails when a version drifts', () => {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'postscope-release-'))
  try {
    fs.mkdirSync(path.join(copy, 'scripts'))
    for (const file of ['scripts/release-check.mjs', 'package.json', 'package-lock.json', 'Dockerfile', 'compose.yaml', 'CHANGELOG.md']) {
      fs.copyFileSync(path.join(root, file), path.join(copy, file))
    }
    fs.writeFileSync(path.join(copy, 'Dockerfile'), fs.readFileSync(path.join(copy, 'Dockerfile'), 'utf8').replace(/ARG APP_VERSION=\S+/, 'ARG APP_VERSION=9.9.9'))
    const result = spawnSync(process.execPath, ['scripts/release-check.mjs'], { encoding: 'utf8', cwd: copy })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Dockerfile ARG APP_VERSION: 9\.9\.9/)
  } finally {
    fs.rmSync(copy, { recursive: true, force: true })
  }
})
