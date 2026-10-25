import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parseCollection } from '../src/lib/parser'
import { runAudit, runAuditDetailed, type Finding } from '../src/lib/auditor'
import { buildIdentityProfile } from '../src/lib/iam/profile'
import { groupPrivileged, weakensMfa } from '../src/lib/iam/admin'
import { calculateScore } from '../src/lib/scorer'
import { buildJsonReport } from '../src/lib/reportExport'
import { validate } from './schema'

const schema = JSON.parse(fs.readFileSync(new URL('../docs/schemas/postscope-report.v2.schema.json', import.meta.url), 'utf8')) as Record<
  string,
  unknown
>

interface Req {
  name: string
  method?: string
  url: string
  json?: unknown
  form?: Array<[string, string]>
  responses?: Array<{ name: string; body: string }>
}

function build(requests: Req[]) {
  return {
    info: { name: 'Admin plane fixture', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    item: requests.map((request) => ({
      name: request.name,
      request: {
        method: request.method ?? 'GET',
        url: request.url,
        description: 'documented',
        header: [],
        ...(request.json !== undefined ? { body: { mode: 'raw', raw: JSON.stringify(request.json) } } : {}),
        ...(request.form ? { body: { mode: 'urlencoded', urlencoded: request.form.map(([key, value]) => ({ key, value })) } } : {}),
      },
      response: (request.responses ?? []).map((response) => ({
        name: response.name,
        originalRequest: { method: request.method ?? 'GET', url: request.url },
        code: 200,
        header: [],
        body: response.body,
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

const OKTA = 'https://acme.okta.com/api/v1'
const GRAPH = 'https://graph.microsoft.com/v1.0'
const KEYCLOAK = 'https://sso.acme-corp.com/admin/realms/main'
const AUTH0 = 'https://acme.eu.auth0.com/api/v2'
const GLOBAL_ADMIN = '62e90394-69f5-4237-9190-012177145e10'
const PRIVILEGED_ROLE_ADMIN = 'e8611ab8-c189-46e8-94e1-60213ab1f814'
const DIRECTORY_READERS = '88d8e3e3-8f55-4a1e-953a-9b9898b8876b'

test('literal top-tier role assignments are reported across platforms', () => {
  const { names, byRule } = audit([
    { name: 'Okta super admin', method: 'POST', url: `${OKTA}/users/{{id}}/roles`, json: { type: 'SUPER_ADMIN' } },
    { name: 'Okta org admin', method: 'POST', url: `${OKTA}/users/{{id}}/roles`, json: { type: 'ORG_ADMIN' } },
    { name: 'Okta helpdesk', method: 'POST', url: `${OKTA}/users/{{id}}/roles`, json: { type: 'HELP_DESK_ADMIN' } },
    { name: 'Okta variable', method: 'POST', url: `${OKTA}/users/{{id}}/roles`, json: { type: '{{roleType}}' } },
    {
      name: 'Entra global admin',
      method: 'POST',
      url: `${GRAPH}/roleManagement/directory/roleAssignments`,
      json: { principalId: '{{id}}', roleDefinitionId: GLOBAL_ADMIN, directoryScopeId: '/' },
    },
    {
      name: 'Entra privileged role admin',
      method: 'POST',
      url: `${GRAPH}/roleManagement/directory/roleAssignments`,
      json: { roleDefinitionId: PRIVILEGED_ROLE_ADMIN },
    },
    {
      name: 'Entra readers',
      method: 'POST',
      url: `${GRAPH}/roleManagement/directory/roleAssignments`,
      json: { roleDefinitionId: DIRECTORY_READERS },
    },
    {
      name: 'Entra variable',
      method: 'POST',
      url: `${GRAPH}/roleManagement/directory/roleAssignments`,
      json: { roleDefinitionId: '{{roleId}}' },
    },
    {
      name: 'Keycloak realm admin',
      method: 'POST',
      url: `${KEYCLOAK}/users/{{id}}/role-mappings/realm`,
      json: [{ id: '{{rid}}', name: 'realm-admin' }],
    },
    {
      name: 'Keycloak other',
      method: 'POST',
      url: `${KEYCLOAK}/users/{{id}}/role-mappings/realm`,
      json: [{ id: '{{rid}}', name: 'viewer' }],
    },
    {
      name: 'AWS admin',
      method: 'POST',
      url: 'https://iam.amazonaws.com/',
      form: [
        ['Action', 'AttachUserPolicy'],
        ['UserName', '{{user}}'],
        ['PolicyArn', 'arn:aws:iam::aws:policy/AdministratorAccess'],
      ],
    },
    {
      name: 'AWS read only',
      method: 'POST',
      url: 'https://iam.amazonaws.com/',
      form: [
        ['Action', 'AttachUserPolicy'],
        ['UserName', '{{user}}'],
        ['PolicyArn', 'arn:aws:iam::aws:policy/ReadOnlyAccess'],
      ],
    },
    {
      name: 'Azure owner',
      method: 'PUT',
      url: 'https://management.azure.com/subscriptions/{{sub}}/providers/Microsoft.Authorization/roleAssignments/{{guid}}',
      json: {
        properties: {
          roleDefinitionId: '/subscriptions/{{sub}}/providers/Microsoft.Authorization/roleDefinitions/8e3af657-a8ff-443c-a75c-2fe8c4bcb635',
          principalId: '{{id}}',
        },
      },
    },
    { name: 'Listing', method: 'GET', url: `${OKTA}/users/{{id}}/roles` },
  ])
  assert.equal(byRule.get('PRIVILEGED_ROLE_ASSIGNMENT')?.severity, 'warning')
  assert.deepEqual(names('PRIVILEGED_ROLE_ASSIGNMENT').sort(), [
    'AWS admin',
    'Azure owner',
    'Entra global admin',
    'Entra privileged role admin',
    'Keycloak realm admin',
    'Okta org admin',
    'Okta super admin',
  ])
  const previews = (byRule.get('PRIVILEGED_ROLE_ASSIGNMENT')?.evidence ?? []).map((entry) => entry.preview).join('|')
  assert.match(previews, /Okta SUPER_ADMIN/)
  assert.match(previews, /Entra Global Administrator/)
  assert.match(previews, /AWS AdministratorAccess/)
})

test('policy bodies that weaken multi-factor authentication are reported', () => {
  assert.ok(weakensMfa({ actions: { signon: { requireFactor: false } } }))
  assert.ok(
    weakensMfa({ displayName: 'x', state: 'disabled', grantControls: { operator: 'OR', builtInControls: ['mfa'] }, conditions: {} })
  )
  assert.ok(weakensMfa({ conditions: { users: { includeUsers: ['All'], excludeUsers: ['All'] } } }))
  assert.ok(weakensMfa({ conditions: { users: { excludeGroups: ['all'] } } }))
  assert.ok(weakensMfa({ type: 'MFA_ENROLL', status: 'INACTIVE', name: 'MFA policy' }))
  assert.ok(weakensMfa({ enforcement: 'none' }))
  assert.ok(weakensMfa({ alias: 'otp', requirement: 'DISABLED' }))
  assert.equal(weakensMfa({ state: 'enabled', grantControls: { operator: 'AND', builtInControls: ['mfa'] }, conditions: {} }), null)
  assert.equal(weakensMfa({ requireFactor: true }), null)
  assert.equal(weakensMfa({ name: 'x', enabled: false }), null, 'a disabled flag on something that is not a factor does not count')
  assert.equal(weakensMfa(null), null)

  const { names, byRule } = audit([
    {
      name: 'Okta rule',
      method: 'PUT',
      url: `${OKTA}/policies/{{pid}}/rules/{{rid}}`,
      json: { name: 'rule', actions: { signon: { requireFactor: false } } },
    },
    {
      name: 'Entra disabled',
      method: 'PATCH',
      url: `${GRAPH}/identity/conditionalAccess/policies/{{id}}`,
      json: { state: 'disabled', grantControls: { operator: 'OR', builtInControls: ['mfa'] } },
    },
    {
      name: 'Entra exclude all',
      method: 'PATCH',
      url: `${GRAPH}/identity/conditionalAccess/policies/{{id}}`,
      json: { conditions: { users: { excludeUsers: ['All'] } } },
    },
    {
      name: 'Entra enabled',
      method: 'PATCH',
      url: `${GRAPH}/identity/conditionalAccess/policies/{{id}}`,
      json: { state: 'enabled', grantControls: { operator: 'AND', builtInControls: ['mfa'] } },
    },
    { name: 'Entra read', url: `${GRAPH}/identity/conditionalAccess/policies` },
    { name: 'Auth0 never', method: 'PUT', url: `${AUTH0}/guardian/policies`, json: [] },
    { name: 'Auth0 all applications', method: 'PUT', url: `${AUTH0}/guardian/policies`, json: ['all-applications'] },
    {
      name: 'Keycloak OTP',
      method: 'PUT',
      url: `${KEYCLOAK}/authentication/flows/browser/executions`,
      json: { alias: 'otp', requirement: 'DISABLED' },
    },
  ])
  assert.deepEqual(names('MFA_POLICY_WEAKENING').sort(), [
    'Auth0 never',
    'Entra disabled',
    'Entra exclude all',
    'Keycloak OTP',
    'Okta rule',
  ])
  assert.equal(byRule.get('MFA_POLICY_WEAKENING')?.severity, 'warning')
})

test('credential creating endpoints are information, and a saved response makes them a warning', () => {
  const noExample = audit([
    {
      name: 'Entra secret',
      method: 'POST',
      url: `${GRAPH}/applications/{{id}}/addPassword`,
      json: { passwordCredential: { displayName: 'ci' } },
    },
    { name: 'Keycloak secret', method: 'POST', url: `${KEYCLOAK}/clients/{{id}}/client-secret` },
    {
      name: 'AWS key',
      method: 'POST',
      url: 'https://iam.amazonaws.com/',
      form: [
        ['Action', 'CreateAccessKey'],
        ['UserName', '{{u}}'],
      ],
    },
    { name: 'GCP key', method: 'POST', url: 'https://iam.googleapis.com/v1/projects/p/serviceAccounts/{{sa}}/keys' },
    { name: 'Okta token', method: 'POST', url: `${OKTA}/api-tokens` },
    { name: 'Listing', url: `${GRAPH}/applications` },
  ])
  assert.deepEqual(noExample.names('CREDENTIAL_MINTING_ENDPOINT').sort(), [
    'AWS key',
    'Entra secret',
    'GCP key',
    'Keycloak secret',
    'Okta token',
  ])
  assert.equal(noExample.byRule.get('CREDENTIAL_MINTING_ENDPOINT')?.severity, 'info')

  const withExample = audit([
    {
      name: 'Entra secret',
      method: 'POST',
      url: `${GRAPH}/applications/{{id}}/addPassword`,
      json: {},
      responses: [{ name: 'OK', body: JSON.stringify({ keyId: 'k', secretText: 'x'.repeat(12) }) }],
    },
  ])
  assert.equal(withExample.byRule.get('CREDENTIAL_MINTING_ENDPOINT')?.severity, 'warning')
})

test('the privileged operations inventory is grouped by platform with danger zone marks', () => {
  const parsed = parseCollection(
    build([
      { name: 'Grant', method: 'POST', url: `${OKTA}/users/{{id}}/roles`, json: { type: 'SUPER_ADMIN' } },
      { name: 'List roles', method: 'GET', url: `${OKTA}/users/{{id}}/roles` },
      { name: 'Policy', method: 'PUT', url: `${OKTA}/policies/{{pid}}`, json: { name: 'p' } },
      { name: 'Mint', method: 'POST', url: `${GRAPH}/applications/{{id}}/addPassword`, json: {} },
      {
        name: 'Retrieve',
        method: 'POST',
        url: 'https://pvwa.acme-corp.com/PasswordVault/API/Accounts/{{id}}/Password/Retrieve',
        json: { reason: 'x' },
      },
      { name: 'Vault write', method: 'POST', url: 'https://vault.acme-corp.com:8200/v1/secret/data/app', json: { data: { a: '{{v}}' } } },
      { name: 'Users', method: 'GET', url: `${OKTA}/users` },
    ])
  )
  const { privileged } = buildIdentityProfile(parsed)
  assert.deepEqual(privileged.map((entry) => entry.kind).sort(), [
    'credential-mint',
    'policy-change',
    'role-assignment',
    'role-assignment',
    'secret-retrieval',
    'secret-write',
  ])
  const grant = privileged.find((entry) => entry.requestId === 'Grant')!
  assert.equal(grant.danger, true)
  assert.equal(grant.topTier, 'Okta SUPER_ADMIN')
  assert.equal(privileged.find((entry) => entry.requestId === 'List roles')?.danger, false)
  assert.equal(privileged.find((entry) => entry.requestId === 'Retrieve')?.danger, true)

  const groups = groupPrivileged(privileged)
  assert.equal(groups[0].platform, 'okta')
  assert.equal(groups[0].dangerCount, 2)
  assert.equal(groups[0].operations[0].danger, true, 'danger zone entries come first')
  assert.deepEqual(groups.map((group) => group.platform).sort(), ['cyberark', 'entra', 'okta', 'vault'])
})

test('the JSON report lists privileged operations and stays schema-valid', () => {
  const parsed = parseCollection(
    build([{ name: 'Grant', method: 'POST', url: `${OKTA}/users/{{id}}/roles`, json: { type: 'SUPER_ADMIN' } }])
  )
  const findings = runAudit(parsed)
  const report = JSON.parse(buildJsonReport({ parsed, findings, score: calculateScore(parsed, findings) })) as {
    identity?: { privileged: Array<{ platform: string; dangerCount: number; operations: Array<{ topTier?: string }> }> }
  }
  assert.deepEqual(validate(schema, report), [])
  assert.equal(report.identity?.privileged[0].platform, 'okta')
  assert.equal(report.identity?.privileged[0].operations[0].topTier, 'Okta SUPER_ADMIN')
})

test('admin plane rules follow the iam-pam pack', () => {
  const raw = build([{ name: 'Grant', method: 'POST', url: `${OKTA}/users/{{id}}/roles`, json: { type: 'SUPER_ADMIN' } }])
  const on = runAuditDetailed(parseCollection(raw))
  assert.equal(on.findings.find((finding) => finding.ruleId === 'PRIVILEGED_ROLE_ASSIGNMENT')?.category, 'identity')
  const off = runAuditDetailed(parseCollection(raw), { rulePacks: { disabled: ['iam-pam'] } })
  assert.ok(!off.findings.some((finding) => finding.ruleId === 'PRIVILEGED_ROLE_ASSIGNMENT'))
})
