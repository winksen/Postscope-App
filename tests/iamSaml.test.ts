import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCollection } from '../src/lib/parser'
import { runAudit, runAuditDetailed, type Finding } from '../src/lib/auditor'
import { describeSamlAssertion, findSamlAssertions } from '../src/lib/iam/saml'
import { classifyEndpoint, endpointContext } from '../src/lib/iam/endpoints'
import { requestParams, splitUrl } from '../src/lib/iam/url'
import { detectIdentitySignals } from '../src/lib/iam/signals'

/** A SAML response built at runtime from fictional values, so no assertion-shaped literal is committed. */
function samlResponse(options: { assertion?: boolean; prefix?: string } = {}): string {
  const prefix = options.prefix ?? 'saml'
  const inner =
    options.assertion === false
      ? '<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Responder"/></samlp:Status>'
      : `<${prefix}:Assertion ID="_a1" Version="2.0"><${prefix}:Subject><${prefix}:NameID>jane.doe@acme-corp.com</${prefix}:NameID></${prefix}:Subject><${prefix}:AttributeStatement><${prefix}:Attribute Name="role"><${prefix}:AttributeValue>Administrator</${prefix}:AttributeValue></${prefix}:Attribute></${prefix}:AttributeStatement></${prefix}:Assertion>`
  const xml = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="_r1"><saml:Issuer xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">https://idp.acme-corp.com/saml/metadata</saml:Issuer>${inner}</samlp:Response>`
  return Buffer.from(xml).toString('base64')
}

interface Req {
  name: string
  method?: string
  url?: string
  form?: Array<[string, string]>
  raw?: string
  responses?: Array<{ name: string; body?: string; headers?: Array<[string, string]>; cookie?: unknown[]; requestBody?: string }>
}

