import type { ParsedCollection } from '../parser'

/**
 * Cheap check that decides whether the identity packs switch on by themselves. It only needs a hint: the platform and
 * endpoint classification that follows is done by the identity profile once a pack is on.
 */
const IDENTITY_HOST =
  /(?:^|\.)(?:okta(?:preview|-emea)?\.com|auth0\.com|login\.microsoftonline\.com|pingone\.(?:com|eu|asia|ca)|forgeblocks\.com|identitynow\.com|saviyntcloud\.com|privilegecloud\.cyberark\.cloud|secretservercloud\.com|omada\.cloud)$/i

const IDENTITY_PATH = [
  /\/oauth2?(?:\/|$)/i,
  /\/connect\/(?:token|authorize|introspect|revocation)\b/i,
  /\/\.well-known\/(?:openid-configuration|jwks\.json|oauth-authorization-server)\b/i,
  /\/protocol\/openid-connect\//i,
  /\/as\/(?:token|authorization)\.oauth2\b/i,
  /\/scim\/v[12]\b/i,
  /\/scim\//i,
  /\/saml2?\/(?:sso|acs|metadata)\b/i,
  /\/PasswordVault\//,
  /\/AIMWebService\//,
  /\/SecretServer\/api\//i,
  /\/v1\/sys\/(?:auth|policies|generate-root)\b/i,
  /\/identityiq\//i,
  /\/ECM\/api\//,
]

function hostOf(url: string): string {
  const match = /^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^/@]*@)?([^/:?#]+)/i.exec(url.trim())
  return match?.[1] ?? ''
}

/** OAuth parameters that appear in the URL or the form body of an authorize, token or callback request. */
const OAUTH_URL_PARAMETER = /[?&#](?:response_type|grant_type|client_id|access_token|id_token)=/i
const OAUTH_FORM_FIELD = /^(?:response_type|grant_type|client_id|client_assertion)$/i

/** A JWT in a header or auth helper: stored tokens are identity material even when nothing else in the collection is. */
const JWT_SHAPE = /eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\./

/** True when the collection looks like it deals with identity platforms (OAuth, OIDC, SCIM, SAML, vaults, admin APIs). */
export function detectIdentitySignals(parsed: ParsedCollection): boolean {
  if ((parsed.authTypes.oauth2 ?? 0) > 0) return true
  return parsed.requests.some((request) => {
    if (IDENTITY_HOST.test(hostOf(request.url))) return true
    if (OAUTH_URL_PARAMETER.test(request.url)) return true
    if (request.headers.some((header) => JWT_SHAPE.test(header.value)) || request.authFields?.some((field) => JWT_SHAPE.test(field.value)))
      return true
    if (request.bodyFields?.some((field) => OAUTH_FORM_FIELD.test(field.key.trim()))) return true
    return IDENTITY_PATH.some((pattern) => pattern.test(request.url))
  })
}
