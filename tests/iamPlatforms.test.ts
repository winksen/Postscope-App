import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCollection } from '../src/lib/parser'
import { runAudit, runAuditDetailed, type Finding } from '../src/lib/auditor'
import { PLATFORM_PROFILES, profileOf } from '../src/lib/iam/platforms'
import { classifyEndpoint, endpointContext } from '../src/lib/iam/endpoints'
import { requestParams, splitUrl } from '../src/lib/iam/url'

interface Req {
  name: string
  method?: string
  url: string
}

function build(requests: Req[], variable: Array<{ key: string; value: string }> = []) {
  return {
    info: { name: 'Platform fixture', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    variable,
    item: requests.map((request) => ({
      name: request.name,
      request: { method: request.method ?? 'GET', url: request.url, description: 'documented', header: [] },
    })),
  }
}

function audit(requests: Req[], variable: Array<{ key: string; value: string }> = []) {
  const parsed = parseCollection(build(requests, variable))
  const findings = runAudit(parsed)
  const byRule = new Map<string, Finding>(findings.map((finding) => [finding.ruleId, finding]))
  const names = (ruleId: string) =>
    (byRule.get(ruleId)?.affected ?? []).map((id) => parsed.requests.find((request) => request.id === id)?.name ?? id)
  return { parsed, findings, byRule, names }
}

const GUID_A = '11111111-2222-4333-8444-555555555555'
const GUID_B = '66666666-7777-4888-8999-aaaaaaaaaaaa'

test('every access management and CIAM platform has a profile with variables, tokens and advice', () => {
  assert.deepEqual(
    PLATFORM_PROFILES.map((profile) => profile.id),
    ['okta', 'entra', 'auth0', 'ping', 'forgerock', 'keycloak']
  )
  for (const profile of PLATFORM_PROFILES) {
    assert.equal(profile.fingerprint.id, profile.id)
    assert.ok(profile.expectedVariables.length > 0 && profile.tokenFormats.length > 0 && profile.recommendation.length > 20, profile.id)
    assert.ok(profile.recommendation.includes('{{'), `${profile.id} names the variable to use`)
  }
  assert.ok(profileOf('okta')?.expectedVariables.includes('oktaDomain'))
  assert.ok(profileOf('entra')?.expectedVariables.includes('tenantId'))
  assert.ok(profileOf('auth0')?.expectedVariables.includes('auth0Domain'))
  assert.ok(profileOf('keycloak')?.expectedVariables.includes('realm'))
  assert.ok(profileOf('ping')?.expectedVariables.includes('envId'))
})

test('a tenant identifier repeated in three or more requests should be a variable', () => {
  const okta = audit([
    { name: 'A', url: 'https://acme.okta.com/api/v1/users' },
    { name: 'B', url: 'https://acme.okta.com/api/v1/groups' },
    { name: 'C', url: 'https://acme.okta.com/api/v1/apps' },
    { name: 'Other', url: 'https://other.okta.com/api/v1/users' },
  ])
  const finding = okta.byRule.get('TENANT_IDENTIFIER_HARDCODED')!
  assert.equal(finding.severity, 'info')
  assert.equal(finding.category, 'variables')
  assert.deepEqual(okta.names('TENANT_IDENTIFIER_HARDCODED').sort(), ['A', 'B', 'C'])
  assert.match(finding.evidence?.[0].preview ?? '', /^acme••••/)
  assert.match(finding.evidence?.[0].preview ?? '', /\{\{oktaDomain\}\}/)

  const entra = audit(
    [GUID_A, GUID_A, GUID_A].map((guid, index) => ({
      name: `T${index}`,
      method: 'POST',
      url: `https://login.microsoftonline.com/${guid}/oauth2/v2.0/token`,
    }))
  )
  assert.equal(entra.names('TENANT_IDENTIFIER_HARDCODED').length, 3)
  assert.ok(!JSON.stringify(entra.byRule.get('TENANT_IDENTIFIER_HARDCODED')).includes(GUID_A), 'tenant ids are masked')

  const keycloak = audit(
    [1, 2, 3].map((index) => ({
      name: `K${index}`,
      url: `https://sso.acme-corp.com/realms/acme/protocol/openid-connect/userinfo?i=${index}`,
    }))
  )
  assert.equal(keycloak.names('TENANT_IDENTIFIER_HARDCODED').length, 3)

  const ping = audit([1, 2, 3].map((index) => ({ name: `P${index}`, url: `https://auth.pingone.com/${GUID_A}/as/authorize?i=${index}` })))
  assert.equal(ping.names('TENANT_IDENTIFIER_HARDCODED').length, 3)
})

test('identifiers behind variables, common authorities and few requests are not reported', () => {
  const viaVariable = audit(
    [1, 2, 3, 4].map((index) => ({ name: `V${index}`, url: `{{oktaBase}}/api/v1/users?i=${index}` })),
    [{ key: 'oktaBase', value: 'https://acme.okta.com' }]
  )
  assert.ok(!viaVariable.byRule.has('TENANT_IDENTIFIER_HARDCODED'))
  const common = audit(
    [1, 2, 3].map((index) => ({
      name: `C${index}`,
      method: 'POST',
      url: `https://login.microsoftonline.com/common/oauth2/v2.0/token?i=${index}`,
    }))
  )
  assert.ok(!common.byRule.has('TENANT_IDENTIFIER_HARDCODED'))
  const two = audit([
    { name: 'A', url: 'https://acme.okta.com/api/v1/users' },
    { name: 'B', url: 'https://acme.okta.com/api/v1/groups' },
  ])
  assert.ok(!two.byRule.has('TENANT_IDENTIFIER_HARDCODED'))
})

test('preview and production tenants, or several tenant ids, in one collection are a warning', () => {
  const okta = audit([
    { name: 'Prod', url: 'https://acme.okta.com/api/v1/users' },
    { name: 'Preview', url: 'https://acme.oktapreview.com/api/v1/users' },
  ])
  assert.equal(okta.byRule.get('MIXED_TENANT_ENVIRONMENTS')?.severity, 'warning')
  assert.deepEqual(okta.names('MIXED_TENANT_ENVIRONMENTS').sort(), ['Preview', 'Prod'])

  const auth0 = audit([
    { name: 'Prod', url: 'https://acme.eu.auth0.com/api/v2/users' },
    { name: 'Dev', url: 'https://acme-dev.eu.auth0.com/api/v2/users' },
  ])
  assert.equal(auth0.names('MIXED_TENANT_ENVIRONMENTS').length, 2)

  const entra = audit([
    { name: 'One', method: 'POST', url: `https://login.microsoftonline.com/${GUID_A}/oauth2/v2.0/token` },
    { name: 'Two', method: 'POST', url: `https://login.microsoftonline.com/${GUID_B}/oauth2/v2.0/token` },
  ])
  assert.equal(entra.names('MIXED_TENANT_ENVIRONMENTS').length, 2)

  const viaVariables = audit(
    [
      { name: 'Prod', url: '{{prodOkta}}/api/v1/users' },
      { name: 'Preview', url: '{{previewOkta}}/api/v1/users' },
    ],
    [
      { key: 'prodOkta', value: 'https://acme.okta.com' },
      { key: 'previewOkta', value: 'https://acme.oktapreview.com' },
    ]
  )
  assert.equal(viaVariables.names('MIXED_TENANT_ENVIRONMENTS').length, 2, 'variables that resolve to different environments still mix them')

  const single = audit([
    { name: 'A', url: 'https://acme.okta.com/api/v1/users' },
    { name: 'B', url: 'https://acme.okta.com/api/v1/groups' },
  ])
  assert.ok(!single.byRule.has('MIXED_TENANT_ENVIRONMENTS'))
})

test('retired and legacy identity APIs are reported', () => {
  const { names, byRule } = audit([
    { name: 'AAD Graph', url: 'https://graph.windows.net/{{tenant}}/users?api-version=1.6' },
    { name: 'Entra v1', method: 'POST', url: `https://login.microsoftonline.com/${GUID_A}/oauth2/token` },
    { name: 'Entra v2', method: 'POST', url: `https://login.microsoftonline.com/${GUID_A}/oauth2/v2.0/token` },
    { name: 'Keycloak legacy', method: 'POST', url: 'https://sso.acme-corp.com/auth/realms/main/protocol/openid-connect/token' },
    { name: 'Keycloak current', method: 'POST', url: 'https://sso.acme-corp.com/realms/main/protocol/openid-connect/token' },
    { name: 'Okta authn', method: 'POST', url: 'https://acme.okta.com/api/v1/authn' },
    { name: 'Okta users', url: 'https://acme.okta.com/api/v1/users' },
    { name: 'Auth0 ro', method: 'POST', url: 'https://acme.eu.auth0.com/oauth/ro' },
    { name: 'Auth0 token', method: 'POST', url: 'https://acme.eu.auth0.com/oauth/token' },
  ])
  assert.equal(byRule.get('DEPRECATED_IDENTITY_API')?.severity, 'warning')
  assert.deepEqual(names('DEPRECATED_IDENTITY_API').sort(), ['AAD Graph', 'Auth0 ro', 'Entra v1', 'Keycloak legacy', 'Okta authn'])
})

test('platform endpoint rules add classes without overriding the shared ones', () => {
  const classify = (method: string, url: string) => {
    const parsed = parseCollection({ info: { name: 'x' }, item: [{ name: 'r', request: { method, url } }] })
    const request = parsed.requests[0]
    return classifyEndpoint(endpointContext(request, splitUrl(request.url, parsed), requestParams(request)))
  }
  assert.equal(classify('POST', 'https://pf.acme-corp.com:9999/pf-admin-api/v1/oauth/clients'), 'admin.credential-mint')
  assert.equal(classify('GET', 'https://pf.acme-corp.com:9999/pf-admin-api/v1/oauth/clients'), 'unknown')
  assert.equal(classify('POST', 'https://sso.acme-corp.com/admin/realms/main/clients'), 'admin.credential-mint')
  assert.equal(classify('POST', 'https://sso.acme-corp.com/realms/main/protocol/openid-connect/token'), 'oauth.token')
})

test('platform rules follow the iam-platform pack', () => {
  const raw = build([
    { name: 'Prod', url: 'https://acme.okta.com/api/v1/users' },
    { name: 'Preview', url: 'https://acme.oktapreview.com/api/v1/users' },
  ])
  assert.ok(runAuditDetailed(parseCollection(raw)).findings.some((finding) => finding.ruleId === 'MIXED_TENANT_ENVIRONMENTS'))
  const off = runAuditDetailed(parseCollection(raw), { rulePacks: { disabled: ['iam-platform'] } })
  assert.ok(!off.findings.some((finding) => finding.ruleId === 'MIXED_TENANT_ENVIRONMENTS'))
})
