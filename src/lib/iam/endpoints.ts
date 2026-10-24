import type { ParsedRequest } from '../parser'
import type { EndpointClass, PlatformId } from './types'
import type { SplitUrl } from './url'

export interface EndpointContext {
  method: string
  /** Normalized path (variables and `:params` replaced by `*`). */
  path: string
  host?: string
  /** Lowercase parameter names of the query, form body and JSON body. */
  params: ReadonlyMap<string, string>
  /** Platform the request was fingerprinted as, when known. */
  platform?: PlatformId
}

type Test = (context: EndpointContext) => boolean

/** The path or the host talks about OAuth, OpenID Connect or a known authorization server. */
const OAUTH_CONTEXT = /\/(?:oauth2?|openid-connect|openid|connect|oidc|as|am\/oauth2|identity\/connect)\b|\/realms\//i

function oauthContext(context: EndpointContext): boolean {
  return OAUTH_CONTEXT.test(context.path) || /login\.microsoftonline|auth0\.com|pingone|okta/i.test(context.host ?? '')
}

/** The AWS API action of a query API call (`Action=...`) or of an `X-Amz-Target` header (`service.Action`), lowercase. */
function action(context: EndpointContext): string {
  const raw = (context.params.get('action') ?? context.params.get('x-amz-target') ?? '').toLowerCase()
  return raw.slice(raw.lastIndexOf('.') + 1)
}

