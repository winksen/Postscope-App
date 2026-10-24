import type { ParsedCollection, ParsedRequest, ParsedScopedVariable, KeyValue } from './parser'
import { RULES, RULE_LIST, isRuleId, type RuleId } from './rules'
import { resolveEnabledPacks, sanitizeRulePacks, type RulePackId, type RulePackSettings } from './rulePacks'
import { detectIdentitySignals } from './iam/signals'
import { buildIdentityProfile } from './iam/profile'
import { isEmptyProfile } from './iam/types'
import { isSeverity, severityRank, type FindingCategory, type Severity } from './severity'
import { secretFieldsFor } from './authSchemes'
import { parseTemplatedJson } from './jsonBody'
import { scanRawBodyFields } from './rawBody'
import { findDescriptionSecrets } from './descriptions'
import { findScriptSecrets } from './scriptSecrets'
import { lookupVariableValue } from './environment'
import { analyzeVariableUsage } from './variableUsage'
import { applySuppressions, type ConfigSuppression, type SuppressedFinding } from './suppressions'
import { extractVariableNames, isVariableOrEmpty } from './variables'
import {
  AUTH_HEADER_SCHEME,
  SESSION_COOKIE,
  TOKEN_HEADER,
  decodeBasicCredentials,
  evidencePreview,
  findSecretPatterns,
  isHighEntropyLiteral,
  isLikelySecretValue,
  isSensitiveHeader,
  isSensitiveKey,
  maskUsername,
  redactSecretsInText,
} from './secretPatterns'

export interface FindingEvidence {
  /** Parser request id, when the evidence belongs to one request. */
  requestId?: string
  /** Human-readable location, e.g. `header Authorization` or `collection variable apiKey`. */
  location: string
  /** Masked preview. Never contains the full secret value. */
  preview?: string
  /** JSON pointer of the value inside the exported collection (set when a report is built from the raw file). */
  pointer?: string
}

export interface Finding {
  /** Unique within one audit run; equals the rule id. */
  id: string
  ruleId: RuleId
  severity: Severity
  category: FindingCategory
  title: string
  description: string
  /** Stable request ids from the parser (not display names). */
  affected: string[]
  recommendation: string
  evidence?: FindingEvidence[]
  cwe?: string
  owasp?: string
}

export interface AuditOptions {
  /** Rule ids to skip entirely. */
  disabledRules?: readonly string[]
  /** Per-rule severity overrides (team policy or personal preference). */
  severityOverrides?: Partial<Record<string, Severity>>
  /** Reviewed suppressions (from `.postscope.json`); inline `postscope-ignore` lines are always honored. */
  suppressions?: readonly ConfigSuppression[]
  /** Clock used to decide whether a suppression has expired. Defaults to now. */
  now?: Date
  /** Rule pack selection. Optional packs not listed follow `auto`: on when the collection shows identity signals. */
  rulePacks?: RulePackSettings
}

const MAX_EVIDENCE_PER_FINDING = 100

const HEADER_PASSWORD_KEY = /passw|password|passwd/i
const API_KEY_HEADER = /api.?key|x-api-key|apikey/i
const PASSWORD_FIELD = /passw/i
const BODY_SECRET_FIELD = /secret|access_?token|refresh_?token|id_?token|api_?key|apikey|private_?key|client_?assertion/i
export { AUTH_HEADER_SCHEME, SESSION_COOKIE, TOKEN_HEADER }
const QUERY_SECRET_KEY =
  /^(access_?token|auth_?token|id_?token|refresh_?token|token|api_?key|apikey|x-api-key|secret|client_?secret|password|passwd|pwd|session_?id|sessionid|sid|sig|signature|private_?key|x-amz-(signature|security-token|credential))$/i
const URL_CREDENTIALS = /^[a-z][a-z0-9+.-]*:\/\/([^\s/@:{}]+):([^\s/@]+)@/i
const SCRIPT_CONSOLE_CALL = /console\.(?:log|info|debug|warn|error|trace)\s*\(([^)\n]*)\)/g
const SENSITIVE_IDENTIFIER = /(token|password|passwd|secret|api_?key|apikey|authorization|credential|cookie|bearer)/i
const RESPONSE_JSON_SECRET =
  /"(access_token|accessToken|refresh_token|refreshToken|id_token|idToken|token|password|client_secret|clientSecret|api_key|apiKey|secret|session_id|sessionId)"\s*:\s*"([^"\\]{8,})"/g
const URL_VARIABLE_PREFIX = /^\{\{\s*([^{}]+?)\s*\}\}/

interface RuleHits {
  affected: string[]
  seen: Set<string>
  evidence: FindingEvidence[]
  evidenceKeys: Set<string>
  description?: string
  /** Severity to use instead of the registry default (a user override still wins). */
  severity?: Severity
}

class FindingCollector {
  private hits = new Map<RuleId, RuleHits>()

  private entry(ruleId: RuleId): RuleHits {
    let hits = this.hits.get(ruleId)
    if (!hits) {
      hits = { affected: [], seen: new Set(), evidence: [], evidenceKeys: new Set() }
      this.hits.set(ruleId, hits)
    }
    return hits
  }

  /** Records a hit. `requestId` adds an affected request; evidence is de-duplicated by location + preview. */
  add(ruleId: RuleId, requestId?: string, evidence?: Omit<FindingEvidence, 'requestId'>): void {
    const hits = this.entry(ruleId)
    if (requestId && !hits.seen.has(requestId)) {
      hits.seen.add(requestId)
      hits.affected.push(requestId)
    }
    if (evidence && hits.evidence.length < MAX_EVIDENCE_PER_FINDING) {
      const key = `${requestId ?? ''}|${evidence.location}|${evidence.preview ?? ''}`
      if (!hits.evidenceKeys.has(key)) {
        hits.evidenceKeys.add(key)
        hits.evidence.push(requestId ? { requestId, ...evidence } : { ...evidence })
      }
    }
  }

  /** Lowers or raises a rule's severity for this run because the evidence is less certain. */
  setSeverity(ruleId: RuleId, severity: Severity): void {
    this.entry(ruleId).severity = severity
  }

  /** Ensures a finding exists even without affected requests (collection-level findings). */
  touch(ruleId: RuleId, description?: string): void {
    const hits = this.entry(ruleId)
    if (description) hits.description = description
  }

