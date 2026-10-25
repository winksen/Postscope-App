import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parseCollection } from '../src/lib/parser'
import { runAudit, runAuditDetailed, type Finding } from '../src/lib/auditor'
import { buildIdentityProfile } from '../src/lib/iam/profile'
import { calculateScore } from '../src/lib/scorer'
import { buildJsonReport } from '../src/lib/reportExport'
import { validate } from './schema'

const schema = JSON.parse(fs.readFileSync(new URL('../docs/schemas/postscope-report.v2.schema.json', import.meta.url), 'utf8')) as Record<
  string,
  unknown
>

const URN_USER = 'urn:ietf:params:scim:schemas:core:2.0:User'
const URN_GROUP = 'urn:ietf:params:scim:schemas:core:2.0:Group'
const URN_PATCH = 'urn:ietf:params:scim:api:messages:2.0:PatchOp'
const URN_BULK = 'urn:ietf:params:scim:api:messages:2.0:BulkRequest'
const BASE = 'https://scim.acme-corp.com/scim/v2'

interface Req {
  name: string
  method?: string
  url: string
  json?: unknown
  raw?: string
  contentType?: string | null
}

function build(requests: Req[]) {
  return {
    info: { name: 'SCIM fixture', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    variable: [{ key: 'scimBase', value: BASE }],
    item: requests.map((request) => {
      const body = request.raw ?? (request.json !== undefined ? JSON.stringify(request.json) : undefined)
      const contentType = request.contentType === undefined ? 'application/scim+json' : request.contentType
      return {
        name: request.name,
        request: {
          method: request.method ?? 'GET',
          url: request.url,
          description: 'documented',
          header: contentType ? [{ key: 'Content-Type', value: contentType }] : [],
          ...(body ? { body: { mode: 'raw', raw: body } } : {}),
        },
      }
    }),
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

const patch = (operations: unknown[]) => ({ schemas: [URN_PATCH], Operations: operations })

test('destructive and unguarded bulk operations are reported', () => {
  const ops = (count: number, method = 'POST') =>
    Array.from({ length: count }, (_, index) => ({
      method,
      path: '/Users',
      bulkId: `b${index}`,
      data: { schemas: [URN_USER], userName: `u${index}` },
    }))
  const { names, byRule } = audit([
    {
      name: 'Deletes',
      method: 'POST',
      url: '{{scimBase}}/Bulk',
      json: { schemas: [URN_BULK], Operations: [...ops(2), { method: 'DELETE', path: '/Users/1' }] },
    },
    { name: 'Large no guard', method: 'POST', url: '{{scimBase}}/Bulk', json: { schemas: [URN_BULK], Operations: ops(25) } },
    {
      name: 'Large guarded',
      method: 'POST',
      url: '{{scimBase}}/Bulk',
      json: { schemas: [URN_BULK], failOnErrors: 1, Operations: ops(25) },
    },
    { name: 'Small', method: 'POST', url: '{{scimBase}}/Bulk', json: { schemas: [URN_BULK], Operations: ops(3) } },
  ])
  assert.deepEqual(names('SCIM_BULK_DESTRUCTIVE').sort(), ['Deletes', 'Large no guard'])
  assert.equal(byRule.get('SCIM_BULK_DESTRUCTIVE')?.severity, 'warning')
  const previews = (byRule.get('SCIM_BULK_DESTRUCTIVE')?.evidence ?? []).map((entry) => entry.preview).join('|')
  assert.match(previews, /1 DELETE of 3 operations/)
  assert.match(previews, /25 operations without failOnErrors/)
})

test('listing all users or groups without a filter or paging is reported', () => {
  const { names } = audit([
    { name: 'All users', url: '{{scimBase}}/Users' },
    { name: 'All groups', url: '{{scimBase}}/Groups' },
    { name: 'Filtered', url: '{{scimBase}}/Users?filter=userName%20eq%20%22jane%22' },
    { name: 'Counted', url: '{{scimBase}}/Users?count=50&startIndex=1' },
    { name: 'One user', url: '{{scimBase}}/Users/{{userId}}' },
    { name: 'Create', method: 'POST', url: '{{scimBase}}/Users', json: { schemas: [URN_USER], userName: 'x' } },
  ])
  assert.deepEqual(names('SCIM_UNBOUNDED_LIST').sort(), ['All groups', 'All users'])
})

test('privilege changing PATCH operations are info, and a literal admin value makes them a warning', () => {
  const info = audit([
    {
      name: 'Members',
      method: 'PATCH',
      url: '{{scimBase}}/Groups/{{id}}',
      json: patch([{ op: 'add', path: 'members', value: [{ value: '{{userId}}' }] }]),
    },
    {
      name: 'Deactivate',
      method: 'PATCH',
      url: '{{scimBase}}/Users/{{id}}',
      json: patch([{ op: 'replace', path: 'active', value: false }]),
    },
    {
      name: 'Display name',
      method: 'PATCH',
      url: '{{scimBase}}/Users/{{id}}',
      json: patch([{ op: 'replace', path: 'displayName', value: 'Jane' }]),
    },
    {
      name: 'Filter path',
      method: 'PATCH',
      url: '{{scimBase}}/Groups/{{id}}',
      json: patch([{ op: 'remove', path: 'members[value eq "{{userId}}"]' }]),
    },
    {
      name: 'Value object',
      method: 'PATCH',
      url: '{{scimBase}}/Users/{{id}}',
      json: patch([{ op: 'add', value: { roles: [{ value: '{{role}}' }] } }]),
    },
  ])
  assert.deepEqual(info.names('SCIM_PRIVILEGE_PATCH').sort(), ['Deactivate', 'Filter path', 'Members', 'Value object'])
  assert.equal(info.byRule.get('SCIM_PRIVILEGE_PATCH')?.severity, 'info')

  const admin = audit([
    {
      name: 'Grant admin',
      method: 'PATCH',
      url: '{{scimBase}}/Users/{{id}}',
      json: patch([{ op: 'add', path: 'roles', value: [{ value: 'Domain Admins' }] }]),
    },
    {
      name: 'Members',
      method: 'PATCH',
      url: '{{scimBase}}/Groups/{{id}}',
      json: patch([{ op: 'add', path: 'members', value: [{ value: '{{userId}}' }] }]),
    },
  ])
  assert.equal(admin.byRule.get('SCIM_PRIVILEGE_PATCH')?.severity, 'warning')
  const text = JSON.stringify(admin.byRule.get('SCIM_PRIVILEGE_PATCH'))
  assert.ok(!text.includes('Domain Admins'), 'the value itself is not copied into the finding')
  assert.match(text, /literal admin value/)

  const removeAdmin = audit([
    {
      name: 'Revoke',
      method: 'PATCH',
      url: '{{scimBase}}/Users/{{id}}',
      json: patch([{ op: 'remove', path: 'roles', value: [{ value: 'Admin' }] }]),
    },
  ])
  assert.equal(removeAdmin.byRule.get('SCIM_PRIVILEGE_PATCH')?.severity, 'info', 'removing an admin role is not a grant')

  const overridden = runAuditDetailed(
    parseCollection(
      build([
        { name: 'Members', method: 'PATCH', url: '{{scimBase}}/Groups/{{id}}', json: patch([{ op: 'add', path: 'members', value: [] }]) },
      ])
    ),
    {
      severityOverrides: { SCIM_PRIVILEGE_PATCH: 'critical' },
    }
  )
  assert.equal(overridden.findings.find((finding) => finding.ruleId === 'SCIM_PRIVILEGE_PATCH')?.severity, 'critical')
})

test('SCIM requests with a body need application/scim+json', () => {
  const user = { schemas: [URN_USER], userName: 'jane' }
  const { names, byRule } = audit([
    { name: 'Json', method: 'POST', url: '{{scimBase}}/Users', json: user, contentType: 'application/json' },
    { name: 'Missing', method: 'POST', url: '{{scimBase}}/Users', json: user, contentType: null },
    { name: 'Correct', method: 'POST', url: '{{scimBase}}/Users', json: user, contentType: 'application/scim+json; charset=utf-8' },
    { name: 'Get', url: '{{scimBase}}/Users/{{id}}', contentType: null },
    { name: 'Other API', method: 'POST', url: 'https://api.acme-corp.com/users', json: user, contentType: 'application/json' },
  ])
  assert.deepEqual(names('SCIM_CONTENT_TYPE').sort(), ['Json', 'Missing'])
  const previews = (byRule.get('SCIM_CONTENT_TYPE')?.evidence ?? []).map((entry) => entry.preview).sort()
  assert.deepEqual(previews, ['application/json', 'not set'])
})

test('bodies need the core schema URN of the resource or message', () => {
  const { names } = audit([
    { name: 'User ok', method: 'POST', url: '{{scimBase}}/Users', json: { schemas: [URN_USER], userName: 'a' } },
    { name: 'User no schemas', method: 'POST', url: '{{scimBase}}/Users', json: { userName: 'a' } },
    { name: 'User wrong URN', method: 'PUT', url: '{{scimBase}}/Users/{{id}}', json: { schemas: [URN_GROUP], userName: 'a' } },
    { name: 'Group ok', method: 'POST', url: '{{scimBase}}/Groups', json: { schemas: [URN_GROUP.toLowerCase()], displayName: 'g' } },
    {
      name: 'Patch no urn',
      method: 'PATCH',
      url: '{{scimBase}}/Users/{{id}}',
      json: { Operations: [{ op: 'replace', path: 'displayName', value: 'x' }] },
    },
    {
      name: 'Patch ok',
      method: 'PATCH',
      url: '{{scimBase}}/Users/{{id}}',
      json: patch([{ op: 'replace', path: 'displayName', value: 'x' }]),
    },
    { name: 'Bulk no urn', method: 'POST', url: '{{scimBase}}/Bulk', json: { Operations: [] } },
    {
      name: 'Templated',
      method: 'POST',
      url: '{{scimBase}}/Users',
      raw: '{"schemas": ["' + URN_USER + '"], "active": {{active}}, "userName": "a"}',
    },
    {
      name: 'Version one',
      method: 'POST',
      url: 'https://scim.acme-corp.com/scim/v1/Users',
      json: { schemas: ['urn:scim:schemas:core:1.0'], userName: 'a' },
    },
  ])
  assert.deepEqual(names('SCIM_SCHEMA_MISMATCH').sort(), ['Bulk no urn', 'Patch no urn', 'User no schemas', 'User wrong URN'])
})

test('the profile lists SCIM targets with resources and operation counts', () => {
  const parsed = parseCollection(
    build([
      { name: 'List users', url: '{{scimBase}}/Users?count=10' },
      { name: 'Create user', method: 'POST', url: '{{scimBase}}/Users', json: { schemas: [URN_USER], userName: 'a' } },
      { name: 'Add member', method: 'PATCH', url: '{{scimBase}}/Groups/{{id}}', json: patch([]) },
      { name: 'Other target', url: 'https://iiq.acme-corp.com/identityiq/scim/v2/Users' },
      { name: 'Unknown host', url: '{{somewhere}}/scim/v2/Groups' },
    ])
  )
  const { scim } = buildIdentityProfile(parsed)
  const primary = scim.find((target) => target.target === 'scim.acme-corp.com')!
  assert.deepEqual(primary.resources.sort(), ['Groups', 'Users'])
  assert.deepEqual(primary.operations, { GET: 1, POST: 1, PATCH: 1 })
  assert.equal(primary.requestIds.length, 3)
  assert.equal(scim.find((target) => target.target === 'iiq.acme-corp.com')?.platform, 'sailpoint')
  assert.ok(scim.some((target) => target.target === '{{somewhere}}'))

  const findings = runAudit(parsed)
  const report = JSON.parse(buildJsonReport({ parsed, findings, score: calculateScore(parsed, findings) })) as {
    identity?: { scim: unknown[] }
  }
  assert.equal(report.identity?.scim.length, 3)
  assert.deepEqual(validate(schema, report), [])
})

test('SCIM rules follow the iam-iga pack and use the identity category', () => {
  const raw = build([{ name: 'All users', url: '{{scimBase}}/Users' }])
  const on = runAuditDetailed(parseCollection(raw))
  const finding = on.findings.find((entry) => entry.ruleId === 'SCIM_UNBOUNDED_LIST')!
  assert.equal(finding.category, 'identity')
  const off = runAuditDetailed(parseCollection(raw), { rulePacks: { disabled: ['iam-iga'] } })
  assert.ok(!off.findings.some((entry) => entry.ruleId === 'SCIM_UNBOUNDED_LIST'))
  const amOnly = runAuditDetailed(parseCollection(raw), { rulePacks: { disabled: ['iam-am'] } })
  assert.ok(
    amOnly.findings.some((entry) => entry.ruleId === 'SCIM_UNBOUNDED_LIST'),
    'packs switch independently'
  )
})