const rules: Array<[EndpointClass, Test]> = [
  ['oidc.discovery', (c) => /\/\.well-known\/(?:openid-configuration|oauth-authorization-server)$/i.test(c.path)],
  [
    'oidc.jwks',
    (c) =>
      /\/\.well-known\/jwks(?:\.json)?$|\/jwks(?:\.json)?$|\/discovery\/(?:v2\.0\/)?keys$|\/protocol\/openid-connect\/certs$|\/oauth2\/(?:[^/]+\/)?v1\/keys$/i.test(
        c.path
      ),
  ],
  ['oauth.par', (c) => /\/(?:oauth2?|connect|as|openid-connect(?:\/ext)?|am\/oauth2)(?:\/[^/]+)*\/par(?:\.oauth2)?$/i.test(c.path)],
  ['oauth.device', (c) => /\/(?:device\/code|device_authorization|devicecode|device\/authorize)$/i.test(c.path)],
  ['oauth.introspect', (c) => /\/introspect(?:ion)?(?:\.oauth2)?$/i.test(c.path) || c.path.endsWith('/token/introspect')],
  ['oauth.revoke', (c) => /\/(?:revoke|revocation)(?:\.oauth2)?$/i.test(c.path) && (oauthContext(c) || c.params.has('token'))],
  ['oidc.userinfo', (c) => /\/userinfo(?:\.openid)?$/i.test(c.path)],
  [
    'oidc.logout',
    (c) =>
      /\/(?:end_?session|openid-connect\/logout|oidc\/logout|v2\/logout|oauth2\/(?:[^/]+\/)*logout|connect\/endsession)$/i.test(c.path) ||
      (/\/logout$/i.test(c.path) && oauthContext(c)),
  ],
  [
    'oauth.authorize',
    (c) =>
      c.params.has('response_type') ||
      (/\/(?:authorize|authorization|auth)(?:\.oauth2)?$/i.test(c.path) && oauthContext(c)) ||
      /\/oauth2\/(?:v2\.0\/)?authorize$/i.test(c.path),
  ],
  [
    'oauth.token',
    (c) =>
      c.params.has('grant_type') ||
      (/\/(?:token|access_token)(?:\.oauth2)?$/i.test(c.path) && (oauthContext(c) || c.method === 'POST' || c.params.has('code'))),
  ],
  ['saml.acs', (c) => /\/saml2?\/(?:acs|consume|sso\/post|assertionconsumerservice)\b|\/shibboleth\.sso\/saml2\/post$/i.test(c.path)],
  [
    'saml.sso',
    (c) =>
      /\/saml2?\/(?:sso|login|metadata|idp)\b|\/idp\/profile\/saml2|\/saml\/(?:signin|logout)\b|\/app\/[^/]+\/[^/]+\/sso\/saml$/i.test(
        c.path
      ),
  ],
  ['scim.bulk', (c) => /\/scim(?:\/v[12])?\/bulk$/i.test(c.path)],
  ['scim.schemas', (c) => /\/scim(?:\/v[12])?\/(?:schemas|serviceproviderconfig|resourcetypes)\b/i.test(c.path)],
  ['scim.users', (c) => /\/scim(?:\/v[12])?\/users\b/i.test(c.path)],
  ['scim.groups', (c) => /\/scim(?:\/v[12])?\/groups\b/i.test(c.path)],
  [
    'iga.sod',
    (c) => /\/(?:sod-polic(?:y|ies)|sod-violations?|sodpolic(?:y|ies)|sodviolations?)\b|\/sod\/(?:polic|violation|check)/i.test(c.path),
  ],
  [
    'iga.certification',
    (c) => /\/(?:certifications?|campaigns?|certificationitems?|getcertifications?|certificationdecisions?)\b/i.test(c.path),
  ],
  [
    'iga.access-request',
    (c) =>
      /\/(?:access-requests?|accessrequests?|createrequest|requestaccess|personwantsorg|access-request-status|approval-items?|requests\/approve)\b/i.test(
        c.path
      ) || /\/ecm\/api\/v5\/(?:createrequest|getrequests?|approverequest)/i.test(c.path),
  ],
  // Credential minting is checked before role assignments: `addPassword` and `client-secret` are not role changes.
  [
    'admin.credential-mint',
    (c) =>
      /\/applications\/[^/]+\/(?:addpassword|addkey)$|\/serviceprincipals\/[^/]+\/addpassword$/i.test(c.path) ||
      /\/api\/v1\/apps\/[^/]+\/credentials\/secrets\b/i.test(c.path) ||
      /\/clients\/[^/]+\/client-secret$/i.test(c.path) ||
      /\/api\/v1\/api-tokens\b/i.test(c.path) ||
      (/\/serviceaccounts\/[^/]+\/keys(?::create)?$/i.test(c.path) && c.method === 'POST') ||
      /\/serviceaccounts\/[^/]+\/keys:create$/i.test(c.path) ||
      /^(?:createaccesskey|createloginprofile|createservicespecificcredential)$/.test(action(c)),
  ],
  [
    'admin.role-assignment',
    (c) =>
      /\/api\/v1\/(?:users|groups)\/[^/]+\/roles\b|\/api\/v1\/iam\/(?:assignees|roles)\b/i.test(c.path) ||
      /\/rolemanagement\/directory\/roleassignments\b|\/directoryroles\/[^/]+\/members\b/i.test(c.path) ||
      /\/admin\/realms\/[^/]+\/(?:users|groups)\/[^/]+\/role-mappings\b/i.test(c.path) ||
      /\/api\/v2\/(?:users|roles)\/[^/]+\/roles\b/i.test(c.path) ||
      /\/providers\/microsoft\.authorization\/roleassignments\b|\/roleassignments\/[^/]+$/i.test(c.path) ||
      /:setiampolicy$/i.test(c.path) ||
      /^(?:attachuserpolicy|attachrolepolicy|attachgrouppolicy|putuserpolicy|putrolepolicy|addusertogroup|createpolicyversion)$/.test(
        action(c)
      ),
  ],
  [
    'admin.policy',
    (c) =>
      /\/api\/v1\/(?:policies|authorizationservers\/[^/]+\/policies)\b/i.test(c.path) ||
      /\/identity\/conditionalaccess\/policies\b|\/policies\/(?:authenticationmethodspolicy|authorizationpolicy|identitysecuritydefaultsenforcementpolicy)\b/i.test(
        c.path
      ) ||
      /\/api\/v2\/guardian\/(?:policies|factors)\b/i.test(c.path) ||
      /\/admin\/realms\/[^/]+\/authentication\/flows\b/i.test(c.path) ||
      /\/v1\/sys\/(?:policies\/acl|policy)\b/i.test(c.path),
  ],
  [
    'pam.retrieve',
    (c) =>
      /\/passwordvault\/api\/accounts\/[^/]+\/password\/retrieve$/i.test(c.path) ||
      /\/aimwebservice\/api\/accounts$/i.test(c.path) ||
      /\/beyondtrust\/api\/public\/v3\/(?:credentials|requests\/[^/]+\/credentials)\b/i.test(c.path) ||
      /\/(?:secretserver\/)?api\/v1\/secrets\/[^/]+\/(?:fields\/[^/]+|password)$/i.test(c.path) ||
      /\/passwordvault\/webservices\/pimservices\.svc\/accounts\b/i.test(c.path),
  ],
  [
    'pam.checkin',
    (c) =>
      /\/passwordvault\/api\/accounts\/[^/]+\/checkin$/i.test(c.path) ||
      /\/beyondtrust\/api\/public\/v3\/requests\/[^/]+\/checkin$/i.test(c.path) ||
      /\/api\/v1\/secrets\/[^/]+\/check-?in$/i.test(c.path),
  ],
  [
    'pam.checkout',
    (c) =>
      /\/passwordvault\/api\/accounts\/[^/]+\/check-?out$/i.test(c.path) ||
      (/\/beyondtrust\/api\/public\/v3\/requests$/i.test(c.path) && c.method === 'POST') ||
      /\/api\/v1\/secrets\/[^/]+\/check-?out$/i.test(c.path),
  ],
  [
    'pam.session',
    (c) =>
      /\/passwordvault\/api\/(?:livesessions|recordings)\b|\/beyondtrust\/api\/public\/v3\/sessions\b|\/api\/v1\/secret-?sessions?\b/i.test(
        c.path
      ),
  ],
  [
    'pam.admin',
    (c) =>
      /\/passwordvault\/api\/safes(?:\/[^/]+(?:\/members)?)?\b/i.test(c.path) ||
      /\/beyondtrust\/api\/public\/v3\/(?:managedaccounts|managedsystems|smartrules)\b/i.test(c.path) ||
      /\/api\/v1\/(?:folder-permissions|secret-permissions|roles)\b/i.test(c.path) ||
      /\/v1\/sys\/(?:auth|mounts|generate-root|rekey|seal|unseal)\b/i.test(c.path),
  ],
  [
    'vault.write',
    (c) =>
      ((c.method === 'POST' || c.method === 'PUT' || c.method === 'PATCH') &&
        (/^\/v1\/[^/]+\/(?:data|metadata)\//i.test(c.path) ||
          (c.platform === 'vault' && /^\/v1\/(?:secret|kv|cubbyhole)\//i.test(c.path)))) ||
      action(c).endsWith('putsecretvalue') ||
      (c.method === 'PUT' && /\.vault\.azure\.net$/.test(c.host ?? '') && /\/secrets\//i.test(c.path)),
  ],
  [
    'vault.read',
    (c) =>
      (c.method === 'GET' &&
        (/^\/v1\/[^/]+\/data\//i.test(c.path) || (c.platform === 'vault' && /^\/v1\/(?:secret|kv|cubbyhole)\//i.test(c.path)))) ||
      action(c).endsWith('getsecretvalue') ||
      (c.method === 'GET' && /\.vault\.azure\.net$/.test(c.host ?? '') && /\/secrets\//i.test(c.path)) ||
      /\/secrets\/[^/]+\/versions\/[^/:]+:access$/i.test(c.path),
  ],
  [
    'cloud-iam.sts',
    (c) =>
      /^sts(?:\.|$)/.test(c.host ?? '') ||
      /^(?:assumerole|assumerolewithsaml|assumerolewithwebidentity|getsessiontoken|getcalleridentity)$/.test(action(c)),
  ],
  ['cloud-iam.iam', (c) => /^iam(?:\.[a-z0-9-]+)?\.amazonaws\.com/.test(c.host ?? '') && !/googleapis/.test(c.host ?? '')],
  ['cloud-iam.azure', (c) => c.host === 'management.azure.com' && /\/providers\/microsoft\.authorization\//i.test(c.path)],
  ['cloud-iam.gcp', (c) => /^iam\.googleapis\.com$|^admin\.googleapis\.com$/.test(c.host ?? '')],
]

/**
 * Classifies a request by what it does for identity. Only the method, the normalized path, the host and parameter
 * names decide, never values. Returns `unknown` for requests that are not identity endpoints.
 */
export function classifyEndpoint(context: EndpointContext): EndpointClass {
  for (const [endpointClass, test] of rules) if (test(context)) return endpointClass
  return 'unknown'
}

export function endpointContext(
  request: ParsedRequest,
  url: SplitUrl,
  params: ReadonlyMap<string, string>,
  platform?: PlatformId
): EndpointContext {
  const target = request.headers.find((header) => header.key.trim().toLowerCase() === 'x-amz-target')?.value
  const merged = target && !params.has('x-amz-target') ? new Map(params).set('x-amz-target', target) : params
  return { method: request.method, path: url.path, host: url.host, params: merged, platform }
}
