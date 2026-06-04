import type { Finding } from './auditor'
import type { ParsedCollection, ParsedRequest } from './parser'
import type { PostmanCollection, PostmanHeader, PostmanItem, PostmanUrl } from '../types/postman'

export type RepairFixKind =
  | 'hardcodedBaseUrl'
  | 'environmentUrl'
  | 'hardcodedAuthToken'
  | 'hardcodedApiKey'
  | 'basicAuthCredentials'
  | 'emptyHeaders'
  | 'collectionVariables'
  | 'missingDescription'
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

export function cloneJson<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value)) as T
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function variableExists(collection: unknown, key: string): boolean {
  const variables = (collection as PostmanCollection).variable
  return Array.isArray(variables) && variables.some((v) => v.key === key)
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

function queryToString(query: PostmanUrl['query']): string {
  if (!Array.isArray(query) || query.length === 0) return ''
  const params = query
    .filter((q) => q.key)
    .map((q) => `${encodeURIComponent(q.key)}=${encodeURIComponent(q.value ?? '')}`)
  return params.length ? `?${params.join('&')}` : ''
}

function postmanUrlToString(url: PostmanUrl): string {
  const protocol = url.protocol ? `${url.protocol}://` : ''
  const host = hostToString(url.host)
  const path = Array.isArray(url.path) && url.path.length > 0 ? `/${url.path.join('/')}` : ''
  return `${protocol}${host}${path}${queryToString(url.query)}`
}

export function parseUrlParts(value: string | PostmanUrl | undefined): UrlParts | null {
  if (!value) return null
  const source = typeof value === 'string' ? value : value.raw || postmanUrlToString(value)
  if (!/^https?:\/\//i.test(source)) return null

  try {
    const parsed = new URL(source)
    const pathQuery = parsed.pathname === '/' && !parsed.search ? '' : `${parsed.pathname}${parsed.search}`
    return {
      origin: parsed.origin,
      pathQuery,
    }
  } catch {
    return null
  }
}

export function replaceUrlHostWithBaseUrl(url: string | PostmanUrl | undefined): {
  before: string
  after: string
  origin: string
} | null {
  if (!url) return null
  const parts = parseUrlParts(url)
  if (!parts) return null
  const before = typeof url === 'string' ? url : url.raw || postmanUrlToString(url)
  return {
    before,
    after: `{{baseUrl}}${parts.pathQuery}`,
    origin: parts.origin,
  }
}

export function getItemAtPath(rawJson: unknown, itemPath: number[]): PostmanItem | undefined {
  let items: PostmanItem[] | undefined = (rawJson as PostmanCollection).item
  let current: PostmanItem | undefined
  for (const index of itemPath) {
    if (!Array.isArray(items) || index < 0 || index >= items.length) return undefined
    current = items[index]
    items = current.item
  }
  return current
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

function findingKind(finding: Finding): RepairFixKind | null {
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

function headerSnippet(request: ParsedRequest | undefined, matcher: (header: { key: string; value: string }) => boolean): string | undefined {
  const header = request?.headers.find(matcher)
  if (!header) return undefined
  return `${header.key}: ${header.value ? '***' : '""'}`
}

function authVariablesForTargets(targets: RepairTarget[], parsed: ParsedCollection): RepairVariable[] {
  const targetIds = new Set(targets.map((target) => target.requestId))
  const keys = new Set<string>()
  for (const request of parsed.requests) {
    if (!targetIds.has(request.id)) continue
    for (const header of request.headers) {
      if (header.key.toLowerCase() !== 'authorization' || isVariableValue(header.value)) continue
      if (/^Basic\s+/i.test(header.value)) keys.add('basicAuthToken')
      if (/^Bearer\s+/i.test(header.value)) keys.add('token')
    }
  }
  if (keys.size === 0) keys.add('token')
  return [...keys].map((key) => ({ key, value: '' }))
}

export function buildGeneratedDescription(request: ParsedRequest): string {
  const parts = parseUrlParts(request.url)
  let target = parts?.pathQuery.split('?')[0] || request.url || request.name
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
    const origins = originSetForRequests(targetRequests)
    const example = affectedRequest ? replaceUrlHostWithBaseUrl(affectedRequest.url) : null
    const multipleHosts = origins.length > 1
    return {
      ...base,
      status: 'auto',
      title: kind === 'hardcodedBaseUrl' ? 'Replace hardcoded base URL' : 'Parameterize environment URL',
      description: multipleHosts
        ? `Replaces literal hosts with {{baseUrl}} while preserving paths and query strings. Multiple hosts were detected; ${origins[0]} will be used as the default baseUrl value.`
        : 'Replaces the literal scheme and host with {{baseUrl}} while preserving paths and query strings.',
      risk: 'medium',
      selectedByDefault: true,
      beforeSnippet: example?.before,
      afterSnippet: example?.after,
      variablesToEnsure: [{ key: 'baseUrl', value: origins[0] || '' }],
    }
  }

  if (kind === 'hardcodedAuthToken') {
    const beforeSnippet = headerSnippet(affectedRequest, (header) => header.key.toLowerCase() === 'authorization')
    const afterSnippet = beforeSnippet?.toLowerCase().includes('basic') ? 'Authorization: Basic {{basicAuthToken}}' : 'Authorization: Bearer {{token}}'
    return {
      ...base,
      status: 'auto',
      title: 'Move Authorization token to variable',
      description: 'Replaces literal Bearer or Basic Authorization header values with collection variables.',
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
      beforeSnippet: headerSnippet(affectedRequest, (header) => API_KEY_REGEX.test(header.key)),
      afterSnippet: 'x-api-key: {{apiKey}}',
      variablesToEnsure: [{ key: 'apiKey', value: '' }],
    }
  }

  if (kind === 'basicAuthCredentials') {
    return {
      ...base,
      status: 'auto',
      title: 'Move Basic auth credentials to variables',
      description: 'Replaces literal username and password fields in Postman Basic auth with {{username}} and {{password}}.',
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

  return {
    ...base,
    status: 'manual',
    title: `Manual review: ${finding.title}`,
    description: finding.recommendation,
    risk: 'manual',
    selectedByDefault: false,
    manualReason: 'This finding needs human context before changing the collection.',
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

function applyUrlPatch(collection: unknown, fix: RepairFix): {
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

    const url = item.request.url
    const replacement = replaceUrlHostWithBaseUrl(url)
    if (!replacement) {
      const currentUrl = typeof url === 'string' ? url : url ? url.raw || postmanUrlToString(url) : ''
      if (VARIABLE_PATTERN.test(currentUrl)) continue
      skipped.push({ fixId: fix.id, title: fix.title, requestId: target.requestId, reason: 'URL was not an absolute HTTP URL.' })
      continue
    }

    if (typeof url === 'string') {
      item.request.url = replacement.after
    } else if (isRecord(url)) {
      url.raw = replacement.after
      url.host = ['{{baseUrl}}']
      delete url.protocol
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
): {
  changed: number
  skipped: SkippedRepair[]
  variables: RepairVariable[]
} {
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

export function patchHeaders(collection: unknown, fix: RepairFix): {
  changed: number
  skipped: SkippedRepair[]
  variables: RepairVariable[]
} {
  if (fix.kind === 'hardcodedAuthToken') {
    return applyHeaderPatch(collection, fix, (header) => {
      if (header.disabled || header.key.toLowerCase() !== 'authorization' || isVariableValue(header.value)) {
        return { changed: false, variables: [] }
      }
      if (/^Bearer\s+/i.test(header.value)) {
        header.value = 'Bearer {{token}}'
        return { changed: true, variables: [{ key: 'token', value: '' }] }
      }
      if (/^Basic\s+/i.test(header.value)) {
        header.value = 'Basic {{basicAuthToken}}'
        return { changed: true, variables: [{ key: 'basicAuthToken', value: '' }] }
      }
      return { changed: false, variables: [] }
    })
  }

  if (fix.kind === 'hardcodedApiKey') {
    return applyHeaderPatch(collection, fix, (header) => {
      if (header.disabled || !API_KEY_REGEX.test(header.key) || isVariableValue(header.value)) {
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

  for (const target of fix.affectedRequests) {
    const item = getItemAtPath(collection, target.itemPath)
    const basic = item?.request?.auth?.basic
    if (!Array.isArray(basic)) {
      skipped.push({ fixId: fix.id, title: fix.title, requestId: target.requestId, reason: 'Basic auth fields were not found.' })
      continue
    }

    let changedForRequest = false
    for (const entry of basic) {
      if (entry.key === 'username' && !isVariableValue(entry.value)) {
        entry.value = '{{username}}'
        changed += 1
        changedForRequest = true
      }
      if (entry.key === 'password' && !isVariableValue(entry.value)) {
        entry.value = '{{password}}'
        changed += 1
        changedForRequest = true
      }
    }
    if (!changedForRequest) {
      skipped.push({ fixId: fix.id, title: fix.title, requestId: target.requestId, reason: 'No literal Basic auth credentials were found.' })
    }
  }

  return { changed, skipped }
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
    if (item.request.description && String(item.request.description).trim()) {
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
      action = `Replaced URL hosts with {{baseUrl}} in ${changed} request(s).`
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
