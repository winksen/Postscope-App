import {
  AUTH_HEADER_SCHEME,
  SESSION_COOKIE,
  TOKEN_HEADER,
  classifyBodySecret,
  findLeakedCollectionVariables,
  findLeakedScopedVariables,
  isQuerySecret,
  type Finding,
} from './auditor'
import type { ParsedCollection, ParsedRequest } from './parser'
import type { PostmanAuth, PostmanCollection, PostmanHeader, PostmanItem, PostmanUrl } from '../types/postman'
import { AUTH_FIELD_VARIABLES, isInheritedAuth, normalizeAuthType, secretFieldsFor } from './authSchemes'
import { isLikelySecretValue } from './secretPatterns'
import { toVariableName } from './variables'
import { detectIndent, parseTemplatedJson } from './jsonBody'
import { replaceRawBodyFields, scanRawBodyFields } from './rawBody'
import { scrubDescription } from './descriptions'

export type RepairFixKind =
  | 'hardcodedBaseUrl'
  | 'environmentUrl'
  | 'hardcodedAuthToken'
  | 'hardcodedApiKey'
  | 'basicAuthCredentials'
  | 'emptyHeaders'
  | 'collectionVariables'
  | 'missingDescription'
  | 'authHelperSecrets'
  | 'bodySecrets'
  | 'querySecrets'
  | 'secretVariables'
  | 'insecureHttp'
  | 'tlsVerification'
  | 'manualReview'

export type RepairRiskLevel = 'low' | 'medium' | 'high' | 'manual'

export interface RepairTarget {
  requestId: string
  requestName: string
  itemPath: number[]
}

export interface RepairVariable {
  key: string
  value: string
}

export interface RepairFix {
  id: string
  kind: RepairFixKind
  status: 'auto' | 'manual'
  category: Finding['category']
  title: string
  description: string
  risk: RepairRiskLevel
  selectedByDefault: boolean
  affectedRequestCount: number
  affectedRequests: RepairTarget[]
  findingTitle: string
  findingSeverity: Finding['severity']
  sourceFindingId: string
  beforeSnippet?: string
  afterSnippet?: string
  variablesToEnsure?: RepairVariable[]
  generatedDescriptions?: Record<string, string>
  manualReason?: string
  /** For base URL fixes: which collection variable replaces the host of each origin. */
  originVariables?: OriginVariable[]
  /** For `secretVariables`: folder and request variables whose values are cleared. */
  scopedVariables?: Array<{ ownerPath: number[]; key: string }>
  /** For `secretVariables`: collection variable keys whose values are cleared. */
  variableKeys?: string[]
  /** For `bodySecrets`: which body classifier the fix targets. */
  bodyRule?: 'HARDCODED_PASSWORD' | 'HARDCODED_SECRET'
}

/** One literal origin (`https://auth.example.com`) and the collection variable that replaces it. */
export interface OriginVariable {
  origin: string
  variable: string
  /** Requests in the collection that use this origin. */
  requestCount: number
}

export interface RepairPlan {
  fixes: RepairFix[]
  autoFixCount: number
  manualCount: number
  defaultSelectedFixIds: string[]
}

export interface AppliedRepair {
  fixId: string
  title: string
  affectedCount: number
  summary: string
}

export interface SkippedRepair {
  fixId: string
  title: string
  requestId?: string
  reason: string
}

interface UrlParts {
  origin: string
  pathQuery: string
}

const VARIABLE_PATTERN = /\{\{[^}]+\}\}/
const API_KEY_REGEX = /api.?key|x-api-key|apikey/i
const HEADER_PASSWORD_KEY = /passw|password|passwd/i

export function cloneJson<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value)) as T
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function variableExists(collection: unknown, key: string): boolean {
  const variables = (collection as PostmanCollection).variable
  return Array.isArray(variables) && variables.some((v) => v?.key === key)
}

export function ensureCollectionVariable(collection: unknown, key: string, value = ''): boolean {
  const col = collection as PostmanCollection
  if (!Array.isArray(col.variable)) col.variable = []
  if (variableExists(col, key)) return false
  col.variable.push({ key, value, type: 'string' })
  return true
}

export function isVariableValue(value: string | undefined): boolean {
  return !value || !value.trim() || VARIABLE_PATTERN.test(value)
}

function hostToString(host: PostmanUrl['host']): string {
  if (Array.isArray(host)) return host.join('.')
  return host || ''
}

function pathToString(path: PostmanUrl['path']): string {
  if (typeof path === 'string') return path ? `/${path.replace(/^\/+/, '')}` : ''
  if (!Array.isArray(path) || path.length === 0) return ''
  return `/${path.map((segment) => (typeof segment === 'string' ? segment : segment?.value ?? '')).join('/')}`
}

function queryToString(query: PostmanUrl['query']): string {
  if (!Array.isArray(query) || query.length === 0) return ''
  const params = query
    .filter((q) => q?.key && !q.disabled)
    .map((q) => `${encodeURIComponent(q.key)}=${encodeURIComponent(q.value ?? '')}`)
  return params.length ? `?${params.join('&')}` : ''
}

function postmanUrlToString(url: PostmanUrl): string {
  const protocol = url.protocol ? `${url.protocol}://` : ''
  return `${protocol}${hostToString(url.host)}${pathToString(url.path)}${queryToString(url.query)}`
}

function currentUrlString(url: string | PostmanUrl | undefined): string {
  if (!url) return ''
  return typeof url === 'string' ? url : url.raw || postmanUrlToString(url)
}

/**
 * Splits an absolute http(s) URL into its origin and the rest (path, query, hash), exactly as written.
 * The rest is never re-encoded, so `{{variables}}` in the path survive. Hosts that contain a variable are not
 * literal origins and return null.
 */
