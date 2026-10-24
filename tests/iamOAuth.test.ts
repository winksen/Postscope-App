import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCollection } from '../src/lib/parser'
import { runAudit, runAuditDetailed, type Finding } from '../src/lib/auditor'
import { calculateScore } from '../src/lib/scorer'
import { RULES } from '../src/lib/rules'
import { IAM_RULE_DEFINITIONS } from '../src/lib/iam/rules'
import { IAM_RULE_IDS } from '../src/lib/iam/ruleIds'
import { broadScopeReason, unsafeRedirectReason } from '../src/lib/iam/oauth'
import { FAKE } from './fixtures'

interface Req {
  name: string
  method?: string
  url: string
  headers?: Array<[string, string]>
  form?: Array<[string, string]>
  auth?: unknown
  responses?: Array<{ name: string; url: string }>
}

function build(requests: Req[], extra: Record<string, unknown> = {}) {
  return {
    info: { name: 'OAuth fixture', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    variable: [{ key: 'baseUrl', value: 'https://idp.acme-corp.com' }],
    item: requests.map((request) => ({
      name: request.name,
      request: {
        method: request.method ?? 'GET',
        url: request.url,
        description: 'documented',
        header: (request.headers ?? []).map(([key, value]) => ({ key, value })),
        ...(request.form ? { body: { mode: 'urlencoded', urlencoded: request.form.map(([key, value]) => ({ key, value })) } } : {}),
        ...(request.auth ? { auth: request.auth } : {}),
      },
      response: (request.responses ?? []).map((response) => ({
        name: response.name,
        originalRequest: { method: 'GET', url: response.url },
        code: 200,
        body: '{}',
      })),
    })),
    ...extra,
  }
}

function oauth2(fields: Record<string, string>) {
  return { type: 'oauth2', oauth2: Object.entries(fields).map(([key, value]) => ({ key, value, type: 'string' })) }
}

function audit(requests: Req[], extra: Record<string, unknown> = {}) {
  const parsed = parseCollection(build(requests, extra))
  const findings = runAudit(parsed)
  const byRule = new Map(findings.map((finding) => [finding.ruleId, finding]))
  return { parsed, findings, byRule }
}

const AUTHORIZE = 'https://idp.acme-corp.com/oauth2/default/v1/authorize'
const TOKEN = 'https://idp.acme-corp.com/oauth2/default/v1/token'
const SAFE_QUERY =
  'client_id=app1&redirect_uri=https%3A%2F%2Fapp.acme-corp.com%2Fcb&scope=openid%20profile&state={{state}}&code_challenge={{challenge}}&code_challenge_method=S256'

function ids(finding: Finding | undefined, parsed: ReturnType<typeof parseCollection>): string[] {
  return (finding?.affected ?? []).map((id) => parsed.requests.find((request) => request.id === id)?.name ?? id)
}

test('identity rules are registered with the identity category, a pack and references', () => {
  assert.deepEqual([...IAM_RULE_IDS].sort(), IAM_RULE_DEFINITIONS.map((definition) => definition.id).sort())
  for (const definition of IAM_RULE_DEFINITIONS) {
    assert.equal(definition.category, 'identity')
    assert.match(definition.pack, /^iam-/)
    assert.ok(RULES[definition.id], `${definition.id} is in the registry`)
    assert.ok(definition.tags.length > 0 && (definition.references?.nist80053?.length ?? 0) > 0)
    assert.ok(
      !new RegExp(`[${String.fromCharCode(0x2014)}${String.fromCharCode(0x2013)}]`).test(
        `${definition.title}${definition.description}${definition.recommendation}`
      ),
      'no dash characters'
    )
  }
  assert.equal(RULES.OAUTH_TOKEN_ENDPOINT_HTTP.severity, 'critical')
  assert.equal(RULES.OAUTH_TOKEN_IN_URL.severity, 'critical')
  assert.equal(RULES.OAUTH_STATE_MISSING.severity, 'info')
  assert.equal(RULES.OAUTH_CLIENT_SECRET_POST.severity, 'info')
})

test('implicit and password grants are reported, the code flow with PKCE is not', () => {
  const { parsed, byRule } = audit([
    { name: 'Implicit', url: `${AUTHORIZE}?response_type=token&client_id=app1&state={{state}}` },
    { name: 'Hybrid', url: `${AUTHORIZE}?response_type=id_token%20token&client_id=app2&state={{state}}&nonce={{nonce}}` },
    {
      name: 'Password',
      method: 'POST',
      url: TOKEN,
      form: [
        ['grant_type', 'password'],
        ['client_id', 'app3'],
        ['username', '{{user}}'],
        ['password', '{{pass}}'],
      ],
    },
    { name: 'Safe', url: `${AUTHORIZE}?response_type=code&${SAFE_QUERY}` },
    {
      name: 'Machine',
      method: 'POST',
      url: TOKEN,
      form: [
        ['grant_type', 'client_credentials'],
        ['client_id', 'svc'],
        ['client_secret', '{{clientSecret}}'],
      ],
    },
  ])
  assert.deepEqual(ids(byRule.get('OAUTH_IMPLICIT_GRANT'), parsed).sort(), ['Hybrid', 'Implicit'])
  assert.deepEqual(ids(byRule.get('OAUTH_PASSWORD_GRANT'), parsed), ['Password'])
  assert.equal(byRule.get('OAUTH_IMPLICIT_GRANT')?.severity, 'warning')
  assert.equal(byRule.get('OAUTH_IMPLICIT_GRANT')?.category, 'identity')
})

test('OAuth helpers are checked at collection, folder and request level', () => {
  const { byRule } = audit([{ name: 'Call', url: '{{baseUrl}}/api/me' }], {
    auth: oauth2({
      grant_type: 'implicit',
      clientId: 'app1',
      authUrl: AUTHORIZE,
      redirect_uri: 'https://app.acme-corp.com/cb',
      scope: 'openid',
    }),
  })
  const finding = byRule.get('OAUTH_IMPLICIT_GRANT')!
  assert.equal(finding.affected.length, 0, 'a collection-level helper is collection-level evidence')
  assert.match(finding.evidence?.[0].location ?? '', /oauth2 helper grant \(collection\)/)

  const own = audit([
    {
      name: 'Own helper',
      url: '{{baseUrl}}/api/me',
      auth: oauth2({ grant_type: 'password_credentials', clientId: 'app1', accessTokenUrl: TOKEN }),
    },
  ])
  assert.deepEqual(ids(own.byRule.get('OAUTH_PASSWORD_GRANT'), own.parsed), ['Own helper'])
})

test('PKCE is expected for public clients and the plain method is reported', () => {
  const { parsed, byRule } = audit([
    {
      name: 'No PKCE',
      url: `${AUTHORIZE}?response_type=code&client_id=spa1&redirect_uri=https%3A%2F%2Fapp.acme-corp.com%2Fcb&state={{state}}`,
    },
    {
      name: 'Plain',
      url: `${AUTHORIZE}?response_type=code&client_id=spa2&state={{state}}&code_challenge={{c}}&code_challenge_method=plain`,
    },
    { name: 'No method', url: `${AUTHORIZE}?response_type=code&client_id=spa3&state={{state}}&code_challenge={{c}}` },
    { name: 'S256', url: `${AUTHORIZE}?response_type=code&client_id=spa4&${SAFE_QUERY}` },
    {
      name: 'Confidential',
      method: 'POST',
      url: TOKEN,
      form: [
        ['grant_type', 'authorization_code'],
        ['client_id', 'web1'],
        ['client_secret', '{{secret}}'],
        ['code', '{{code}}'],
      ],
    },
    {
      name: 'Verifier',
      method: 'POST',
      url: TOKEN,
      form: [
        ['grant_type', 'authorization_code'],
        ['client_id', 'spa5'],
        ['code_verifier', '{{verifier}}'],
        ['code', '{{code}}'],
      ],
    },
  ])
  assert.deepEqual(ids(byRule.get('OAUTH_PKCE_MISSING'), parsed), ['No PKCE'])
  assert.deepEqual(ids(byRule.get('OAUTH_PKCE_PLAIN'), parsed).sort(), ['No method', 'Plain'])

  const helpers = audit([{ name: 'Call', url: '{{baseUrl}}/api/me' }], {
    auth: oauth2({ grant_type: 'authorization_code', clientId: 'app', authUrl: AUTHORIZE, accessTokenUrl: TOKEN }),
  })
  assert.ok(helpers.byRule.has('OAUTH_PKCE_MISSING'))
  const withPkce = audit([{ name: 'Call', url: '{{baseUrl}}/api/me' }], {
    auth: oauth2({
      grant_type: 'authorization_code_with_pkce',
      challengeAlgorithm: 'S256',
      clientId: 'app',
      authUrl: AUTHORIZE,
      accessTokenUrl: TOKEN,
    }),
  })
  assert.ok(!withPkce.byRule.has('OAUTH_PKCE_MISSING') && !withPkce.byRule.has('OAUTH_PKCE_PLAIN'))
  const plainHelper = audit([{ name: 'Call', url: '{{baseUrl}}/api/me' }], {
    auth: oauth2({
      grant_type: 'authorization_code_with_pkce',
      challengeAlgorithm: 'plain',
      clientId: 'app',
      authUrl: AUTHORIZE,
      accessTokenUrl: TOKEN,
    }),
  })
  assert.ok(plainHelper.byRule.has('OAUTH_PKCE_PLAIN'))
})

test('redirect URIs: http to a remote host, wildcards, user info and nested URLs are unsafe', () => {
  for (const uri of [
    'http://app.acme-corp.com/cb',
    'https://*.acme-corp.com/cb',
    'https://user:pass@app.acme-corp.com/cb',
    'https://app.acme-corp.com/cb?next=https://evil.test/',
  ]) {
    assert.ok(unsafeRedirectReason(uri), uri)
  }
  for (const uri of [
    'https://app.acme-corp.com/cb',
    'http://localhost:3000/cb',
    'http://127.0.0.1:8080/cb',
    'myapp://callback',
    'https://app.acme-corp.com/cb?tab=1',
  ]) {
    assert.equal(unsafeRedirectReason(uri), null, uri)
  }
  const { parsed, byRule } = audit([
    {
      name: 'Remote http',
      url: `${AUTHORIZE}?response_type=code&client_id=a&redirect_uri=http%3A%2F%2Fapp.acme-corp.com%2Fcb&${SAFE_QUERY.replace(/client_id=app1&redirect_uri=[^&]+&/, '')}`,
    },
    {
      name: 'Local',
      url: `${AUTHORIZE}?response_type=code&client_id=b&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fcb&${SAFE_QUERY.replace(/client_id=app1&redirect_uri=[^&]+&/, '')}`,
    },
    {
      name: 'Wildcard',
      method: 'POST',
      url: TOKEN,
      form: [
        ['grant_type', 'authorization_code'],
        ['client_id', 'c'],
        ['redirect_uri', 'https://*.acme-corp.com/cb'],
        ['code_verifier', '{{v}}'],
      ],
    },
  ])
  assert.deepEqual(ids(byRule.get('OAUTH_REDIRECT_URI_UNSAFE'), parsed).sort(), ['Remote http', 'Wildcard'])
})

test('state is expected unless PKCE or an OpenID nonce protects the flow', () => {
  const { parsed, byRule } = audit([
    { name: 'Bare', url: `${AUTHORIZE}?response_type=code&client_id=a1&scope=profile` },
    { name: 'With state', url: `${AUTHORIZE}?response_type=code&client_id=a2&state={{state}}` },
    { name: 'With PKCE', url: `${AUTHORIZE}?response_type=code&client_id=a3&code_challenge={{c}}&code_challenge_method=S256` },
    { name: 'OIDC nonce', url: `${AUTHORIZE}?response_type=code&client_id=a4&scope=openid&nonce={{nonce}}&code_challenge={{c}}` },
    { name: 'OIDC only nonce', url: `${AUTHORIZE}?response_type=id_token&client_id=a5&scope=openid&nonce={{nonce}}` },
    { name: 'OIDC no nonce', url: `${AUTHORIZE}?response_type=code&client_id=a6&scope=openid` },
  ])
  assert.deepEqual(ids(byRule.get('OAUTH_STATE_MISSING'), parsed).sort(), ['Bare', 'OIDC no nonce'])
})

test('token, introspection and revocation endpoints over http are critical', () => {
  const { parsed, byRule } = audit([
    {
      name: 'Token http',
      method: 'POST',
      url: 'http://idp.acme-corp.com/oauth2/default/v1/token',
      form: [['grant_type', 'client_credentials']],
    },
    { name: 'Introspect http', method: 'POST', url: 'http://idp.acme-corp.com/oauth2/default/v1/introspect', form: [['token', '{{t}}']] },
    { name: 'Revoke http', method: 'POST', url: 'http://idp.acme-corp.com/oauth2/default/v1/revoke', form: [['token', '{{t}}']] },
    { name: 'Local', method: 'POST', url: 'http://localhost:8080/oauth2/token', form: [['grant_type', 'client_credentials']] },
    { name: 'Https', method: 'POST', url: TOKEN, form: [['grant_type', 'client_credentials']] },
    { name: 'Userinfo http', url: 'http://idp.acme-corp.com/oauth2/default/v1/userinfo' },
  ])
  const finding = byRule.get('OAUTH_TOKEN_ENDPOINT_HTTP')!
  assert.equal(finding.severity, 'critical')
  assert.deepEqual(ids(finding, parsed).sort(), ['Introspect http', 'Revoke http', 'Token http'])
})

test('tokens and authorization codes with literal values in URLs are critical, variables are fine', () => {
  const { parsed, byRule } = audit([
    { name: 'Fragment', url: `https://app.acme-corp.com/cb#access_token=${FAKE.bearer}&token_type=bearer` },
    { name: 'Code', url: 'https://app.acme-corp.com/cb?code=SplxlOBeZQQYbYS6WxSbIA&state={{state}}' },
    { name: 'Id token', url: `https://app.acme-corp.com/cb#id_token=${FAKE.jwt}` },
    { name: 'Variables', url: 'https://app.acme-corp.com/cb?code={{code}}#access_token={{token}}' },
    {
      name: 'Saved',
      url: '{{baseUrl}}/x',
      responses: [{ name: 'Callback', url: 'https://app.acme-corp.com/cb?code=SplxlOBeZQQYbYS6WxSbIA' }],
    },
    { name: 'Query token', url: `{{baseUrl}}/x?access_token=${FAKE.bearer}` },
  ])
  const finding = byRule.get('OAUTH_TOKEN_IN_URL')!
  assert.equal(finding.severity, 'critical')
  assert.deepEqual(ids(finding, parsed).sort(), ['Code', 'Fragment', 'Id token', 'Saved'])
  const text = JSON.stringify(finding)
  for (const secret of [FAKE.bearer, FAKE.jwt, 'SplxlOBeZQQYbYS6WxSbIA']) assert.ok(!text.includes(secret), 'evidence is masked')
  assert.ok(byRule.get('SECRET_IN_QUERY')?.affected.includes('Query token'), 'the existing query rule still reports query tokens')
  assert.ok(!finding.affected.includes('Query token'), 'and the new rule does not report the same location twice')
})

test('wildcard and administrative scopes are reported, ordinary scopes are not', () => {
  const client = { clientAuth: 'client_secret_basic' as const }
  for (const scope of [
    '*',
    'admin',
    'Directory.ReadWrite.All',
    'RoleManagement.ReadWrite.Directory',
    'Mail.ReadWrite.All',
    'okta.users.manage',
    'okta.groups.manage',
    'update:users',
    'read:client_keys',
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/admin.directory.user',
    'billing:admin',
  ]) {
    assert.ok(broadScopeReason(scope, client), scope)
  }
  for (const scope of [
    'openid',
    'profile',
    'email',
    'offline_access',
    'User.Read',
    'Mail.Read',
    'okta.users.read',
    'read:users',
    'api://app/access',
  ]) {
    assert.equal(broadScopeReason(scope, client), null, scope)
  }
  assert.ok(broadScopeReason('https://graph.microsoft.com/.default', { clientAuth: 'none' }), '.default on a public client')
  assert.equal(broadScopeReason('https://graph.microsoft.com/.default', client), null, '.default is normal for confidential clients')

  const { parsed, byRule } = audit([
    {
      name: 'Wide',
      method: 'POST',
      url: TOKEN,
      form: [
        ['grant_type', 'client_credentials'],
        ['client_id', 'svc'],
        ['client_secret', '{{s}}'],
        ['scope', 'okta.users.manage okta.apps.read'],
      ],
    },
    {
      name: 'Narrow',
      method: 'POST',
      url: TOKEN,
      form: [
        ['grant_type', 'client_credentials'],
        ['client_id', 'svc2'],
        ['client_secret', '{{s}}'],
        ['scope', 'okta.users.read'],
      ],
    },
  ])
  assert.deepEqual(ids(byRule.get('OAUTH_BROAD_SCOPE'), parsed), ['Wide'])
  assert.match(byRule.get('OAUTH_BROAD_SCOPE')?.evidence?.[0].preview ?? '', /okta\.users\.manage/)
})

test('a client secret in the body is reported as information, Basic and private_key_jwt are not', () => {
  const { parsed, byRule } = audit([
    {
      name: 'Post',
      method: 'POST',
      url: TOKEN,
      form: [
        ['grant_type', 'client_credentials'],
        ['client_id', 'svc1'],
        ['client_secret', '{{secret}}'],
      ],
    },
    {
      name: 'Basic',
      method: 'POST',
      url: TOKEN,
      headers: [['Authorization', 'Basic {{basic}}']],
      form: [['grant_type', 'client_credentials']],
    },
    {
      name: 'Assertion',
      method: 'POST',
      url: TOKEN,
      form: [
        ['grant_type', 'client_credentials'],
        ['client_assertion_type', 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer'],
        ['client_assertion', '{{jwt}}'],
      ],
    },
  ])
  assert.deepEqual(ids(byRule.get('OAUTH_CLIENT_SECRET_POST'), parsed), ['Post'])
  assert.equal(byRule.get('OAUTH_CLIENT_SECRET_POST')?.severity, 'info')
  const helper = audit([{ name: 'Call', url: '{{baseUrl}}/x' }], {
    auth: oauth2({
      grant_type: 'client_credentials',
      clientId: 'a',
      clientSecret: '{{s}}',
      accessTokenUrl: TOKEN,
      client_authentication: 'body',
    }),
  })
  assert.ok(helper.byRule.has('OAUTH_CLIENT_SECRET_POST'))
})

test('identity rules follow the pack settings, overrides and the identity score', () => {
  const requests: Req[] = [{ name: 'Implicit', url: `${AUTHORIZE}?response_type=token&client_id=app1&state={{state}}` }]
  const parsed = parseCollection(build(requests))
  const active = runAuditDetailed(parsed)
  assert.ok(active.findings.some((finding) => finding.ruleId === 'OAUTH_IMPLICIT_GRANT'))
  const score = calculateScore(parsed, active.findings)
  assert.ok((score.categories.identity ?? 100) < 100)
  assert.ok(score.penalties.some((penalty) => penalty.category === 'identity'))

  const off = runAuditDetailed(parseCollection(build(requests)), { rulePacks: { disabled: ['iam-am'] } })
  assert.ok(!off.findings.some((finding) => finding.category === 'identity'))
  const disabled = runAuditDetailed(parseCollection(build(requests)), { disabledRules: ['OAUTH_IMPLICIT_GRANT'] })
  assert.ok(!disabled.findings.some((finding) => finding.ruleId === 'OAUTH_IMPLICIT_GRANT'))
  const critical = runAuditDetailed(parseCollection(build(requests)), { severityOverrides: { OAUTH_IMPLICIT_GRANT: 'critical' } })
  assert.equal(critical.findings.find((finding) => finding.ruleId === 'OAUTH_IMPLICIT_GRANT')?.severity, 'critical')

  const generic = audit([{ name: 'List', url: 'https://api.acme-corp.com/v1/items?filter=token' }])
  assert.ok(!generic.findings.some((finding) => finding.category === 'identity'), 'ordinary APIs are untouched')
})

test('identity findings never contain client secrets or token values', () => {
  const { findings } = audit([
    {
      name: 'Token',
      method: 'POST',
      url: 'http://idp.acme-corp.com/oauth2/default/v1/token',
      form: [
        ['grant_type', 'password'],
        ['client_id', 'app1'],
        ['client_secret', FAKE.clientSecret],
        ['password', FAKE.password],
      ],
    },
    { name: 'Callback', url: `https://app.acme-corp.com/cb#access_token=${FAKE.bearer}` },
  ])
  const text = JSON.stringify(findings.filter((finding) => finding.category === 'identity'))
  for (const secret of [FAKE.clientSecret, FAKE.password, FAKE.bearer]) assert.ok(!text.includes(secret))
})
