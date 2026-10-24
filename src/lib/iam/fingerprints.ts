import type { ParsedCollection, ParsedRequest } from '../parser'
import { extractVariableNames } from '../variables'
import type { DetectedPlatform, PlatformFamily, PlatformId } from './types'
import { splitUrl, type SplitUrl } from './url'

interface HeaderSignal {
  name: RegExp
  /** When set, the header value must match too. */
  value?: RegExp
  label: string
}

interface PlatformFingerprint {
  id: PlatformId
  name: string
  family: PlatformFamily
  /** Host suffix or exact host patterns. A match is the strongest signal. */
  hosts: RegExp[]
  /** Specific paths that only this platform uses. */
  strongPaths: RegExp[]
  /** Paths that are typical but could belong to other APIs. */
  paths: RegExp[]
  headers: HeaderSignal[]
  /** Token shapes in the header values and auth helper fields. */
  tokens: Array<{ pattern: RegExp; label: string }>
  ports: string[]
  /** Variable names that hint at the platform, such as `{{oktaDomain}}`. */
  variables: RegExp[]
  /** Postman auth helper types that point to the platform (for example `awsv4`). */
  authTypes: string[]
}

const WEIGHT = { host: 0.6, strongPath: 0.5, path: 0.3, header: 0.5, token: 0.5, port: 0.2, variable: 0.15, authType: 0.3 }

/** Signals that must add up to this much on one request for a platform to be reported. */
const DETECTION_THRESHOLD = 0.5
const MAX_LISTED = 50

/**
 * The platform table. Hosts and paths are written for normalized paths (variables replaced by `*`), and every
 * pattern is anchored or bounded so none of them backtracks badly on long values.
 */
