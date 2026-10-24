import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCollection } from '../src/lib/parser'
import { runAudit, runAuditDetailed, type Finding } from '../src/lib/auditor'
import { collectJwts, collectRequestJwts, findJwts, inspectJwt, isLongLived, MAX_JWT_LENGTH } from '../src/lib/iam/jwt'
import { detectIdentitySignals } from '../src/lib/iam/signals'

const NOW = new Date('2026-06-01T00:00:00Z')
const nowSeconds = Math.floor(NOW.getTime() / 1000)

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

/** Builds an unsigned test token at runtime so no token-shaped literal is committed. */
function makeJwt(
  payload: Record<string, unknown>,
  header: Record<string, unknown> = { alg: 'RS256', typ: 'JWT', kid: 'key-0001-abcdef' }
): string {
  return [b64url(header), b64url(payload), 'c2lnbmF0dXJlLWZvci10ZXN0cw'].join('.')
}

const ISSUER = 'https://login.acme-corp.com/oauth2/default'

function accessToken(extra: Record<string, unknown> = {}, lifetime = 3600): string {
  return makeJwt({
    iss: ISSUER,
    sub: 'user-12345',
    aud: 'api://orders',
    iat: nowSeconds - 60,
    exp: nowSeconds - 60 + lifetime,
    scp: 'orders.read',
    ...extra,
  })
}

interface Req {
  name: string
  url?: string
  headers?: Array<[string, string]>
  responses?: Array<{ name: string; body?: string; requestHeaders?: Array<[string, string]> }>
  auth?: unknown
}

