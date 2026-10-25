import type { ParsedCollection } from '../../parser'
import type { FindingSink } from '../sink'
import type { IdentityProfile, PlatformId } from '../types'
import { splitUrl } from '../url'
import { PLATFORM_PROFILES } from './index'
import type { PlatformProfile, TenantEnvironment } from './types'

/** A tenant identifier written the same way in this many requests is repeated enough to belong in a variable. */
const REPEAT_THRESHOLD = 3

function mask(value: string): string {
  return `${value.slice(0, 4)}${'•'.repeat(4)}`
}

interface Repeated {
  profile: PlatformProfile
  kind: string
  value: string
  variable: string
  requestIds: Set<string>
}

/** Platform profile checks of the `iam-platform` pack: hardcoded tenant identifiers, mixed environments and retired APIs. */
export function checkPlatforms(parsed: ParsedCollection, profile: IdentityProfile, out: FindingSink): void {
  const detected = new Set<PlatformId>(profile.platforms.map((platform) => platform.id))
  const profiles = PLATFORM_PROFILES.filter((entry) => detected.has(entry.id))
  if (!profiles.length) return

  const repeated = new Map<string, Repeated>()
  const environments = new Map<string, Map<TenantEnvironment, { hosts: Set<string>; requestIds: Set<string> }>>()
  const tenantIds = new Map<string, { values: Set<string>; requestIds: Set<string> }>()

  for (const request of parsed.requests) {
    const url = splitUrl(request.url, parsed)
    for (const entry of profiles) {
      const identifiers = entry.tenantIdentifiers(url)
      for (const identifier of identifiers) {
        // Only what is written in the request counts as hardcoded; a variable that resolves to the value does not.
        if (request.url.includes(identifier.value)) {
          const key = `${entry.id}|${identifier.kind}|${identifier.value}`
          const found = repeated.get(key) ?? {
            profile: entry,
            kind: identifier.kind,
            value: identifier.value,
            variable: identifier.variable,
            requestIds: new Set<string>(),
          }
          found.requestIds.add(request.id)
          repeated.set(key, found)
        }
        if (identifier.kind === 'tenant-id') {
          const ids = tenantIds.get(entry.id) ?? { values: new Set<string>(), requestIds: new Set<string>() }
          ids.values.add(identifier.value.toLowerCase())
          ids.requestIds.add(request.id)
          tenantIds.set(entry.id, ids)
        }
      }
      const environment = entry.environmentOf?.(url)
      if (environment && url.host) {
        const byEnvironment = environments.get(entry.id) ?? new Map()
        const group = byEnvironment.get(environment) ?? { hosts: new Set<string>(), requestIds: new Set<string>() }
        group.hosts.add(url.host)
        group.requestIds.add(request.id)
        byEnvironment.set(environment, group)
        environments.set(entry.id, byEnvironment)
      }
      for (const message of entry.deprecated?.(request, url) ?? [])
        out.add('DEPRECATED_IDENTITY_API', request.id, { location: `${entry.fingerprint.name} URL`, preview: message })
    }
  }

  for (const found of repeated.values()) {
    if (found.requestIds.size < REPEAT_THRESHOLD) continue
    for (const id of found.requestIds)
      out.add('TENANT_IDENTIFIER_HARDCODED', id, {
        location: `${found.profile.fingerprint.name} ${found.kind}`,
        preview: `${mask(found.value)} in ${found.requestIds.size} requests, use {{${found.variable}}}`,
      })
  }

  for (const entry of profiles) {
    const byEnvironment = environments.get(entry.id)
    if (byEnvironment?.has('production') && (byEnvironment.has('preview') || byEnvironment.has('development'))) {
      const other = byEnvironment.has('preview') ? 'preview' : 'development'
      for (const group of byEnvironment.values())
        for (const id of group.requestIds)
          out.add('MIXED_TENANT_ENVIRONMENTS', id, {
            location: `${entry.fingerprint.name} tenants`,
            preview: `production and ${other} hosts in one collection`,
          })
    }
    const ids = tenantIds.get(entry.id)
    if (ids && ids.values.size > 1)
      for (const id of ids.requestIds)
        out.add('MIXED_TENANT_ENVIRONMENTS', id, {
          location: `${entry.fingerprint.name} tenants`,
          preview: `${ids.values.size} different tenant ids`,
        })
  }
}
