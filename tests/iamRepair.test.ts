import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCollection } from '../src/lib/parser'
import { runAudit, type Finding } from '../src/lib/auditor'
import { applyRepairPlan, createRepairPlan, type RepairFix } from '../src/lib/repairEngine'
import { FAKE } from './fixtures'

const NOW = new Date('2026-06-01T00:00:00Z')

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

const JWT = [
  b64url({ alg: 'RS256', typ: 'JWT' }),
  b64url({ iss: 'https://login.acme-corp.com', sub: 'u1', email: 'jane.doe@acme-corp.com', iat: 1, exp: 4_000_000_000 }),
  'c2lnbmF0dXJl',
].join('.')
const SAML = Buffer.from(
  '<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"><saml:Issuer xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">https://idp.acme-corp.com/saml</saml:Issuer><saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_a"><saml:Subject><saml:NameID>jane.doe@acme-corp.com</saml:NameID></saml:Subject></saml:Assertion></samlp:Response>'
).toString('base64')
const PASSWORD = 'Fx-vault-Value-9'

type Raw = Record<string, unknown>

function oauth2(fields: Record<string, string>) {
  return { type: 'oauth2', oauth2: Object.entries(fields).map(([key, value]) => ({ key, value, type: 'string' })) }
}

function plan(raw: Raw) {
  const parsed = parseCollection(raw)
  const findings = runAudit(parsed, { now: NOW })
  return { parsed, findings, plan: createRepairPlan(raw, parsed, findings) }
}

function fixFor(planned: ReturnType<typeof plan>, ruleId: string): RepairFix {
  const finding = planned.findings.find((entry) => entry.ruleId === ruleId)
  assert.ok(finding, `${ruleId} is reported`)
  const fix = planned.plan.fixes.find((entry) => entry.sourceFindingId === finding.id)
  assert.ok(fix, `${ruleId} has a fix`)
  return fix
}

function after(raw: Raw, ids: string[], planned: ReturnType<typeof plan>) {
  const result = applyRepairPlan(raw, ids, planned.plan)
  const parsed = parseCollection(result.fixedJson)
  return { ...result, findings: runAudit(parsed, { now: NOW }) as Finding[], text: JSON.stringify(result.fixedJson) }
}