function build(requests: Req[]) {
  return {
    info: { name: 'SAML fixture', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    item: requests.map((request) => ({
      name: request.name,
      request: {
        method: request.method ?? 'POST',
        url: request.url ?? 'https://sp.acme-corp.com/saml2/acs',
        description: 'documented',
        header: [],
        ...(request.form ? { body: { mode: 'urlencoded', urlencoded: request.form.map(([key, value]) => ({ key, value })) } } : {}),
        ...(request.raw ? { body: { mode: 'raw', raw: request.raw } } : {}),
      },
      response: (request.responses ?? []).map((response) => ({
        name: response.name,
        originalRequest: {
          method: 'POST',
          url: 'https://sp.acme-corp.com/saml2/acs',
          body: response.requestBody ? { mode: 'raw', raw: response.requestBody } : undefined,
        },
        code: 200,
        header: (response.headers ?? []).map(([key, value]) => ({ key, value })),
        cookie: response.cookie,
        body: response.body ?? '',
      })),
    })),
  }
}

function audit(requests: Req[]) {
  const parsed = parseCollection(build(requests))
  const findings = runAudit(parsed)
  const byRule = new Map<string, Finding>(findings.map((finding) => [finding.ruleId, finding]))
  const names = (ruleId: string) =>
    (byRule.get(ruleId)?.affected ?? []).map((id) => parsed.requests.find((request) => request.id === id)?.name ?? id)
  return { parsed, findings, byRule, names }
}

test('SAML assertions are found in form fields, raw bodies, queries and saved examples, without leaking their content', () => {
  const response = samlResponse()
  const { byRule, names } = audit([
    {
      name: 'Form field',
      form: [
        ['SAMLResponse', response],
        ['RelayState', 'x'],
      ],
    },
    { name: 'Raw body', raw: `SAMLResponse=${encodeURIComponent(response)}&RelayState=x` },
    { name: 'Query', method: 'GET', url: `https://sp.acme-corp.com/saml2/acs?SAMLResponse=${encodeURIComponent(response)}` },
    {
      name: 'Saved html',
      responses: [{ name: 'Auto submit', body: `<form><input type="hidden" name="SAMLResponse" value="${response}"/></form>` }],
    },
    { name: 'Saved request', responses: [{ name: 'Posted', requestBody: `SAMLResponse=${encodeURIComponent(response)}` }] },
    { name: 'Prefixed', form: [['SAMLResponse', samlResponse({ prefix: 'saml2' })]] },
    { name: 'No assertion', form: [['SAMLResponse', samlResponse({ assertion: false })]] },
    { name: 'Not base64', form: [['SAMLResponse', `${'not-base64!'.repeat(20)}`]] },
    { name: 'Variable', form: [['SAMLResponse', '{{samlResponse}}']] },
  ])
  const finding = byRule.get('SAML_ASSERTION_CAPTURED')!
  assert.equal(finding.severity, 'critical')
  assert.equal(finding.category, 'identity')
  assert.deepEqual(names('SAML_ASSERTION_CAPTURED').sort(), ['Form field', 'Prefixed', 'Query', 'Raw body', 'Saved html', 'Saved request'])
  const text = JSON.stringify(finding)
  for (const secret of ['jane.doe', 'Administrator', response, 'NameID', 'AttributeValue'])
    assert.ok(!text.includes(secret), `finding leaks ${secret}`)
  assert.match(finding.evidence?.[0].preview ?? '', /^SAML assertion \(\d+ characters\), issuer idp\.acme-corp\.com$/)
})

test('assertion detection is bounded and tolerant of bad input', () => {
  assert.equal(describeSamlAssertion('short'), null)
  assert.equal(describeSamlAssertion('%%%'.repeat(40)), null)
  const huge = Buffer.from(`<saml:Assertion>${'x'.repeat(500_000)}</saml:Assertion>`).toString('base64')
  assert.ok(describeSamlAssertion(huge), 'the assertion tag sits near the start, so a huge value is still read within the bound')
  const request = parseCollection(build([{ name: 'Big', raw: `SAMLResponse=${'A'.repeat(3_000_000)}` }])).requests[0]
  const started = Date.now()
  assert.deepEqual(findSamlAssertions(request), [])
  assert.ok(Date.now() - started < 1500)
})

test('SAML endpoints over http are reported, https and localhost are not', () => {
  const { names, byRule } = audit([
    { name: 'Metadata http', method: 'GET', url: 'http://idp.acme-corp.com/saml2/idp/metadata' },
    { name: 'ADFS http', method: 'GET', url: 'http://adfs.acme-corp.com/adfs/ls/?SAMLRequest=abc' },
    { name: 'ACS http', url: 'http://sp.acme-corp.com/saml2/acs' },
    { name: 'Https', method: 'GET', url: 'https://idp.acme-corp.com/saml2/idp/metadata' },
    { name: 'Local', method: 'GET', url: 'http://localhost:8080/saml2/idp/metadata' },
    { name: 'Federation metadata', method: 'GET', url: 'http://adfs.acme-corp.com/FederationMetadata/2007-06/FederationMetadata.xml' },
  ])
  assert.deepEqual(names('SAML_IDP_METADATA_HTTP').sort(), ['ACS http', 'ADFS http', 'Federation metadata', 'Metadata http'])
  assert.equal(byRule.get('SAML_IDP_METADATA_HTTP')?.severity, 'warning')
})

test('session cookies without Secure, HttpOnly or SameSite are reported from saved examples', () => {
  const { names, byRule } = audit([
    {
      name: 'Bare',
      method: 'GET',
      responses: [{ name: 'Login', headers: [['Set-Cookie', 'JSESSIONID=abcdef1234567890abcdef; Path=/']] }],
    },
    {
      name: 'Partial',
      method: 'GET',
      responses: [{ name: 'Login', headers: [['Set-Cookie', 'sid=abcdef1234567890abcdef; Path=/; Secure; HttpOnly']] }],
    },
    {
      name: 'Complete',
      method: 'GET',
      responses: [{ name: 'Login', headers: [['Set-Cookie', 'session=abcdef1234567890abcdef; Secure; HttpOnly; SameSite=Lax']] }],
    },
    { name: 'Theme', method: 'GET', responses: [{ name: 'Prefs', headers: [['Set-Cookie', 'theme=dark; Path=/']] }] },
    {
      name: 'Stored cookie',
      method: 'GET',
      responses: [{ name: 'Login', cookie: [{ name: 'auth_token', value: 'abcdef1234567890', secure: false, httpOnly: true }] }],
    },
  ])
  assert.deepEqual(names('SESSION_COOKIE_FLAGS').sort(), ['Bare', 'Partial', 'Stored cookie'])
  const previews = (byRule.get('SESSION_COOKIE_FLAGS')?.evidence ?? []).map((entry) => `${entry.location}: ${entry.preview}`).join('\n')
  assert.match(previews, /cookie JSESSIONID: missing Secure, HttpOnly, SameSite/)
  assert.match(previews, /cookie sid: missing SameSite/)
  assert.match(previews, /cookie auth_token: missing Secure, SameSite/)
  assert.ok(!previews.includes('abcdef1234567890'), 'cookie values are never shown')
  assert.equal(byRule.get('SESSION_COOKIE_FLAGS')?.severity, 'info')
})

const TOKEN = (platformUrl: string) => ({
  name: `Token ${platformUrl}`,
  url: platformUrl,
  form: [['grant_type', 'client_credentials']] as Array<[string, string]>,
})

test('token requests without any revocation, logout or session termination are reported per platform', () => {
  const missing = audit([TOKEN('https://acme.okta.com/oauth2/default/v1/token')])
  const finding = missing.byRule.get('TOKEN_REVOCATION_NOT_COVERED')!
  assert.equal(finding.severity, 'info')
  assert.equal(finding.affected.length, 0)
  assert.match(finding.evidence?.[0].location ?? '', /Okta/)

  const covered = audit([
    TOKEN('https://acme.okta.com/oauth2/default/v1/token'),
    { name: 'Revoke', url: 'https://acme.okta.com/oauth2/default/v1/revoke', form: [['token', '{{t}}']] },
  ])
  assert.ok(!covered.byRule.has('TOKEN_REVOCATION_NOT_COVERED'))

  const logout = audit([
    TOKEN('https://sso.acme-corp.com/realms/main/protocol/openid-connect/token'),
    {
      name: 'Logout',
      method: 'POST',
      url: 'https://sso.acme-corp.com/realms/main/protocol/openid-connect/logout',
      form: [['refresh_token', '{{r}}']],
    },
  ])
  assert.ok(!logout.byRule.has('TOKEN_REVOCATION_NOT_COVERED'))

  const sessions = audit([
    TOKEN('https://acme.okta.com/oauth2/default/v1/token'),
    { name: 'End sessions', method: 'DELETE', url: 'https://acme.okta.com/api/v1/users/{{id}}/sessions' },
  ])
  assert.ok(!sessions.byRule.has('TOKEN_REVOCATION_NOT_COVERED'))

  const onePlatform = audit([
    TOKEN('https://acme.okta.com/oauth2/default/v1/token'),
    TOKEN('https://sso.acme-corp.com/realms/main/protocol/openid-connect/token'),
    { name: 'Revoke', url: 'https://acme.okta.com/oauth2/default/v1/revoke', form: [['token', '{{t}}']] },
  ])
  const evidence = onePlatform.byRule.get('TOKEN_REVOCATION_NOT_COVERED')?.evidence ?? []
  assert.equal(evidence.length, 1)
  assert.match(evidence[0].location, /Keycloak/)

  const none = audit([{ name: 'List', method: 'GET', url: 'https://acme.okta.com/api/v1/users' }])
  assert.ok(!none.byRule.has('TOKEN_REVOCATION_NOT_COVERED'), 'nothing obtains tokens, so nothing needs revoking')
})

test('session termination requests are classified', () => {
  const classify = (method: string, url: string) => {
    const parsed = parseCollection({ info: { name: 'x' }, item: [{ name: 'r', request: { method, url } }] })
    const request = parsed.requests[0]
    return classifyEndpoint(endpointContext(request, splitUrl(request.url, parsed), requestParams(request)))
  }
  assert.equal(classify('DELETE', 'https://acme.okta.com/api/v1/users/{{id}}/sessions'), 'session.terminate')
  assert.equal(classify('DELETE', 'https://acme.okta.com/api/v1/sessions/{{id}}'), 'session.terminate')
  assert.equal(classify('POST', 'https://graph.microsoft.com/v1.0/users/{{id}}/revokeSignInSessions'), 'session.terminate')
  assert.equal(classify('POST', 'https://sso.acme-corp.com/admin/realms/main/users/{{id}}/logout'), 'session.terminate')
  assert.equal(classify('GET', 'https://acme.okta.com/api/v1/users/{{id}}/sessions'), 'unknown')
  assert.equal(classify('POST', 'https://sso.acme-corp.com/realms/main/protocol/openid-connect/logout'), 'oidc.logout')
})

test('SAML rules follow the pack settings and a SAML response is an identity signal', () => {
  const raw = build([{ name: 'ACS', form: [['SAMLResponse', samlResponse()]] }])
  assert.equal(detectIdentitySignals(parseCollection(raw)), true)
  assert.ok(runAuditDetailed(parseCollection(raw)).findings.some((finding) => finding.ruleId === 'SAML_ASSERTION_CAPTURED'))
  const off = runAuditDetailed(parseCollection(raw), { rulePacks: { disabled: ['iam-am'] } })
  assert.ok(!off.findings.some((finding) => finding.ruleId === 'SAML_ASSERTION_CAPTURED'))
})
