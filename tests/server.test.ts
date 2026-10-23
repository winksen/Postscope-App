import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'postscope-server-'))
const distDir = path.join(tmpRoot, 'dist')
const dataDir = path.join(tmpRoot, 'data')
fs.mkdirSync(path.join(distDir, 'assets'), { recursive: true })
fs.writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><title>PostScope</title>')
fs.writeFileSync(path.join(distDir, 'assets', 'app.js'), `console.log(${JSON.stringify('x'.repeat(4096))})`)
fs.writeFileSync(path.join(tmpRoot, 'secret.txt'), 'top-secret')

Object.assign(process.env, {
  LOGGING_MODE: 'hybrid',
  PUBLIC_LANDING_PAGE: 'false',
  DATA_DIR: dataDir,
  RATE_LIMIT_WRITES_PER_MIN: '1000',
  RATE_LIMIT_READS_PER_MIN: '10000',
  MAX_COLLECTION_MB: '1',
  LOG_LEVEL: 'error',
})

const { createRequestHandler } = await import('../server/requestPipeline')
const { rateLimiter, sweepAuthFailures } = await import('../server/security')
const { resetLibraryCache } = await import('../server/libraryStore')

let server: http.Server
let port = 0

interface RawResponse {
  status: number
  headers: http.IncomingHttpHeaders
  body: string
}

function raw(pathname: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method: options.method ?? 'GET', headers: options.headers }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', reject)
    if (options.body) req.write(options.body)
    req.end()
  })
}

function postCollection(collection: unknown, headers: Record<string, string> = {}, name = 'Test collection') {
  return raw('/api/collections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ rawJson: JSON.stringify(collection), name }),
  })
}

const sample = { info: { name: 'Sample' }, item: [{ name: 'A', request: { url: 'https://example.com' } }] }

before(async () => {
  const handle = createRequestHandler({ mode: 'production', distDir })
  server = http.createServer((req, res) => void handle(req, res))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
})

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

beforeEach(() => {
  rateLimiter.sweep(Date.now() + 3_600_000)
  sweepAuthFailures(Date.now() + 3_600_000)
})

test('static server blocks path traversal and dotfiles', async () => {
  for (const attack of ['/../secret.txt', '/..%2fsecret.txt', '/%2e%2e/secret.txt', '/assets/..%5c..%5csecret.txt', '/.env', '/%00index.html']) {
    const res = await raw(attack)
    assert.ok(res.status === 404 || res.status === 400, `${attack} -> ${res.status}`)
    assert.ok(!res.body.includes('top-secret'), attack)
  }
})

test('static server serves SPA routes, assets with caching and gzip, and 404s missing assets', async () => {
  const spa = await raw('/analyze')
  assert.equal(spa.status, 200)
  assert.match(String(spa.headers['content-type']), /text\/html/)
  assert.equal(spa.headers['cache-control'], 'no-cache')

  const asset = await raw('/assets/app.js', { headers: { 'Accept-Encoding': 'gzip' } })
  assert.equal(asset.status, 200)
  assert.equal(asset.headers['content-encoding'], 'gzip')
  assert.match(String(asset.headers['cache-control']), /immutable/)

  const notModified = await raw('/assets/app.js', { headers: { 'If-None-Match': String(asset.headers.etag) } })
  assert.equal(notModified.status, 304)

  assert.equal((await raw('/assets/missing.js')).status, 404)
  assert.equal((await raw('/index.html', { method: 'POST' })).status, 405)
})

