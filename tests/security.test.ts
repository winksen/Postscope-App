import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import type { IncomingMessage } from 'node:http'

const { AuthFailureTracker, getClientIp, normalizeIp } = await import('../server/security')

function request(headers: Record<string, string | string[]>, remoteAddress = '10.0.0.1'): IncomingMessage {
  return { headers, socket: { remoteAddress } } as unknown as IncomingMessage
}

afterEach(() => {
  delete process.env.TRUST_PROXY
  delete process.env.TRUST_PROXY_HOPS
})

test('client address ignores X-Forwarded-For unless the proxy is trusted', () => {
  assert.equal(getClientIp(request({ 'x-forwarded-for': '6.6.6.6' })), '10.0.0.1')
  assert.equal(getClientIp(request({}, '::ffff:192.0.2.5')), '192.0.2.5')
})

test('with a trusted proxy the entry added by that proxy is used, not the client-controlled left side', () => {
  process.env.TRUST_PROXY = 'true'
  assert.equal(getClientIp(request({ 'x-forwarded-for': '203.0.113.9' })), '203.0.113.9')
  assert.equal(getClientIp(request({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9' })), '203.0.113.9')
  assert.equal(getClientIp(request({ 'x-forwarded-for': '7.7.7.7, 8.8.8.8, 203.0.113.9' })), '203.0.113.9')
  assert.equal(getClientIp(request({ 'x-forwarded-for': ['1.1.1.1', '203.0.113.9'] })), '203.0.113.9')
})

test('TRUST_PROXY_HOPS counts proxies from the right and falls back to the socket address', () => {
  process.env.TRUST_PROXY = 'true'
  process.env.TRUST_PROXY_HOPS = '2'
  assert.equal(getClientIp(request({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9, 198.51.100.4' })), '203.0.113.9')
  // Fewer entries than trusted hops: the header cannot be trusted at all.
  assert.equal(getClientIp(request({ 'x-forwarded-for': '203.0.113.9' })), '10.0.0.1')
  assert.equal(getClientIp(request({})), '10.0.0.1')
  process.env.TRUST_PROXY_HOPS = '1'
  assert.equal(getClientIp(request({ 'x-forwarded-for': '6.6.6.6, not-an-ip' })), '10.0.0.1')
  assert.equal(getClientIp(request({ 'x-forwarded-for': '6.6.6.6, unknown' })), '10.0.0.1')
})

test('invalid TRUST_PROXY_HOPS values fall back to one hop', () => {
  process.env.TRUST_PROXY = 'true'
  for (const value of ['0', '-1', 'abc', '99']) {
    process.env.TRUST_PROXY_HOPS = value
    assert.equal(getClientIp(request({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9' })), '203.0.113.9', value)
  }
})

test('addresses are normalized', () => {
  assert.equal(normalizeIp('203.0.113.9:51234'), '203.0.113.9')
  assert.equal(normalizeIp('[2001:db8::1]:443'), '2001:db8::1')
  assert.equal(normalizeIp('::ffff:203.0.113.9'), '203.0.113.9')
  assert.equal(normalizeIp('2001:DB8::1'), '2001:db8::1')
  assert.equal(normalizeIp('999.1.1.1'), null)
  assert.equal(normalizeIp('evil, 1.1.1.1'), null)
  assert.equal(normalizeIp(undefined), null)
})

test('flooding the failure table cannot unlock a locked address', () => {
  const tracker = new AuthFailureTracker(50)
  const now = 1_000_000
  const limit = 3
  for (let i = 0; i < limit; i += 1) tracker.record('203.0.113.9', limit, now)
  assert.ok(tracker.peek('203.0.113.9', now) >= limit)

  for (let i = 0; i < 500; i += 1) tracker.record(`198.51.${Math.floor(i / 250)}.${i % 250}`, limit, now + i)
  assert.ok(tracker.peek('203.0.113.9', now + 500) >= limit, 'locked address stays locked')
  assert.ok(tracker.size <= 50)
})

test('expired windows are swept before anything else is evicted', () => {
  const tracker = new AuthFailureTracker(10)
  for (let i = 0; i < 10; i += 1) tracker.record(`192.0.2.${i}`, 5, 1_000)
  const later = 1_000 + 16 * 60_000
  tracker.record('192.0.2.200', 5, later)
  assert.equal(tracker.size, 1)
})

test('a table full of locked addresses keeps its lockouts and still counts globally', () => {
  const tracker = new AuthFailureTracker(5)
  const limit = 2
  for (let i = 0; i < 5; i += 1) for (let n = 0; n < limit; n += 1) tracker.record(`192.0.2.${i}`, limit, 1_000)
  tracker.record('192.0.2.99', limit, 1_001)
  assert.equal(tracker.size, 5)
  assert.equal(tracker.peek('192.0.2.99', 1_001), 0)
  for (let i = 0; i < 5; i += 1) assert.ok(tracker.peek(`192.0.2.${i}`, 1_001) >= limit)
})

test('failures spread over many addresses trigger a short global back-off that expires', () => {
  const tracker = new AuthFailureTracker()
  const limit = 3
  const start = 5_000_000
  for (let i = 0; i < limit * 10; i += 1) tracker.record(`203.0.113.${i}`, limit, start)
  assert.equal(tracker.inBackoff(start), false)
  tracker.record('203.0.114.1', limit, start)
  assert.equal(tracker.inBackoff(start + 1), true)
  assert.equal(tracker.inBackoff(start + 61_000), false)
})
