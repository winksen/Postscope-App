import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { cleanCollection, kitchenSinkCollection } from './fixtures'

// The compiled CLI and server must run with plain `node`: no tsx, no TypeScript sources and no node_modules.
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'postscope-compiled-'))
const outdir = path.join(work, 'dist-node')
const risky = path.join(work, 'collections', 'risky.postman_collection.json')
const clean = path.join(work, 'collections', 'team', 'clean.postman_collection.json')

before(() => {
  const build = spawnSync(process.execPath, ['scripts/build-node.mjs', '--outdir', outdir], { cwd: process.cwd(), encoding: 'utf8' })
  assert.equal(build.status, 0, build.stderr)
  fs.mkdirSync(path.dirname(clean), { recursive: true })
  fs.writeFileSync(risky, JSON.stringify(kitchenSinkCollection()))
  fs.writeFileSync(clean, JSON.stringify(cleanCollection()))
})
after(() => fs.rmSync(work, { recursive: true, force: true }))

function cli(...args: string[]) {
  const result = spawnSync(process.execPath, [path.join(outdir, 'cli.js'), ...args], {
    cwd: work,
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', APP_VERSION: '1.2.3' },
  })
  return { code: result.status, stdout: result.stdout, stderr: result.stderr }
}

test('the build produces self-contained files with no imports from node_modules or the sources', () => {
  const cliSource = fs.readFileSync(path.join(outdir, 'cli.js'), 'utf8')
  const serverSource = fs.readFileSync(path.join(outdir, 'server.js'), 'utf8')
  assert.ok(cliSource.startsWith('#!/usr/bin/env node'))
  assert.ok((fs.statSync(path.join(outdir, 'cli.js')).mode & 0o111) !== 0, 'cli.js is executable')
  for (const source of [cliSource, serverSource]) {
    const imports = [...source.matchAll(/^import .* from ["']([^"']+)["']/gm)].map((match) => match[1])
    assert.ok(
      imports.every((name) => name.startsWith('node:')),
      `non-builtin imports: ${imports.filter((name) => !name.startsWith('node:'))}`
    )
  }
  assert.ok(!fs.existsSync(path.join(work, 'node_modules')))
})

test('the compiled CLI scans, applies the exit code policy and prints its version', () => {
  assert.equal(cli('--version').stdout.trim(), '1.2.3')
  const failing = cli('scan', risky)
  assert.equal(failing.code, 1)
  assert.match(failing.stdout, /HARDCODED_AUTH_CREDENTIAL/)
  assert.equal(cli('scan', clean).code, 0)
  assert.equal(cli('scan', path.join(work, 'collections', 'nope.json')).code, 2)
})

test('the compiled CLI expands folders and globs and produces JUnit, HTML and SARIF', () => {
  const folder = cli('scan', 'collections', '--format', 'json', '--fail-on', 'none')
  assert.equal(folder.code, 0)
  assert.equal(JSON.parse(folder.stdout).length, 2)
  const glob = cli('scan', 'collections/**/clean.postman_collection.json', '--format', 'json', '--fail-on', 'none')
  assert.equal(JSON.parse(glob.stdout).collection.name, 'Clean')
  assert.equal(cli('scan', 'collections/**/*.nothing').code, 2)

  const junit = cli('scan', 'collections', '--format', 'junit', '--fail-on', 'critical')
  assert.equal(junit.code, 1)
  assert.match(junit.stdout, /^<\?xml version="1.0" encoding="UTF-8"\?>/)
  assert.match(cli('scan', clean, '--format', 'html').stdout, /^<!doctype html>/)
  assert.equal(JSON.parse(cli('scan', risky, '--format', 'sarif', '--fail-on', 'none').stdout).version, '2.1.0')
})

test('the compiled CLI pairs environment files with --auto-env', () => {
  fs.writeFileSync(
    path.join(work, 'collections', 'team', 'clean.postman_environment.json'),
    JSON.stringify({
      name: 'Staging',
      values: [{ key: 'clientSecret', value: 'cs-0a1b2c3d4e5f6a7b8c9d', enabled: true }],
      _postman_variable_scope: 'environment',
    })
  )
  const without = JSON.parse(cli('scan', clean, '--format', 'json', '--fail-on', 'none').stdout)
  const withEnvironment = JSON.parse(cli('scan', clean, '--auto-env', '--format', 'json', '--fail-on', 'none').stdout)
  assert.ok(!without.findings.some((finding: { ruleId: string }) => finding.ruleId === 'SECRET_IN_ENVIRONMENT'))
  assert.ok(withEnvironment.findings.some((finding: { ruleId: string }) => finding.ruleId === 'SECRET_IN_ENVIRONMENT'))
  assert.equal(withEnvironment.collection.environments[0].name, 'Staging')
})

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo
      probe.close(() => resolve(port))
    })
  })
}