const base = (item: unknown[], extra: Raw = {}): Raw => ({
  info: { name: 'Repair fixture', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  item,
  ...extra,
})

const request = (name: string, url: unknown, extra: Raw = {}) => ({
  name,
  request: { method: 'GET', url, description: 'documented', header: [], ...extra },
})

test('PKCE is switched on in OAuth 2.0 helpers, and plain becomes S256', () => {
  const raw = base([request('Call', 'https://api.acme-corp.com/me')], {
    auth: oauth2({
      grant_type: 'authorization_code',
      clientId: 'app',
      authUrl: 'https://idp.acme-corp.com/oauth2/v1/authorize',
      accessTokenUrl: 'https://idp.acme-corp.com/oauth2/v1/token',
    }),
  })
  const planned = plan(raw)
  const fix = fixFor(planned, 'OAUTH_PKCE_MISSING')
  assert.equal(fix.kind, 'oauthPkce')
  assert.equal(fix.status, 'auto')
  assert.equal(fix.risk, 'medium')
  assert.equal(fix.selectedByDefault, false)
  const result = after(raw, [fix.id], planned)
  const helper = (result.fixedJson as { auth: { oauth2: Array<{ key: string; value: string }> } }).auth.oauth2
  assert.equal(helper.find((entry) => entry.key === 'grant_type')?.value, 'authorization_code_with_pkce')
  assert.equal(helper.find((entry) => entry.key === 'challengeAlgorithm')?.value, 'S256')
  assert.ok(!result.findings.some((finding) => finding.ruleId === 'OAUTH_PKCE_MISSING'))

  const plain = base([request('Call', 'https://api.acme-corp.com/me')], {
    auth: oauth2({
      grant_type: 'authorization_code_with_pkce',
      challengeAlgorithm: 'plain',
      clientId: 'app',
      authUrl: 'https://idp.acme-corp.com/oauth2/v1/authorize',
      accessTokenUrl: 'https://idp.acme-corp.com/oauth2/v1/token',
    }),
  })
  const plainPlan = plan(plain)
  const plainResult = after(plain, [fixFor(plainPlan, 'OAUTH_PKCE_PLAIN').id], plainPlan)
  assert.ok(!plainResult.findings.some((finding) => finding.ruleId === 'OAUTH_PKCE_PLAIN'))
  assert.ok(plainResult.text.includes('"S256"'))
})

test('flows written as requests get guidance instead of a risky automatic change', () => {
  const planned = plan(
    base([request('Authorize', 'https://idp.acme-corp.com/oauth2/v1/authorize?response_type=code&client_id=spa&state={{state}}')])
  )
  const fix = fixFor(planned, 'OAUTH_PKCE_MISSING')
  assert.equal(fix.status, 'manual')
  assert.match(fix.manualReason ?? '', /code_challenge/)
  assert.equal(fix.selectedByDefault, false)
})

test('migration guidance is offered for implicit and password grants and broad scopes', () => {
  const planned = plan(
    base([
      request('Implicit', 'https://idp.acme-corp.com/oauth2/v1/authorize?response_type=token&client_id=a&state={{s}}'),
      request(
        'Password',
        { raw: 'https://idp.acme-corp.com/oauth2/v1/token' },
        {
          method: 'POST',
          body: {
            mode: 'urlencoded',
            urlencoded: [
              { key: 'grant_type', value: 'password' },
              { key: 'client_id', value: 'a' },
            ],
          },
        }
      ),
      request('Wide', 'https://idp.acme-corp.com/oauth2/v1/token', {
        method: 'POST',
        body: {
          mode: 'urlencoded',
          urlencoded: [
            { key: 'grant_type', value: 'client_credentials' },
            { key: 'client_id', value: 'b' },
            { key: 'scope', value: 'okta.users.manage' },
          ],
        },
      }),
    ])
  )
  assert.match(fixFor(planned, 'OAUTH_IMPLICIT_GRANT').manualReason ?? '', /response_type=code/)
  assert.match(fixFor(planned, 'OAUTH_PASSWORD_GRANT').manualReason ?? '', /client credentials/)
  assert.match(fixFor(planned, 'OAUTH_BROAD_SCOPE').manualReason ?? '', /narrowest scopes/)
  for (const rule of ['OAUTH_IMPLICIT_GRANT', 'OAUTH_PASSWORD_GRANT', 'OAUTH_BROAD_SCOPE'])
    assert.equal(fixFor(planned, rule).status, 'manual')
})

test('a state value is added to authorize requests, once', () => {
  const raw = base([
    request('String url', 'https://idp.acme-corp.com/oauth2/v1/authorize?response_type=code&client_id=a'),
    request('Object url', {
      raw: 'https://idp.acme-corp.com/oauth2/v1/authorize?response_type=code&client_id=b#frag',
      query: [
        { key: 'response_type', value: 'code' },
        { key: 'client_id', value: 'b' },
      ],
    }),
  ])
  const planned = plan(raw)
  const fix = fixFor(planned, 'OAUTH_STATE_MISSING')
  assert.equal(fix.risk, 'low')
  assert.equal(fix.selectedByDefault, false)
  const result = after(raw, [fix.id], planned)
  const items = (result.fixedJson as { item: Array<{ request: { url: string | { raw: string; query: Array<{ key: string }> } } }> }).item
  assert.equal(items[0].request.url, 'https://idp.acme-corp.com/oauth2/v1/authorize?response_type=code&client_id=a&state={{$randomUUID}}')
  const objectUrl = items[1].request.url as { raw: string; query: Array<{ key: string }> }
  assert.equal(objectUrl.raw, 'https://idp.acme-corp.com/oauth2/v1/authorize?response_type=code&client_id=b&state={{$randomUUID}}#frag')
  assert.ok(objectUrl.query.some((entry) => entry.key === 'state'))
  assert.ok(!result.findings.some((finding) => finding.ruleId === 'OAUTH_STATE_MISSING'))
  const again = applyRepairPlan(result.fixedJson, [fix.id], planned.plan)
  assert.equal(JSON.stringify(again.fixedJson), result.text, 'applying again changes nothing')
})

test('repeated tenant identifiers move into variables that keep the current value', () => {
  const raw = base([
    request('Users', 'https://acme.okta.com/api/v1/users'),
    request('Groups', {
      raw: 'https://acme.okta.com/api/v1/groups',
      protocol: 'https',
      host: ['acme', 'okta', 'com'],
      path: ['api', 'v1', 'groups'],
    }),
    request('Apps', 'https://acme.okta.com/api/v1/apps?limit=10'),
  ])
  const planned = plan(raw)
  const fix = fixFor(planned, 'TENANT_IDENTIFIER_HARDCODED')
  assert.equal(fix.kind, 'tenantVariables')
  assert.equal(fix.risk, 'medium')
  assert.deepEqual(fix.variablesToEnsure, [{ key: 'oktaDomain', value: 'acme.okta.com' }])
  const result = after(raw, [fix.id], planned)
  const items = result.fixedJson as {
    item: Array<{ request: { url: string | { raw: string; host: string[] } } }>
    variable: Array<{ key: string; value: string }>
  }
  assert.equal(items.item[0].request.url, 'https://{{oktaDomain}}/api/v1/users')
  assert.equal((items.item[1].request.url as { raw: string }).raw, 'https://{{oktaDomain}}/api/v1/groups')
  assert.deepEqual((items.item[1].request.url as { host: string[] }).host, ['{{oktaDomain}}'])
  assert.equal(items.item[2].request.url, 'https://{{oktaDomain}}/api/v1/apps?limit=10')
  assert.ok(items.variable.some((variable) => variable.key === 'oktaDomain' && variable.value === 'acme.okta.com'))
  assert.ok(!result.findings.some((finding) => finding.ruleId === 'TENANT_IDENTIFIER_HARDCODED'))

  const entra = base(
    ['a', 'b', 'c'].map((name) =>
      request(name, `https://login.microsoftonline.com/11111111-2222-4333-8444-555555555555/oauth2/v2.0/token?i=${name}`, {
        method: 'POST',
      })
    )
  )
  const entraPlan = plan(entra)
  const entraResult = after(entra, [fixFor(entraPlan, 'TENANT_IDENTIFIER_HARDCODED').id], entraPlan)
  assert.ok(entraResult.text.includes('login.microsoftonline.com/{{tenantId}}/oauth2/v2.0/token'))
})

test('captured tokens, assertions and retrieved secrets are removed from saved examples by default', () => {
  const example = (name: string, body: string, extra: Raw = {}) => ({
    name,
    originalRequest: { method: 'GET', url: 'https://api.acme-corp.com/x', header: [{ key: 'Authorization', value: `Bearer ${JWT}` }] },
    code: 200,
    header: [],
    body,
    ...extra,
  })
  const raw = base([
    {
      name: 'Token',
      request: { method: 'POST', url: 'https://idp.acme-corp.com/oauth2/v1/token', description: 'd', header: [] },
      response: [example('OK', JSON.stringify({ access_token: JWT, token_type: 'Bearer', expires_in: 3600 }))],
    },
    {
      name: 'Assertion',
      request: { method: 'POST', url: 'https://sp.acme-corp.com/saml2/acs', description: 'd', header: [] },
      response: [
        example('Posted', `<form><input type="hidden" name="SAMLResponse" value="${SAML}"/><input name="RelayState" value="keep"/></form>`),
      ],
    },
    {
      name: 'Retrieve',
      request: {
        method: 'POST',
        url: 'https://pvwa.acme-corp.com/PasswordVault/API/Accounts/1/Password/Retrieve',
        description: 'd',
        header: [],
        body: { mode: 'raw', raw: '{"reason":"INC1"}' },
      },
      response: [example('OK', JSON.stringify(PASSWORD))],
    },
    {
      name: 'Vault',
      request: { method: 'GET', url: 'https://vault.acme-corp.com:8200/v1/secret/data/app', description: 'd', header: [] },
      response: [example('OK', JSON.stringify({ data: { data: { password: PASSWORD, owner: 'team-a' }, metadata: { version: 3 } } }))],
    },
  ])
  const planned = plan(raw)
  const captured = planned.plan.fixes.filter((fix) => fix.kind === 'scrubCaptured')
  assert.ok(captured.length >= 3)
  for (const fix of captured) {
    assert.equal(fix.risk, 'high')
    assert.equal(fix.selectedByDefault, true, 'live credentials are removed by default')
    assert.ok(planned.plan.defaultSelectedFixIds.includes(fix.id))
  }
  const result = after(raw, planned.plan.defaultSelectedFixIds, planned)
  for (const secret of [SAML, PASSWORD, JWT]) assert.ok(!result.text.includes(secret), `still contains ${secret.slice(0, 12)}`)
  assert.ok(
    result.text.includes('RelayState') && result.text.includes('team-a') && result.text.includes('token_type'),
    'the rest of the example stays'
  )
  for (const rule of ['SAML_ASSERTION_CAPTURED', 'PAM_RETRIEVED_SECRET_CAPTURED'])
    assert.ok(!result.findings.some((finding) => finding.ruleId === rule), `${rule} is gone`)
  assert.ok(result.applied.some((entry) => /captured credential/.test(entry.summary)))
  assert.ok(!JSON.stringify(result.applied).includes(FAKE.githubToken))
})

test('a token that is not in a saved example is left to manual review', () => {
  const raw = base([request('Call', 'https://api.acme-corp.com/me', { header: [{ key: 'X-Id-Token', value: JWT }] })])
  const planned = plan(raw)
  const fix = fixFor(planned, 'JWT_SENSITIVE_CLAIMS')
  assert.equal(fix.status, 'manual')
})

test('only the selected identity repairs are applied', () => {
  const raw = base([request('Authorize', 'https://idp.acme-corp.com/oauth2/v1/authorize?response_type=code&client_id=a')], {
    auth: oauth2({ grant_type: 'authorization_code', clientId: 'app', accessTokenUrl: 'https://idp.acme-corp.com/oauth2/v1/token' }),
  })
  const planned = plan(raw)
  assert.deepEqual(
    planned.plan.defaultSelectedFixIds.filter((id) => planned.plan.fixes.find((fix) => fix.id === id)?.kind === 'oauthState'),
    []
  )
  const result = after(raw, [fixFor(planned, 'OAUTH_STATE_MISSING').id], planned)
  assert.ok(
    result.findings.some((finding) => finding.ruleId === 'OAUTH_PKCE_MISSING'),
    'the PKCE repair was not selected'
  )
  assert.ok(!result.findings.some((finding) => finding.ruleId === 'OAUTH_STATE_MISSING'))
})