test('browser navigations to deep links open the app, even when the last segment looks like a file', async () => {
  const html = { headers: { Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' } }
  for (const link of ['/analyze/requests/Users%2FList%20users', '/analyze/requests/v1.2%2FGet%20item.v2', '/requests/%2Ehidden%2Fa', '/analyze/security?severity=critical&rule=HARDCODED_TOKEN']) {
    const res = await raw(link, html)
    assert.equal(res.status, 200, link)
    assert.match(String(res.headers['content-type']), /text\/html/)
    assert.ok(!res.body.includes('top-secret'), link)
  }
  // Only navigations fall back: script and data requests for unknown files still 404.
  assert.equal((await raw('/analyze/requests/v1.2%2FGet%20item.v2')).status, 404)
  assert.equal((await raw('/assets/missing.js')).status, 404)
})

test('responses carry security headers and a CSP', async () => {
  const res = await raw('/')
  assert.equal(res.headers['x-content-type-options'], 'nosniff')
  assert.equal(res.headers['x-frame-options'], 'DENY')
  assert.equal(res.headers['referrer-policy'], 'no-referrer')
  assert.match(String(res.headers['content-security-policy']), /frame-ancestors 'none'/)
  assert.match(String(res.headers['content-security-policy']), /script-src 'self'/)
})

test('config and health endpoints', async () => {
  const config = JSON.parse((await raw('/api/config')).body)
  assert.equal(config.loggingMode, 'hybrid')
  assert.equal(config.maxCollectionBytes, 1_000_000)
  assert.match(config.appVersion, /^\d+\.\d+\.\d+/)
  assert.deepEqual(config.auditPolicy, { disabledRules: [], severityOverrides: {} })

  const health = await raw('/api/health')
  assert.equal(health.status, 200)
  assert.equal(JSON.parse(health.body).storage, 'writable')
  assert.equal((await raw('/api/nope')).status, 404)
})

test('library API rejects invalid ids and traversal attempts', async () => {
  for (const id of ['..%2F..%2Fpackage', 'not-a-uuid', '%E0%A4%A']) {
    const res = await raw(`/api/collections/${id}`)
    assert.equal(res.status, 400, id)
  }
  assert.equal((await raw('/api/collections/00000000-0000-4000-8000-000000000000')).status, 404)
})

test('library API enforces JSON content type, same-origin, and payload validation', async () => {
  const textPlain = await raw('/api/collections', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })
  assert.equal(textPlain.status, 415)

  const crossSite = await postCollection(sample, { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' })
  assert.equal(crossSite.status, 403)

  const badOrigin = await postCollection(sample, { Origin: 'https://evil.example' })
  assert.equal(badOrigin.status, 403)

  const badJson = await raw('/api/collections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' })
  assert.equal(badJson.status, 400)
  assert.ok(!badJson.body.includes('position'), 'parser internals must not leak')

  const notCollection = await raw('/api/collections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rawJson: '{"a":1}' }),
  })
  assert.equal(notCollection.status, 422)

  const tooLarge = await raw('/api/collections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rawJson: JSON.stringify({ item: [], pad: 'x'.repeat(3_200_000) }) }),
  })
  assert.equal(tooLarge.status, 413)
})

test('library API saves, de-duplicates, sanitizes names, lists, and deletes', async () => {
  const saved = await postCollection(sample, { Origin: `http://127.0.0.1:${port}` }, `Evil${String.fromCharCode(0x202e)}name${String.fromCharCode(0)}`)
  assert.equal(saved.status, 201)
  const meta = JSON.parse(saved.body)
  assert.equal(meta.name, 'Evil name')
  assert.equal(meta.requestCount, 1)

  const duplicate = await postCollection(sample, { 'Sec-Fetch-Site': 'same-origin' })
  assert.equal(duplicate.status, 200)
  assert.equal(JSON.parse(duplicate.body).id, meta.id)
  assert.equal(JSON.parse(duplicate.body).deduplicated, true)

  const list = JSON.parse((await raw('/api/collections')).body)
  assert.ok(list.collections.some((item: { id: string }) => item.id === meta.id))
  assert.ok(!('rawJson' in list.collections[0]))

  const record = JSON.parse((await raw(`/api/collections/${meta.id}`)).body)
  assert.equal(JSON.parse(record.rawJson).info.name, 'Sample')

  process.env.LIBRARY_ALLOW_DELETE = 'false'
  assert.equal((await raw(`/api/collections/${meta.id}`, { method: 'DELETE' })).status, 403)
  delete process.env.LIBRARY_ALLOW_DELETE

  assert.equal((await raw(`/api/collections/${meta.id}`, { method: 'DELETE' })).status, 200)
  assert.equal((await raw(`/api/collections/${meta.id}`)).status, 404)
})

