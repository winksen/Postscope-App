import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { parseCollection } from '../src/lib/parser'
import { runAuditDetailed } from '../src/lib/auditor'
import { calculateScore } from '../src/lib/scorer'
import { buildJsonReport } from '../src/lib/reportExport'
import { attachEnvironments } from '../src/lib/environment'
import { buildIdentityProfile } from '../src/lib/iam/profile'
import { classifyEndpoint, endpointContext } from '../src/lib/iam/endpoints'
import { fingerprintPlatforms } from '../src/lib/iam/fingerprints'
import { splitUrl, normalizePath, requestParams } from '../src/lib/iam/url'
import { isEmptyProfile, type EndpointClass, type PlatformId } from '../src/lib/iam/types'
import { FAKE, cleanCollection, environmentExport } from './fixtures'
import { validate } from './schema'

const schema = JSON.parse(fs.readFileSync(new URL('../docs/schemas/postscope-report.v2.schema.json', import.meta.url), 'utf8')) as Record<
  string,
  unknown
>

interface Req {
  method?: string
  url: string
  headers?: Array<[string, string]>
  form?: Array<[string, string]>
  raw?: string
  auth?: unknown
  name?: string
}

function collection(requests: Req[], extra: Record<string, unknown> = {}) {
  return {
    info: { name: 'IAM fixture', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    item: requests.map((request, index) => ({
      name: request.name ?? `Request ${index}`,
      request: {
        method: request.method ?? 'GET',
        url: request.url,
        description: 'documented',
        header: (request.headers ?? []).map(([key, value]) => ({ key, value })),
        ...(request.form
          ? { body: { mode: 'urlencoded', urlencoded: request.form.map(([key, value]) => ({ key, value })) } }
          : request.raw
            ? { body: { mode: 'raw', raw: request.raw } }
            : {}),
        ...(request.auth ? { auth: request.auth } : {}),
      },
    })),
    ...extra,
  }
}

function oauth2(fields: Record<string, string>) {
  return { type: 'oauth2', oauth2: Object.entries(fields).map(([key, value]) => ({ key, value, type: 'string' })) }
}

function platformsOf(url: string, headers: Array<[string, string]> = [], method = 'GET'): PlatformId[] {
  const parsed = parseCollection(collection([{ url, headers, method }]))
  return fingerprintPlatforms(parsed).platforms.map((platform) => platform.id)
}

test('platforms are recognized from hosts, paths, headers and token shapes', () => {
  const table: Array<[string, PlatformId, Array<[string, string]>?]> = [
    ['https://example.okta.com/api/v1/users', 'okta'],
    ['https://example.oktapreview.com/oauth2/default/v1/token', 'okta'],
    ['https://login.microsoftonline.com/{{tenantId}}/oauth2/v2.0/token', 'entra'],
    ['https://graph.microsoft.com/v1.0/users', 'entra'],
    ['https://example.eu.auth0.com/api/v2/users', 'auth0'],
    ['https://auth.pingone.com/{{envId}}/as/token.oauth2', 'ping'],
    ['https://openam-example.forgeblocks.com/am/oauth2/realms/root/access_token', 'forgerock'],
    ['https://sso.example.com/realms/main/protocol/openid-connect/token', 'keycloak'],
    ['https://sso.example.com/auth/admin/realms/main/users', 'keycloak'],
    ['https://example.api.identitynow.com/v3/access-requests', 'sailpoint'],
    ['https://iiq.example.com/identityiq/scim/v2/Users', 'sailpoint'],
    ['https://example.saviyntcloud.com/ECM/api/v5/getUsers', 'saviynt'],
    ['https://oim.example.com/AppServer/api/entities/Person', 'oneidentity'],
    ['https://example.omada.cloud/OData/DataObjects/Identity', 'omada'],
    ['https://pvwa.example.com/PasswordVault/API/Accounts', 'cyberark'],
    ['https://example.privilegecloud.cyberark.cloud/PasswordVault/API/Safes', 'cyberark'],
    ['https://bt.example.com/BeyondTrust/api/public/v3/Requests', 'beyondtrust'],
    ['https://ss.example.com/SecretServer/api/v1/secrets/1', 'delinea'],
    ['http://vault.example.com:8200/v1/sys/health', 'vault'],
    ['https://vault.example.com/v1/secret/data/app', 'vault', [['X-Vault-Token', '{{vaultToken}}']]],
    ['https://iam.amazonaws.com/?Action=ListUsers', 'aws-iam'],
    ['https://management.azure.com/subscriptions/x/providers/Microsoft.Authorization/roleAssignments/y', 'azure-iam'],
    ['https://iam.googleapis.com/v1/projects/p/serviceAccounts', 'gcp-iam'],
    ['https://example.com/api/x', 'okta', [['Authorization', `SSWS ${FAKE.apiKey}`]]],
    ['https://example.com/api/x', 'beyondtrust', [['Authorization', 'PS-Auth key=abc123; runas=svc;']]],
  ]
  for (const [url, expected, headers] of table) {
    assert.ok(platformsOf(url, headers).includes(expected), `${url} should match ${expected}, got ${platformsOf(url, headers).join()}`)
  }
})

test('generic APIs are not mistaken for identity platforms', () => {
  for (const url of [
    'https://api.example.com/api/v1/users',
    'https://api.example.com/v1/items',
    '{{baseUrl}}/orders',
    'https://shop.example.com/oauth/callback',
  ]) {
    assert.deepEqual(platformsOf(url), [], url)
  }
})

test('the platform is found through variables the environment resolves', () => {
  const raw = collection([{ url: '{{idp}}/oauth2/default/v1/token', method: 'POST' }], {
    variable: [{ key: 'idp', value: 'https://acme.okta.com' }],
  })
  assert.ok(fingerprintPlatforms(parseCollection(raw)).platforms.some((platform) => platform.id === 'okta'))
  const bare = collection([{ url: '{{baseUrl}}/oauth2/default/v1/token', method: 'POST' }])
  const withEnv = attachEnvironments(parseCollection(bare), [JSON.stringify(environmentExport())])
  assert.ok(withEnv.environments?.length === 1)
  const hostVariable = splitUrl('{{baseUrl}}/users', parseCollection(bare))
  assert.equal(hostVariable.host, undefined)
  assert.equal(hostVariable.hostVariable, 'baseUrl')
})

test('several platforms in one collection get separate confidence scores', () => {
  const parsed = parseCollection(
    collection([
      { url: 'https://example.okta.com/api/v1/users' },
      { url: 'https://example.okta.com/api/v1/groups' },
      { url: 'https://vault.example.com:8200/v1/sys/health' },
    ])
  )
  const { platforms } = fingerprintPlatforms(parsed)
  assert.deepEqual(platforms.map((platform) => platform.id).sort(), ['okta', 'vault'])
  const okta = platforms.find((platform) => platform.id === 'okta')!
  assert.equal(okta.requestCount, 2)
  assert.ok(okta.confidence >= 0.6 && okta.confidence <= 1)
  assert.ok(okta.signals.some((signal) => signal.startsWith('host ')))
})

function classify(method: string, url: string, form?: Array<[string, string]>, headers?: Array<[string, string]>): EndpointClass {
  const parsed = parseCollection(collection([{ method, url, form, headers }]))
  const request = parsed.requests[0]
  const split = splitUrl(request.url, parsed)
  return classifyEndpoint(endpointContext(request, split, requestParams(request)))
}

test('endpoints are classified by what they do for identity', () => {
  const table: Array<[string, string, EndpointClass, Array<[string, string]>?, Array<[string, string]>?]> = [
    ['POST', 'https://example.okta.com/oauth2/default/v1/token', 'oauth.token'],
    ['POST', 'https://login.microsoftonline.com/{{tenant}}/oauth2/v2.0/token', 'oauth.token'],
    ['POST', 'https://sso.example.com/realms/main/protocol/openid-connect/token', 'oauth.token'],
    ['POST', 'https://x.example.com/anything', 'oauth.token', [['grant_type', 'client_credentials']]],
    ['GET', 'https://example.okta.com/oauth2/default/v1/authorize?response_type=code&client_id=abc', 'oauth.authorize'],
    ['GET', 'https://sso.example.com/realms/main/protocol/openid-connect/auth', 'oauth.authorize'],
    ['POST', 'https://example.okta.com/oauth2/default/v1/par', 'oauth.par'],
    ['POST', 'https://login.microsoftonline.com/t/oauth2/v2.0/devicecode', 'oauth.device'],
    ['POST', 'https://example.okta.com/oauth2/default/v1/introspect', 'oauth.introspect'],
    ['POST', 'https://example.okta.com/oauth2/default/v1/revoke', 'oauth.revoke'],
    ['GET', 'https://example.okta.com/oauth2/default/v1/userinfo', 'oidc.userinfo'],
    ['GET', 'https://example.okta.com/oauth2/default/.well-known/openid-configuration', 'oidc.discovery'],
    ['GET', 'https://example.okta.com/oauth2/default/v1/keys', 'oidc.jwks'],
    ['GET', 'https://sso.example.com/realms/main/protocol/openid-connect/certs', 'oidc.jwks'],
    ['GET', 'https://sso.example.com/realms/main/protocol/openid-connect/logout', 'oidc.logout'],
    ['POST', 'https://sp.example.com/saml2/acs', 'saml.acs'],
    ['GET', 'https://idp.example.com/saml2/sso', 'saml.sso'],
    ['GET', '{{scim}}/scim/v2/Users?count=10', 'scim.users'],
    ['PATCH', '{{scim}}/scim/v2/Groups/{{id}}', 'scim.groups'],
    ['POST', '{{scim}}/scim/v2/Bulk', 'scim.bulk'],
    ['GET', '{{scim}}/scim/v2/ServiceProviderConfig', 'scim.schemas'],
    ['POST', 'https://example.api.identitynow.com/v3/access-requests', 'iga.access-request'],
    ['GET', 'https://example.api.identitynow.com/v3/certifications', 'iga.certification'],
    ['GET', 'https://example.api.identitynow.com/beta/sod-policies', 'iga.sod'],
    ['POST', 'https://example.okta.com/api/v1/users/{{id}}/roles', 'admin.role-assignment'],
    ['POST', 'https://graph.microsoft.com/v1.0/roleManagement/directory/roleAssignments', 'admin.role-assignment'],
    ['POST', 'https://sso.example.com/admin/realms/main/users/{{id}}/role-mappings/realm', 'admin.role-assignment'],
    ['POST', 'https://iam.amazonaws.com/', 'admin.role-assignment', [['Action', 'AttachUserPolicy']]],
    ['POST', 'https://example.okta.com/api/v1/policies', 'admin.policy'],
    ['PATCH', 'https://graph.microsoft.com/v1.0/identity/conditionalAccess/policies/{{id}}', 'admin.policy'],
    ['POST', 'https://graph.microsoft.com/v1.0/applications/{{id}}/addPassword', 'admin.credential-mint'],
    ['POST', 'https://sso.example.com/admin/realms/main/clients/{{id}}/client-secret', 'admin.credential-mint'],
    ['POST', 'https://iam.amazonaws.com/', 'admin.credential-mint', [['Action', 'CreateAccessKey']]],
    ['POST', 'https://pvwa.example.com/PasswordVault/API/Accounts/{{id}}/Password/Retrieve', 'pam.retrieve'],
    ['GET', 'https://ss.example.com/SecretServer/api/v1/secrets/1/fields/password', 'pam.retrieve'],
    ['POST', 'https://bt.example.com/BeyondTrust/api/public/v3/Requests', 'pam.checkout'],
    ['PUT', 'https://bt.example.com/BeyondTrust/api/public/v3/Requests/{{id}}/Checkin', 'pam.checkin'],
    ['POST', 'https://pvwa.example.com/PasswordVault/API/Safes/{{safe}}/Members', 'pam.admin'],
    ['GET', 'https://vault.example.com:8200/v1/secret/data/app', 'vault.read'],
    ['POST', 'https://vault.example.com:8200/v1/secret/data/app', 'vault.write'],
    ['POST', 'https://sts.amazonaws.com/', 'cloud-iam.sts', [['Action', 'AssumeRole']]],
    ['POST', 'https://iam.googleapis.com/v1/projects/p/serviceAccounts/{{sa}}/keys', 'admin.credential-mint'],
    ['GET', 'https://api.example.com/v1/items', 'unknown'],
    ['GET', 'https://shop.example.com/oauth/callback', 'unknown'],
  ]
  for (const [method, url, expected, form, headers] of table)
    assert.equal(classify(method, url, form ?? undefined, headers), expected, `${method} ${url}`)
})

test('URLs are normalized with variables and path params replaced by a star', () => {
  assert.equal(normalizePath('/api/v1/users/{{id}}/roles?x=1#y'), '/api/v1/users/*/roles')
  assert.equal(normalizePath('/a/:id/b/'), '/a/*/b')
  assert.equal(normalizePath('/'), '/')
  const parsed = parseCollection(collection([{ url: '{{baseUrl}}/scim/v2/Users/{{userId}}' }]))
  assert.deepEqual(splitUrl(parsed.requests[0].url, parsed), { scheme: undefined, hostVariable: 'baseUrl', path: '/scim/v2/Users/*' })
  const absolute = splitUrl('HTTPS://Login.MicrosoftOnline.com:443/x/oauth2/v2.0/token?a=1', parsed)
  assert.equal(absolute.host, 'login.microsoftonline.com')
  assert.equal(absolute.port, '443')
})

test('OAuth clients come from auth helpers and from authorize and token requests', () => {
  const parsed = parseCollection(
    collection(
      [
        {
          name: 'Authorize',
          url: 'https://example.okta.com/oauth2/default/v1/authorize?response_type=code&client_id=0oaabcdef123456&redirect_uri=https%3A%2F%2Fapp.example.com%2Fcb&scope=openid%20profile&code_challenge=abc&code_challenge_method=S256&state=xyz',
        },
        {
          name: 'Token',
          method: 'POST',
          url: 'https://example.okta.com/oauth2/default/v1/token',
          form: [
            ['grant_type', 'authorization_code'],
            ['client_id', '0oaabcdef123456'],
            ['code_verifier', '{{verifier}}'],
            ['redirect_uri', 'https://app.example.com/cb'],
          ],
        },
        {
          name: 'Machine',
          method: 'POST',
          url: 'https://example.okta.com/oauth2/default/v1/token',
          form: [
            ['grant_type', 'client_credentials'],
            ['client_id', '{{machineId}}'],
            ['client_secret', FAKE.clientSecret],
            ['scope', 'okta.users.read'],
          ],
        },
      ],
      {
        auth: oauth2({
          grant_type: 'authorization_code_with_pkce',
          challengeAlgorithm: 'S256',
          clientId: '{{clientId}}',
          accessTokenUrl: 'https://login.microsoftonline.com/{{tenantId}}/oauth2/v2.0/token',
          scope: 'User.Read offline_access',
          client_authentication: 'body',
        }),
      }
    )
  )
  const profile = buildIdentityProfile(parsed)
  const helper = profile.oauthClients.find((client) => client.source === 'auth-helper')!
  assert.equal(helper.grant, 'authorization_code')
  assert.equal(helper.pkce, 'S256')
  assert.equal(helper.clientAuth, 'client_secret_post')
  assert.equal(helper.clientId, '{{clientId}}')
  assert.deepEqual(helper.scopes, ['User.Read', 'offline_access'])

  const web = profile.oauthClients.find((client) => client.source === 'request' && client.requestIds.includes('Authorize'))!
  assert.ok(web.requestIds.includes('Token'), 'authorize and token requests of one client are one entry')
  assert.equal(web.grant, 'authorization_code')
  assert.equal(web.pkce, 'S256')
  assert.equal(web.clientAuth, 'none')
  assert.ok(web.clientId?.startsWith('0oaa') && web.clientId.includes('•') && !web.clientId.includes('123456'))
  assert.deepEqual(web.redirectUris, ['https://app.example.com/cb'])
  assert.deepEqual(web.scopes, ['openid', 'profile'])
  assert.equal(web.platform, 'okta')

  const machine = profile.oauthClients.find((client) => client.source === 'request' && client.requestIds.includes('Machine'))!
  assert.equal(machine.grant, 'client_credentials')
  assert.equal(machine.clientAuth, 'client_secret_post')
  assert.equal(machine.pkce, 'not-applicable')

  assert.ok(profile.grants.some((entry) => entry.grant === 'client_credentials'))
  assert.equal(profile.scopes.find((entry) => entry.scope === 'openid')?.clients, 1)
  assert.ok(!JSON.stringify(profile).includes(FAKE.clientSecret))
})

test('authorization code flows without a challenge report PKCE as absent, and a challenge without a method as plain', () => {
  const parsed = parseCollection(
    collection([
      { name: 'A', url: 'https://example.okta.com/oauth2/default/v1/authorize?response_type=code&client_id=aaaa1111bbbb' },
      { name: 'B', url: 'https://example.auth0.com/authorize?response_type=code&client_id=cccc2222dddd&code_challenge=zzz' },
      { name: 'C', url: 'https://example.okta.com/oauth2/default/v1/authorize?response_type=token&client_id=eeee3333ffff' },
    ])
  )
  const profile = buildIdentityProfile(parsed)
  const byRequest = (id: string) => profile.oauthClients.find((client) => client.requestIds.includes(id))!
  assert.equal(byRequest('A').pkce, 'absent')
  assert.equal(byRequest('B').pkce, 'plain')
  assert.equal(byRequest('C').grant, 'implicit')
})

test('literal tokens are inventoried with masked previews only', () => {
  const parsed = parseCollection(
    collection(
      [
        { name: 'Jwt', url: 'https://example.okta.com/api/v1/users', headers: [['Authorization', `Bearer ${FAKE.jwt}`]] },
        { name: 'Ssws', url: 'https://example.okta.com/api/v1/users', headers: [['Authorization', `SSWS ${FAKE.apiKey}`]] },
        {
          name: 'Vault',
          url: 'https://vault.example.com:8200/v1/sys/health',
          headers: [['X-Vault-Token', ['hvs', '.', 'A'.repeat(24)].join('')]],
        },
        { name: 'Variable', url: 'https://example.okta.com/api/v1/users', headers: [['Authorization', 'Bearer {{token}}']] },
      ],
      { variable: [{ key: 'saved', value: FAKE.jwt }] }
    )
  )
  const { tokens } = buildIdentityProfile(parsed)
  assert.deepEqual(tokens.map((token) => token.kind).sort(), ['jwt', 'jwt', 'okta-ssws', 'vault-token'])
  assert.ok(!tokens.some((token) => token.requestId === 'Variable'))
  const text = JSON.stringify(tokens)
  for (const secret of [FAKE.jwt, FAKE.apiKey, 'A'.repeat(24)]) assert.ok(!text.includes(secret))
})

test('the profile is empty for collections that have nothing to do with identity', () => {
  assert.ok(isEmptyProfile(buildIdentityProfile(parseCollection(cleanCollection()))))
  const samples = path.resolve('public/samples')
  for (const file of fs.readdirSync(samples).filter((name) => name.endsWith('.postman_collection.json'))) {
    const profile = buildIdentityProfile(parseCollection(JSON.parse(fs.readFileSync(path.join(samples, file), 'utf8'))))
    // The samples call an application's own OAuth endpoints, which are classified, but no identity platform.
    assert.equal(profile.platforms.length, 0, `${file} has no identity platform`)
  }
})

test('the audit attaches the profile only when identity signals exist, and the score gets an identity category', () => {
  const plain = parseCollection(cleanCollection())
  runAuditDetailed(plain)
  assert.equal(plain.identity, undefined)

  const parsed = parseCollection(
    collection([{ url: 'https://example.okta.com/oauth2/default/v1/token', method: 'POST', form: [['grant_type', 'client_credentials']] }])
  )
  const { findings } = runAuditDetailed(parsed)
  assert.ok(parsed.identity && parsed.identity.endpoints.length === 1)
  assert.equal(parsed.identity.endpoints[0].class, 'oauth.token')
  // The token request has no revocation counterpart, which costs the identity score a little (info finding).
  const identityScore = calculateScore(parsed, findings).categories.identity
  assert.ok(identityScore !== undefined && identityScore >= 90 && identityScore <= 100)

  runAuditDetailed(parsed, { rulePacks: { disabled: ['iam-am', 'iam-iga', 'iam-pam', 'iam-platform'] } })
  assert.ok(parsed.identity, 'a detected profile does not depend on the packs because detection is automatic')
})

test('the JSON report carries a schema-valid identity section without secrets', () => {
  const parsed = parseCollection(
    collection(
      [
        {
          name: 'Token',
          method: 'POST',
          url: 'https://example.okta.com/oauth2/default/v1/token',
          form: [
            ['grant_type', 'client_credentials'],
            ['client_id', '0oaabcdef123456'],
            ['client_secret', FAKE.clientSecret],
          ],
        },
        { name: 'Users', url: 'https://example.okta.com/api/v1/users', headers: [['Authorization', `Bearer ${FAKE.jwt}`]] },
      ],
      {}
    )
  )
  const { findings } = runAuditDetailed(parsed)
  const text = buildJsonReport({ parsed, findings, score: calculateScore(parsed, findings), appVersion: 'test' })
  const report = JSON.parse(text) as { identity?: { platforms: Array<{ id: string }>; endpointCounts: Record<string, number> } }
  assert.deepEqual(validate(schema, report), [])
  assert.equal(report.identity?.platforms[0].id, 'okta')
  assert.equal(report.identity?.endpointCounts['oauth.token'], 1)
  for (const secret of [FAKE.clientSecret, FAKE.jwt, '0oaabcdef123456']) assert.ok(!text.includes(secret), `report leaks ${secret}`)

  const plain = parseCollection(cleanCollection())
  const plainFindings = runAuditDetailed(plain).findings
  const plainReport = JSON.parse(
    buildJsonReport({ parsed: plain, findings: plainFindings, score: calculateScore(plain, plainFindings) })
  ) as Record<string, unknown>
  assert.equal('identity' in plainReport, false)
})

test('hostile input does not slow the profile down or throw', () => {
  const long = 'a'.repeat(50_000)
  const parsed = parseCollection(
    collection([
      { url: `https://${long}.okta.com/${'x/'.repeat(5000)}token`, method: 'POST', raw: `{"grant_type": "${long}"` },
      { url: '{{{{{{', form: [['grant_type', '{{']] },
      { url: `https://example.com/?${'a=b&'.repeat(5000)}` },
    ])
  )
  const started = Date.now()
  const profile = buildIdentityProfile(parsed)
  assert.ok(Date.now() - started < 2000)
  assert.ok(Array.isArray(profile.platforms))
})
