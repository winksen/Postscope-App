import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parseCollection } from '../src/lib/parser'
import { runAudit, runAuditDetailed, type Finding } from '../src/lib/auditor'
import { buildIdentityProfile } from '../src/lib/iam/profile'
import { bodyDisablesAccount, buildLifecycleMatrix } from '../src/lib/iam/lifecycle'
import { calculateScore } from '../src/lib/scorer'
import { buildJsonReport } from '../src/lib/reportExport'
import { validate } from './schema'

const schema = JSON.parse(fs.readFileSync(new URL('../docs/schemas/postscope-report.v2.schema.json', import.meta.url), 'utf8')) as Record<
  string,
  unknown
>

interface Req {
  name: string
  method: string
  url: string
  json?: unknown
  folder?: string[]
}

const URN_PATCH = 'urn:ietf:params:scim:api:messages:2.0:PatchOp'

function build(requests: Req[]) {
  type Item = { name: string; item?: Item[]; request?: unknown }
  const root: Item[] = []
  for (const request of requests) {
    let level = root
    for (const folder of request.folder ?? []) {
      let next = level.find((entry) => entry.name === folder && entry.item)
      if (!next) {
        next = { name: folder, item: [] }
        level.push(next)
      }
      level = next.item!
    }
    level.push({
      name: request.name,
      request: {
        method: request.method,
        url: request.url,
        description: 'documented',
        header: [{ key: 'Content-Type', value: 'application/scim+json' }],
        ...(request.json !== undefined ? { body: { mode: 'raw', raw: JSON.stringify(request.json) } } : {}),
      },
    })
  }
  return { info: { name: 'JML fixture', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, item: root }
}

function profileOf(requests: Req[]) {
  return buildIdentityProfile(parseCollection(build(requests)))
}

function stageOf(request: Omit<Req, 'name'>): string {
  const profile = profileOf([{ name: 'r', ...request }])
  const entry = profile.lifecycle[0]
  return entry ? `${entry.stage}:${entry.action}` : 'none'
}

const OKTA = 'https://acme.okta.com'
const ENTRA = 'https://graph.microsoft.com/v1.0'
const KEYCLOAK = 'https://sso.acme-corp.com/admin/realms/main'
const AUTH0 = 'https://acme.eu.auth0.com/api/v2'
const SCIM = 'https://scim.acme-corp.com/scim/v2'

test('requests are classified as joiner, mover or leaver per platform', () => {
  const table: Array<[Omit<Req, 'name'>, string]> = [
    [{ method: 'POST', url: `${SCIM}/Users` }, 'joiner:create'],
    [
      {
        method: 'PATCH',
        url: `${SCIM}/Users/{{id}}`,
        json: { schemas: [URN_PATCH], Operations: [{ op: 'replace', path: 'active', value: false }] },
      },
      'leaver:disable',
    ],
    [
      {
        method: 'PATCH',
        url: `${SCIM}/Users/{{id}}`,
        json: { schemas: [URN_PATCH], Operations: [{ op: 'replace', path: 'displayName', value: 'x' }] },
      },
      'mover:attribute-update',
    ],
    [{ method: 'PUT', url: `${SCIM}/Users/{{id}}`, json: { userName: 'a', active: false } }, 'leaver:disable'],
    [{ method: 'DELETE', url: `${SCIM}/Users/{{id}}` }, 'leaver:delete'],
    [{ method: 'PATCH', url: `${SCIM}/Groups/{{id}}`, json: { schemas: [URN_PATCH], Operations: [] } }, 'mover:group-change'],
    [{ method: 'GET', url: `${SCIM}/Users/{{id}}` }, 'none'],
    [{ method: 'POST', url: `${OKTA}/api/v1/users?activate=false` }, 'joiner:create'],
    [{ method: 'POST', url: `${OKTA}/api/v1/users/{{id}}/lifecycle/deactivate` }, 'leaver:disable'],
    [{ method: 'POST', url: `${OKTA}/api/v1/users/{{id}}/lifecycle/suspend` }, 'leaver:disable'],
    [{ method: 'DELETE', url: `${OKTA}/api/v1/users/{{id}}/sessions` }, 'leaver:revoke'],
    [{ method: 'DELETE', url: `${OKTA}/api/v1/users/{{id}}` }, 'leaver:delete'],
    [{ method: 'PUT', url: `${OKTA}/api/v1/groups/{{g}}/users/{{u}}` }, 'mover:group-change'],
    [{ method: 'DELETE', url: `${OKTA}/api/v1/groups/{{g}}/users/{{u}}` }, 'leaver:remove-access'],
    [{ method: 'POST', url: `${OKTA}/api/v1/users/{{id}}/roles` }, 'mover:role-change'],
    [{ method: 'DELETE', url: `${OKTA}/api/v1/users/{{id}}/roles/{{r}}` }, 'leaver:remove-access'],
    [{ method: 'POST', url: `${ENTRA}/users` }, 'joiner:create'],
    [{ method: 'PATCH', url: `${ENTRA}/users/{{id}}`, json: { accountEnabled: false } }, 'leaver:disable'],
    [{ method: 'PATCH', url: `${ENTRA}/users/{{id}}`, json: { jobTitle: 'x' } }, 'mover:attribute-update'],
    [{ method: 'POST', url: `${ENTRA}/users/{{id}}/revokeSignInSessions` }, 'leaver:revoke'],
    [{ method: 'DELETE', url: `${ENTRA}/users/{{id}}` }, 'leaver:delete'],
    [{ method: 'POST', url: `${KEYCLOAK}/users` }, 'joiner:create'],
    [{ method: 'PUT', url: `${KEYCLOAK}/users/{{id}}`, json: { enabled: false } }, 'leaver:disable'],
    [{ method: 'POST', url: `${KEYCLOAK}/users/{{id}}/logout` }, 'leaver:revoke'],
    [{ method: 'DELETE', url: `${KEYCLOAK}/users/{{id}}` }, 'leaver:delete'],
    [{ method: 'PUT', url: `${KEYCLOAK}/users/{{id}}/groups/{{g}}` }, 'mover:group-change'],
    [{ method: 'POST', url: `${AUTH0}/users` }, 'joiner:create'],
    [{ method: 'PATCH', url: `${AUTH0}/users/{{id}}`, json: { blocked: true } }, 'leaver:disable'],
    [{ method: 'DELETE', url: `${AUTH0}/users/{{id}}` }, 'leaver:delete'],
    [{ method: 'POST', url: 'https://acme.saviyntcloud.com/ECM/api/v5/createUser' }, 'joiner:create'],
    [{ method: 'DELETE', url: 'https://api.acme-corp.com/users/{{id}}' }, 'none'],
    [{ method: 'POST', url: 'https://api.acme-corp.com/users' }, 'none'],
  ]
  for (const [request, expected] of table) assert.equal(stageOf(request), expected, `${request.method} ${request.url}`)
})

test('account switching off is recognized in several body shapes', () => {
  assert.equal(bodyDisablesAccount({ active: false }), true)
  assert.equal(bodyDisablesAccount({ accountEnabled: false }), true)
  assert.equal(bodyDisablesAccount({ enabled: false }), true)
  assert.equal(bodyDisablesAccount({ blocked: true }), true)
  assert.equal(bodyDisablesAccount({ status: 'SUSPENDED' }), true)
  assert.equal(bodyDisablesAccount({ Operations: [{ op: 'replace', path: 'active', value: false }] }), true)
  assert.equal(
    bodyDisablesAccount({ Operations: [{ op: 'replace', path: 'urn:ietf:params:scim:schemas:core:2.0:User:active', value: false }] }),
    true
  )
  assert.equal(bodyDisablesAccount({ active: true }), false)
  assert.equal(bodyDisablesAccount({ Operations: [{ op: 'replace', path: 'active', value: true }] }), false)
  assert.equal(bodyDisablesAccount(null), false)
  assert.equal(bodyDisablesAccount('active'), false)
})

test('the coverage map counts requests per platform', () => {
  const profile = profileOf([
    { name: 'Create', method: 'POST', url: `${OKTA}/api/v1/users` },
    { name: 'Create 2', method: 'POST', url: `${OKTA}/api/v1/users` },
    { name: 'Update', method: 'POST', url: `${OKTA}/api/v1/users/{{id}}` },
    { name: 'Deactivate', method: 'POST', url: `${OKTA}/api/v1/users/{{id}}/lifecycle/deactivate` },
    { name: 'Sessions', method: 'DELETE', url: `${OKTA}/api/v1/users/{{id}}/sessions` },
    { name: 'Delete', method: 'DELETE', url: `${OKTA}/api/v1/users/{{id}}` },
    { name: 'Entra create', method: 'POST', url: `${ENTRA}/users` },
  ])
  const matrix = buildLifecycleMatrix(profile.lifecycle)
  assert.deepEqual(
    matrix.find((row) => row.platform === 'okta'),
    { platform: 'okta', joiner: 2, mover: 1, disable: 1, removeAccess: 0, revoke: 1, delete: 1 }
  )
  assert.deepEqual(
    matrix.find((row) => row.platform === 'entra'),
    { platform: 'entra', joiner: 1, mover: 0, disable: 0, removeAccess: 0, revoke: 0, delete: 0 }
  )
})

function audit(requests: Req[]) {
  const parsed = parseCollection(build(requests))
  const findings = runAudit(parsed)
  const byRule = new Map<string, Finding>(findings.map((finding) => [finding.ruleId, finding]))
  const names = (ruleId: string) =>
    (byRule.get(ruleId)?.affected ?? []).map((id) => parsed.requests.find((request) => request.id === id)?.name ?? id)
  return { parsed, findings, byRule, names }
}

test('joiner requests without any disable are reported per platform', () => {
  const missing = audit([{ name: 'Create', method: 'POST', url: `${OKTA}/api/v1/users` }])
  const finding = missing.byRule.get('JML_LEAVER_NOT_COVERED')!
  assert.equal(finding.severity, 'info')
  assert.equal(finding.category, 'identity')
  assert.match(finding.evidence?.[0].location ?? '', /okta/)

  const covered = audit([
    { name: 'Create', method: 'POST', url: `${OKTA}/api/v1/users` },
    { name: 'Deactivate', method: 'POST', url: `${OKTA}/api/v1/users/{{id}}/lifecycle/deactivate` },
  ])
  assert.ok(!covered.byRule.has('JML_LEAVER_NOT_COVERED'))

  const perPlatform = audit([
    { name: 'Okta create', method: 'POST', url: `${OKTA}/api/v1/users` },
    { name: 'Entra create', method: 'POST', url: `${ENTRA}/users` },
    { name: 'Entra disable', method: 'PATCH', url: `${ENTRA}/users/{{id}}`, json: { accountEnabled: false } },
  ])
  assert.equal(perPlatform.byRule.get('JML_LEAVER_NOT_COVERED')?.evidence?.length, 1)
  assert.match(perPlatform.byRule.get('JML_LEAVER_NOT_COVERED')?.evidence?.[0].location ?? '', /okta/)

  const scimOnly = audit([
    {
      name: 'Create',
      method: 'POST',
      url: `${SCIM}/Users`,
      json: { schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], userName: 'a' },
    },
  ])
  assert.match(scimOnly.byRule.get('JML_LEAVER_NOT_COVERED')?.evidence?.[0].location ?? '', /provisioning target|scim/i)

  const noJoiners = audit([{ name: 'Deactivate', method: 'POST', url: `${OKTA}/api/v1/users/{{id}}/lifecycle/deactivate` }])
  assert.ok(!noJoiners.byRule.has('JML_LEAVER_NOT_COVERED'), 'nothing is created, so nothing needs a leaver step')
})

