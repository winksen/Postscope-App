import type { ParsedCollection } from '../parser'
import type { RulePackId } from '../rulePacks'
import { checkJwts } from './jwtChecks'
import { checkOAuth } from './oauth'
import { checkPam } from './pam'
import { checkRevocationCoverage } from './revocation'
import { checkAdminPlane } from './admin'
import { checkPlatforms } from './platforms/check'
import { checkGovernance } from './governance'
import { checkLifecycle } from './lifecycle'
import { checkSamlAndSessions } from './saml'
import { checkScim } from './scim'
import type { FindingSink } from './sink'
import type { IdentityProfile } from './types'

export interface IdentityCheckContext {
  /** Clock used to decide whether a stored token has expired. */
  now: Date
}

/** Runs the identity rules of every pack that is enabled. Each pack only reads the profile, it never calls anything. */
export function runIdentityChecks(
  parsed: ParsedCollection,
  profile: IdentityProfile,
  out: FindingSink,
  packs: ReadonlySet<RulePackId>,
  context: IdentityCheckContext
): void {
  if (packs.has('iam-am')) {
    checkOAuth(parsed, profile, out)
    checkJwts(parsed, profile, out, context.now)
    checkSamlAndSessions(parsed, profile, out)
    checkRevocationCoverage(profile, out)
  }
  if (packs.has('iam-iga')) {
    checkScim(parsed, profile, out)
    checkLifecycle(parsed, profile, out)
    checkGovernance(parsed, profile, out)
  }
  if (packs.has('iam-pam')) {
    checkPam(parsed, profile, out)
    checkAdminPlane(parsed, profile, out)
  }
  if (packs.has('iam-platform')) checkPlatforms(parsed, profile, out)
}
