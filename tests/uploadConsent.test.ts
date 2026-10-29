import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'

const local = new Map<string, string>()
const memory = {
  getItem: (key: string) => local.get(key) ?? null,
  setItem: (key: string, value: string) => void local.set(key, value),
  removeItem: (key: string) => void local.delete(key),
}
;(globalThis as unknown as { window: unknown }).window = { localStorage: memory, sessionStorage: memory }

const { getUploadConsentState, recordUploadConsent, revokeUploadConsent, uploadPolicyDigest } = await import('../src/lib/uploadConsent')

beforeEach(() => local.clear())

const policy = { loggingMode: 'hybrid', redactsSecrets: false, encrypted: false, retentionDays: 0 } as const
const ORIGIN = 'https://postscope.example.com'

test('the digest is stable and changes with every setting that affects stored data', () => {
  const base = uploadPolicyDigest(policy)
  assert.equal(base, uploadPolicyDigest({ ...policy }))
  assert.match(base, /^[0-9a-f]{8}$/)
  const variants = [
    { ...policy, loggingMode: 'on' as const },
    { ...policy, redactsSecrets: true },
    { ...policy, encrypted: true },
    { ...policy, retentionDays: 30 },
  ]
  for (const variant of variants) assert.notEqual(uploadPolicyDigest(variant), base, JSON.stringify(variant))
  assert.equal(new Set(variants.map((variant) => uploadPolicyDigest(variant))).size, variants.length)
})

test('consent is nothing until given, then holds for the same origin and policy without asking again', () => {
  const digest = uploadPolicyDigest(policy)
  assert.equal(getUploadConsentState(ORIGIN, digest), 'none')
  recordUploadConsent(ORIGIN, digest)
  assert.equal(getUploadConsentState(ORIGIN, digest), 'accepted')
  assert.equal(getUploadConsentState(ORIGIN, digest), 'accepted', 'repeated checks stay accepted')
})

test('a changed policy or origin invalidates earlier consent', () => {
  recordUploadConsent(ORIGIN, uploadPolicyDigest(policy))
  assert.equal(getUploadConsentState(ORIGIN, uploadPolicyDigest({ ...policy, retentionDays: 7 })), 'stale')
  assert.equal(getUploadConsentState(ORIGIN, uploadPolicyDigest({ ...policy, redactsSecrets: true })), 'stale')
  assert.equal(getUploadConsentState('https://other.example.com', uploadPolicyDigest(policy)), 'stale')
})

test('the old plain acceptance flag does not count as consent', () => {
  local.set('postscope:upload-risk-accepted', 'true')
  assert.equal(getUploadConsentState(ORIGIN, uploadPolicyDigest(policy)), 'stale')
  local.set('postscope:upload-risk-accepted', 'false')
  assert.equal(getUploadConsentState(ORIGIN, uploadPolicyDigest(policy)), 'none')
  local.set('postscope:upload-risk-accepted', '{broken')
  assert.equal(getUploadConsentState(ORIGIN, uploadPolicyDigest(policy)), 'stale')
})

test('revoking removes the consent', () => {
  const digest = uploadPolicyDigest(policy)
  recordUploadConsent(ORIGIN, digest)
  revokeUploadConsent()
  assert.equal(getUploadConsentState(ORIGIN, digest), 'none')
})
