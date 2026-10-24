import type { ParsedCollection } from '../parser'
import type { RulePackId } from '../rulePacks'
import { checkOAuth } from './oauth'
import type { FindingSink } from './sink'
import type { IdentityProfile } from './types'

/** Runs the identity rules of every pack that is enabled. Each pack only reads the profile, it never calls anything. */
export function runIdentityChecks(
  parsed: ParsedCollection,
  profile: IdentityProfile,
  out: FindingSink,
  packs: ReadonlySet<RulePackId>
): void {
  if (packs.has('iam-am')) checkOAuth(parsed, profile, out)
}
