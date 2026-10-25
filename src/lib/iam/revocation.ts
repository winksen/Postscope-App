import { PLATFORM_FINGERPRINTS } from './fingerprints'
import type { FindingSink } from './sink'
import type { EndpointClass, IdentityProfile } from './types'

const OBTAINS_TOKENS: EndpointClass[] = ['oauth.token']
const ENDS_TOKENS: EndpointClass[] = ['oauth.revoke', 'oidc.logout', 'session.terminate']

const platformNames = new Map<string, string>(PLATFORM_FINGERPRINTS.map((fingerprint) => [fingerprint.id, fingerprint.name]))

/**
 * Revocation coverage (V0.2.4). A collection that obtains tokens from a platform should also show how they are ended:
 * a revocation, logout or session termination request. A request without a detected platform covers every platform,
 * because the collection may reach the same service through a gateway.
 */
export function checkRevocationCoverage(profile: IdentityProfile, out: FindingSink): void {
  const obtain = new Map<string, string[]>()
  const covered = new Set<string>()
  let coversAll = false
  for (const endpoint of profile.endpoints) {
    const key = endpoint.platform ?? ''
    if (OBTAINS_TOKENS.includes(endpoint.class)) obtain.set(key, [...(obtain.get(key) ?? []), endpoint.requestId])
    if (ENDS_TOKENS.includes(endpoint.class)) {
      if (key) covered.add(key)
      else coversAll = true
    }
  }
  if (coversAll) return
  for (const [key, requestIds] of obtain) {
    if (key && covered.has(key)) continue
    // Token requests with no detected platform are covered by a revocation of any platform: nothing ties them together.
    if (!key && covered.size > 0) continue
    const name = key ? (platformNames.get(key) ?? key) : 'the identity provider'
    out.add('TOKEN_REVOCATION_NOT_COVERED', undefined, {
      location: `token requests for ${name}`,
      preview: `${requestIds.length} token request${requestIds.length === 1 ? '' : 's'}, no revocation, logout or session termination`,
    })
  }
}