test('server-side redaction scrubs credentials before storing', async () => {
  process.env.LIBRARY_REDACT_SECRETS = 'true'
  try {
    const secret = 'Bearer live-token-abcdef123456'
    const collection = { info: { name: 'Secrets' }, item: [{ name: 'A', request: { url: 'https://x', header: [{ key: 'Authorization', value: secret }] } }] }
    const res = await postCollection(collection)
    assert.equal(res.status, 201)
    const meta = JSON.parse(res.body)
    assert.ok(meta.redactedCount >= 1)
    const record = JSON.parse((await raw(`/api/collections/${meta.id}`)).body)
    assert.ok(!record.rawJson.includes('live-token-abcdef123456'))
  } finally {
    delete process.env.LIBRARY_REDACT_SECRETS
  }
})

test('public mode refuses storage', async () => {
  process.env.LOGGING_MODE = 'off'
  try {
    assert.equal((await postCollection(sample)).status, 403)
    assert.deepEqual(JSON.parse((await raw('/api/collections')).body), { collections: [] })
  } finally {
    process.env.LOGGING_MODE = 'hybrid'
  }
})

test('write rate limit returns 429 with Retry-After', async () => {
  process.env.RATE_LIMIT_WRITES_PER_MIN = '3'
  try {
    const statuses: number[] = []
    for (let i = 0; i < 5; i += 1) statuses.push((await raw('/api/collections/00000000-0000-4000-8000-000000000000', { method: 'DELETE' })).status)
    assert.deepEqual(statuses, [404, 404, 404, 429, 429])
    const limited = await raw('/api/collections/00000000-0000-4000-8000-000000000000', { method: 'DELETE' })
    assert.ok(Number(limited.headers['retry-after']) > 0)
  } finally {
    process.env.RATE_LIMIT_WRITES_PER_MIN = '1000'
  }
})

test('optional Basic auth protects everything except health, with lockout', async () => {
  process.env.BASIC_AUTH_USER = 'admin'
  process.env.BASIC_AUTH_PASSWORD = 'a-long-test-password'
  process.env.RATE_LIMIT_AUTH_FAILURES = '3'
  const good = `Basic ${Buffer.from('admin:a-long-test-password').toString('base64')}`
  const bad = `Basic ${Buffer.from('admin:wrong').toString('base64')}`
  try {
    assert.equal((await raw('/api/health')).status, 200)
    const challenge = await raw('/')
    assert.equal(challenge.status, 401)
    assert.match(String(challenge.headers['www-authenticate']), /Basic realm="PostScope"/)
    assert.equal((await raw('/api/config', { headers: { Authorization: good } })).status, 200)

    const statuses: number[] = []
    for (let i = 0; i < 4; i += 1) statuses.push((await raw('/', { headers: { Authorization: bad } })).status)
    assert.deepEqual(statuses, [401, 401, 401, 429])
    assert.equal((await raw('/', { headers: { Authorization: good } })).status, 429)
  } finally {
    delete process.env.BASIC_AUTH_USER
    delete process.env.BASIC_AUTH_PASSWORD
    delete process.env.RATE_LIMIT_AUTH_FAILURES
    resetLibraryCache()
  }
})

test('health hides the version when HEALTH_EXPOSE_VERSION is false', async () => {
  assert.ok(JSON.parse((await raw('/api/health')).body).version)
  process.env.HEALTH_EXPOSE_VERSION = 'false'
  try {
    const body = JSON.parse((await raw('/api/health')).body)
    assert.equal(body.status, 'ok')
    assert.equal('version' in body, false)
    assert.ok(JSON.parse((await raw('/api/config')).body).appVersion)
  } finally {
    delete process.env.HEALTH_EXPOSE_VERSION
  }
})

