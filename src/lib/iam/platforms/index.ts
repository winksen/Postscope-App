import type { PlatformId } from '../types'
import { auth0Profile } from './auth0'
import { entraProfile } from './entra'
import { forgerockProfile } from './forgerock'
import { keycloakProfile } from './keycloak'
import { oktaProfile } from './okta'
import { pingProfile } from './ping'
import { sailpointProfile } from './sailpoint'
import { saviyntProfile } from './saviynt'
import { oneIdentityProfile } from './oneIdentity'
import { omadaProfile } from './omada'
import { cyberarkProfile } from './cyberark'
import { beyondTrustProfile } from './beyondTrust'
import { delineaProfile } from './delinea'
import { vaultProfile } from './vault'
import { awsIamProfile } from './awsIam'
import { azureIamProfile } from './azureIam'
import { gcpIamProfile } from './gcpIam'
import type { PlatformProfile } from './types'

/** Platform profiles in detection order. Access management and CIAM platforms first, then governance, privileged access and cloud IAM. */
export const PLATFORM_PROFILES: PlatformProfile[] = [
  oktaProfile,
  entraProfile,
  auth0Profile,
  pingProfile,
  forgerockProfile,
  keycloakProfile,
  sailpointProfile,
  saviyntProfile,
  oneIdentityProfile,
  omadaProfile,
  cyberarkProfile,
  beyondTrustProfile,
  delineaProfile,
  vaultProfile,
  awsIamProfile,
  azureIamProfile,
  gcpIamProfile,
]

const byId = new Map<PlatformId, PlatformProfile>(PLATFORM_PROFILES.map((profile) => [profile.id, profile]))

export function profileOf(id: PlatformId): PlatformProfile | undefined {
  return byId.get(id)
}

export type { PlatformProfile, TenantIdentifier, TenantEnvironment, PlatformFingerprint } from './types'
