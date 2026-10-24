import type { ParsedCollection } from '../parser'
import { describeLifetime, collectJwts, inspectJwt, isLongLived, type JwtInspection } from './jwt'
import type { FindingSink } from './sink'
import type { IdentityProfile } from './types'

function claimPreview(inspection: JwtInspection, names: string[]): string {
  const byName = new Map(inspection.claims.map((claim) => [claim.name, claim.preview]))
  return names
    .slice(0, 6)
    .map((name) => `${name} ${byName.get(name) ?? ''}`.trim())
    .join(', ')
}

/** JWT inspection of the `iam-am` pack (V0.2.3). Tokens are decoded in memory only; evidence shows masked claims, never the token. */
export function checkJwts(parsed: ParsedCollection, profile: IdentityProfile, out: FindingSink, now: Date): void {
  const endpointClass = new Map(profile.endpoints.map((endpoint) => [endpoint.requestId, endpoint.class]))
  for (const occurrence of collectJwts(parsed)) {
    const inspection = inspectJwt(occurrence.token, now)
    if (!inspection) continue
    const { requestId, location } = occurrence

    if (inspection.alg.toLowerCase() === 'none') out.add('JWT_ALG_NONE', requestId, { location, preview: 'alg none (unsigned token)' })

    if (isLongLived(inspection)) {
      const preview = inspection.hasExp ? `lifetime ${describeLifetime(inspection.lifetimeSeconds ?? 0)}` : 'no exp claim'
      out.add('JWT_LONG_LIVED', requestId, { location, preview: `${preview}${inspection.issuer ? `, iss ${inspection.issuer}` : ''}` })
    }

    const exposed = [...inspection.personalClaims, ...inspection.privilegeClaims]
    if (exposed.length) out.add('JWT_SENSITIVE_CLAIMS', requestId, { location, preview: claimPreview(inspection, exposed) })

    if (occurrence.bearer && inspection.idToken && requestId && endpointClass.get(requestId) !== 'oidc.userinfo')
      out.add('ID_TOKEN_AS_BEARER', requestId, {
        location,
        preview: `ID token claims${inspection.issuer ? `, iss ${inspection.issuer}` : ''}`,
      })

    if (inspection.expired)
      out.add('JWT_EXPIRED_STORED', requestId, { location, preview: `expired ${inspection.expiresAt?.slice(0, 10) ?? ''}`.trim() })
  }
}
