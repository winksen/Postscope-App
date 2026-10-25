import type { PlatformId } from '../types'
import { auth0Profile } from './auth0'
import { entraProfile } from './entra'
import { forgerockProfile } from './forgerock'
import { keycloakProfile } from './keycloak'
import { oktaProfile } from './okta'
import { pingProfile } from './ping'
import type { PlatformProfile } from './types'

/** Platform profiles in detection order. Access management and CIAM platforms first, the rest follow in later releases. */
export const PLATFORM_PROFILES: PlatformProfile[] = [
  oktaProfile,
  entraProfile,
  auth0Profile,
  pingProfile,
  forgerockProfile,
  keycloakProfile,
]

const byId = new Map<PlatformId, PlatformProfile>(PLATFORM_PROFILES.map((profile) => [profile.id, profile]))

export function profileOf(id: PlatformId): PlatformProfile | undefined {
  return byId.get(id)
}

export type { PlatformProfile, TenantIdentifier, TenantEnvironment, PlatformFingerprint } from './types'
