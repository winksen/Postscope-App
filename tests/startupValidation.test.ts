import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'

const { validateRuntimeSettings } = await import('../server/startupValidation')

const KEYS = [
  'LOGGING_MODE',
  'BASIC_AUTH_USER',
  'BASIC_AUTH_PASSWORD',
  'ALLOW_UNAUTHENTICATED_TEAM_STORAGE',
  'PORT',
  'TRUST_PROXY',
  'TRUSTED_USER_HEADER',
  'TRUSTED_PROXY_PEERS',
]

function configure(values: Record<string, string>): void {
  for (const key of KEYS) delete process.env[key]
  Object.assign(process.env, values)
}

afterEach(() => {
  for (const key of KEYS) delete process.env[key]
})

const codes = (values: Record<string, string>) => {
  configure(values)
  return validateRuntimeSettings().errors.map((issue) => issue.code)
}

test('static mode starts without credentials', () => {
  assert.deepEqual(codes({ LOGGING_MODE: 'off' }), [])
})

test('a username without a password, or the reverse, is a startup error', () => {
  assert.deepEqual(codes({ LOGGING_MODE: 'off', BASIC_AUTH_USER: 'admin' }), ['BASIC_AUTH_PARTIAL'])
  assert.deepEqual(codes({ LOGGING_MODE: 'off', BASIC_AUTH_PASSWORD: 'a-long-random-password' }), ['BASIC_AUTH_PARTIAL'])
  assert.deepEqual(codes({ LOGGING_MODE: 'off', BASIC_AUTH_USER: '  ', BASIC_AUTH_PASSWORD: 'a-long-random-password' }), [
    'BASIC_AUTH_PARTIAL',
  ])
})

test('hybrid and on modes refuse to start without authentication', () => {
  assert.deepEqual(codes({ LOGGING_MODE: 'hybrid' }), ['TEAM_STORAGE_UNAUTHENTICATED'])
  assert.deepEqual(codes({ LOGGING_MODE: 'on' }), ['TEAM_STORAGE_UNAUTHENTICATED'])
})

test('hybrid and on modes start with complete credentials', () => {
  assert.deepEqual(codes({ LOGGING_MODE: 'hybrid', BASIC_AUTH_USER: 'admin', BASIC_AUTH_PASSWORD: 'a-long-random-password' }), [])
})

test('the isolated-network override starts team storage and leaves a warning', () => {
  configure({ LOGGING_MODE: 'on', ALLOW_UNAUTHENTICATED_TEAM_STORAGE: 'true' })
  const report = validateRuntimeSettings()
  assert.deepEqual(report.errors, [])
  assert.match(report.warnings.join(' '), /ALLOW_UNAUTHENTICATED_TEAM_STORAGE/)
})

test('the override does not excuse partial credentials', () => {
  assert.deepEqual(codes({ LOGGING_MODE: 'on', ALLOW_UNAUTHENTICATED_TEAM_STORAGE: 'true', BASIC_AUTH_USER: 'admin' }), [
    'BASIC_AUTH_PARTIAL',
  ])
})

test('proxy identity needs a peer list and counts as authentication for team storage', () => {
  const proxy = { LOGGING_MODE: 'hybrid', TRUST_PROXY: 'true', TRUSTED_USER_HEADER: 'X-Auth-Request-Email' }
  assert.deepEqual(codes(proxy), ['PROXY_PEERS_MISSING', 'TEAM_STORAGE_UNAUTHENTICATED'])
  assert.deepEqual(codes({ ...proxy, TRUSTED_PROXY_PEERS: '10.0.0.0/8, ::1' }), [])
})

test('invalid proxy peer entries are reported', () => {
  const base = { LOGGING_MODE: 'off', TRUST_PROXY: 'true', TRUSTED_USER_HEADER: 'X-Forwarded-User' }
  assert.deepEqual(codes({ ...base, TRUSTED_PROXY_PEERS: '10.0.0.0/33' }), ['PROXY_PEERS_INVALID'])
  assert.deepEqual(codes({ ...base, TRUSTED_PROXY_PEERS: 'proxy.example.com' }), ['PROXY_PEERS_INVALID'])
  assert.deepEqual(codes({ ...base, TRUSTED_PROXY_PEERS: '10.0.0.1/8/8' }), ['PROXY_PEERS_INVALID'])
  assert.deepEqual(codes({ ...base, TRUSTED_PROXY_PEERS: '2001:db8::/129' }), ['PROXY_PEERS_INVALID'])
  assert.deepEqual(codes({ ...base, TRUSTED_PROXY_PEERS: '2001:db8::/32, 192.0.2.1' }), [])
})

test('an invalid port is reported', () => {
  assert.deepEqual(codes({ LOGGING_MODE: 'off', PORT: '70000' }), ['PORT_INVALID'])
  assert.deepEqual(codes({ LOGGING_MODE: 'off', PORT: '3010' }), [])
})

test('messages never contain the configured password', () => {
  configure({ LOGGING_MODE: 'on', BASIC_AUTH_PASSWORD: 'sentinel-password-value' })
  assert.ok(!JSON.stringify(validateRuntimeSettings()).includes('sentinel-password-value'))
})