test('rotating X-Forwarded-For does not dodge the sign-in lockout behind a trusted proxy', async () => {
  process.env.BASIC_AUTH_USER = 'admin'
  process.env.BASIC_AUTH_PASSWORD = 'a-long-test-password'
  process.env.RATE_LIMIT_AUTH_FAILURES = '3'
  process.env.TRUST_PROXY = 'true'
  const bad = `Basic ${Buffer.from('admin:wrong').toString('base64')}`
  try {
    const statuses: number[] = []
    for (let i = 0; i < 4; i += 1) statuses.push((await raw('/', { headers: { Authorization: bad, 'X-Forwarded-For': `10.9.8.${i}, 198.51.100.7` } })).status)
    assert.deepEqual(statuses, [401, 401, 401, 429])
  } finally {
    delete process.env.BASIC_AUTH_USER
    delete process.env.BASIC_AUTH_PASSWORD
    delete process.env.RATE_LIMIT_AUTH_FAILURES
    delete process.env.TRUST_PROXY
  }
})

test('distributed sign-in failures trigger a global back-off without locking out plain requests', async () => {
  process.env.BASIC_AUTH_USER = 'admin'
  process.env.BASIC_AUTH_PASSWORD = 'a-long-test-password'
  process.env.RATE_LIMIT_AUTH_FAILURES = '2'
  process.env.TRUST_PROXY = 'true'
  const good = `Basic ${Buffer.from('admin:a-long-test-password').toString('base64')}`
  const bad = `Basic ${Buffer.from('admin:wrong').toString('base64')}`
  try {
    for (let i = 0; i <= 20; i += 1) await raw('/', { headers: { Authorization: bad, 'X-Forwarded-For': `203.0.113.${i + 1}` } })
    const blocked = await raw('/', { headers: { Authorization: good, 'X-Forwarded-For': '203.0.113.200' } })
    assert.equal(blocked.status, 429)
    assert.equal(blocked.headers['retry-after'], '60')
    assert.equal((await raw('/', { headers: { 'X-Forwarded-For': '203.0.113.201' } })).status, 401)
    sweepAuthFailures(Date.now() + 3_600_000)
    assert.equal((await raw('/', { headers: { Authorization: good, 'X-Forwarded-For': '203.0.113.202' } })).status, 200)
  } finally {
    delete process.env.BASIC_AUTH_USER
    delete process.env.BASIC_AUTH_PASSWORD
    delete process.env.RATE_LIMIT_AUTH_FAILURES
    delete process.env.TRUST_PROXY
  }
})

test('score weights are shared through /api/config and ignore invalid entries', async () => {
  assert.deepEqual(JSON.parse((await raw('/api/config')).body).scoreWeights, { critical: 20, warning: 8, info: 2 })
  process.env.SCORE_WEIGHTS = 'critical=30,warning=5,info=1'
  try {
    assert.deepEqual(JSON.parse((await raw('/api/config')).body).scoreWeights, { critical: 30, warning: 5, info: 1 })
    process.env.SCORE_WEIGHTS = 'critical=oops,bogus=1'
    assert.deepEqual(JSON.parse((await raw('/api/config')).body).scoreWeights, { critical: 20, warning: 8, info: 2 })
  } finally {
    delete process.env.SCORE_WEIGHTS
  }
})

