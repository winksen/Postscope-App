import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'

const { validateRuntimeSettings } = await import('../server/startupValidation')

const KEYS = ['LOGGING_MODE', 'BASIC_AUTH_USER', 'BASIC_AUTH_PASSWORD', 'ALLOW_UNAUTHENTICATED_TEAM_STORAGE', 'PORT']

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

test('an invalid port is reported', () => {
  assert.deepEqual(codes({ LOGGING_MODE: 'off', PORT: '70000' }), ['PORT_INVALID'])
  assert.deepEqual(codes({ LOGGING_MODE: 'off', PORT: '3010' }), [])
})

test('messages never contain the configured password', () => {
  configure({ LOGGING_MODE: 'on', BASIC_AUTH_PASSWORD: 'sentinel-password-value' })
  assert.ok(!JSON.stringify(validateRuntimeSettings()).includes('sentinel-password-value'))
})