test('the compiled server starts without node_modules and serves the app, config and health', async () => {
  const dist = path.join(work, 'dist')
  fs.mkdirSync(dist, { recursive: true })
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>PostScope</title>')
  fs.writeFileSync(path.join(work, 'package.json'), JSON.stringify({ name: 'postscope', version: '9.8.7', type: 'module' }))
  fs.writeFileSync(path.join(work, '.env'), 'SHOW_FEEDBACK_LINK=false\n')
  const port = await freePort()
  const child: ChildProcess = spawn(process.execPath, [path.join(outdir, 'server.js')], {
    cwd: work,
    env: {
      PATH: process.env.PATH ?? '',
      PORT: String(port),
      HOST: '127.0.0.1',
      LOGGING_MODE: 'off',
      LOG_LEVEL: 'error',
      DATA_DIR: path.join(work, 'data'),
    },
    stdio: 'ignore',
  })
  try {
    let health: Response | null = null
    for (let attempt = 0; attempt < 50 && !health; attempt += 1) {
      try {
        health = await fetch(`http://127.0.0.1:${port}/api/health`)
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
    assert.ok(health, 'server did not start')
    const body = (await health.json()) as { status: string; version: string }
    assert.equal(body.status, 'ok')
    assert.equal(body.version, '9.8.7')
    assert.match(await (await fetch(`http://127.0.0.1:${port}/`)).text(), /PostScope/)
    const config = (await (await fetch(`http://127.0.0.1:${port}/api/config`)).json()) as { loggingMode: string; showFeedbackLink: boolean }
    assert.equal(config.loggingMode, 'off')
    assert.equal(config.showFeedbackLink, false, '.env is read without Vite')
  } finally {
    child.kill('SIGTERM')
    await new Promise((resolve) => child.once('exit', resolve))
  }
})

test('the compiled library tool reports status and encrypts records', async () => {
  const data = path.join(work, 'library-data')
  const library = path.join(data, 'library')
  fs.mkdirSync(library, { recursive: true })
  const id = '0f0f0f0f-1111-4222-8333-444444444444'
  const record = {
    id,
    name: 'Legacy',
    rawJson: '{"info":{"name":"Legacy"},"item":[]}',
    requestCount: 0,
    savedAt: 1,
    sizeBytes: 36,
    contentHash: 'x',
  }
  fs.writeFileSync(path.join(library, `${id}.json`), JSON.stringify(record))
  const run = (...args: string[]) => {
    const result = spawnSync(process.execPath, [path.join(outdir, 'library.js'), ...args], {
      cwd: work,
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', DATA_DIR: data, LIBRARY_ENCRYPTION_KEY: '0'.repeat(63) + '1' },
    })
    return { code: result.status, stdout: result.stdout, stderr: result.stderr }
  }
  assert.match(run('status').stdout, /Records: 1 \(1 plaintext, 0 encrypted, 0 unreadable\)/)
  assert.match(run('encrypt', '--dry-run').stdout, /Dry run: 1 record\(s\) scanned, 1 to encrypt/)
  assert.ok(fs.readFileSync(path.join(library, `${id}.json`), 'utf8').includes('Legacy'), 'a dry run changes nothing')
  const encrypted = run('encrypt')
  assert.equal(encrypted.code, 0, encrypted.stderr)
  assert.match(encrypted.stdout, /1 encrypted/)
  assert.ok(!fs.readFileSync(path.join(library, `${id}.json`), 'utf8').includes('Legacy'))
  assert.match(run('status').stdout, /1 encrypted/)
  assert.equal(run('bogus').code, 2)
  const noKey = spawnSync(process.execPath, [path.join(outdir, 'library.js'), 'encrypt'], {
    cwd: work,
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', DATA_DIR: data },
  })
  assert.equal(noKey.status, 2)
  assert.match(noKey.stderr, /LIBRARY_ENCRYPTION_KEY/)
})