export function parseUrlParts(value: string | PostmanUrl | undefined): UrlParts | null {
  if (!value) return null
  const source = currentUrlString(value).trim()
  const match = source.match(/^(https?):\/\/([^/?#]*)([\s\S]*)$/i)
  if (!match) return null
  const authority = match[2].replace(/^[^@]*@/, '').toLowerCase()
  if (!authority || authority.includes('{{')) return null
  const scheme = match[1].toLowerCase()
  const defaultPort = scheme === 'https' ? ':443' : ':80'
  const host = authority.endsWith(defaultPort) ? authority.slice(0, -defaultPort.length) : authority
  const rest = match[3]
  return { origin: `${scheme}://${host}`, pathQuery: rest === '/' ? '' : rest }
}

/** `auth.example.com` becomes `authBaseUrl`; IP addresses and unusual hosts become `hostBaseUrl`. */
function baseUrlVariableName(origin: string): string {
  const host = origin.replace(/^https?:\/\//, '').replace(/:\d+$/, '')
  const label = /^[\d.]+$/.test(host) || host.includes(':') ? 'host' : host.split('.')[0]
  const words = label.split(/[^A-Za-z0-9]+/).filter(Boolean)
  const camel = words.map((word, index) => (index === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())).join('')
  const name = /^[A-Za-z]/.test(camel) ? camel : `host${camel}`
  return `${name || 'host'}BaseUrl`
}

/**
 * Maps every literal origin used by the collection to a collection variable. The most frequent origin keeps
 * `baseUrl`; the others get a readable name from the first host label (`authBaseUrl`), with a numeric suffix on
 * collisions. An existing `baseUrl` variable keeps its meaning: it is only reused for the origin it points at.
 */
export function buildOriginVariableMap(parsed: ParsedCollection): OriginVariable[] {
  const counts = new Map<string, number>()
  for (const request of parsed.requests) {
    const origin = parseUrlParts(request.url)?.origin
    if (origin) counts.set(origin, (counts.get(origin) ?? 0) + 1)
  }
  const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const existing = new Map((parsed.collectionVariables ?? []).map((variable) => [variable.key, variable.value]))
  const used = new Set(existing.keys())
  const result: OriginVariable[] = []

  const existingBaseOrigin = existing.has('baseUrl') ? parseUrlParts(existing.get('baseUrl'))?.origin : undefined
  const baseOrigin = existing.has('baseUrl') ? (existingBaseOrigin && counts.has(existingBaseOrigin) ? existingBaseOrigin : undefined) : ordered[0]?.[0]
  if (baseOrigin) {
    used.add('baseUrl')
    result.push({ origin: baseOrigin, variable: 'baseUrl', requestCount: counts.get(baseOrigin) ?? 0 })
  }
  for (const [origin, requestCount] of ordered) {
    if (origin === baseOrigin) continue
    const stem = baseUrlVariableName(origin)
    let variable = stem
    for (let suffix = 2; used.has(variable); suffix += 1) variable = `${stem}${suffix}`
    used.add(variable)
    result.push({ origin, variable, requestCount })
  }
  return result.sort((a, b) => b.requestCount - a.requestCount || a.origin.localeCompare(b.origin))
}

export function replaceUrlHostWithBaseUrl(
  url: string | PostmanUrl | undefined,
  variableFor: (origin: string) => string | undefined = () => 'baseUrl'
): {
  before: string
  after: string
  origin: string
  variable: string
} | null {
  if (!url) return null
  const parts = parseUrlParts(url)
  if (!parts) return null
  const variable = variableFor(parts.origin)
  if (!variable) return null
  return {
    before: currentUrlString(url),
    after: `{{${variable}}}${parts.pathQuery}`,
    origin: parts.origin,
    variable,
  }
}

export function getItemAtPath(rawJson: unknown, itemPath: number[]): PostmanItem | undefined {
  let items: PostmanItem[] | undefined = (rawJson as PostmanCollection)?.item
  let current: PostmanItem | undefined
  for (const index of itemPath) {
    if (!Array.isArray(items) || index < 0 || index >= items.length) return undefined
    current = items[index]
    if (!isRecord(current)) return undefined
    items = current.item
  }
  return current
}

/** Items from the collection root down to the item at `itemPath` (inclusive), skipping missing ones. */
function itemChain(rawJson: unknown, itemPath: number[]): PostmanItem[] {
  const chain: PostmanItem[] = []
  for (let depth = 1; depth <= itemPath.length; depth += 1) {
    const item = getItemAtPath(rawJson, itemPath.slice(0, depth))
    if (item) chain.push(item)
  }
  return chain
}

/** Auth object that Postman would actually use for the request at `itemPath` (request → folders → collection). */
function findEffectiveAuth(rawJson: unknown, itemPath: number[]): PostmanAuth | undefined {
  const target = getItemAtPath(rawJson, itemPath)
  if (target?.request?.auth && !isInheritedAuth(target.request.auth)) return target.request.auth
  const folders = itemChain(rawJson, itemPath.slice(0, -1)).reverse()
  for (const folder of folders) {
    if (folder.auth && !isInheritedAuth(folder.auth)) return folder.auth
  }
  const collectionAuth = (rawJson as PostmanCollection)?.auth
  return collectionAuth && !isInheritedAuth(collectionAuth) ? collectionAuth : undefined
}

function sanitizeIdPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'collection'
}

function hashString(value: string): string {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(i) | 0
  }
  return Math.abs(hash).toString(36)
}

function stableFixId(kind: RepairFixKind, finding: Finding): string {
  const affected = finding.affected.length ? finding.affected.join('|') : 'collection'
  return `${sanitizeIdPart(kind)}-${hashString(`${finding.title}|${finding.category}|${affected}`)}`
}

function requestTargets(finding: Finding, parsed: ParsedCollection): RepairTarget[] {
  const byId = new Map(parsed.requests.map((request) => [request.id, request]))
  return finding.affected
    .map((id) => byId.get(id))
    .filter((request): request is ParsedRequest => !!request)
    .map((request) => ({
      requestId: request.id,
      requestName: request.name,
      itemPath: request.itemPath,
    }))
}

const KIND_BY_RULE: Partial<Record<string, RepairFixKind>> = {
  HARDCODED_BASEURL: 'hardcodedBaseUrl',
  HARDCODED_ENV_URL: 'environmentUrl',
  HARDCODED_TOKEN: 'hardcodedAuthToken',
  HARDCODED_API_KEY: 'hardcodedApiKey',
  BASIC_AUTH_PLAINTEXT: 'basicAuthCredentials',
  EMPTY_HEADERS: 'emptyHeaders',
  NO_COLLECTION_VARIABLES: 'collectionVariables',
  MISSING_DESCRIPTION: 'missingDescription',
  HARDCODED_AUTH_CREDENTIAL: 'authHelperSecrets',
  HARDCODED_PASSWORD: 'bodySecrets',
  HARDCODED_SECRET: 'bodySecrets',
  SECRET_IN_QUERY: 'querySecrets',
  SECRET_IN_COLLECTION_VARIABLE: 'secretVariables',
  INSECURE_HTTP: 'insecureHttp',
  TLS_VERIFICATION_DISABLED: 'tlsVerification',
}

function findingKind(finding: Finding): RepairFixKind | null {
  if (finding.ruleId && KIND_BY_RULE[finding.ruleId]) return KIND_BY_RULE[finding.ruleId] ?? null
  // Fallback for findings created without a rule id (older data).
  const title = finding.title.toLowerCase()
  if (title === 'hardcoded base url') return 'hardcodedBaseUrl'
  if (title === 'environment-specific url') return 'environmentUrl'
  if (title === 'hardcoded authorization token') return 'hardcodedAuthToken'
  if (title === 'hardcoded api key') return 'hardcodedApiKey'
  if (title === 'basic auth with literal credentials') return 'basicAuthCredentials'
  if (title === 'requests with empty header values') return 'emptyHeaders'
  if (title === 'few collection variables defined') return 'collectionVariables'
  if (title === 'requests without description') return 'missingDescription'
  return null
}

function originSetForRequests(requests: ParsedRequest[]): string[] {
  return [...new Set(requests.map((request) => parseUrlParts(request.url)?.origin).filter((origin): origin is string => !!origin))]
}

function firstAffectedRequest(finding: Finding, parsed: ParsedCollection): ParsedRequest | undefined {
  return parsed.requests.find((request) => finding.affected.includes(request.id))
}

function headerSnippet(
  request: ParsedRequest | undefined,
  matcher: (header: { key: string; value: string }) => boolean,
  includeDisabled = false
): string | undefined {
  const header = request?.headers.find(matcher) ?? (includeDisabled ? request?.disabledHeaders?.find(matcher) : undefined)
  if (!header) return undefined
  return `${header.key}: ${header.value ? '***' : '""'}`
}

function authVariablesForTargets(targets: RepairTarget[], parsed: ParsedCollection): RepairVariable[] {
  const targetIds = new Set(targets.map((target) => target.requestId))
  const keys = new Set<string>()
  for (const request of parsed.requests) {
    if (!targetIds.has(request.id)) continue
    for (const header of [...request.headers, ...(request.disabledHeaders ?? [])]) {
      if (isVariableValue(header.value)) continue
      const lower = header.key.toLowerCase()
      if (lower === 'cookie') keys.add('sessionCookie')
      else if (lower !== 'authorization' && lower !== 'proxy-authorization') {
        if (TOKEN_HEADER.test(lower)) keys.add('token')
      } else if (/^Basic\s+/i.test(header.value)) keys.add('basicAuthToken')
      else keys.add('token')
    }
  }
  if (keys.size === 0) keys.add('token')
  return [...keys].map((key) => ({ key, value: '' }))
}

export function buildGeneratedDescription(request: ParsedRequest): string {
  const parts = parseUrlParts(request.url)
  let target = parts?.pathQuery.split(/[?#]/)[0] || request.url || request.name
  if (target.startsWith('{{baseUrl}}')) target = target.replace('{{baseUrl}}', '') || '/'
  if (!target.startsWith('/') && !/^https?:\/\//i.test(target)) target = `/${target}`
  return `Sends a ${request.method} request to ${target}.`
}

function buildFixForFinding(rawJson: unknown, parsed: ParsedCollection, finding: Finding): RepairFix {
  const kind = findingKind(finding) || 'manualReview'
  const targets = requestTargets(finding, parsed)
  const affectedRequest = firstAffectedRequest(finding, parsed)
  const base = {
    id: stableFixId(kind, finding),
    kind,
    category: finding.category,
    affectedRequestCount: targets.length,
    affectedRequests: targets,
    findingTitle: finding.title,
    findingSeverity: finding.severity,
    sourceFindingId: finding.id,
  }

  if (kind === 'hardcodedBaseUrl' || kind === 'environmentUrl') {
    const targetRequests = parsed.requests.filter((request) => finding.affected.includes(request.id))
    const targetOrigins = new Set(originSetForRequests(targetRequests))
    const originVariables = buildOriginVariableMap(parsed).filter((entry) => targetOrigins.has(entry.origin))
    const variableFor = (origin: string) => originVariables.find((entry) => entry.origin === origin)?.variable
    const example = affectedRequest ? replaceUrlHostWithBaseUrl(affectedRequest.url, variableFor) : null
    const mappings = originVariables.map((entry) => `${entry.origin} becomes {{${entry.variable}}}`).join('; ')
    return {
      ...base,
      status: 'auto',
      title: kind === 'hardcodedBaseUrl' ? 'Replace hardcoded base URL' : 'Parameterize environment URL',
      description:
        originVariables.length > 1
          ? `Replaces literal hosts with collection variables while preserving paths and query strings. Each host gets its own variable so requests keep calling the same server: ${mappings}.`
          : `Replaces the literal scheme and host with ${originVariables[0] ? `{{${originVariables[0].variable}}}` : '{{baseUrl}}'} while preserving paths and query strings.`,
      risk: 'medium',
      selectedByDefault: true,
      beforeSnippet: example?.before,
      afterSnippet: example?.after,
      originVariables,
      variablesToEnsure: originVariables.map((entry) => ({ key: entry.variable, value: entry.origin })),
    }
  }

  if (kind === 'hardcodedAuthToken') {
    const beforeSnippet = headerSnippet(affectedRequest, (header) => {
      const lower = header.key.toLowerCase()
      return lower === 'authorization' || lower === 'proxy-authorization' || lower === 'cookie' || TOKEN_HEADER.test(lower)
    }, true)
    const afterSnippet = beforeSnippet?.toLowerCase().includes('basic') ? 'Authorization: Basic {{basicAuthToken}}' : 'Authorization: Bearer {{token}}'
    return {
      ...base,
      status: 'auto',
      title: 'Move Authorization token to variable',
      description: 'Replaces literal Authorization, token, and session cookie header values with collection variables.',
      risk: 'medium',
      selectedByDefault: true,
      beforeSnippet,
      afterSnippet,
      variablesToEnsure: authVariablesForTargets(targets, parsed),
    }
  }

  if (kind === 'hardcodedApiKey') {
    return {
      ...base,
      status: 'auto',
      title: 'Move API key headers to variable',
      description: 'Replaces literal API key header values with {{apiKey}} and defines the variable if needed.',
      risk: 'low',
      selectedByDefault: true,
      beforeSnippet: headerSnippet(affectedRequest, (header) => API_KEY_REGEX.test(header.key), true),
      afterSnippet: 'x-api-key: {{apiKey}}',
      variablesToEnsure: [{ key: 'apiKey', value: '' }],
    }
  }

  if (kind === 'basicAuthCredentials') {
    return {
      ...base,
      status: 'auto',
      title: 'Move Basic auth credentials to variables',
      description: 'Replaces literal username and password fields in Postman Basic auth with {{username}} and {{password}}, including auth inherited from folders or the collection.',
      risk: 'low',
      selectedByDefault: true,
      beforeSnippet: 'Basic auth username/password: ***',
      afterSnippet: 'Basic auth username/password: {{username}} / {{password}}',
      variablesToEnsure: [
        { key: 'username', value: '' },
        { key: 'password', value: '' },
      ],
    }
  }

  if (kind === 'emptyHeaders') {
    return {
      ...base,
      status: 'auto',
      title: 'Disable empty headers',
      description: 'Marks empty Postman headers as disabled so they stay visible for review without being sent.',
      risk: 'low',
      selectedByDefault: true,
      beforeSnippet: headerSnippet(affectedRequest, (header) => !header.value?.trim()),
      afterSnippet: 'Header disabled',
    }
  }

  if (kind === 'collectionVariables') {
    const inferredBaseUrl = originSetForRequests(parsed.requests)[0] || ''
    return {
      ...base,
      status: 'auto',
      title: 'Add starter collection variables',
      description: 'Adds missing baseUrl, apiKey, and token collection variables without changing request values.',
      risk: 'low',
      selectedByDefault: true,
      affectedRequestCount: 0,
      variablesToEnsure: [
        { key: 'baseUrl', value: inferredBaseUrl },
        { key: 'apiKey', value: '' },
        { key: 'token', value: '' },
      ],
      beforeSnippet: `Variables: ${(rawJson as PostmanCollection).variable?.length ?? 0}`,
      afterSnippet: 'Variables include baseUrl, apiKey, token',
    }
  }

  if (kind === 'missingDescription') {
    const generatedDescriptions = Object.fromEntries(
      parsed.requests
        .filter((request) => finding.affected.includes(request.id))
        .map((request) => [request.id, buildGeneratedDescription(request)])
    )
    return {
      ...base,
      status: 'auto',
      title: 'Generate request descriptions',
      description: 'Documentation polish: adds concise descriptions from each request method and path.',
      risk: 'low',
      selectedByDefault: false,
      beforeSnippet: 'Description: empty',
      afterSnippet: affectedRequest ? buildGeneratedDescription(affectedRequest) : undefined,
      generatedDescriptions,
    }
  }

  if (kind === 'authHelperSecrets') {
    const location = finding.evidence?.[0]?.location
    return {
      ...base,
      status: 'auto',
      title: 'Move auth settings credentials to variables',
      description:
        'Replaces literal tokens and secrets in Postman auth helpers (request, folder, and collection level) with variables such as {{token}}, {{apiKey}}, and {{clientSecret}}.',
      risk: 'medium',
      selectedByDefault: true,
      beforeSnippet: location ? `${location}: ***` : 'Auth helper secret: ***',
      afterSnippet: 'Auth helper secret: {{token}}',
    }
  }

  if (kind === 'bodySecrets') {
    const bodyRule = finding.ruleId === 'HARDCODED_PASSWORD' ? 'HARDCODED_PASSWORD' : 'HARDCODED_SECRET'
    const field = finding.evidence?.find((evidence) => evidence.location.startsWith('body'))?.location.split(/[ .]/).pop()
    return {
      ...base,
      status: 'auto',
      title: bodyRule === 'HARDCODED_PASSWORD' ? 'Move passwords to variables' : 'Move body secrets to variables',
      description:
        bodyRule === 'HARDCODED_PASSWORD'
          ? 'Replaces literal password values in password headers, JSON bodies, and form fields with variables named after each field.'
          : 'Replaces literal secrets and tokens in JSON bodies and form fields with variables named after each field. Non-JSON raw bodies are left for manual review.',
      risk: 'medium',
      selectedByDefault: true,
      bodyRule,
      beforeSnippet: field ? `"${field}": "***"` : undefined,
      afterSnippet: field ? `"${field}": "{{${toVariableName(field)}}}"` : undefined,
    }
  }

  if (kind === 'querySecrets') {
    const param = affectedRequest?.queryParams?.find((entry) => isQuerySecret(entry.key, entry.value))
    return {
      ...base,
      status: 'auto',
      title: 'Move query string secrets to variables',
      description: 'Replaces literal credential query parameter values with variables named after each parameter.',
      risk: 'medium',
      selectedByDefault: true,
      beforeSnippet: param ? `?${param.key}=***` : undefined,
      afterSnippet: param ? `?${param.key}={{${toVariableName(param.key)}}}` : undefined,
    }
  }

  if (kind === 'secretVariables') {
    const leaked = findLeakedCollectionVariables(parsed)
    const leakedScoped = findLeakedScopedVariables(parsed)
    const first = leaked[0] ?? leakedScoped[0]
    return {
      ...base,
      status: 'auto',
      title: 'Clear secret collection variable values',
      description:
        'Empties the values of credential-like collection, folder and request variables so the export no longer carries them. Set the real values in a private environment or vault afterwards.',
      risk: 'medium',
      selectedByDefault: true,
      variableKeys: leaked.map((variable) => variable.key),
      scopedVariables: leakedScoped.map((variable) => ({ ownerPath: variable.ownerPath, key: variable.key })),
      beforeSnippet: first ? `${first.key} = ***` : undefined,
      afterSnippet: first ? `${first.key} = ""` : undefined,
    }
  }

  if (kind === 'insecureHttp') {
    const example = affectedRequest?.url
    return {
      ...base,
      status: 'auto',
      title: 'Upgrade plaintext endpoints to HTTPS',
      description:
        'Rewrites http:// and ws:// URLs (and a leading {{variable}} that resolves to one) to https:// and wss://. Only apply when the servers support TLS.',
      risk: 'high',
      selectedByDefault: false,
      beforeSnippet: example,
      afterSnippet: example?.replace(/^http:\/\//i, 'https://').replace(/^ws:\/\//i, 'wss://'),
    }
  }

  if (kind === 'tlsVerification') {
    return {
      ...base,
      status: 'auto',
      title: 'Re-enable TLS certificate verification',
      description: 'Removes strictSSL: false from affected requests, their folders, and the collection. Requests to servers with self-signed certificates will fail until their CA is trusted.',
      risk: 'medium',
      selectedByDefault: false,
      beforeSnippet: 'protocolProfileBehavior.strictSSL: false',
      afterSnippet: 'Certificate verification on (default)',
    }
  }

  return {
    ...base,
    status: 'manual',
    title: `Manual review: ${finding.title}`,
    description: finding.recommendation,
    risk: 'manual',
    selectedByDefault: false,
    manualReason:
      finding.ruleId === 'SECRET_IN_ENVIRONMENT'
        ? 'The secret lives in an environment or globals file, not in the collection. Use Export, Sanitized environments (or the CLI --sanitize option) to get copies with the values emptied.'
        : finding.ruleId === 'HIGH_ENTROPY_LITERAL'
          ? 'Confirm whether the value is a credential before moving it to a variable.'
          : 'This finding needs human context before changing the collection.',
  }
}

export function createRepairPlan(rawJson: unknown, parsed: ParsedCollection, findings: Finding[]): RepairPlan {
  const fixes = findings.map((finding) => buildFixForFinding(rawJson, parsed, finding))
  return {
    fixes,
    autoFixCount: fixes.filter((fix) => fix.status === 'auto').length,
    manualCount: fixes.filter((fix) => fix.status === 'manual').length,
    defaultSelectedFixIds: fixes.filter((fix) => fix.status === 'auto' && fix.selectedByDefault).map((fix) => fix.id),
  }
}

interface PatchResult {
  changed: number
  skipped: SkippedRepair[]
  variables: RepairVariable[]
}

function applyUrlPatch(collection: unknown, fix: RepairFix): {
  changed: number
  skipped: SkippedRepair[]
} {
  let changed = 0
  const skipped: SkippedRepair[] = []
  const variableByOrigin = new Map((fix.originVariables ?? []).map((entry) => [entry.origin, entry.variable]))

  for (const target of fix.affectedRequests) {
    const item = getItemAtPath(collection, target.itemPath)
    if (!item?.request) {
      skipped.push({ fixId: fix.id, title: fix.title, requestId: target.requestId, reason: 'Request item was not found.' })
      continue
    }

    const url = item.request.url
    const replacement = replaceUrlHostWithBaseUrl(url, (origin) => variableByOrigin.get(origin))
    if (!replacement) {
      if (VARIABLE_PATTERN.test(currentUrlString(url))) continue
      const known = parseUrlParts(url)
      skipped.push({
        fixId: fix.id,
        title: fix.title,
        requestId: target.requestId,
        reason: known ? `No variable was planned for ${known.origin}.` : 'URL was not an absolute HTTP URL.',
      })
      continue
    }

    if (typeof url === 'string') {
      item.request.url = replacement.after
    } else if (isRecord(url)) {
      url.raw = replacement.after
      url.host = [`{{${replacement.variable}}}`]
      delete url.protocol
      delete url.port
    } else {
      item.request.url = replacement.after
    }
    changed += 1
  }

  return { changed, skipped }
}

function applyHeaderPatch(
  collection: unknown,
  fix: RepairFix,
  patcher: (header: PostmanHeader) => { changed: boolean; variables: RepairVariable[] }
): PatchResult {
  let changed = 0
  const variables = new Map<string, RepairVariable>()
  const skipped: SkippedRepair[] = []

  for (const target of fix.affectedRequests) {
    const item = getItemAtPath(collection, target.itemPath)
    const headers = item?.request?.header
    if (!Array.isArray(headers)) {
      skipped.push({ fixId: fix.id, title: fix.title, requestId: target.requestId, reason: 'Request headers were not found.' })
      continue
    }

    let changedForRequest = false
    for (const header of headers) {
      if (!isRecord(header) || typeof header.value !== 'string' || typeof header.key !== 'string') continue
      const result = patcher(header)
      if (result.changed) {
        changed += 1
        changedForRequest = true
        result.variables.forEach((variable) => variables.set(variable.key, variable))
      }
    }
    if (!changedForRequest) {
      skipped.push({ fixId: fix.id, title: fix.title, requestId: target.requestId, reason: 'No matching literal header value was found.' })
    }
  }

  return { changed, skipped, variables: [...variables.values()] }
}

function patchAuthorizationHeader(header: PostmanHeader): { changed: boolean; variables: RepairVariable[] } {
  const value = header.value.trim()
  if (/^Bearer\s+/i.test(value)) {
    header.value = 'Bearer {{token}}'
    return { changed: true, variables: [{ key: 'token', value: '' }] }
  }
  if (/^Basic\s+/i.test(value)) {
    header.value = 'Basic {{basicAuthToken}}'
    return { changed: true, variables: [{ key: 'basicAuthToken', value: '' }] }
  }
  const scheme = value.match(AUTH_HEADER_SCHEME)
  if (scheme) {
    header.value = `${scheme[1]} {{token}}`
    return { changed: true, variables: [{ key: 'token', value: '' }] }
  }
  if (!/\s/.test(value) && value.length >= 16) {
    header.value = '{{token}}'
    return { changed: true, variables: [{ key: 'token', value: '' }] }
  }
  return { changed: false, variables: [] }
}

export function patchHeaders(collection: unknown, fix: RepairFix): PatchResult {
  if (fix.kind === 'hardcodedAuthToken') {
    return applyHeaderPatch(collection, fix, (header) => {
      if (isVariableValue(header.value)) return { changed: false, variables: [] }
      const lower = header.key.toLowerCase()
      if (lower === 'authorization' || lower === 'proxy-authorization') return patchAuthorizationHeader(header)
      if (TOKEN_HEADER.test(lower) && isLikelySecretValue(header.value)) {
        header.value = '{{token}}'
        return { changed: true, variables: [{ key: 'token', value: '' }] }
      }
      if (lower === 'cookie') {
        const cookie = header.value.match(SESSION_COOKIE)
        if (cookie && isLikelySecretValue(cookie[2])) {
          header.value = header.value.replace(`${cookie[1]}=${cookie[2]}`, `${cookie[1]}={{sessionCookie}}`)
          return { changed: true, variables: [{ key: 'sessionCookie', value: '' }] }
        }
      }
      return { changed: false, variables: [] }
    })
  }

  if (fix.kind === 'hardcodedApiKey') {
    return applyHeaderPatch(collection, fix, (header) => {
      if (!API_KEY_REGEX.test(header.key) || isVariableValue(header.value)) {
        return { changed: false, variables: [] }
      }
      header.value = '{{apiKey}}'
      return { changed: true, variables: [{ key: 'apiKey', value: '' }] }
    })
  }

  if (fix.kind === 'emptyHeaders') {
    return applyHeaderPatch(collection, fix, (header) => {
      if (header.disabled || header.value?.trim()) return { changed: false, variables: [] }
      header.disabled = true
      return { changed: true, variables: [] }
    })
  }

  return { changed: 0, skipped: [], variables: [] }
}

export function patchBasicAuth(collection: unknown, fix: RepairFix): {
  changed: number
  skipped: SkippedRepair[]
} {
  let changed = 0
  const skipped: SkippedRepair[] = []
  const patchedOwners = new Set<PostmanAuth>()

  for (const target of fix.affectedRequests) {
    const auth = findEffectiveAuth(collection, target.itemPath)
    const basic = auth && normalizeAuthType(auth.type) === 'basic' ? auth.basic : undefined
    if (!auth || !Array.isArray(basic)) {
      skipped.push({ fixId: fix.id, title: fix.title, requestId: target.requestId, reason: 'Basic auth fields were not found.' })
      continue
    }
    // Inherited auth is shared: patch the owner once and count every request it covers.
    if (patchedOwners.has(auth)) continue
    patchedOwners.add(auth)

    let changedForOwner = false
    for (const entry of basic) {
      if (!isRecord(entry)) continue
      if (entry.key === 'username' && !isVariableValue(entry.value)) {
        entry.value = '{{username}}'
        changed += 1
        changedForOwner = true
      }
      if (entry.key === 'password' && !isVariableValue(entry.value)) {
        entry.value = '{{password}}'
        changed += 1
        changedForOwner = true
      }
    }
    if (!changedForOwner) {
      skipped.push({ fixId: fix.id, title: fix.title, requestId: target.requestId, reason: 'No literal Basic auth credentials were found.' })
    }
  }

  return { changed, skipped }
}

/** Replaces literal secret fields of one auth object; returns the variables it introduced. */
function patchAuthObject(auth: PostmanAuth, variables: Map<string, RepairVariable>): number {
  const type = normalizeAuthType(auth.type)
  const fields = type === 'basic' ? ['username', 'password'] : secretFieldsFor(type)
  if (!fields.length) return 0
  const rawType = typeof auth.type === 'string' ? auth.type : type
  const block = (auth as Record<string, unknown>)[rawType] ?? (auth as Record<string, unknown>)[type]
  let changed = 0

  const replacement = (field: string) => {
    const name = AUTH_FIELD_VARIABLES[field] ?? field
    variables.set(name, { key: name, value: '' })
    return `{{${name}}}`
  }
  const shouldPatch = (field: string, value: unknown) =>
    typeof value === 'string' && (field === 'username' ? !isVariableValue(value) : isLikelySecretValue(value))

  if (Array.isArray(block)) {
    for (const entry of block) {
      if (!isRecord(entry) || typeof entry.key !== 'string' || !fields.includes(entry.key)) continue
      if (shouldPatch(entry.key, entry.value)) {
        entry.value = replacement(entry.key)
        changed += 1
      }
    }
  } else if (isRecord(block)) {
    for (const field of fields) {
      if (shouldPatch(field, block[field])) {
        block[field] = replacement(field)
        changed += 1
      }
    }
  }
  return changed
}

function patchAuthHelperSecrets(collection: unknown): PatchResult {
  const variables = new Map<string, RepairVariable>()
  let changed = 0
  const col = collection as PostmanCollection

  const visitAuth = (auth: unknown) => {
    if (isRecord(auth) && !isInheritedAuth(auth)) changed += patchAuthObject(auth as PostmanAuth, variables)
  }
  const walk = (items: unknown, depth: number) => {
    if (!Array.isArray(items) || depth > 100) return
    for (const item of items) {
      if (!isRecord(item)) continue
      visitAuth(item.auth)
      if (isRecord(item.request)) visitAuth(item.request.auth)
      walk(item.item, depth + 1)
    }
  }

  visitAuth(col.auth)
  walk(col.item, 0)
  return { changed, skipped: [], variables: [...variables.values()] }
}

function replaceJsonSecrets(value: unknown, rule: 'HARDCODED_PASSWORD' | 'HARDCODED_SECRET', variables: Map<string, RepairVariable>, depth = 0): number {
  if (depth > 50 || value === null || typeof value !== 'object') return 0
  let changed = 0
  if (Array.isArray(value)) {
    value.forEach((child) => {
      changed += replaceJsonSecrets(child, rule, variables, depth + 1)
    })
    return changed
  }
  const record = value as Record<string, unknown>
  for (const [key, child] of Object.entries(record)) {
    if (typeof child === 'string') {
      if (classifyBodySecret(key, child) === rule) {
        const name = toVariableName(key)
        record[key] = `{{${name}}}`
        variables.set(name, { key: name, value: '' })
        changed += 1
      }
    } else {
      changed += replaceJsonSecrets(child, rule, variables, depth + 1)
    }
  }
  return changed
}

/** Replaces credentials in a `description` that is a string or `{ content, type }`. Returns how many were replaced. */
function scrubDescriptionOf(owner: unknown): number {
  if (!isRecord(owner)) return 0
  const description = owner.description
  if (typeof description === 'string') {
    const result = scrubDescription(description, '{{REDACTED}}')
    if (result.count) owner.description = result.text
    return result.count
  }
  if (isRecord(description) && typeof description.content === 'string') {
    const result = scrubDescription(description.content, '{{REDACTED}}')
    if (result.count) description.content = result.text
    return result.count
  }
  return 0
}

function patchBodySecrets(collection: unknown, fix: RepairFix): PatchResult {
  const rule = fix.bodyRule ?? 'HARDCODED_SECRET'
  const variables = new Map<string, RepairVariable>()
  const skipped: SkippedRepair[] = []
  let changed = 0

  for (const target of fix.affectedRequests) {
    const item = getItemAtPath(collection, target.itemPath)
    const request = item?.request
    if (!request) {
      skipped.push({ fixId: fix.id, title: fix.title, requestId: target.requestId, reason: 'Request item was not found.' })
      continue
    }
    let changedForRequest = 0

    if (rule === 'HARDCODED_PASSWORD' && Array.isArray(request.header)) {
      for (const header of request.header) {
        if (!isRecord(header) || typeof header.key !== 'string' || typeof header.value !== 'string') continue
        if (HEADER_PASSWORD_KEY.test(header.key) && !isVariableValue(header.value)) {
          const name = toVariableName(header.key, 'password')
          header.value = `{{${name}}}`
          variables.set(name, { key: name, value: '' })
          changedForRequest += 1
        }
      }
    }

    const body = request.body
    if (isRecord(body)) {
      for (const mode of ['urlencoded', 'formdata'] as const) {
        const fields = body[mode]
        if (!Array.isArray(fields)) continue
        for (const field of fields) {
          if (!isRecord(field) || field.type === 'file' || typeof field.key !== 'string' || typeof field.value !== 'string') continue
          if (classifyBodySecret(field.key, field.value) === rule) {
            const name = toVariableName(field.key)
            field.value = `{{${name}}}`
            variables.set(name, { key: name, value: '' })
            changedForRequest += 1
          }
        }
      }
      if (typeof body.raw === 'string' && (!body.mode || body.mode === 'raw')) {
        const templated = parseTemplatedJson(body.raw)
        if (templated) {
          const replaced = replaceJsonSecrets(templated.value, rule, variables)
          if (replaced > 0) {
            body.raw = templated.restore(JSON.stringify(templated.value, null, detectIndent(body.raw)))
            changedForRequest += replaced
          }
        } else {
          // Not JSON (XML/SOAP, form-like text): replace the matching field values in place.
          const replacements = scanRawBodyFields(body.raw)
            .filter((field) => classifyBodySecret(field.key, field.value) === rule)
            .map((field) => {
              const name = toVariableName(field.key)
              variables.set(name, { key: name, value: '' })
              return { field, value: `{{${name}}}` }
            })
          if (replacements.length > 0) {
            body.raw = replaceRawBodyFields(body.raw, replacements)
            changedForRequest += replacements.length
          }
        }
      }
    }

    if (rule === 'HARDCODED_SECRET') {
      // Credentials pasted into the request documentation are reported under the same rule.
      changedForRequest += scrubDescriptionOf(item) + scrubDescriptionOf(request)
    }

    if (changedForRequest === 0) {
      skipped.push({ fixId: fix.id, title: fix.title, requestId: target.requestId, reason: 'No literal value could be replaced automatically (body is not JSON or form data).' })
    }
    changed += changedForRequest
  }

  return { changed, skipped, variables: [...variables.values()] }
}

function patchQuerySecrets(collection: unknown, fix: RepairFix): PatchResult {
  const variables = new Map<string, RepairVariable>()
  const skipped: SkippedRepair[] = []
  let changed = 0

  const replaceInRaw = (raw: string, key: string, value: string, replacement: string) =>
    raw.replace(new RegExp(`([?&]${escapeRegExp(key)}=)${escapeRegExp(value)}(?=&|#|$)`), `$1${replacement}`)

  for (const target of fix.affectedRequests) {
    const item = getItemAtPath(collection, target.itemPath)
    const request = item?.request
    if (!request?.url) {
      skipped.push({ fixId: fix.id, title: fix.title, requestId: target.requestId, reason: 'Request URL was not found.' })
      continue
    }
    let changedForRequest = 0

    if (typeof request.url === 'string') {
      const queryStart = request.url.indexOf('?')
      if (queryStart !== -1) {
        const [query, hash = ''] = request.url.slice(queryStart + 1).split('#')
        const pairs = query.split('&').map((pair) => {
          const eq = pair.indexOf('=')
          if (eq === -1) return pair
          const key = pair.slice(0, eq)
          const value = pair.slice(eq + 1)
          let decoded = value
          try {
            decoded = decodeURIComponent(value)
          } catch {
            /* keep raw */
          }
          if (!isQuerySecret(key, decoded)) return pair
          const name = toVariableName(key)
          variables.set(name, { key: name, value: '' })
          changedForRequest += 1
          return `${key}={{${name}}}`
        })
        request.url = `${request.url.slice(0, queryStart)}?${pairs.join('&')}${hash ? `#${hash}` : ''}`
      }
    } else if (isRecord(request.url)) {
      const url = request.url as PostmanUrl
      for (const param of Array.isArray(url.query) ? url.query : []) {
        if (!isRecord(param) || typeof param.key !== 'string' || typeof param.value !== 'string') continue
        if (!isQuerySecret(param.key, param.value)) continue
        const name = toVariableName(param.key)
        const replacement = `{{${name}}}`
        if (typeof url.raw === 'string') {
          url.raw = replaceInRaw(replaceInRaw(url.raw, param.key, param.value, replacement), param.key, encodeURIComponent(param.value), replacement)
        }
        param.value = replacement
        variables.set(name, { key: name, value: '' })
        changedForRequest += 1
      }
    }

    if (changedForRequest === 0) {
      skipped.push({ fixId: fix.id, title: fix.title, requestId: target.requestId, reason: 'No literal query parameter secret was found.' })
    }
    changed += changedForRequest
  }

  return { changed, skipped, variables: [...variables.values()] }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function patchSecretVariables(collection: unknown, fix: RepairFix): PatchResult {
  const keys = new Set(fix.variableKeys ?? [])
  const col = collection as PostmanCollection
  let changed = 0
  for (const variable of Array.isArray(col.variable) ? col.variable : []) {
    if (isRecord(variable) && keys.has(variable.key) && typeof variable.value === 'string' && variable.value) {
      variable.value = ''
      changed += 1
    }
  }
  for (const target of fix.scopedVariables ?? []) {
    const item = getItemAtPath(collection, target.ownerPath) as { variable?: unknown } | undefined
    for (const variable of Array.isArray(item?.variable) ? item.variable : []) {
      if (isRecord(variable) && variable.key === target.key && typeof variable.value === 'string' && variable.value) {
        variable.value = ''
        changed += 1
      }
    }
  }
  return { changed, skipped: [], variables: [] }
}

function upgradeScheme(url: string): string {
  return url.replace(/^http:\/\//i, 'https://').replace(/^ws:\/\//i, 'wss://')
}

function patchInsecureHttp(collection: unknown, fix: RepairFix): PatchResult {
  const col = collection as PostmanCollection
  const skipped: SkippedRepair[] = []
  const upgradedVariables = new Set<string>()
  let changed = 0

  for (const target of fix.affectedRequests) {
    const request = getItemAtPath(collection, target.itemPath)?.request
    if (!request?.url) {
      skipped.push({ fixId: fix.id, title: fix.title, requestId: target.requestId, reason: 'Request URL was not found.' })
      continue
    }
    const current = currentUrlString(request.url)
    const leadingVariable = current.match(/^\{\{\s*([^{}]+?)\s*\}\}/)?.[1]

    if (leadingVariable) {
      const variable = Array.isArray(col.variable) ? col.variable.find((entry) => entry?.key === leadingVariable) : undefined
      if (variable && typeof variable.value === 'string' && /^(http|ws):\/\//i.test(variable.value)) {
        if (!upgradedVariables.has(leadingVariable)) {
          variable.value = upgradeScheme(variable.value)
          upgradedVariables.add(leadingVariable)
          changed += 1
        }
        continue
      }
      skipped.push({ fixId: fix.id, title: fix.title, requestId: target.requestId, reason: `{{${leadingVariable}}} is not defined as a collection variable.` })
      continue
    }

    if (typeof request.url === 'string') {
      request.url = upgradeScheme(request.url)
    } else if (isRecord(request.url)) {
      const url = request.url as PostmanUrl
      if (typeof url.raw === 'string') url.raw = upgradeScheme(url.raw)
      if (url.protocol === 'http') url.protocol = 'https'
      if (url.protocol === 'ws') url.protocol = 'wss'
    }
    changed += 1
  }

  return { changed, skipped, variables: [] }
}

function patchTlsVerification(collection: unknown, fix: RepairFix): PatchResult {
  let changed = 0
  const clear = (owner: unknown) => {
    if (!isRecord(owner) || !isRecord(owner.protocolProfileBehavior)) return
    if (owner.protocolProfileBehavior.strictSSL === false) {
      delete owner.protocolProfileBehavior.strictSSL
      changed += 1
    }
  }
  clear(collection)
  for (const target of fix.affectedRequests) {
    itemChain(collection, target.itemPath).forEach(clear)
  }
  return { changed, skipped: [], variables: [] }
}

function patchDescriptions(collection: unknown, fix: RepairFix): {
  changed: number
  skipped: SkippedRepair[]
} {
  let changed = 0
  const skipped: SkippedRepair[] = []

  for (const target of fix.affectedRequests) {
    const item = getItemAtPath(collection, target.itemPath)
    if (!item?.request) {
      skipped.push({ fixId: fix.id, title: fix.title, requestId: target.requestId, reason: 'Request item was not found.' })
      continue
    }
    const existing = item.request.description as unknown
    const existingText = typeof existing === 'string' ? existing : isRecord(existing) ? String(existing.content ?? '') : ''
    if (existingText.trim()) {
      skipped.push({ fixId: fix.id, title: fix.title, requestId: target.requestId, reason: 'Request already has a description.' })
      continue
    }
    item.request.description = fix.generatedDescriptions?.[target.requestId] || 'Sends a documented API request.'
    changed += 1
  }

  return { changed, skipped }
}

export function applyRepairPlan(rawJson: unknown, selectedFixIds: string[], plan: RepairPlan): {
  fixedJson: unknown
  applied: AppliedRepair[]
  skipped: SkippedRepair[]
} {
  const fixedJson = cloneJson(rawJson)
  const selected = new Set(selectedFixIds)
  const applied: AppliedRepair[] = []
  const skipped: SkippedRepair[] = []

  for (const fix of plan.fixes) {
    if (!selected.has(fix.id)) continue
    if (fix.status !== 'auto') {
      skipped.push({ fixId: fix.id, title: fix.title, reason: 'Manual-review fixes cannot be applied automatically.' })
      continue
    }

    let changed = 0
    let variables = fix.variablesToEnsure || []
    let localSkipped: SkippedRepair[] = []
    let action = 'Updated collection.'

    if (fix.kind === 'hardcodedBaseUrl' || fix.kind === 'environmentUrl') {
      const result = applyUrlPatch(fixedJson, fix)
      changed = result.changed
      localSkipped = result.skipped
      action = `Replaced URL hosts with collection variables in ${changed} request(s).`
    } else if (fix.kind === 'hardcodedAuthToken' || fix.kind === 'hardcodedApiKey' || fix.kind === 'emptyHeaders') {
      const result = patchHeaders(fixedJson, fix)
      changed = result.changed
      localSkipped = result.skipped
      variables = result.variables.length ? result.variables : variables
      action = fix.kind === 'emptyHeaders'
        ? `Disabled ${changed} empty header(s).`
        : `Replaced ${changed} literal header value(s) with variables.`
    } else if (fix.kind === 'basicAuthCredentials') {
      const result = patchBasicAuth(fixedJson, fix)
      changed = result.changed
      localSkipped = result.skipped
      action = `Replaced ${changed} Basic auth credential field(s) with variables.`
    } else if (fix.kind === 'collectionVariables') {
      action = 'Added missing starter collection variables.'
    } else if (fix.kind === 'missingDescription') {
      const result = patchDescriptions(fixedJson, fix)
      changed = result.changed
      localSkipped = result.skipped
      action = `Added generated descriptions to ${changed} request(s).`
    } else {
      const patchers: Partial<Record<RepairFixKind, (collection: unknown, fix: RepairFix) => PatchResult>> = {
        authHelperSecrets: (collection) => patchAuthHelperSecrets(collection),
        bodySecrets: patchBodySecrets,
        querySecrets: patchQuerySecrets,
        secretVariables: patchSecretVariables,
        insecureHttp: patchInsecureHttp,
        tlsVerification: patchTlsVerification,
      }
      const result = patchers[fix.kind]?.(fixedJson, fix)
      if (result) {
        changed = result.changed
        localSkipped = result.skipped
        variables = result.variables.length ? result.variables : variables
        const actions: Partial<Record<RepairFixKind, string>> = {
          authHelperSecrets: `Replaced ${changed} auth setting credential(s) with variables.`,
          bodySecrets: `Replaced ${changed} literal secret value(s) with variables.`,
          querySecrets: `Replaced ${changed} query parameter secret(s) with variables.`,
          secretVariables: `Cleared ${changed} secret collection variable value(s).`,
          insecureHttp: `Upgraded ${changed} endpoint(s) to HTTPS.`,
          tlsVerification: `Re-enabled certificate verification in ${changed} place(s).`,
        }
        action = actions[fix.kind] ?? action
      }
    }

    const variablesAdded = variables.reduce((count, variable) => {
      return ensureCollectionVariable(fixedJson, variable.key, variable.value) ? count + 1 : count
    }, 0)

    skipped.push(...localSkipped)
    if (changed > 0 || variablesAdded > 0) {
      applied.push({
        fixId: fix.id,
        title: fix.title,
        affectedCount: changed || variablesAdded,
        summary: variablesAdded > 0 ? `${action} Added ${variablesAdded} collection variable(s).` : action,
      })
    } else if (localSkipped.length === 0 && fix.kind !== 'hardcodedBaseUrl' && fix.kind !== 'environmentUrl') {
      skipped.push({ fixId: fix.id, title: fix.title, reason: 'No changes were needed.' })
    }
  }

  return { fixedJson, applied, skipped }
}