test('a hard delete needs a disable earlier in the same folder or its sibling phase', () => {
  const del = (name: string, folder?: string[]): Req => ({ name, method: 'DELETE', url: `${OKTA}/api/v1/users/{{id}}`, folder })
  const disable = (name: string, folder?: string[]): Req => ({
    name,
    method: 'POST',
    url: `${OKTA}/api/v1/users/{{id}}/lifecycle/deactivate`,
    folder,
  })

  assert.deepEqual(audit([del('Delete')]).names('LEAVER_DELETE_WITHOUT_DISABLE'), ['Delete'])
  assert.deepEqual(audit([disable('Disable'), del('Delete')]).names('LEAVER_DELETE_WITHOUT_DISABLE'), [])
  assert.deepEqual(
    audit([del('Delete'), disable('Disable')]).names('LEAVER_DELETE_WITHOUT_DISABLE'),
    ['Delete'],
    'a disable after the delete does not help'
  )
  assert.deepEqual(audit([disable('Disable', ['Leaver']), del('Delete', ['Leaver'])]).names('LEAVER_DELETE_WITHOUT_DISABLE'), [])
  assert.deepEqual(
    audit([disable('Disable', ['Leaver', 'Step 1']), del('Delete', ['Leaver', 'Step 2'])]).names('LEAVER_DELETE_WITHOUT_DISABLE'),
    [],
    'sibling folders under one phase count as one sequence'
  )
  assert.deepEqual(
    audit([disable('Disable', ['Cleanup A', 'Step']), del('Delete', ['Cleanup B', 'Step'])]).names('LEAVER_DELETE_WITHOUT_DISABLE'),
    ['Delete'],
    'folders of different branches do not'
  )
})