  /** `requestId|location` keys already reported by any of the given rules. */
  flaggedLocations(ruleIds: RuleId[]): Set<string> {
    const keys = new Set<string>()
    for (const ruleId of ruleIds) {
      for (const evidence of this.hits.get(ruleId)?.evidence ?? []) keys.add(`${evidence.requestId ?? ''}|${evidence.location}`)
    }
    return keys
  }

  has(ruleId: RuleId): boolean {
    return this.hits.has(ruleId)
  }

  affectedBy(ruleIds: RuleId[]): Set<string> {
    const ids = new Set<string>()
    for (const ruleId of ruleIds) this.hits.get(ruleId)?.affected.forEach((id) => ids.add(id))
    return ids
  }

  build(options: AuditOptions = {}, enabledPacks?: ReadonlySet<RulePackId>): Finding[] {
    const disabled = new Set(options.disabledRules ?? [])
    const overrides = options.severityOverrides ?? {}
    const findings: Finding[] = []

    for (const rule of RULE_LIST) {
      const hits = this.hits.get(rule.id)
      if (!hits || disabled.has(rule.id)) continue
      if (enabledPacks && !enabledPacks.has(rule.pack)) continue
      const override = overrides[rule.id]
      findings.push({
        id: rule.id,
        ruleId: rule.id,
        severity: isSeverity(override) ? override : (hits.severity ?? rule.severity),
        category: rule.category,
        title: rule.title,
        description: hits.description ?? rule.description,
        affected: hits.affected,
        recommendation: rule.recommendation,
        evidence: hits.evidence.length ? hits.evidence : undefined,
        cwe: rule.cwe,
        owasp: rule.owasp,
      })
    }

    // Stable ordering: severity first, then registry order (Array.prototype.sort is stable).
    return findings.sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
  }
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

// ---------------------------------------------------------------------------
// Secrets in headers and bodies
// ---------------------------------------------------------------------------

/** Appended to evidence locations for entries that are switched off in Postman but still ship in the export. */
const DISABLED_SUFFIX = ' (disabled)'

function checkHeaders(req: ParsedRequest, out: FindingCollector): void {
  checkHeaderList(req, req.headers, '', out)
  checkHeaderList(req, req.disabledHeaders ?? [], DISABLED_SUFFIX, out)
}

function checkHeaderList(req: ParsedRequest, headers: KeyValue[], suffix: string, out: FindingCollector): void {
  for (const h of headers) {
    const key = h.key.trim()
    const lower = key.toLowerCase()
    const literal = !isVariableOrEmpty(h.value)
    if (!literal) continue

    if (HEADER_PASSWORD_KEY.test(key)) {
      out.add('HARDCODED_PASSWORD', req.id, { location: `header ${key}${suffix}`, preview: evidencePreview(h.value) })
    }

    const isAuthorization = lower === 'authorization' || lower === 'proxy-authorization'
    if (isAuthorization) {
      const value = h.value.trim()
      const basic = /^Basic\s+\S+$/i.test(value) ? decodeBasicCredentials(value) : null
      if (basic) {
        // The token is readable: only a literal password makes it a leak (a variable or placeholder is fine).
        if (isLikelySecretValue(basic.password)) {
          const account = /^api$/i.test(basic.username) && /^key-[0-9a-f]{32}$/.test(basic.password) ? ' (Mailgun API key)' : ''
          out.add('HARDCODED_TOKEN', req.id, {
            location: `header ${key}${suffix} (basic credentials for user ${maskUsername(basic.username)})${account}`,
            preview: evidencePreview(basic.password),
          })
        }
        continue
      }
      if (AUTH_HEADER_SCHEME.test(value) || (!/\s/.test(value) && value.length >= 16)) {
        out.add('HARDCODED_TOKEN', req.id, { location: `header ${key}${suffix}`, preview: evidencePreview(value) })
      }
    } else if (TOKEN_HEADER.test(lower) && isLikelySecretValue(h.value)) {
      out.add('HARDCODED_TOKEN', req.id, { location: `header ${key}${suffix}`, preview: evidencePreview(h.value) })
    } else if (lower === 'cookie') {
      const cookie = h.value.match(SESSION_COOKIE)
      if (cookie && isLikelySecretValue(cookie[2]) && cookie[2].trim().length >= 8) {
        out.add('HARDCODED_TOKEN', req.id, { location: `cookie ${cookie[1]}${suffix}`, preview: evidencePreview(cookie[2]) })
      }
    }

    if (API_KEY_HEADER.test(key)) {
      out.add('HARDCODED_API_KEY', req.id, { location: `header ${key}${suffix}`, preview: evidencePreview(h.value) })
    }
  }
}

/** Classifies a body field: HARDCODED_PASSWORD, HARDCODED_SECRET, or null when it is not a literal credential. */
export function classifyBodySecret(key: string, value: string): 'HARDCODED_PASSWORD' | 'HARDCODED_SECRET' | null {
  if (!isLikelySecretValue(value) || !isSensitiveKey(key)) return null
  if (PASSWORD_FIELD.test(key)) return 'HARDCODED_PASSWORD'
  if (BODY_SECRET_FIELD.test(key)) return 'HARDCODED_SECRET'
  return null
}

/** True when a query parameter carries a literal credential. */
export function isQuerySecret(key: string, value: string): boolean {
  const name = key.trim()
  if (!isLikelySecretValue(value)) return false
  if (QUERY_SECRET_KEY.test(name) || isSensitiveKey(name)) return true
  return /^key$/i.test(name) && value.trim().length >= 16 && !/\s/.test(value)
}

function checkSecretField(req: ParsedRequest, key: string, value: string, location: string, out: FindingCollector): void {
  const ruleId = classifyBodySecret(key, value)
  if (ruleId) out.add(ruleId, req.id, { location, preview: evidencePreview(value) })
}

function walkJson(value: unknown, visit: (key: string, value: string, path: string) => void, path = '', depth = 0): void {
  if (depth > 50 || value === null || typeof value !== 'object') return
  if (Array.isArray(value)) {
    value.forEach((child, index) => walkJson(child, visit, `${path}[${index}]`, depth + 1))
    return
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = path ? `${path}.${key}` : key
    if (typeof child === 'string') visit(key, child, childPath)
    else walkJson(child, visit, childPath, depth + 1)
  }
}

/** Parses a JSON body, tolerating unquoted Postman variables such as `{"id": {{userId}}}`. */
function tryParseJson(text: string | undefined): unknown {
  return text ? parseTemplatedJson(text)?.value : undefined
}

function checkBody(req: ParsedRequest, out: FindingCollector): void {
  for (const field of req.disabledBodyFields ?? []) {
    checkSecretField(req, field.key, field.value, `body field ${field.key}${DISABLED_SUFFIX}`, out)
  }
  if (req.bodyFields?.length) {
    for (const field of req.bodyFields) checkSecretField(req, field.key, field.value, `body field ${field.key}`, out)
    return
  }
  if (!req.bodyRaw) return

  if (req.bodyMode === 'graphql') {
    // GraphQL query text is not data; only the variables JSON can hold literals.
    const variables = req.bodyRaw.split('\n').slice(1).join('\n')
    const json = tryParseJson(variables)
    if (json !== undefined) walkJson(json, (key, value, path) => checkSecretField(req, key, value, `GraphQL variable ${path}`, out))
    return
  }

  const json = tryParseJson(req.bodyRaw)
  if (json !== undefined) {
    walkJson(json, (key, value, path) => checkSecretField(req, key, value, `body ${path}`, out))
    return
  }

  // Non-JSON raw bodies (XML/SOAP, form-like text, JSON that does not parse): look at individual fields.
  for (const field of scanRawBodyFields(req.bodyRaw)) {
    checkSecretField(req, field.key, field.value, `raw body ${field.key}`, out)
  }
}

/**
 * Long random-looking literals in credential positions (sensitive header, query, form or JSON field names)
 * that no other secret rule reported at the same place.
 */
function checkHighEntropy(parsed: ParsedCollection, out: FindingCollector): void {
  const flagged = out.flaggedLocations(SECRET_RULES)
  const report = (req: ParsedRequest, location: string, value: string) => {
    if (flagged.has(`${req.id}|${location}`) || !isHighEntropyLiteral(value) || findSecretPatterns(value, 1).length) return
    out.add('HIGH_ENTROPY_LITERAL', req.id, { location, preview: evidencePreview(value) })
  }
  for (const req of parsed.requests) {
    for (const [headers, suffix] of [
      [req.headers, ''],
      [req.disabledHeaders ?? [], DISABLED_SUFFIX],
    ] as const) {
      for (const header of headers) {
        const lower = header.key.trim().toLowerCase()
        // Cookies and readable Basic tokens are judged by the header rules, not by entropy.
        if (lower === 'cookie' || (/^Basic\s/i.test(header.value.trim()) && decodeBasicCredentials(header.value))) continue
        if (isSensitiveHeader(header.key)) report(req, `header ${header.key.trim()}${suffix}`, header.value)
      }
    }
    for (const [params, suffix] of [
      [req.queryParams ?? [], ''],
      [req.disabledQueryParams ?? [], DISABLED_SUFFIX],
    ] as const) {
      for (const param of params) if (isSensitiveKey(param.key)) report(req, `query ${param.key.trim()}${suffix}`, param.value)
    }
    for (const [fields, suffix] of [
      [req.bodyFields ?? [], ''],
      [req.disabledBodyFields ?? [], DISABLED_SUFFIX],
    ] as const) {
      for (const field of fields) if (isSensitiveKey(field.key)) report(req, `body field ${field.key}${suffix}`, field.value)
    }
    if (!req.bodyFields?.length && req.bodyRaw && req.bodyMode !== 'graphql') {
      const json = tryParseJson(req.bodyRaw)
      if (json !== undefined) walkJson(json, (key, value, path) => isSensitiveKey(key) && report(req, `body ${path}`, value))
    }
  }
}

// ---------------------------------------------------------------------------
// Auth helpers, query strings and URLs
// ---------------------------------------------------------------------------

function authOwnerLabel(req: ParsedRequest, parsed: ParsedCollection): string {
  if (req.authSource === 'collection') return 'collection level'
  if (req.authSource === 'folder' && req.authOwnerPath) {
    const owner = parsed.authOwners?.find((candidate) => candidate.ownerPath.join('.') === req.authOwnerPath?.join('.'))
    return owner ? `folder "${owner.owner}"` : 'folder level'
  }
  return 'request level'
}

function checkAuthHelpers(parsed: ParsedCollection, out: FindingCollector): void {
  for (const req of parsed.requests) {
    if (!req.authFields?.length) continue
    for (const field of secretFieldsFor(req.auth)) {
      const value = req.authFields.find((entry) => entry.key === field)?.value
      if (value && isLikelySecretValue(value)) {
        out.add('HARDCODED_AUTH_CREDENTIAL', req.id, {
          location: `${req.auth} auth ${field} (${authOwnerLabel(req, parsed)})`,
          preview: evidencePreview(value),
        })
      }
    }
  }

  // Collection/folder auth leaks in the export even when every request overrides it.
  for (const owner of parsed.authOwners ?? []) {
    if (owner.type === 'basic') {
      const password = owner.fields.find((entry) => entry.key === 'password')?.value
      if (password && isLikelySecretValue(password)) {
        out.add('HARDCODED_AUTH_CREDENTIAL', undefined, {
          location: `basic auth password (${owner.owner === 'collection' ? 'collection level' : `folder "${owner.owner}"`})`,
          preview: evidencePreview(password),
        })
      }
      continue
    }
    for (const field of secretFieldsFor(owner.type)) {
      const value = owner.fields.find((entry) => entry.key === field)?.value
      if (value && isLikelySecretValue(value)) {
        out.add('HARDCODED_AUTH_CREDENTIAL', undefined, {
          location: `${owner.type} auth ${field} (${owner.owner === 'collection' ? 'collection level' : `folder "${owner.owner}"`})`,
          preview: evidencePreview(value),
        })
      }
    }
  }
}

function checkQueryAndUrl(req: ParsedRequest, out: FindingCollector): void {
  for (const param of req.queryParams ?? []) {
    if (isQuerySecret(param.key, param.value)) {
      out.add('SECRET_IN_QUERY', req.id, { location: `query ${param.key.trim()}`, preview: evidencePreview(param.value) })
    }
  }
  for (const variable of req.pathVariables ?? []) {
    if (isQuerySecret(variable.key, variable.value)) {
      out.add('SECRET_IN_QUERY', req.id, { location: `path variable ${variable.key.trim()}`, preview: evidencePreview(variable.value) })
    }
  }
  for (const param of req.disabledQueryParams ?? []) {
    if (isQuerySecret(param.key, param.value)) {
      out.add('SECRET_IN_QUERY', req.id, { location: `query ${param.key.trim()}${DISABLED_SUFFIX}`, preview: evidencePreview(param.value) })
    }
  }

  const credentials = req.url.match(URL_CREDENTIALS)
  if (credentials && !isVariableOrEmpty(credentials[2])) {
    const [, user, password] = credentials
    out.add('CREDENTIALS_IN_URL', req.id, {
      location: 'URL userinfo',
      preview: req.url.replace(`${user}:${password}@`, `${user}:••••••@`).slice(0, 80),
    })
  }
}

// ---------------------------------------------------------------------------
// Scripts, collection variables, saved responses
// ---------------------------------------------------------------------------

function scanScript(source: string, location: string, requestId: string | undefined, out: FindingCollector): void {
  if (!source) return

  for (const secret of findScriptSecrets(source)) {
    out.add('SECRET_IN_SCRIPT', requestId, { location: `${location}: ${secret.label}`, preview: evidencePreview(secret.value) })
  }

  for (const match of source.matchAll(SCRIPT_CONSOLE_CALL)) {
    if (SENSITIVE_IDENTIFIER.test(match[1])) {
      out.add('SECRET_LOGGED_IN_SCRIPT', requestId, {
        location,
        preview: redactSecretsInText(match[0]).slice(0, 80),
      })
    }
  }
}

function checkScripts(parsed: ParsedCollection, out: FindingCollector): void {
  for (const req of parsed.requests) {
    if (req.scripts?.prerequest) scanScript(req.scripts.prerequest, 'pre-request script', req.id, out)
    if (req.scripts?.test) scanScript(req.scripts.test, 'test script', req.id, out)
    if (req.scripts?.disabledPrerequest) scanScript(req.scripts.disabledPrerequest, `pre-request script${DISABLED_SUFFIX}`, req.id, out)
    if (req.scripts?.disabledTest) scanScript(req.scripts.disabledTest, `test script${DISABLED_SUFFIX}`, req.id, out)
  }
  for (const script of parsed.scripts ?? []) {
    const owner = script.owner === 'collection' ? 'collection' : `folder "${script.owner}"`
    const kind =
      script.listen === 'prerequest' ? 'pre-request script' : script.listen === 'test' ? 'test script' : `${script.listen} script`
    scanScript(script.source, `${owner} ${kind}${script.disabled ? DISABLED_SUFFIX : ''}`, undefined, out)
  }
}

function requestText(req: ParsedRequest): string {
  return [
    req.url,
    ...req.headers.map((h) => h.value),
    req.bodyRaw ?? '',
    ...(req.authFields ?? []).map((field) => field.value),
    req.basicAuth ? `${req.basicAuth.username} ${req.basicAuth.password}` : '',
  ].join('\n')
}

export interface LeakedVariable {
  key: string
  value: string
  /** Provider format label when the value matched a known token pattern. */
  reason?: string
}

function leakedFrom<T extends { key: string; value: string; type?: string }>(variables: T[]): Array<T & { reason?: string }> {
  const leaked: Array<T & { reason?: string }> = []
  for (const variable of variables) {
    if (!isLikelySecretValue(variable.value)) continue
    const pattern = findSecretPatterns(variable.value, 1)[0]
    if (isSensitiveKey(variable.key) || variable.type === 'secret' || pattern) {
      leaked.push({ ...variable, reason: pattern?.label })
    }
  }
  return leaked
}

/** Collection variables whose literal values look like credentials. Shared with the repair engine. */
export function findLeakedCollectionVariables(parsed: ParsedCollection): LeakedVariable[] {
  return leakedFrom(parsed.collectionVariables ?? []).map(({ key, value, reason }) => ({ key, value, reason }))
}

export interface LeakedScopedVariable extends LeakedVariable {
  scope: ParsedScopedVariable['scope']
  owner: string
  ownerPath: number[]
  requestId?: string
}

/** Folder and request level variables whose literal values look like credentials. Shared with the repair engine. */
export function findLeakedScopedVariables(parsed: ParsedCollection): LeakedScopedVariable[] {
  return leakedFrom(parsed.scopedVariables ?? []).map(({ key, value, reason, scope, owner, ownerPath, requestId }) => ({
    key,
    value,
    reason,
    scope,
    owner,
    ownerPath,
    requestId,
  }))
}

export interface LeakedEnvironmentVariable extends LeakedVariable {
  /** Name of the environment or globals file. */
  environment: string
  kind: 'environment' | 'globals'
  enabled: boolean
}

/** Environment and globals variables whose literal values look like credentials. Shared with redaction tests. */
export function findLeakedEnvironmentVariables(parsed: ParsedCollection): LeakedEnvironmentVariable[] {
  const leaked: LeakedEnvironmentVariable[] = []
  for (const environment of parsed.environments ?? []) {
    for (const variable of leakedFrom(environment.variables)) {
      leaked.push({
        key: variable.key,
        value: variable.value,
        reason: variable.reason,
        environment: environment.name,
        kind: environment.kind,
        enabled: variable.enabled,
      })
    }
  }
  return leaked
}

function checkEnvironments(parsed: ParsedCollection, out: FindingCollector): void {
  const leaked = findLeakedEnvironmentVariables(parsed)
  if (!leaked.length) return
  const names = new Set(leaked.map((variable) => variable.key))
  out.touch(
    'SECRET_IN_ENVIRONMENT',
    `${plural(leaked.length, 'environment variable')} with credential-like names, the secret type or token-shaped values ${leaked.length === 1 ? 'has' : 'have'} a literal value in the loaded environment or globals files.`
  )
  for (const variable of leaked) {
    const place = variable.kind === 'globals' ? `globals "${variable.environment}"` : `environment "${variable.environment}"`
    out.add('SECRET_IN_ENVIRONMENT', undefined, {
      location: `${place} variable ${variable.key}${variable.enabled ? '' : DISABLED_SUFFIX}${variable.reason ? ` (${variable.reason})` : ''}`,
      preview: evidencePreview(variable.value),
    })
  }
  for (const req of parsed.requests) {
    if (extractVariableNames(requestText(req)).some((name) => names.has(name))) out.add('SECRET_IN_ENVIRONMENT', req.id)
  }
}

function checkCollectionVariables(parsed: ParsedCollection, out: FindingCollector): void {
  const leaked = findLeakedCollectionVariables(parsed)
  const leakedScoped = findLeakedScopedVariables(parsed)
  const total = leaked.length + leakedScoped.length
  if (!total) return

  const leakedKeys = new Set([...leaked, ...leakedScoped].map((variable) => variable.key))
  const where = leakedScoped.length ? 'collection, folder or request level variable' : 'collection variable'
  out.touch(
    'SECRET_IN_COLLECTION_VARIABLE',
    `${plural(total, where)} with credential-like names or values ${total === 1 ? 'has' : 'have'} a literal value that ships with every export.`
  )
  for (const variable of leaked) {
    out.add('SECRET_IN_COLLECTION_VARIABLE', undefined, {
      location: `collection variable ${variable.key}${variable.reason ? ` (${variable.reason})` : ''}`,
      preview: evidencePreview(variable.value),
    })
  }
  for (const variable of leakedScoped) {
    const place =
      variable.scope === 'folder' ? `folder variable ${variable.key} (folder "${variable.owner}")` : `request variable ${variable.key}`
    out.add('SECRET_IN_COLLECTION_VARIABLE', variable.requestId, {
      location: `${place}${variable.reason ? ` (${variable.reason})` : ''}`,
      preview: evidencePreview(variable.value),
    })
  }
  for (const req of parsed.requests) {
    if (extractVariableNames(requestText(req)).some((name) => leakedKeys.has(name))) {
      out.add('SECRET_IN_COLLECTION_VARIABLE', req.id)
    }
  }
}

// ---------------------------------------------------------------------------
// Descriptions
// ---------------------------------------------------------------------------

function checkDescriptions(parsed: ParsedCollection, out: FindingCollector): void {
  for (const description of parsed.descriptions ?? []) {
    const place =
      description.kind === 'collection'
        ? 'description (collection)'
        : description.kind === 'folder'
          ? `description (folder "${description.owner}")`
          : 'description'
    for (const secret of findDescriptionSecrets(description.text)) {
      const ruleId = secret.kind === 'pattern' ? 'KNOWN_SECRET_PATTERN' : 'HARDCODED_SECRET'
      const label = secret.kind === 'pattern' ? ` (${secret.label})` : `: ${secret.label}`
      out.add(ruleId, description.requestId, { location: `${place}${label}`, preview: evidencePreview(secret.value) })
    }
  }
}

function checkHeaderListForSecrets(headers: KeyValue[]): KeyValue | undefined {
  return headers.find((h) => isSensitiveHeader(h.key) && isLikelySecretValue(h.value) && h.value.trim().length >= 8)
}

function checkSavedResponses(req: ParsedRequest, out: FindingCollector): void {
  for (const response of req.savedResponses ?? []) {
    const label = `saved response "${response.name}"`

    const requestHeader = checkHeaderListForSecrets(response.requestHeaders)
    if (requestHeader) {
      out.add('SECRET_IN_SAVED_RESPONSE', req.id, {
        location: `${label} original request header ${requestHeader.key}`,
        preview: evidencePreview(requestHeader.value),
      })
    }
    const disabledRequestHeader = checkHeaderListForSecrets(response.disabledRequestHeaders ?? [])
    if (disabledRequestHeader) {
      out.add('SECRET_IN_SAVED_RESPONSE', req.id, {
        location: `${label} original request header ${disabledRequestHeader.key}${DISABLED_SUFFIX}`,
        preview: evidencePreview(disabledRequestHeader.value),
      })
    }

    if (response.requestAuthType && response.requestAuthFields?.length) {
      for (const field of secretFieldsFor(response.requestAuthType)) {
        const value = response.requestAuthFields.find((entry) => entry.key === field)?.value
        if (value && isLikelySecretValue(value)) {
          out.add('SECRET_IN_SAVED_RESPONSE', req.id, {
            location: `${label} original request ${response.requestAuthType} ${field}`,
            preview: evidencePreview(value),
          })
        }
      }
    }

    for (const header of response.headers) {
      const lower = header.key.toLowerCase()
      if (lower === 'set-cookie') {
        const cookie = header.value.match(/^\s*([^=;\s]*(?:session|sess|sid|token|auth|jwt)[^=;\s]*)=([^;]+)/i)
        if (cookie && isLikelySecretValue(cookie[2]) && cookie[2].trim().length >= 8) {
          out.add('SECRET_IN_SAVED_RESPONSE', req.id, { location: `${label} Set-Cookie ${cookie[1]}`, preview: evidencePreview(cookie[2]) })
        }
      } else if (isSensitiveHeader(header.key) && isLikelySecretValue(header.value) && header.value.trim().length >= 8) {
        out.add('SECRET_IN_SAVED_RESPONSE', req.id, { location: `${label} header ${header.key}`, preview: evidencePreview(header.value) })
      }
    }

    if (response.body) {
      for (const match of response.body.matchAll(RESPONSE_JSON_SECRET)) {
        if (isLikelySecretValue(match[2])) {
          out.add('SECRET_IN_SAVED_RESPONSE', req.id, { location: `${label} body ${match[1]}`, preview: evidencePreview(match[2]) })
        }
      }
      for (const secret of findSecretPatterns(response.body, 3)) {
        out.add('SECRET_IN_SAVED_RESPONSE', req.id, { location: `${label} body (${secret.label})`, preview: evidencePreview(secret.match) })
      }
    }

    for (const param of response.requestQuery ?? []) {
      if (isQuerySecret(param.key, param.value)) {
        out.add('SECRET_IN_SAVED_RESPONSE', req.id, {
          location: `${label} original request query ${param.key.trim()}`,
          preview: evidencePreview(param.value),
        })
      }
    }

    if (response.requestBody) {
      const json = parseTemplatedJson(response.requestBody)
      const fields: Array<{ key: string; value: string; path: string }> = []
      if (json) walkJson(json.value, (key, value, path) => fields.push({ key, value, path }))
      else for (const field of scanRawBodyFields(response.requestBody)) fields.push({ key: field.key, value: field.value, path: field.key })
      for (const field of fields) {
        if (classifyBodySecret(field.key, field.value)) {
          out.add('SECRET_IN_SAVED_RESPONSE', req.id, {
            location: `${label} original request body ${field.path}`,
            preview: evidencePreview(field.value),
          })
        }
      }
      for (const secret of findSecretPatterns(response.requestBody, 3)) {
        out.add('SECRET_IN_SAVED_RESPONSE', req.id, {
          location: `${label} original request body (${secret.label})`,
          preview: evidencePreview(secret.match),
        })
      }
    }

    for (const secret of findSecretPatterns(response.requestUrl, 2)) {
      out.add('SECRET_IN_SAVED_RESPONSE', req.id, {
        location: `${label} original request URL (${secret.label})`,
        preview: evidencePreview(secret.match),
      })
    }
  }
}

const SECRET_RULES: RuleId[] = [
  'HARDCODED_PASSWORD',
  'HARDCODED_TOKEN',
  'HARDCODED_API_KEY',
  'HARDCODED_SECRET',
  'HARDCODED_AUTH_CREDENTIAL',
  'SECRET_IN_QUERY',
  'CREDENTIALS_IN_URL',
  'SECRET_IN_SCRIPT',
  'SECRET_IN_SAVED_RESPONSE',
]

/** Provider-format tokens in places the keyword rules did not already flag for that request. */
function checkKnownPatterns(parsed: ParsedCollection, out: FindingCollector): void {
  const alreadyFlagged = out.affectedBy(SECRET_RULES)
  for (const req of parsed.requests) {
    if (alreadyFlagged.has(req.id)) continue
    const locations: Array<[string, string | undefined]> = [
      ['URL', req.url],
      ...req.headers.map((h): [string, string] => [`header ${h.key}`, h.value]),
      ...(req.disabledHeaders ?? []).map((h): [string, string] => [`header ${h.key}${DISABLED_SUFFIX}`, h.value]),
      ...(req.disabledQueryParams ?? []).map((p): [string, string] => [`query ${p.key}${DISABLED_SUFFIX}`, p.value]),
      ...(req.disabledBodyFields ?? []).map((f): [string, string] => [`body field ${f.key}${DISABLED_SUFFIX}`, f.value]),
      ['body', req.bodyRaw],
      ...(req.authFields ?? []).map((field): [string, string] => [`${req.auth} auth ${field.key}`, field.value]),
    ]
    for (const [location, text] of locations) {
      for (const secret of findSecretPatterns(text, 2)) {
        out.add('KNOWN_SECRET_PATTERN', req.id, { location: `${location} (${secret.label})`, preview: evidencePreview(secret.match) })
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Warnings: URLs, auth, transport
// ---------------------------------------------------------------------------

export function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return (
    host === 'localhost' ||
    host === '::1' ||
    host === '0.0.0.0' ||
    host === 'host.docker.internal' ||
    /^127(\.\d{1,3}){3}$/.test(host) ||
    /\.(localhost|test|example|invalid)$/.test(host)
  )
}

export function resolveLeadingVariable(url: string, parsed: ParsedCollection): string {
  const match = url.match(URL_VARIABLE_PREFIX)
  if (!match) return url
  const value = lookupVariableValue(parsed, match[1].trim())
  if (!value || isVariableOrEmpty(value)) return url
  return value.replace(/\/+$/, '') + url.slice(match[0].length)
}

export function plaintextOrigin(url: string): string | null {
  const match = url.match(/^(http|ws):\/\/([^/?#\s]+)/i)
  if (!match) return null
  const authority = match[2].replace(/^[^@]*@/, '')
  const hostname = authority.startsWith('[') ? authority.slice(0, authority.indexOf(']') + 1) : authority.split(':')[0]
  if (!hostname || hostname.includes('{{') || isLocalHost(hostname)) return null
  return `${match[1].toLowerCase()}://${authority}`
}

/**
 * Hostname of an absolute or scheme-less URL, or null when the authority is a variable, contains a variable,
 * or does not look like a host (`{{baseUrl}}/users`, `users/1`).
 */
export function urlHostname(url: string): string | null {
  const match = url.trim().match(/^(?:([a-z][a-z0-9+.-]*):\/\/)?([^/?#\s]+)/i)
  if (!match) return null
  const authority = match[2].replace(/^[^@]*@/, '')
  if (authority.includes('{{')) return null
  const hostname = (authority.startsWith('[') ? authority.slice(0, authority.indexOf(']') + 1) : authority.split(':')[0]).toLowerCase()
  if (!hostname) return null
  if (!match[1] && !hostname.includes('.') && hostname !== 'localhost') return null
  return hostname
}

const ENVIRONMENT_LABEL = /(^|[.-])(prod|production|stg|staging|stage|dev|develop|qa|uat|preprod|sandbox|test|int)([.-]|$)/
const AUTH_ASSIGNING_SCRIPT = [
  /pm\.request\.headers\.(?:add|upsert)\s*\(\s*(?:\{[^}]{0,300}?\bkey\s*:\s*)?['"`]\s*(?:proxy-)?authorization\b/i,
  /pm\.request\.auth\s*=[^=]/,
  /pm\.request\.auth\.update\s*\(/,
]

function scriptSetsAuthorization(source: string | undefined): boolean {
  return !!source && AUTH_ASSIGNING_SCRIPT.some((pattern) => pattern.test(source))
}

/** Enabled pre-request scripts that run for a request: its own, its folders' and the collection's. */
function requestSetsAuthorizationInScript(req: ParsedRequest, parsed: ParsedCollection): boolean {
  if (scriptSetsAuthorization(req.scripts?.prerequest)) return true
  return (parsed.scripts ?? []).some(
    (script) =>
      !script.disabled &&
      script.listen === 'prerequest' &&
      script.ownerPath.length <= req.itemPath.length &&
      script.ownerPath.every((index, position) => req.itemPath[position] === index) &&
      scriptSetsAuthorization(script.source)
  )
}

const NON_AUTH_TOKEN_HEADER = /csrf|xsrf/i

/** True when a request without an auth helper still carries credentials: header, cookie, query or script. */
function hasCredentialsOutsideAuthHelper(req: ParsedRequest, parsed: ParsedCollection): boolean {
  if (req.headers.some((h) => !NON_AUTH_TOKEN_HEADER.test(h.key) && isSensitiveHeader(h.key))) return true
  if ((req.queryParams ?? []).some((param) => QUERY_SECRET_KEY.test(param.key.trim()) || isSensitiveKey(param.key))) return true
  return requestSetsAuthorizationInScript(req, parsed)
}

/** `POST /v1/users` style label for triage; the origin and query string are dropped. */
function requestRoute(req: ParsedRequest): string {
  const path = req.url.replace(/^\s*(?:[a-z][a-z0-9+.-]*:\/\/[^/?#]*|\{\{[^{}]+\}\})/i, '').split(/[?#]/)[0]
  return `${req.method} ${path.startsWith('/') ? path : `/${path}`}`
}

/** Variables that are referenced but never defined, and collection variables nobody references. */
function checkVariableIntegrity(parsed: ParsedCollection, out: FindingCollector): void {
  const usage = analyzeVariableUsage(parsed)

  if (usage.undefinedNames.size > 0) {
    const uncertain = !usage.environmentLoaded || usage.hasDynamicSets
    const hint = !usage.environmentLoaded
      ? ' They may be defined in an environment that was not loaded.'
      : usage.hasDynamicSets
        ? ' Scripts also set variables with computed names, so some of these may be defined at runtime.'
        : ''
    out.touch(
      'UNDEFINED_VARIABLE',
      `${plural(usage.undefinedNames.size, 'variable')} ${usage.undefinedNames.size === 1 ? 'is' : 'are'} referenced but not defined anywhere in the export.${hint}`
    )
    for (const [name, references] of usage.undefinedNames) {
      for (const reference of references) {
        out.add('UNDEFINED_VARIABLE', reference.requestId || undefined, { location: `{{${name}}} in ${reference.place}` })
      }
    }
    if (uncertain) out.setSeverity('UNDEFINED_VARIABLE', 'info')
  }

  // Empty starter placeholders (added by the repair engine) are intentional and not reported.
  const unused = usage.unusedCollectionVariables.filter((key) => {
    const variable = parsed.collectionVariables?.find((candidate) => candidate.key === key)
    return !(STARTER_VARIABLES.has(key) && !variable?.value)
  })
  if (unused.length > 0) {
    out.touch(
      'UNUSED_COLLECTION_VARIABLE',
      `${plural(unused.length, 'collection variable')} ${unused.length === 1 ? 'is' : 'are'} defined but never referenced.`
    )
    for (const key of unused) out.add('UNUSED_COLLECTION_VARIABLE', undefined, { location: `collection variable ${key}` })
  }
}

const STARTER_VARIABLES = new Set(['baseUrl', 'apiKey', 'token'])

function runWarningChecks(parsed: ParsedCollection, out: FindingCollector): void {
  const mutationMethods = ['POST', 'PUT', 'PATCH', 'DELETE']

  for (const req of parsed.requests) {
    const url = req.url || ''
    const hostname = urlHostname(url)
    if (/^https?:\/\//i.test(url) && hostname) {
      out.add('HARDCODED_BASEURL', req.id)
    }
    if (hostname && (hostname === 'localhost' || ENVIRONMENT_LABEL.test(hostname))) {
      out.add('HARDCODED_ENV_URL', req.id, { location: 'host', preview: hostname })
    }

    if (mutationMethods.includes(req.method) && req.auth === 'noauth' && !hasCredentialsOutsideAuthHelper(req, parsed)) {
      out.add('MISSING_AUTH', req.id, { location: requestRoute(req) })
    }

    if (req.auth === 'basic' && req.basicAuth) {
      const { username, password } = req.basicAuth
      const literalUser = username && !isVariableOrEmpty(username)
      const literalPass = password && !isVariableOrEmpty(password)
      if (literalUser || literalPass) {
        out.add('BASIC_AUTH_PLAINTEXT', req.id, {
          location: `basic auth (${authOwnerLabel(req, parsed)})`,
          preview: literalPass ? `password ${evidencePreview(password)}` : 'literal username',
        })
      }
    }

    const origin = plaintextOrigin(resolveLeadingVariable(url, parsed))
    if (origin) {
      out.add('INSECURE_HTTP', req.id)
      out.add('INSECURE_HTTP', undefined, { location: 'endpoint', preview: origin })
    }

    if (req.tlsVerificationDisabled) {
      out.add('TLS_VERIFICATION_DISABLED', req.id)
      out.add('TLS_VERIFICATION_DISABLED', undefined, { location: 'protocolProfileBehavior', preview: 'strictSSL: false' })
    }
  }
}

// ---------------------------------------------------------------------------
// Info: hygiene and structure
// ---------------------------------------------------------------------------

function runInfoChecks(parsed: ParsedCollection, out: FindingCollector): void {
  const noDesc = parsed.requests.filter((r) => !r.hasDescription)
  if (noDesc.length > 0) {
    out.touch('MISSING_DESCRIPTION', `${noDesc.length} request(s) have no description.`)
    noDesc.forEach((r) => out.add('MISSING_DESCRIPTION', r.id))
  }

  if (parsed.definedVariables.length < 3 && parsed.totalRequests > 0) {
    out.touch(
      'NO_COLLECTION_VARIABLES',
      `Collection defines ${parsed.definedVariables.length} variable(s). Consider at least baseUrl, apiKey, and environment-specific values.`
    )
  }

  const authTypeCount = Object.keys(parsed.authTypes).filter((k) => k !== 'noauth').length
  if (authTypeCount > 2) {
    out.touch('INCONSISTENT_AUTH', `Collection uses ${authTypeCount} different auth types. This may complicate maintenance.`)
  }

  const emptyHeaders = parsed.requests.filter((r) => r.headers.length > 0 && r.headers.every((h) => !h.value?.trim()))
  if (emptyHeaders.length > 0) {
    out.touch('EMPTY_HEADERS', `${emptyHeaders.length} request(s) have headers with empty values.`)
    emptyHeaders.forEach((r) => out.add('EMPTY_HEADERS', r.id))
  }

  const requestsByFolderAndName = new Map<string, string[]>()
  for (const request of parsed.requests) {
    const key = `${request.folderPath.join('/')}::${request.name.trim().toLowerCase()}`
    const ids = requestsByFolderAndName.get(key) ?? []
    ids.push(request.id)
    requestsByFolderAndName.set(key, ids)
  }
  const duplicateNameIds = [...requestsByFolderAndName.values()].filter((ids) => ids.length > 1).flat()
  if (duplicateNameIds.length > 0) {
    out.touch('DUPLICATE_REQUEST_NAMES', `${duplicateNameIds.length} request(s) share a name with another request in the same folder.`)
    duplicateNameIds.forEach((id) => out.add('DUPLICATE_REQUEST_NAMES', id))
  }

  const placeholderNamePattern = /^(new request|untitled|request|copy of\b|copy\b)/i
  const placeholderNames = parsed.requests.filter((request) => placeholderNamePattern.test(request.name.trim()))
  if (placeholderNames.length > 0) {
    out.touch('PLACEHOLDER_REQUEST_NAMES', `${placeholderNames.length} request(s) appear to use placeholder or copied names.`)
    placeholderNames.forEach((r) => out.add('PLACEHOLDER_REQUEST_NAMES', r.id))
  }

  const looseRootRequests = parsed.requests.filter((request) => request.folderPath.length === 0)
  if (looseRootRequests.length > 0 && parsed.totalFolders > 1) {
    out.touch(
      'ROOT_LEVEL_REQUESTS',
      `${looseRootRequests.length} request(s) sit at the collection root while the rest of the collection uses folders.`
    )
    looseRootRequests.forEach((r) => out.add('ROOT_LEVEL_REQUESTS', r.id))
  }

  const deepNestedRequests = parsed.requests.filter((request) => request.folderPath.length >= 5)
  if (deepNestedRequests.length > 0) {
    out.touch('DEEP_FOLDER_NESTING', `${deepNestedRequests.length} request(s) are nested five or more folders deep.`)
    deepNestedRequests.forEach((r) => out.add('DEEP_FOLDER_NESTING', r.id))
  }

  const getWithBody = parsed.requests.filter(
    (request) =>
      (request.method === 'GET' || request.method === 'HEAD') &&
      request.bodyMode !== 'graphql' &&
      (!!request.bodyRaw?.trim() || !!request.bodyFields?.length)
  )
  if (getWithBody.length > 0) {
    out.touch('GET_WITH_BODY', `${getWithBody.length} GET/HEAD request(s) send a request body.`)
    getWithBody.forEach((r) => out.add('GET_WITH_BODY', r.id))
  }
}

/** Normalizes untrusted option input (localStorage, server config) into a safe AuditOptions object. */
export function sanitizeAuditOptions(input: unknown): AuditOptions {
  if (!input || typeof input !== 'object') return {}
  const raw = input as { disabledRules?: unknown; severityOverrides?: unknown; rulePacks?: unknown }
  const disabledRules = Array.isArray(raw.disabledRules) ? raw.disabledRules.filter(isRuleId) : []
  const severityOverrides: Partial<Record<RuleId, Severity>> = {}
  if (raw.severityOverrides && typeof raw.severityOverrides === 'object') {
    for (const [ruleId, severity] of Object.entries(raw.severityOverrides as Record<string, unknown>)) {
      if (isRuleId(ruleId) && isSeverity(severity) && severity !== RULES[ruleId].severity) severityOverrides[ruleId] = severity
    }
  }
  const rulePacks = sanitizeRulePacks(raw.rulePacks)
  return { disabledRules, severityOverrides, ...(rulePacks ? { rulePacks } : {}) }
}

export interface AuditResult {
  /** Active findings: what is reported, scored and checked by `--fail-on`. */
  findings: Finding[]
  /** Occurrences hidden by a reviewed suppression, kept for reports. */
  suppressed: SuppressedFinding[]
  /** Rule packs that ran: `core` plus the identity packs that were forced on or switched on by identity signals. */
  packs: RulePackId[]
}

function sortFindings(findings: Finding[]): Finding[] {
  const order = new Map(RULE_LIST.map((rule, index) => [rule.id, index]))
  return findings.sort(
    (a, b) => severityRank(a.severity) - severityRank(b.severity) || (order.get(a.ruleId) ?? 0) - (order.get(b.ruleId) ?? 0)
  )
}

export function runAuditDetailed(parsed: ParsedCollection, options: AuditOptions = {}): AuditResult {
  const out = new FindingCollector()
  const identityDetected = detectIdentitySignals(parsed)
  const enabledPacks = resolveEnabledPacks(options.rulePacks, identityDetected)
  const packs = [...enabledPacks]

  // The profile depends on the selected environment (hosts behind variables), so every audit builds it again.
  const identity = identityDetected || enabledPacks.size > 1 ? buildIdentityProfile(parsed) : undefined
  if (identity && !isEmptyProfile(identity)) parsed.identity = identity
  else delete parsed.identity

  for (const req of parsed.requests) {
    checkHeaders(req, out)
    checkBody(req, out)
    checkQueryAndUrl(req, out)
    checkSavedResponses(req, out)
  }
  checkAuthHelpers(parsed, out)
  checkScripts(parsed, out)
  checkCollectionVariables(parsed, out)
  checkEnvironments(parsed, out)
  checkKnownPatterns(parsed, out)
  checkDescriptions(parsed, out)
  checkHighEntropy(parsed, out)

  runWarningChecks(parsed, out)
  checkVariableIntegrity(parsed, out)
  runInfoChecks(parsed, out)

  const { active, suppressed, notices } = applySuppressions(parsed, out.build(options, enabledPacks), options)
  if (notices.length === 0) return { findings: active, suppressed, packs }

  const noticeCollector = new FindingCollector()
  for (const notice of notices) noticeCollector.add(notice.ruleId, undefined, { location: notice.location })
  return { findings: sortFindings([...active, ...noticeCollector.build(options, enabledPacks)]), suppressed, packs }
}

export function runAudit(parsed: ParsedCollection, options: AuditOptions = {}): Finding[] {
  return runAuditDetailed(parsed, options).findings
}