export const PLATFORM_FINGERPRINTS: PlatformFingerprint[] = [
  {
    id: 'okta',
    name: 'Okta Workforce Identity',
    family: 'access-management',
    hosts: [/(?:^|\.)(?:okta|oktapreview|okta-emea|okta-gov|trexcloud)\.com$/],
    strongPaths: [/^\/oauth2\/(?:default|aus[a-z0-9]+)\/v1\//i, /^\/api\/v1\/(?:authorizationservers|sessions|factors|idps|iam)\b/i],
    paths: [/^\/api\/v1\/(?:users|groups|apps|policies|roles|logs|org|zones|trustedorigins)\b/i],
    headers: [{ name: /^authorization$/i, value: /^SSWS\s/, label: 'Authorization: SSWS' }],
    tokens: [],
    ports: [],
    variables: [/okta/i],
    authTypes: [],
  },
  {
    id: 'entra',
    name: 'Microsoft Entra ID',
    family: 'access-management',
    hosts: [/^login\.microsoftonline\.(?:com|us|de)$/, /^graph\.microsoft\.(?:com|us)$/, /^graph\.windows\.net$/, /^sts\.windows\.net$/],
    strongPaths: [
      /\/oauth2\/(?:v2\.0\/)?(?:token|authorize|devicecode)$/i,
      /^\/(?:v1\.0|beta)\/(?:users|groups|applications|serviceprincipals|directoryroles|rolemanagement|identity)\b/i,
    ],
    paths: [],
    headers: [],
    tokens: [{ pattern: /[A-Za-z0-9_.~-]{3}\dQ~[A-Za-z0-9_.~-]{20,}/, label: 'client secret (Q~)' }],
    ports: [],
    variables: [/tenant(?:id)?\b/i, /entra|azuread|msgraph/i],
    authTypes: [],
  },
  {
    id: 'auth0',
    name: 'Auth0',
    family: 'ciam',
    hosts: [/(?:^|\.)auth0\.com$/],
    strongPaths: [/^\/api\/v2\/(?:users|clients|connections|roles|resource-servers|guardian|tenants|client-grants|rules|actions)\b/i],
    paths: [/^\/oauth\/token$/i, /^\/api\/v2\//i],
    headers: [],
    tokens: [],
    ports: [],
    variables: [/auth0/i],
    authTypes: [],
  },
  {
    id: 'ping',
    name: 'Ping Identity',
    family: 'access-management',
    hosts: [/(?:^|\.)pingone\.(?:com|eu|asia|ca|com\.au)$/, /(?:^|\.)pingidentity\.(?:com|cloud)$/],
    strongPaths: [/^\/as\/(?:token|authorization|introspect|revoke|userinfo)\.oauth2$/i, /^\/pf-admin-api\//i, /^\/v1\/environments\//i],
    paths: [],
    headers: [],
    tokens: [],
    ports: [],
    variables: [/pingone|pingfederate|pingid/i],
    authTypes: [],
  },
  {
    id: 'forgerock',
    name: 'ForgeRock and Ping Advanced Identity Cloud',
    family: 'access-management',
    hosts: [/(?:^|\.)forgeblocks\.com$/, /(?:^|\.)forgerock\.io$/],
    strongPaths: [/^\/am\/oauth2\//i, /^\/openidm\//i, /^\/am\/json\//i],
    paths: [],
    headers: [
      { name: /^x-openam-username$/i, label: 'X-OpenAM-Username' },
      { name: /^x-openam-password$/i, label: 'X-OpenAM-Password' },
    ],
    tokens: [],
    ports: [],
    variables: [/forgerock|openam|openidm|forgeblocks/i],
    authTypes: [],
  },
  {
    id: 'keycloak',
    name: 'Keycloak',
    family: 'access-management',
    hosts: [],
    strongPaths: [/^(?:\/auth)?\/realms\/[^/]+\/protocol\/openid-connect\//i, /^(?:\/auth)?\/admin\/realms\b/i],
    paths: [/^(?:\/auth)?\/realms\/[^/]+\/(?:\.well-known|account|clients-registrations)\b/i],
    headers: [],
    tokens: [],
    ports: [],
    variables: [/keycloak/i],
    authTypes: [],
  },
  {
    id: 'sailpoint',
    name: 'SailPoint Identity Security Cloud and IdentityIQ',
    family: 'governance',
    hosts: [/(?:^|\.)identitynow(?:-demo)?\.com$/, /(?:^|\.)api\.identitynow\.com$/],
    strongPaths: [
      /^\/identityiq\//i,
      /^\/(?:v3|beta|v2024|v2025)\/(?:access-requests|certifications|campaigns|sod-polic|sod-violation|identities|accounts|sources|entitlements|access-profiles|roles|search)\b/i,
    ],
    paths: [/^\/cc\/api\//i],
    headers: [],
    tokens: [],
    ports: [],
    variables: [/sailpoint|identitynow|identityiq/i],
    authTypes: [],
  },
  {
    id: 'saviynt',
    name: 'Saviynt Enterprise Identity Cloud',
    family: 'governance',
    hosts: [/(?:^|\.)saviyntcloud\.com$/],
    strongPaths: [/^\/ecm\/api\/v5\//i],
    paths: [],
    headers: [],
    tokens: [],
    ports: [],
    variables: [/saviynt/i],
    authTypes: [],
  },
  {
    id: 'oneidentity',
    name: 'One Identity Manager',
    family: 'governance',
    hosts: [/(?:^|\.)oneidentity\.com$/],
    strongPaths: [/^\/appserver\/api\//i, /^\/apiserver\//i],
    paths: [],
    headers: [],
    tokens: [],
    ports: [],
    variables: [/oneidentity|identitymanager/i],
    authTypes: [],
  },
  {
    id: 'omada',
    name: 'Omada Identity',
    family: 'governance',
    hosts: [/(?:^|\.)omada\.cloud$/],
    strongPaths: [/^\/odata\//i],
    paths: [],
    headers: [],
    tokens: [],
    ports: [],
    variables: [/omada/i],
    authTypes: [],
  },
  {
    id: 'cyberark',
    name: 'CyberArk',
    family: 'privileged-access',
    hosts: [/(?:^|\.)privilegecloud\.cyberark\.cloud$/, /(?:^|\.)cyberark\.cloud$/, /(?:^|\.)cyberark\.com$/],
    strongPaths: [/^\/passwordvault\/(?:api|webservices)\//i, /^\/aimwebservice\/api\//i, /^\/authn\/[^/]+\/[^/]+\/authenticate$/i],
    paths: [],
    headers: [],
    tokens: [],
    ports: [],
    variables: [/cyberark|pvwa|conjur/i],
    authTypes: [],
  },
  {
    id: 'beyondtrust',
    name: 'BeyondTrust Password Safe',
    family: 'privileged-access',
    hosts: [/(?:^|\.)beyondtrustcloud\.com$/],
    strongPaths: [/^\/beyondtrust\/api\/public\/v3\//i],
    paths: [],
    headers: [{ name: /^authorization$/i, value: /^PS-Auth\s/i, label: 'Authorization: PS-Auth' }],
    tokens: [],
    ports: [],
    variables: [/beyondtrust|psauth/i],
    authTypes: [],
  },
  {
    id: 'delinea',
    name: 'Delinea Secret Server',
    family: 'privileged-access',
    hosts: [/(?:^|\.)secretservercloud\.(?:com|eu|ca|com\.au)$/, /(?:^|\.)delinea\.app$/],
    strongPaths: [/^\/secretserver\/api\/v1\//i, /^\/api\/v1\/secrets\b/i],
    paths: [],
    headers: [],
    tokens: [],
    ports: [],
    variables: [/delinea|secretserver/i],
    authTypes: [],
  },
  {
    id: 'vault',
    name: 'HashiCorp Vault',
    family: 'privileged-access',
    hosts: [/(?:^|\.)vault\.hashicorp\.cloud$/],
    strongPaths: [/^\/v1\/sys\//i, /^\/v1\/auth\/[^/]+\/(?:login|token|role)/i],
    paths: [/^\/v1\/[^/]+\/data\//i, /^\/v1\/(?:secret|kv|cubbyhole|transit|pki|database)\b/i],
    headers: [{ name: /^x-vault-token$/i, label: 'X-Vault-Token' }],
    tokens: [{ pattern: /\bhv[sbr]\.[A-Za-z0-9_-]{16,}/, label: 'Vault token (hvs.)' }],
    ports: ['8200'],
    variables: [/vault/i],
    authTypes: [],
  },
  {
    id: 'aws-iam',
    name: 'AWS IAM and STS',
    family: 'cloud-iam',
    hosts: [
      /^(?:iam|sts)(?:\.[a-z0-9-]+)?\.amazonaws\.com$/,
      /^secretsmanager\.[a-z0-9-]+\.amazonaws\.com$/,
      /^iam\.[a-z0-9-]+\.amazonaws\.com\.cn$/,
    ],
    strongPaths: [],
    paths: [],
    headers: [{ name: /^x-amz-target$/i, value: /iam|sts|secretsmanager/i, label: 'X-Amz-Target' }],
    tokens: [],
    ports: [],
    variables: [],
    authTypes: ['awsv4', 'aws'],
  },
  {
    id: 'azure-iam',
    name: 'Azure resource IAM and Key Vault',
    family: 'cloud-iam',
    hosts: [/^management\.azure\.com$/, /(?:^|\.)vault\.azure\.net$/, /^management\.usgovcloudapi\.net$/],
    strongPaths: [/\/providers\/microsoft\.authorization\//i, /\/roleassignments\b/i],
    paths: [],
    headers: [],
    tokens: [],
    ports: [],
    variables: [],
    authTypes: [],
  },
  {
    id: 'gcp-iam',
    name: 'Google Cloud IAM',
    family: 'cloud-iam',
    hosts: [
      /^iam\.googleapis\.com$/,
      /^secretmanager\.googleapis\.com$/,
      /^admin\.googleapis\.com$/,
      /^cloudresourcemanager\.googleapis\.com$/,
    ],
    strongPaths: [],
    paths: [],
    headers: [],
    tokens: [],
    ports: [],
    variables: [],
    authTypes: [],
  },
]

function union(patterns: RegExp[]): RegExp {
  return new RegExp(patterns.map((pattern) => `(?:${pattern.source})`).join('|'), 'i')
}

/**
 * One combined pattern per signal kind. A request that matches none of them cannot match any platform, which spares
 * the per-platform loop for almost every request of a collection that is not about identity. Variable names are left
 * out on purpose: with a weight of 0.15 they can never reach the detection threshold without another signal.
 */
const ANY_HOST = union(PLATFORM_FINGERPRINTS.flatMap((fingerprint) => fingerprint.hosts))
const ANY_PATH = union(PLATFORM_FINGERPRINTS.flatMap((fingerprint) => [...fingerprint.strongPaths, ...fingerprint.paths]))
const ANY_TOKEN = union(PLATFORM_FINGERPRINTS.flatMap((fingerprint) => fingerprint.tokens.map((token) => token.pattern)))
const SIGNAL_HEADER = new RegExp(
  `^(?:${[...new Set(PLATFORM_FINGERPRINTS.flatMap((fingerprint) => fingerprint.headers.map((header) => header.name.source.replace(/^\^|\$$/g, ''))))].join('|')})$`,
  'i'
)
const SIGNAL_PORTS = new Set(PLATFORM_FINGERPRINTS.flatMap((fingerprint) => fingerprint.ports))
const SIGNAL_AUTH = new Set(PLATFORM_FINGERPRINTS.flatMap((fingerprint) => fingerprint.authTypes))

function hasAnySignal(request: ParsedRequest, url: SplitUrl): boolean {
  if (url.host && ANY_HOST.test(url.host)) return true
  if (ANY_PATH.test(url.path)) return true
  if (url.port && SIGNAL_PORTS.has(url.port)) return true
  if (SIGNAL_AUTH.has(request.auth)) return true
  if (request.headers.some((header) => SIGNAL_HEADER.test(header.key.trim()))) return true
  return tokenSources(request).some((text) => ANY_TOKEN.test(text))
}

export interface RequestPlatformMatch {
  id: PlatformId
  score: number
  signals: string[]
}

function tokenSources(request: ParsedRequest): string[] {
  return [...request.headers.map((header) => header.value), ...(request.authFields ?? []).map((field) => field.value)]
}

/** Scores every platform for one request. Only matches at or above the detection threshold are returned. */
export function fingerprintRequest(request: ParsedRequest, url: SplitUrl): RequestPlatformMatch[] {
  const matches: RequestPlatformMatch[] = []
  if (!hasAnySignal(request, url)) return matches
  const variableNames = extractVariableNames(request.url)
  const tokenTexts = tokenSources(request)
  for (const fingerprint of PLATFORM_FINGERPRINTS) {
    let score = 0
    const signals: string[] = []
    const add = (weight: number, label: string) => {
      score += weight
      if (!signals.includes(label)) signals.push(label)
    }
    if (url.host && fingerprint.hosts.some((pattern) => pattern.test(url.host!))) add(WEIGHT.host, `host ${url.host}`)
    const strong = fingerprint.strongPaths.find((pattern) => pattern.test(url.path))
    if (strong) add(WEIGHT.strongPath, `path ${url.path}`)
    else if (fingerprint.paths.some((pattern) => pattern.test(url.path))) add(WEIGHT.path, `path ${url.path}`)
    for (const signal of fingerprint.headers) {
      const header = request.headers.find(
        (entry) => signal.name.test(entry.key.trim()) && (!signal.value || signal.value.test(entry.value.trim()))
      )
      if (header) add(WEIGHT.header, `header ${signal.label}`)
    }
    for (const token of fingerprint.tokens)
      if (tokenTexts.some((text) => token.pattern.test(text))) add(WEIGHT.token, `token ${token.label}`)
    if (url.port && fingerprint.ports.includes(url.port)) add(WEIGHT.port, `port ${url.port}`)
    if (variableNames.some((name) => fingerprint.variables.some((pattern) => pattern.test(name)))) add(WEIGHT.variable, 'variable name')
    if (fingerprint.authTypes.includes(request.auth)) add(WEIGHT.authType, `auth ${request.auth}`)
    if (score >= DETECTION_THRESHOLD) matches.push({ id: fingerprint.id, score: Math.min(1, score), signals })
  }
  return matches.sort((a, b) => b.score - a.score)
}

/** Detects the identity platforms a collection talks to. Several platforms per collection are normal. */
export function fingerprintPlatforms(
  parsed: ParsedCollection,
  urls?: ReadonlyMap<string, SplitUrl>
): {
  platforms: DetectedPlatform[]
  byRequest: Map<string, RequestPlatformMatch[]>
} {
  const byRequest = new Map<string, RequestPlatformMatch[]>()
  const found = new Map<PlatformId, { best: number; signals: Set<string>; requestIds: string[]; count: number; hosts: Set<string> }>()
  for (const request of parsed.requests) {
    const url = urls?.get(request.id) ?? splitUrl(request.url, parsed)
    const matches = fingerprintRequest(request, url)
    if (!matches.length) continue
    byRequest.set(request.id, matches)
    for (const match of matches) {
      const entry = found.get(match.id) ?? { best: 0, signals: new Set<string>(), requestIds: [], count: 0, hosts: new Set<string>() }
      entry.best = Math.max(entry.best, match.score)
      match.signals.forEach((signal) => entry.signals.size < 6 && entry.signals.add(signal))
      entry.count += 1
      if (entry.requestIds.length < MAX_LISTED) entry.requestIds.push(request.id)
      if (url.host && entry.hosts.size < 5) entry.hosts.add(url.host)
      found.set(match.id, entry)
    }
  }
  const platforms: DetectedPlatform[] = []
  for (const fingerprint of PLATFORM_FINGERPRINTS) {
    const entry = found.get(fingerprint.id)
    if (!entry) continue
    platforms.push({
      id: fingerprint.id,
      name: fingerprint.name,
      family: fingerprint.family,
      confidence: Math.round(Math.min(1, entry.best + Math.min(0.2, 0.04 * (entry.count - 1))) * 100) / 100,
      signals: [...entry.signals],
      requestIds: entry.requestIds,
      requestCount: entry.count,
      hosts: [...entry.hosts],
    })
  }
  return { platforms: platforms.sort((a, b) => b.confidence - a.confidence || b.requestCount - a.requestCount), byRequest }
}
