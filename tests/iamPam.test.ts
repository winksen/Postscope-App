import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCollection } from '../src/lib/parser'
import { runAudit, runAuditDetailed, type Finding } from '../src/lib/auditor'
import { grantsFullPermissions } from '../src/lib/iam/pam'

interface Req {
  name: string
  method?: string
  url: string
  headers?: Array<[string, string]>
  json?: unknown
  basic?: [string, string]
  responses?: Array<{ name: string; body: string }>
}

function build(requests: Req[]) {
  return {
    info: { name: 'PAM fixture', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    item: requests.map((request) => ({
      name: request.name,
      request: {
        method: request.method ?? 'GET',
        url: request.url,
        description: 'documented',
        header: (request.headers ?? []).map(([key, value]) => ({ key, value })),
        ...(request.json !== undefined ? { body: { mode: 'raw', raw: JSON.stringify(request.json) } } : {}),
        ...(request.basic
          ? {
              auth: {
                type: 'basic',
                basic: [
                  { key: 'username', value: request.basic[0] },
                  { key: 'password', value: request.basic[1] },
                ],
              },
            }
          : {}),
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

const PVWA = 'https://pvwa.acme-corp.com/PasswordVault/API'
const BEYOND = 'https://bt.acme-corp.com/BeyondTrust/api/public/v3'
const DELINEA = 'https://ss.acme-corp.com/SecretServer/api/v1'
const VAULT = 'https://vault.acme-corp.com:8200/v1'
/** A secret value for the saved examples, built at runtime. */
const SECRET = ['Fx', '-', 'retrieved', '-', 'Value', '9'].join('')
const VAULT_TOKEN = ['hvs', '.', 'B'.repeat(24)].join('')

test('retrieved secrets in saved examples are critical, for several vaults', () => {
  const { names, byRule } = audit([
    {
      name: 'CyberArk',
      method: 'POST',
      url: `${PVWA}/Accounts/{{id}}/Password/Retrieve`,
      json: { reason: 'x' },
      responses: [{ name: 'OK', body: JSON.stringify(SECRET) }],
    },
    {
      name: 'Vault v2',
      url: `${VAULT}/secret/data/app`,
      headers: [['X-Vault-Token', '{{vaultToken}}']],
      responses: [{ name: 'OK', body: JSON.stringify({ data: { data: { password: SECRET }, metadata: { version: 3 } } }) }],
    },
    {
      name: 'AWS',
      method: 'POST',
      url: 'https://secretsmanager.eu-west-1.amazonaws.com/',
      headers: [['X-Amz-Target', 'secretsmanager.GetSecretValue']],
      responses: [{ name: 'OK', body: JSON.stringify({ Name: 'app', SecretString: SECRET }) }],
    },
    {
      name: 'Azure',
      url: 'https://acme.vault.azure.net/secrets/app/{{version}}',
      responses: [{ name: 'OK', body: JSON.stringify({ value: SECRET, id: 'x' }) }],
    },
    { name: 'Delinea', url: `${DELINEA}/secrets/1/fields/password`, responses: [{ name: 'OK', body: SECRET }] },
    {
      name: 'Metadata only',
      url: `${VAULT}/secret/data/app`,
      responses: [{ name: 'OK', body: JSON.stringify({ data: { metadata: { version: 2 } } }) }],
    },
    {
      name: 'Placeholder',
      url: `${VAULT}/secret/data/app`,
      responses: [{ name: 'OK', body: JSON.stringify({ data: { data: { password: '{{password}}' } } }) }],
    },
    { name: 'No example', url: `${VAULT}/secret/data/app` },
  ])
  assert.equal(byRule.get('PAM_RETRIEVED_SECRET_CAPTURED')?.severity, 'critical')
  assert.deepEqual(names('PAM_RETRIEVED_SECRET_CAPTURED').sort(), ['Azure', 'AWS', 'CyberArk', 'Delinea', 'Vault v2'].sort())
  const text = JSON.stringify(byRule.get('PAM_RETRIEVED_SECRET_CAPTURED'))
  assert.ok(!text.includes(SECRET) && !text.includes('Fx-retrieved'), 'the secret is masked in evidence')
})

test('vault and PAM session tokens stored as literals are critical, variables are fine', () => {
  const { names, byRule } = audit([
    { name: 'Vault literal', url: `${VAULT}/sys/health`, headers: [['X-Vault-Token', VAULT_TOKEN]] },
    { name: 'Vault variable', url: `${VAULT}/sys/health`, headers: [['X-Vault-Token', '{{vaultToken}}']] },
    { name: 'BeyondTrust', url: `${BEYOND}/Requests`, headers: [['Authorization', 'PS-Auth key=0123456789abcdef0123; runas=svc;']] },
    {
      name: 'CyberArk logon token',
      url: `${PVWA}/Accounts`,
      headers: [['Authorization', 'NjQ2YjFlMTMtZmNiYy00ZjU4LWE5ZTMtMGY4YzJlNzE4OWYx']],
    },
    { name: 'CyberArk variable', url: `${PVWA}/Accounts`, headers: [['Authorization', '{{cyberarkToken}}']] },
    { name: 'Delinea bearer', url: `${DELINEA}/secrets/1`, headers: [['Authorization', 'Bearer ZXlKaGJHY2lPaUpJVXpJMU5pSjk5OTk5OTk5OQ']] },
    {
      name: 'Other API',
      url: 'https://api.acme-corp.com/items',
      headers: [['Authorization', 'NjQ2YjFlMTMtZmNiYy00ZjU4LWE5ZTMtMGY4YzJlNzE4OWYx']],
    },
  ])
  assert.equal(byRule.get('PAM_VAULT_TOKEN_LITERAL')?.severity, 'critical')
  assert.deepEqual(names('PAM_VAULT_TOKEN_LITERAL').sort(), ['BeyondTrust', 'CyberArk logon token', 'Delinea bearer', 'Vault literal'])
  const text = JSON.stringify(byRule.get('PAM_VAULT_TOKEN_LITERAL'))
  for (const secret of [VAULT_TOKEN, 'NjQ2YjFlMTMtZmNiYy00ZjU4', '0123456789abcdef0123'])
    assert.ok(!text.includes(secret), `evidence leaks ${secret}`)
})

test('Vault root tokens and root token generation are critical', () => {
  const { names, byRule } = audit([
    { name: 'Generate', method: 'POST', url: `${VAULT}/sys/generate-root/attempt` },
    { name: 'Root header', url: `${VAULT}/sys/health`, headers: [['X-Vault-Token', 'root']] },
    { name: 'My root', url: `${VAULT}/sys/health`, headers: [['X-Vault-Token', 'myroot']] },
    { name: 'Normal token', url: `${VAULT}/sys/health`, headers: [['X-Vault-Token', VAULT_TOKEN]] },
    { name: 'Status', url: `${VAULT}/sys/health` },
  ])
  assert.equal(byRule.get('PAM_ROOT_TOKEN_USAGE')?.severity, 'critical')
  assert.deepEqual(names('PAM_ROOT_TOKEN_USAGE').sort(), ['Generate', 'My root', 'Root header'])
})

test('retrievals and checkouts need a reason or ticket', () => {
  const { names } = audit([
    { name: 'CyberArk no reason', method: 'POST', url: `${PVWA}/Accounts/{{id}}/Password/Retrieve`, json: {} },
    { name: 'CyberArk reason', method: 'POST', url: `${PVWA}/Accounts/{{id}}/Password/Retrieve`, json: { reason: 'Incident 4711' } },
    {
      name: 'CyberArk ticket',
      method: 'POST',
      url: `${PVWA}/Accounts/{{id}}/Password/Retrieve`,
      json: { TicketingSystemName: 'SN', TicketId: 'INC1' },
    },
    { name: 'CyberArk empty reason', method: 'POST', url: `${PVWA}/Accounts/{{id}}/Password/Retrieve`, json: { reason: '' } },
    { name: 'Delinea no comment', url: `${DELINEA}/secrets/1/fields/password` },
    { name: 'Delinea comment', url: `${DELINEA}/secrets/1/fields/password?comment=INC1` },
    { name: 'BeyondTrust request no reason', method: 'POST', url: `${BEYOND}/Requests`, json: { SystemId: 1, AccountId: 2 } },
    {
      name: 'BeyondTrust request reason',
      method: 'POST',
      url: `${BEYOND}/Requests`,
      json: { SystemId: 1, AccountId: 2, Reason: 'INC1', DurationMinutes: 30 },
    },
    { name: 'BeyondTrust retrieve', url: `${BEYOND}/Credentials/{{requestId}}` },
    { name: 'Vault read', url: `${VAULT}/secret/data/app` },
  ])
  assert.deepEqual(names('PAM_RETRIEVAL_WITHOUT_REASON').sort(), [
    'BeyondTrust request no reason',
    'CyberArk empty reason',
    'CyberArk no reason',
    'Delinea no comment',
  ])
})

test('checkouts without a check-in are reported per platform', () => {
  const missing = audit([{ name: 'Checkout', method: 'POST', url: `${BEYOND}/Requests`, json: { Reason: 'x' } }])
  assert.equal(missing.byRule.get('PAM_CHECKOUT_WITHOUT_CHECKIN')?.severity, 'info')
  assert.match(missing.byRule.get('PAM_CHECKOUT_WITHOUT_CHECKIN')?.evidence?.[0].location ?? '', /BeyondTrust/)

  const covered = audit([
    { name: 'Checkout', method: 'POST', url: `${BEYOND}/Requests`, json: { Reason: 'x' } },
    { name: 'Checkin', method: 'PUT', url: `${BEYOND}/Requests/{{id}}/Checkin` },
  ])
  assert.ok(!covered.byRule.has('PAM_CHECKOUT_WITHOUT_CHECKIN'))

  const mixed = audit([
    { name: 'BT checkout', method: 'POST', url: `${BEYOND}/Requests`, json: { Reason: 'x' } },
    { name: 'BT checkin', method: 'PUT', url: `${BEYOND}/Requests/{{id}}/Checkin` },
    { name: 'Delinea checkout', method: 'POST', url: `${DELINEA}/secrets/1/check-out`, json: { comment: 'x' } },
  ])
  assert.equal(mixed.byRule.get('PAM_CHECKOUT_WITHOUT_CHECKIN')?.evidence?.length, 1)
  assert.match(mixed.byRule.get('PAM_CHECKOUT_WITHOUT_CHECKIN')?.evidence?.[0].location ?? '', /Delinea/)
})

test('built-in privileged and break-glass accounts used as literal logins are reported', () => {
  const { names, byRule } = audit([
    { name: 'Basic admin', url: `${PVWA}/Accounts`, basic: ['Administrator', '{{password}}'] },
    { name: 'Body root', method: 'POST', url: `${PVWA}/Auth/CyberArk/Logon`, json: { username: 'root', password: '{{password}}' } },
    { name: 'Break glass', method: 'POST', url: `${PVWA}/Auth/CyberArk/Logon`, json: { UserName: 'breakglass-01', Password: '{{p}}' } },
    { name: 'SQL sa', method: 'POST', url: `${PVWA}/Auth/LDAP/Logon`, json: { user: 'sa' } },
    { name: 'Named account', method: 'POST', url: `${PVWA}/Auth/CyberArk/Logon`, json: { username: 'jsmith' } },
    { name: 'Variable', method: 'POST', url: `${PVWA}/Auth/CyberArk/Logon`, json: { username: '{{pamUser}}' } },
  ])
  assert.deepEqual(names('PAM_PRIVILEGED_ACCOUNT_LITERAL').sort(), ['Basic admin', 'Body root', 'Break glass', 'SQL sa'])
  const previews = (byRule.get('PAM_PRIVILEGED_ACCOUNT_LITERAL')?.evidence ?? []).map((entry) => entry.preview).join('|')
  assert.match(previews, /break-glass account name/)
  assert.ok(!previews.includes('breakglass-01'))
})

test('safe, policy and permission changes are information, and full grants are a warning', () => {
  const some = audit([
    {
      name: 'Add member',
      method: 'POST',
      url: `${PVWA}/Safes/{{safe}}/Members`,
      json: { memberName: 'team', permissions: { useAccounts: true, listAccounts: true } },
    },
    { name: 'List members', url: `${PVWA}/Safes/{{safe}}/Members` },
    {
      name: 'Policy',
      method: 'PUT',
      url: `${VAULT}/sys/policies/acl/app`,
      json: { policy: 'path "secret/data/app/*" { capabilities = ["read"] }' },
    },
  ])
  assert.deepEqual(some.names('PAM_SAFE_ADMIN_CHANGE').sort(), ['Add member', 'Policy'])
  assert.equal(some.byRule.get('PAM_SAFE_ADMIN_CHANGE')?.severity, 'info')

  const full = audit([
    {
      name: 'Everything',
      method: 'POST',
      url: `${PVWA}/Safes/{{safe}}/Members`,
      json: {
        memberName: 'team',
        permissions: Object.fromEntries(
          [
            'useAccounts',
            'retrieveAccounts',
            'listAccounts',
            'addAccounts',
            'updateAccountContent',
            'updateAccountProperties',
            'initiateCPMAccountManagementOperations',
            'specifyNextAccountContent',
            'renameAccounts',
            'deleteAccounts',
          ].map((name) => [name, true])
        ),
      },
    },
  ])
  assert.equal(full.byRule.get('PAM_SAFE_ADMIN_CHANGE')?.severity, 'warning')

  const sudo = audit([
    {
      name: 'Sudo policy',
      method: 'PUT',
      url: `${VAULT}/sys/policies/acl/ops`,
      json: { policy: 'path "*" { capabilities = ["create", "read", "update", "delete", "list", "sudo"] }' },
    },
  ])
  assert.equal(sudo.byRule.get('PAM_SAFE_ADMIN_CHANGE')?.severity, 'warning')

  assert.equal(grantsFullPermissions('', { manageSafe: true, manageSafeMembers: true }), true)
  assert.equal(grantsFullPermissions('', { permission: 'Owner' }), true)
  assert.equal(grantsFullPermissions('', { useAccounts: true }), false)
})

test('PAM rules follow the iam-pam pack and use the identity category', () => {
  const raw = build([{ name: 'Vault literal', url: `${VAULT}/sys/health`, headers: [['X-Vault-Token', VAULT_TOKEN]] }])
  const on = runAuditDetailed(parseCollection(raw))
  assert.equal(on.findings.find((finding) => finding.ruleId === 'PAM_VAULT_TOKEN_LITERAL')?.category, 'identity')
  const off = runAuditDetailed(parseCollection(raw), { rulePacks: { disabled: ['iam-pam'] } })
  assert.ok(!off.findings.some((finding) => finding.ruleId === 'PAM_VAULT_TOKEN_LITERAL'))
  const amOff = runAuditDetailed(parseCollection(raw), { rulePacks: { disabled: ['iam-am'] } })
  assert.ok(
    amOff.findings.some((finding) => finding.ruleId === 'PAM_VAULT_TOKEN_LITERAL'),
    'packs switch independently'
  )
})