function build(requests: Req[], extra: Record<string, unknown> = {}) {
  return {
    info: { name: 'JWT fixture', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    item: requests.map((request) => ({
      name: request.name,
      request: {
        method: 'GET',
        url: request.url ?? 'https://api.acme-corp.com/orders',
        description: 'documented',
        header: (request.headers ?? []).map(([key, value]) => ({ key, value })),
        ...(request.auth ? { auth: request.auth } : {}),
      },
      response: (request.responses ?? []).map((response) => ({
        name: response.name,
        originalRequest: {
          method: 'GET',
          url: 'https://api.acme-corp.com/orders',
          header: (response.requestHeaders ?? []).map(([key, value]) => ({ key, value })),
        },
        code: 200,
        header: [],
        body: response.body ?? '{}',
      })),
    })),
    ...extra,
  }
}

function audit(requests: Req[], extra: Record<string, unknown> = {}) {
  const parsed = parseCollection(build(requests, extra))
  const findings = runAudit(parsed, { now: NOW })
  const byRule = new Map<string, Finding>(findings.map((finding) => [finding.ruleId, finding]))
  const names = (ruleId: string) =>
    (byRule.get(ruleId)?.affected ?? []).map((id) => parsed.requests.find((request) => request.id === id)?.name ?? id)
  return { parsed, findings, byRule, names }
}

const bearer = (token: string): Array<[string, string]> => [['Authorization', `Bearer ${token}`]]

test('a JWT is decoded without verifying it, and the claims are masked', () => {
  const token = accessToken({
    email: 'jane.doe@acme-corp.com',
    name: 'Jane Doe',
    phone_number: '+33612345678',
    roles: ['a', 'b', 'c'],
    tid: 'tenant-abcdef',
  })
  const inspection = inspectJwt(token, NOW)!
  assert.equal(inspection.alg, 'RS256')
  assert.equal(inspection.issuer, 'login.acme-corp.com')
  assert.equal(inspection.lifetimeSeconds, 3600)
  assert.equal(inspection.expired, false)
  assert.deepEqual(inspection.personalClaims.sort(), ['email', 'name', 'phone_number'])
  assert.deepEqual(inspection.privilegeClaims, ['roles'])
  const preview = (name: string) => inspection.claims.find((claim) => claim.name === name)?.preview
  assert.equal(preview('email'), 'j•••@•••')
  assert.equal(preview('roles'), '[3 values]')
  assert.equal(preview('name'), 'J•••')
  assert.equal(preview('phone_number'), '••••78')
  assert.equal(preview('scp'), 'orders.read')
  assert.equal(preview('tid'), 'tena•••')
  assert.match(preview('exp') ?? '', /^2026-/)
  assert.equal(inspection.kid, 'key-•••')
  const text = JSON.stringify(inspection)
  for (const secret of ['jane.doe', 'Jane', '12345678', 'c2lnbmF0dXJl', token])
    assert.ok(!text.includes(secret), `inspection leaks ${secret}`)
})

test('garbage, oversized and non-JWT values are ignored safely', () => {
  assert.equal(inspectJwt('not.a.jwt'), null)
  assert.equal(inspectJwt('eyJhbGciOiJub25lIn0.e30'), null)
  assert.equal(inspectJwt(`eyJ${'a'.repeat(MAX_JWT_LENGTH)}.bbbbbb.cccccc`), null)
  assert.equal(inspectJwt(['eyJ!!!!', 'eyJ????', 'x'].join('.')), null)
  assert.equal(inspectJwt([b64url({ typ: 'JWT' }), b64url({ sub: 'x' }), 'sig'].join('.')), null, 'a header without alg is not a JWT')
  assert.deepEqual(findJwts(undefined), [])
  assert.deepEqual(findJwts('no tokens here'), [])
  const many = Array.from({ length: 20 }, (_, index) => accessToken({ sub: `u${index}` })).join(' ')
  assert.equal(findJwts(many).length, 5, 'one value yields a bounded number of tokens')
})

test('alg none is critical and a signed token is not', () => {
  const none = makeJwt({ sub: 'admin', exp: nowSeconds + 3600, iat: nowSeconds }, { alg: 'none', typ: 'JWT' })
  const { parsed, byRule, names } = audit([
    { name: 'Unsigned', headers: bearer(none) },
    { name: 'Signed', headers: bearer(accessToken()) },
  ])
  assert.equal(byRule.get('JWT_ALG_NONE')?.severity, 'critical')
  assert.deepEqual(names('JWT_ALG_NONE'), ['Unsigned'])
  assert.equal(byRule.get('JWT_ALG_NONE')?.category, 'identity')
  assert.ok(!JSON.stringify(byRule.get('JWT_ALG_NONE')).includes(none))
  assert.ok(parsed.identity, 'a stored JWT switches the identity packs on')
})

test('access tokens that never expire or live over a day are reported', () => {
  const noExp = makeJwt({ iss: ISSUER, sub: 'svc', iat: nowSeconds })
  const { byRule, names } = audit([
    { name: 'No exp', headers: bearer(noExp) },
    { name: 'Thirty days', headers: bearer(accessToken({}, 30 * 24 * 3600)) },
    { name: 'One hour', headers: bearer(accessToken({}, 3600)) },
    { name: 'Just under a day', headers: bearer(accessToken({}, 24 * 3600)) },
    {
      name: 'ID token',
      headers: [['X-Id-Token', makeJwt({ iss: ISSUER, nonce: 'n', iat: nowSeconds, exp: nowSeconds + 90 * 24 * 3600 })]],
    },
    {
      name: 'Refresh token',
      headers: [['X-Refresh', makeJwt({ iss: ISSUER, typ: 'Refresh', iat: nowSeconds, exp: nowSeconds + 90 * 24 * 3600 })]],
    },
  ])
  assert.deepEqual(names('JWT_LONG_LIVED').sort(), ['No exp', 'Thirty days'])
  assert.match(
    byRule
      .get('JWT_LONG_LIVED')
      ?.evidence?.map((entry) => entry.preview)
      .join(' ') ?? '',
    /no exp claim/
  )
  assert.match(
    byRule
      .get('JWT_LONG_LIVED')
      ?.evidence?.map((entry) => entry.preview)
      .join(' ') ?? '',
    /30 days/
  )
  assert.equal(isLongLived(inspectJwt(accessToken({}, 24 * 3600), NOW)!), false)
})

test('personal data and privilege claims in a stored token are reported with masked values', () => {
  const { byRule, names } = audit([
    { name: 'Personal', headers: bearer(accessToken({ email: 'jane.doe@acme-corp.com', given_name: 'Jane' })) },
    { name: 'Privileges', headers: bearer(accessToken({ roles: ['Global Administrator'], groups: ['g1', 'g2'] })) },
    { name: 'Plain', headers: bearer(accessToken({ scp: 'orders.read orders.write' })) },
  ])
  assert.deepEqual(names('JWT_SENSITIVE_CLAIMS').sort(), ['Personal', 'Privileges'])
  const evidence = JSON.stringify(byRule.get('JWT_SENSITIVE_CLAIMS')?.evidence)
  assert.match(evidence, /email j•••@•••/)
  assert.match(evidence, /roles \[1 value\]/)
  for (const secret of ['jane.doe', 'Global Administrator', 'Jane']) assert.ok(!evidence.includes(secret))
})

test('an ID token sent as a bearer token to an API is reported, the userinfo endpoint is fine', () => {
  const idToken = makeJwt({ iss: ISSUER, sub: 'u1', aud: 'client-1', nonce: 'abc', at_hash: 'xyz', iat: nowSeconds, exp: nowSeconds + 300 })
  const { names } = audit([
    { name: 'API call', url: 'https://api.acme-corp.com/orders', headers: bearer(idToken) },
    { name: 'Userinfo', url: 'https://login.acme-corp.com/oauth2/default/v1/userinfo', headers: bearer(idToken) },
    { name: 'Access token', url: 'https://api.acme-corp.com/orders', headers: bearer(accessToken()) },
    { name: 'Not bearer', url: 'https://api.acme-corp.com/orders', headers: [['X-Id-Token', idToken]] },
  ])
  assert.deepEqual(names('ID_TOKEN_AS_BEARER'), ['API call'])
})

test('expired tokens are reported as information with the clock from the options', () => {
  const expired = accessToken({}, 3600)
  const parsed = parseCollection(build([{ name: 'Old', headers: bearer(expired) }]))
  const later = runAudit(parsed, { now: new Date(NOW.getTime() + 7200_000) })
  assert.equal(later.find((finding) => finding.ruleId === 'JWT_EXPIRED_STORED')?.severity, 'info')
  assert.match(later.find((finding) => finding.ruleId === 'JWT_EXPIRED_STORED')?.evidence?.[0].preview ?? '', /^expired 2026-06-01$/)
  const sooner = runAudit(parseCollection(build([{ name: 'Old', headers: bearer(expired) }])), { now: NOW })
  assert.ok(!sooner.some((finding) => finding.ruleId === 'JWT_EXPIRED_STORED'))
})

test('tokens are found in auth helpers, variables, saved examples and disabled headers', () => {
  const token = accessToken({ email: 'a.b@acme-corp.com' })
  const parsed = parseCollection(
    build(
      [
        { name: 'Own helper', auth: { type: 'bearer', bearer: [{ key: 'token', value: token, type: 'string' }] } },
        {
          name: 'Saved',
          responses: [{ name: 'Login', body: JSON.stringify({ access_token: token }), requestHeaders: bearer(token) }],
        },
      ],
      { variable: [{ key: 'saved', value: token }], auth: { type: 'bearer', bearer: [{ key: 'token', value: token, type: 'string' }] } }
    )
  )
  const locations = collectJwts(parsed).map((occurrence) => occurrence.location)
  assert.ok(locations.includes('auth helper bearer token'))
  assert.ok(locations.some((location) => location.startsWith('saved response "Login" body')))
  assert.ok(locations.some((location) => location.includes('original request header Authorization')))
  assert.ok(locations.includes('collection variable saved'))
  assert.ok(
    locations.some((location) => location.includes('(collection)')),
    'a collection helper is scanned once, not for every request'
  )
  assert.equal(collectRequestJwts(parsed.requests[0]).filter((occurrence) => occurrence.bearer).length, 1)
})

test('the identity signal exists for stored tokens and not for plain collections', () => {
  assert.equal(detectIdentitySignals(parseCollection(build([{ name: 'A', headers: bearer(accessToken()) }]))), true)
  assert.equal(detectIdentitySignals(parseCollection(build([{ name: 'A' }]))), false)
})

test('JWT rules follow the pack, rule and severity settings and never print a token', () => {
  const token = accessToken({ email: 'jane.doe@acme-corp.com' }, 40 * 24 * 3600)
  const raw = build([{ name: 'Call', headers: bearer(token) }])
  const all = runAuditDetailed(parseCollection(raw), { now: NOW })
  const jwtRules = ['JWT_LONG_LIVED', 'JWT_SENSITIVE_CLAIMS']
  for (const rule of jwtRules)
    assert.ok(
      all.findings.some((finding) => finding.ruleId === rule),
      rule
    )
  const text = JSON.stringify(all.findings.filter((finding) => finding.category === 'identity'))
  assert.ok(!text.includes(token) && !text.includes('jane.doe') && !text.includes('c2lnbmF0dXJl'))
  const off = runAuditDetailed(parseCollection(raw), { now: NOW, rulePacks: { disabled: ['iam-am'] } })
  assert.ok(!off.findings.some((finding) => jwtRules.includes(finding.ruleId)))
  const tuned = runAuditDetailed(parseCollection(raw), {
    now: NOW,
    disabledRules: ['JWT_LONG_LIVED'],
    severityOverrides: { JWT_SENSITIVE_CLAIMS: 'critical' },
  })
  assert.ok(!tuned.findings.some((finding) => finding.ruleId === 'JWT_LONG_LIVED'))
  assert.equal(tuned.findings.find((finding) => finding.ruleId === 'JWT_SENSITIVE_CLAIMS')?.severity, 'critical')
})
