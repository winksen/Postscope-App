import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const read = (file: string) => fs.readFileSync(file, 'utf8')
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'postscope-style-'))
after(() => fs.rmSync(scratch, { recursive: true, force: true }))

function checkStyle(root: string) {
  const result = spawnSync(process.execPath, ['scripts/check-style.mjs'], {
    encoding: 'utf8',
    env: { ...process.env, STYLE_CHECK_ROOT: root },
  })
  return { code: result.status, output: `${result.stdout}${result.stderr}` }
}

test('the style check finds an em dash, names the file and line, and passes clean files', () => {
  fs.mkdirSync(path.join(scratch, 'sub'))
  fs.mkdirSync(path.join(scratch, 'node_modules'))
  fs.writeFileSync(path.join(scratch, 'clean.md'), 'Plain text: no long dash here.\n')
  fs.writeFileSync(path.join(scratch, 'node_modules', 'ignored.txt'), `dependency ${String.fromCodePoint(0x2014)} text\n`)
  assert.equal(checkStyle(scratch).code, 0)

  fs.writeFileSync(path.join(scratch, 'sub', 'bad.ts'), `// first line\nconst text = 'a ${String.fromCodePoint(0x2014)} b'\n`)
  const failing = checkStyle(scratch)
  assert.equal(failing.code, 1)
  assert.match(failing.output, /sub[\\/]bad\.ts:2:/)
})

test('the repository itself follows the style rules', () => {
  const result = spawnSync(process.execPath, ['scripts/check-style.mjs'], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
})

test('package scripts and CI workflows cover lint, formatting, style, browser tests, Docker and code scanning', () => {
  const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts
  for (const name of ['lint', 'format', 'format:check', 'check:style', 'test:e2e', 'audit:deps']) assert.ok(scripts[name], name)
  assert.match(scripts.lint, /--max-warnings 0/)

  const ci = read('.github/workflows/ci.yml')
  for (const step of [
    'npm run lint',
    'npm run format:check',
    'npm run check:style',
    'npm run release:check',
    'npm run test:e2e',
    'npm run audit:deps',
    'docker build',
    '/api/health',
  ]) {
    assert.ok(ci.includes(step), `ci.yml runs ${step}`)
  }
  assert.doesNotMatch(ci, /continue-on-error/, 'no CI step is allowed to fail silently')

  assert.match(read('.github/workflows/codeql.yml'), /languages: javascript-typescript/)
  const dependabot = read('.github/dependabot.yml')
  for (const ecosystem of ['npm', 'github-actions', 'docker']) assert.match(dependabot, new RegExp(`package-ecosystem: ${ecosystem}`))
})

test('the browser tests use the preinstalled Chromium when one is configured', () => {
  const config = read('playwright.config.ts')
  assert.match(config, /PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH/)
  assert.match(config, /LOGGING_MODE: 'off'/)
  for (const spec of ['smoke', 'navigation', 'a11y', 'large']) assert.ok(fs.existsSync(`e2e/${spec}.spec.ts`), spec)
})
