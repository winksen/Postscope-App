import type { Finding } from '../auditor'
import type { ParsedCollection } from '../parser'
import { groupPrivileged } from './admin'
import { buildLifecycleMatrix } from './lifecycle'
import { broadScopeReason } from './oauth'
import { profileOf } from './platforms'
import { isEmptyProfile, type IdentityProfile, type PlatformId } from './types'

/** A table of the identity appendix of a report. Cells are plain text; the renderers escape them. */
export interface AppendixTable {
  title: string
  columns: string[]
  rows: string[][]
}

const MAX_ROWS = 50

function platformName(id: string): string {
  return profileOf(id as PlatformId)?.fingerprint.name ?? (id === 'unspecified' ? 'Not detected' : id)
}

function limit(rows: string[][]): string[][] {
  return rows.length > MAX_ROWS
    ? [...rows.slice(0, MAX_ROWS), [`... and ${rows.length - MAX_ROWS} more`, ...rows[0].slice(1).map(() => '')]]
    : rows
}

/** Platforms, OAuth clients, scopes, tokens, lifecycle coverage, privileged operations and PAM retrievals as report tables. Values are already masked. */
export function identityAppendix(profile: IdentityProfile | undefined): AppendixTable[] {
  if (!profile || isEmptyProfile(profile)) return []
  const tables: AppendixTable[] = []
  if (profile.platforms.length)
    tables.push({
      title: 'Platforms',
      columns: ['Platform', 'Confidence', 'Requests', 'Hosts'],
      rows: limit(
        profile.platforms.map((platform) => [
          platform.name,
          `${Math.round(platform.confidence * 100)}%`,
          String(platform.requestCount),
          platform.hosts.join(', ') || 'variable',
        ])
      ),
    })
  if (profile.oauthClients.length)
    tables.push({
      title: 'OAuth clients and flows',
      columns: ['Client', 'Flow', 'Client authentication', 'PKCE', 'Redirect URIs', 'Scopes'],
      rows: limit(
        profile.oauthClients.map((client) => [
          client.clientId ?? 'no client id',
          client.grant.replace(/_/g, ' '),
          client.clientAuth.replace(/_/g, ' '),
          client.pkce,
          client.redirectUris.join(', ') || 'none',
          client.scopes.join(' ') || 'none',
        ])
      ),
    })
  if (profile.scopes.length)
    tables.push({
      title: 'Scopes',
      columns: ['Scope', 'Clients', 'Note'],
      rows: limit(
        profile.scopes.map((scope) => [
          scope.scope,
          String(scope.clients),
          broadScopeReason(scope.scope, { clientAuth: 'client_secret_basic' }) ?? '',
        ])
      ),
    })
  if (profile.tokens.length)
    tables.push({
      title: 'Tokens stored in the collection',
      columns: ['Kind', 'Where', 'Preview'],
      rows: limit(
        profile.tokens.map((token) => [
          token.kind.replace(/-/g, ' '),
          `${token.requestId ?? 'collection'}, ${token.location}`,
          token.preview,
        ])
      ),
    })
  const lifecycle = buildLifecycleMatrix(profile.lifecycle ?? [])
  if (lifecycle.length)
    tables.push({
      title: 'Joiner, mover, leaver coverage',
      columns: ['Platform', 'Joiner', 'Mover', 'Disable', 'Remove access', 'Revoke sessions', 'Delete'],
      rows: lifecycle.map((row) => [
        platformName(row.platform),
        ...[row.joiner, row.mover, row.disable, row.removeAccess, row.revoke, row.delete].map(String),
      ]),
    })
  const privileged = groupPrivileged(profile.privileged ?? [])
  const operations = privileged.flatMap((group) => group.operations.map((operation) => ({ group, operation })))
  if (operations.length)
    tables.push({
      title: 'Privileged operations',
      columns: ['Platform', 'Kind', 'Request', 'Danger zone', 'Top-tier role'],
      rows: limit(
        operations
          .filter(({ operation }) => operation.kind !== 'secret-retrieval')
          .map(({ group, operation }) => [
            platformName(group.platform),
            operation.kind.replace(/-/g, ' '),
            `${operation.method} ${operation.path}`,
            operation.danger ? 'yes' : 'no',
            operation.topTier ?? '',
          ])
      ),
    })
  const retrievals = operations.filter(({ operation }) => operation.kind === 'secret-retrieval')
  if (retrievals.length)
    tables.push({
      title: 'Privileged credential retrievals',
      columns: ['Platform', 'Request'],
      rows: limit(retrievals.map(({ group, operation }) => [platformName(group.platform), `${operation.method} ${operation.path}`])),
    })
  if (profile.scim?.length)
    tables.push({
      title: 'SCIM provisioning targets',
      columns: ['Target', 'Resources', 'Requests per method'],
      rows: limit(
        profile.scim.map((target) => [
          target.target,
          target.resources.join(', '),
          Object.entries(target.operations)
            .map(([method, count]) => `${method} ${count}`)
            .join(', '),
        ])
      ),
    })
  return tables.filter((table) => table.rows.length > 0)
}

const FORMULA_START = /^[=+\-@\t\r]/

/** One CSV cell. Cells that start like a spreadsheet formula get a leading quote so opening the file cannot run anything. */
export function csvCell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** Request ids of findings that touch each request, for the related findings column. */
function findingsByRequest(findings: Finding[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const finding of findings) {
    const ids = new Set<string>(finding.affected)
    for (const evidence of finding.evidence ?? []) if (evidence.requestId) ids.add(evidence.requestId)
    for (const id of ids) map.set(id, [...(map.get(id) ?? []), finding.ruleId])
  }
  return map
}

/**
 * `identity-inventory.csv`: one row per identity endpoint with its class, platform, method, masked URL, request path
 * and related findings. Query strings are never included, so no value reaches the file.
 */
export function buildIdentityInventoryCsv(parsed: ParsedCollection, findings: Finding[]): string {
  const profile = parsed.identity
  const related = findingsByRequest(findings)
  const requests = new Map(parsed.requests.map((request) => [request.id, request]))
  const lines = [['endpoint class', 'platform', 'method', 'url', 'request', 'findings'].map(csvCell).join(',')]
  for (const endpoint of profile?.endpoints ?? []) {
    const request = requests.get(endpoint.requestId)
    const label = request ? [...request.folderPath, request.name].join(' / ') : endpoint.requestId
    const host = endpoint.host ?? ''
    lines.push(
      [
        endpoint.class,
        endpoint.platform ?? '',
        endpoint.method,
        `${host}${endpoint.path}`,
        label,
        (related.get(endpoint.requestId) ?? []).join(' '),
      ]
        .map(csvCell)
        .join(',')
    )
  }
  return `${lines.join('\r\n')}\r\n`
}
