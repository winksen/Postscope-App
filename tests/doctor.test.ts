import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'

// Settings that influence the check. Each run starts from the current environment with these removed, so a variable
// on the developer's machine cannot change the result (and Windows keeps the variables Node itself needs).
const MANAGED = [
  'LOGGING_MODE',
  'BASIC_AUTH_USER',
  'BASIC_AUTH_PASSWORD',
  'ALLOW_UNAUTHENTICATED_TEAM_STORAGE',
  'TRUST_PROXY',
  'TRUST_PROXY_HOPS',
  'TRUSTED_USER_HEADER',
  'TRUSTED_PROXY_PEERS',
  'ALLOWED_ORIGINS',
  'ENABLE_HSTS',
  'LIBRARY_ENCRYPTION_KEY',
  'LIBRARY_ENCRYPTION_KEY_FILE',
  'LIBRARY_REDACT_SECRETS',
  'LIBRARY_RETENTION_DAYS',
  'LIBRARY_AUDIT_LOG',
  'PRIVACY_INTERNAL_IDENTIFIERS',
  'HOST',
  'PORT',
  'RATE_LIMIT_WRITES_PER_MIN',
  'RATE_LIMIT_READS_PER_MIN',
]

function doctor(settings: Record<string, string>, ...args: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const key of MANAGED) delete env[key]
  Object.assign(env, settings)
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'cli/postscope.ts', 'doctor', ...args], {
    encoding: 'utf8',
    cwd: process.cwd(),
    env,
  })
  return { code: result.status, stdout: result.stdout, stderr: result.stderr }
}

const PASSWORD = 'Zq8-sentinel-password-4417'
const KEY = crypto.randomBytes(32).toString('hex')

/** The three recipes of docs/DEPLOYMENT.md, with placeholders replaced by strong values. */
const BROWSER_ONLY = { LOGGING_MODE: 'off' }
const ISOLATED_TEAM = { LOGGING_MODE: 'hybrid', ALLOW_UNAUTHENTICATED_TEAM_STORAGE: 'true' }
const AUTHENTICATED_TEAM = {
  LOGGING_MODE: 'hybrid',
  BASIC_AUTH_USER: 'postscope-admin',
  BASIC_AUTH_PASSWORD: PASSWORD,
  LIBRARY_ENCRYPTION_KEY: KEY,
  LIBRARY_REDACT_SECRETS: 'true',
  LIBRARY_RETENTION_DAYS: '90',
  ENABLE_HSTS: 'true',
}

const report = (settings: Record<string, string>) =>
  JSON.parse(doctor(settings, '--json').stdout) as {
    deployment: string
    settings: Record<string, unknown>
    issues: Array<{ level: string; code: string }>
  }

test('the browser-only recipe passes with nothing to report', () => {
  const result = doctor(BROWSER_ONLY)
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stdout, /Deployment: browser only/)
  assert.match(result.stdout, /No problems found\./)
  assert.equal(doctor(BROWSER_ONLY, '--strict').code, 0)
})

test('the isolated team recipe starts but is flagged as relying on the network', () => {
  const result = doctor(ISOLATED_TEAM)
  assert.equal(result.code, 0, result.stderr)
  const parsed = report(ISOLATED_TEAM)
  assert.equal(parsed.deployment, 'isolated-team')
  assert.ok(parsed.issues.some((issue) => issue.code === 'TEAM_STORAGE_OVERRIDE'))
  assert.equal(doctor(ISOLATED_TEAM, '--strict').code, 1, '--strict fails on warnings')
})

test('the authenticated team recipe is clean', () => {
  const result = doctor(AUTHENTICATED_TEAM, '--strict')
  assert.equal(result.code, 0, result.stdout + result.stderr)
  const parsed = report(AUTHENTICATED_TEAM)
  assert.equal(parsed.deployment, 'authenticated-team')
  assert.deepEqual(parsed.issues, [])
})

test('the authenticated team recipe also works with a trusted proxy instead of Basic auth', () => {
  const proxy = {
    LOGGING_MODE: 'on',
    TRUST_PROXY: 'true',
    TRUSTED_USER_HEADER: 'X-Auth-Request-Email',
    TRUSTED_PROXY_PEERS: '10.0.0.0/8',
    ALLOWED_ORIGINS: 'https://postscope.example.com',
    LIBRARY_ENCRYPTION_KEY: KEY,
    LIBRARY_REDACT_SECRETS: 'true',
    LIBRARY_RETENTION_DAYS: '90',
    ENABLE_HSTS: 'true',
  }
  const result = doctor(proxy, '--strict')
  assert.equal(result.code, 0, result.stdout + result.stderr)
  assert.equal(report(proxy).deployment, 'authenticated-team')
})

test('unsafe settings fail with the stable codes the server uses at startup', () => {
  const open = doctor({ LOGGING_MODE: 'hybrid' })
  assert.equal(open.code, 1)
  assert.match(open.stdout, /TEAM_STORAGE_UNAUTHENTICATED/)
  const partial = doctor({ LOGGING_MODE: 'off', BASIC_AUTH_USER: 'admin' })
  assert.equal(partial.code, 1)
  assert.match(partial.stdout, /BASIC_AUTH_PARTIAL/)
  const peers = doctor({ LOGGING_MODE: 'off', TRUST_PROXY: 'true', TRUSTED_USER_HEADER: 'X-User' })
  assert.match(peers.stdout, /PROXY_PEERS_MISSING/)
})

test('example and weak values from the documentation are flagged', () => {
  const example = report({ ...AUTHENTICATED_TEAM, BASIC_AUTH_PASSWORD: 'change-me-to-a-long-random-value' })
  assert.ok(example.issues.some((issue) => issue.code === 'PASSWORD_IS_EXAMPLE'))
  const short = report({ ...AUTHENTICATED_TEAM, BASIC_AUTH_PASSWORD: 'Short-1' })
  assert.ok(short.issues.some((issue) => issue.code === 'PASSWORD_SHORT'))
  const exampleKey = doctor({ ...AUTHENTICATED_TEAM, LIBRARY_ENCRYPTION_KEY: '0'.repeat(64) })
  assert.equal(exampleKey.code, 1)
  assert.match(exampleKey.stdout, /ENCRYPTION_KEY_IS_EXAMPLE/)
  const bare = report({ LOGGING_MODE: 'hybrid', BASIC_AUTH_USER: 'postscope', BASIC_AUTH_PASSWORD: PASSWORD })
  for (const code of ['ENCRYPTION_OFF', 'REDACTION_OFF', 'RETENTION_UNLIMITED', 'HSTS_OFF'])
    assert.ok(
      bare.issues.some((issue) => issue.code === code),
      code
    )
})

test('the report never contains a password, a key or an internal identifier', () => {
  const settings = { ...AUTHENTICATED_TEAM, PRIVACY_INTERNAL_IDENTIFIERS: 'internal-codename-xyz' }
  for (const args of [[], ['--json']]) {
    const result = doctor(settings, ...args)
    const text = result.stdout + result.stderr
    for (const secret of [PASSWORD, KEY, 'internal-codename-xyz']) assert.ok(!text.includes(secret), `${args.join(' ')} leaks a secret`)
  }
  assert.match(doctor(settings).stdout, /internalIdentifiers\s+1 configured/)
})

test('usage', () => {
  assert.equal(doctor({}, '--bogus').code, 2)
  const help = doctor({}, '--help')
  assert.equal(help.code, 0)
  assert.match(help.stdout, /postscope doctor/)
})