test('library saves, opens and removals are written to an append-only audit log', async () => {
  const { flushAuditLog } = await import('../server/auditLog')
  const auditDir = path.join(dataDir, 'audit')
  fs.rmSync(auditDir, { recursive: true, force: true })
  process.env.TRUST_PROXY = 'true'
  process.env.TRUSTED_USER_HEADER = 'X-Auth-Request-Email'
  try {
    const forwarded = { 'X-Forwarded-For': '198.51.100.23', 'X-Auth-Request-Email': 'alice@example.com' }
    const saved = await postCollection({ ...sample, info: { name: 'Audited' } }, forwarded, 'Audited collection')
    assert.equal(saved.status, 201)
    const meta = JSON.parse(saved.body)
    assert.equal(meta.savedBy, 'alice@example.com')
    assert.equal((await raw(`/api/collections/${meta.id}`, { headers: { 'X-Forwarded-For': '198.51.100.24', 'X-Auth-Request-Email': 'bob@example.com' } })).status, 200)
    assert.equal((await raw('/api/collections', { headers: forwarded })).status, 200)
    assert.equal((await raw(`/api/collections/${meta.id}`, { method: 'DELETE', headers: forwarded })).status, 200)
    await flushAuditLog()

    const files = fs.readdirSync(auditDir)
    assert.equal(files.length, 1)
    assert.match(files[0], /^library-\d{4}-\d{2}\.jsonl$/)
    const entries = fs.readFileSync(path.join(auditDir, files[0]), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    assert.deepEqual(entries.map((entry) => [entry.action, entry.user, entry.ip]), [
      ['save', 'alice@example.com', '198.51.100.23'],
      ['open', 'bob@example.com', '198.51.100.24'],
      ['delete', 'alice@example.com', '198.51.100.23'],
    ])
    assert.ok(entries.every((entry) => entry.id === meta.id && entry.name === 'Audited collection' && typeof entry.requestId === 'string' && !Number.isNaN(Date.parse(entry.ts))))
    const text = fs.readFileSync(path.join(auditDir, files[0]), 'utf8')
    assert.ok(!text.includes('example.com/') && !text.includes('"item"'), 'no collection content in the log')
  } finally {
    delete process.env.TRUST_PROXY
    delete process.env.TRUSTED_USER_HEADER
    resetLibraryCache()
  }
})

test('without TRUST_PROXY the user header is ignored and the socket address is logged', async () => {
  const { flushAuditLog } = await import('../server/auditLog')
  fs.rmSync(path.join(dataDir, 'audit'), { recursive: true, force: true })
  process.env.TRUSTED_USER_HEADER = 'X-Forwarded-User'
  try {
    const saved = await postCollection({ ...sample, info: { name: 'Spoof' } }, { 'X-Forwarded-User': 'admin', 'X-Forwarded-For': '6.6.6.6' }, 'Spoof attempt')
    assert.equal(saved.status, 201)
    assert.equal(JSON.parse(saved.body).savedBy, undefined)
    await flushAuditLog()
    const [file] = fs.readdirSync(path.join(dataDir, 'audit'))
    const entry = JSON.parse(fs.readFileSync(path.join(dataDir, 'audit', file), 'utf8').trim().split('\n')[0])
    assert.equal(entry.user, null)
    assert.equal(entry.ip, '127.0.0.1')
    await raw(`/api/collections/${JSON.parse(saved.body).id}`, { method: 'DELETE' })
    await flushAuditLog()
  } finally {
    delete process.env.TRUSTED_USER_HEADER
    resetLibraryCache()
  }
})

test('the audit log can be switched off and config reports whether the library is encrypted', async () => {
  const { flushAuditLog } = await import('../server/auditLog')
  fs.rmSync(path.join(dataDir, 'audit'), { recursive: true, force: true })
  process.env.LIBRARY_AUDIT_LOG = 'false'
  process.env.LIBRARY_ENCRYPTION_KEY = 'a'.repeat(64)
  try {
    assert.equal(JSON.parse((await raw('/api/config')).body).libraryEncrypted, true)
    const saved = await postCollection({ ...sample, info: { name: 'Quiet' } }, {}, 'Quiet')
    assert.equal(saved.status, 201)
    const id = JSON.parse(saved.body).id
    assert.equal(JSON.parse((await raw(`/api/collections/${id}`)).body).name, 'Quiet')
    assert.ok(!fs.readFileSync(path.join(dataDir, 'library', `${id}.json`), 'utf8').includes('Quiet'), 'stored encrypted')
    await raw(`/api/collections/${id}`, { method: 'DELETE' })
    await flushAuditLog()
    assert.equal(fs.existsSync(path.join(dataDir, 'audit')), false)
  } finally {
    delete process.env.LIBRARY_AUDIT_LOG
    delete process.env.LIBRARY_ENCRYPTION_KEY
    resetLibraryCache()
  }
  assert.equal(JSON.parse((await raw('/api/config')).body).libraryEncrypted, false)
})