test('a disable needs a session or token revocation for the same platform', () => {
  const disable: Req = { name: 'Deactivate', method: 'POST', url: `${OKTA}/api/v1/users/{{id}}/lifecycle/deactivate` }
  assert.deepEqual(audit([disable]).names('LEAVER_SESSION_NOT_REVOKED'), ['Deactivate'])
  assert.deepEqual(
    audit([disable, { name: 'Sessions', method: 'DELETE', url: `${OKTA}/api/v1/users/{{id}}/sessions` }]).names(
      'LEAVER_SESSION_NOT_REVOKED'
    ),
    []
  )
  assert.deepEqual(
    audit([disable, { name: 'Revoke', method: 'POST', url: `${OKTA}/oauth2/default/v1/revoke` }]).names('LEAVER_SESSION_NOT_REVOKED'),
    []
  )
  assert.deepEqual(
    audit([disable, { name: 'Entra sessions', method: 'POST', url: `${ENTRA}/users/{{id}}/revokeSignInSessions` }]).names(
      'LEAVER_SESSION_NOT_REVOKED'
    ),
    ['Deactivate'],
    'a revocation on another platform does not cover this one'
  )
})

test('the lifecycle section of the JSON report is valid and rules follow the pack', () => {
  const raw = build([
    { name: 'Create', method: 'POST', url: `${OKTA}/api/v1/users` },
    { name: 'Delete', method: 'DELETE', url: `${OKTA}/api/v1/users/{{id}}` },
  ])
  const parsed = parseCollection(raw)
  const findings = runAudit(parsed)
  const report = JSON.parse(buildJsonReport({ parsed, findings, score: calculateScore(parsed, findings) })) as {
    identity?: { lifecycle: unknown[] }
  }
  assert.deepEqual(validate(schema, report), [])
  assert.equal(report.identity?.lifecycle.length, 1)
  const off = runAuditDetailed(parseCollection(raw), { rulePacks: { disabled: ['iam-iga'] } })
  assert.ok(
    !off.findings.some((finding) =>
      ['JML_LEAVER_NOT_COVERED', 'LEAVER_DELETE_WITHOUT_DISABLE', 'LEAVER_SESSION_NOT_REVOKED'].includes(finding.ruleId)
    )
  )
})
