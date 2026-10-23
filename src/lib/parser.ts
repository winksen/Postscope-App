import type { PostmanAuth, PostmanCollection } from '../types/postman'
import { detectRequestProtocol, type RequestProtocol } from './requestProtocol'
import { getAuthEntries, isInheritedAuth, normalizeAuthType, type AuthEntry } from './authSchemes'
import { extractVariableNames } from './variables'

export type { RequestProtocol }

/** Where a request's effective auth comes from. Postman inherits auth from parent folders and the collection. */
export type AuthSource = 'request' | 'folder' | 'collection' | 'none'

export interface KeyValue {
  key: string
  value: string
}

export interface ParsedSavedResponse {
  name: string
  headers: KeyValue[]
  /** Truncated body text, kept only for scanning. */
  body?: string
  requestHeaders: KeyValue[]
  /** Disabled headers of the saved request. They still ship in the export, so they are audited. */
  disabledRequestHeaders?: KeyValue[]
  requestUrl?: string
  requestAuthType?: string
  requestAuthFields?: AuthEntry[]
}

export interface ParsedRequest {
  id: string;
  name: string;
  method: string;
  protocol: RequestProtocol;
  url: string;
  /** Index path through nested Postman item arrays back to the raw collection item. */
  itemPath: number[];
  folderPath: string[];
  /** Effective auth type, including auth inherited from folders or the collection. */
  auth: string;
  /** Present when the effective Postman auth type is basic (username/password fields). */
  basicAuth?: { username: string; password: string };
  headers: Array<{ key: string; value: string }>;
  /** Headers switched off in Postman. They are not sent but still ship in the export. */
  disabledHeaders?: KeyValue[];
  bodyRaw?: string;
  hasDescription: boolean;
  authSource?: AuthSource;
  /** Item path of the request or folder that owns the effective auth; `[]` means collection level. */
  authOwnerPath?: number[];
  /** Entries of the effective auth helper (all types except basic). */
  authFields?: AuthEntry[];
  queryParams?: KeyValue[];
  /** Query params switched off in Postman (kept in `url.query`, absent from `url.raw`). */
  disabledQueryParams?: KeyValue[];
  bodyMode?: string;
  /** Text fields of urlencoded / form-data bodies. */
  bodyFields?: KeyValue[];
  /** Disabled text fields of urlencoded / form-data bodies. */
  disabledBodyFields?: KeyValue[];
  scripts?: { prerequest?: string; test?: string; disabledPrerequest?: string; disabledTest?: string };
  savedResponses?: ParsedSavedResponse[];
  /** True when Postman SSL certificate verification is disabled for this request (directly or inherited). */
  tlsVerificationDisabled?: boolean;
}

export interface ParsedFolder {
  name: string;
  path: string[];
  requestCount: number;
  requests: ParsedRequest[];
}

export interface ParsedScript {
  /** `collection` or the folder path joined with ` / `. */
  owner: string
  ownerPath: number[]
  listen: string
  source: string
  /** True when the event is switched off in Postman. It still ships in the export. */
  disabled?: boolean
}

/** A collection or folder that defines its own auth (requests may inherit it). */
export interface ParsedAuthOwner {
  /** `collection` or the folder path joined with ` / `. */
  owner: string
  ownerPath: number[]
  type: string
  fields: AuthEntry[]
}

export interface ParsedVariable {
  key: string
  value: string
  type?: string
  disabled?: boolean
}

export interface ParsedCollection {
  name: string;
  version: string;
  totalRequests: number;
  totalFolders: number;
  methods: Record<string, number>;
  authTypes: Record<string, number>;
  variables: string[];
  definedVariables: string[];
  requests: ParsedRequest[];
  folders: ParsedFolder[];
  collectionVariables?: ParsedVariable[];
  collectionAuthType?: string;
  /** Collection- and folder-level auth definitions. */
  authOwners?: ParsedAuthOwner[];
  /** Collection- and folder-level scripts (request scripts live on each request). */
  scripts?: ParsedScript[];
  /** Non-fatal problems found while reading a malformed export. */
  parseWarnings?: string[];
}

/** Nesting deeper than this is almost certainly malformed and is skipped to protect the call stack. */
const MAX_DEPTH = 100
const MAX_WARNINGS = 25
const MAX_RESPONSE_BODY_SCAN = 64_000
const MAX_SAVED_RESPONSES_PER_REQUEST = 50

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function asText(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

/** Postman descriptions may be a string or `{ content, type }`. */
function descriptionText(value: unknown): string {
  if (typeof value === 'string') return value
  if (isRecord(value)) return asText(value.content)
  return ''
}

function pathSegments(path: unknown): string[] {
  if (typeof path === 'string') return path.split('/').filter(Boolean)
  if (!Array.isArray(path)) return []
  return path.map((segment) => (isRecord(segment) ? asText(segment.value) : asText(segment)))
}

function getUrlString(url: unknown): string {
  if (!url) return ''
  if (typeof url === 'string') return url
  if (!isRecord(url)) return ''
  const raw = asText(url.raw)
  if (raw) return raw
  const host = Array.isArray(url.host) ? url.host.map(asText).join('.') : asText(url.host)
  const path = pathSegments(url.path).join('/')
  return `${host}/${path}`
}

function parseQueryFromRaw(rawUrl: string): KeyValue[] {
  const queryStart = rawUrl.indexOf('?')
  if (queryStart === -1) return []
  const query = rawUrl.slice(queryStart + 1).split('#')[0]
  return query
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf('=')
      const key = eq === -1 ? pair : pair.slice(0, eq)
      const value = eq === -1 ? '' : pair.slice(eq + 1)
      return { key: safeDecode(key), value: safeDecode(value) }
    })
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '))
  } catch {
    return value
  }
}

function getQueryParams(url: unknown, urlString: string): { active: KeyValue[]; disabled: KeyValue[] } {
  if (isRecord(url) && Array.isArray(url.query)) {
    const entries = url.query
      .filter((entry): entry is UnknownRecord => isRecord(entry))
      .map((entry) => ({ key: asText(entry.key), value: asText(entry.value), disabled: entry.disabled === true }))
      .filter((entry) => entry.key)
    return {
      active: entries.filter((entry) => !entry.disabled).map(({ key, value }) => ({ key, value })),
      disabled: entries.filter((entry) => entry.disabled).map(({ key, value }) => ({ key, value })),
    }
  }
  return { active: parseQueryFromRaw(urlString), disabled: [] }
}

interface NormalizedHeader {
  key: string
  value: string
  disabled?: boolean
}

/** Headers may be an array of `{ key, value }` or a raw `Key: value` string block. */
function normalizeHeaders(headers: unknown): NormalizedHeader[] {
  if (typeof headers === 'string') {
    return headers
      .split(/\r?\n/)
      .map((line) => {
        const colon = line.indexOf(':')
        if (colon <= 0) return null
        return { key: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim() }
      })
      .filter((header): header is NormalizedHeader => !!header && !!header.key)
  }
  if (!Array.isArray(headers)) return []
  return headers
    .filter(isRecord)
    .map((header) => ({ key: asText(header.key), value: asText(header.value), disabled: header.disabled === true }))
    .filter((header) => header.key)
}

function formFields(entries: unknown, disabled = false): KeyValue[] {
  if (!Array.isArray(entries)) return []
  return entries
    .filter((entry): entry is UnknownRecord => isRecord(entry) && (entry.disabled === true) === disabled && entry.type !== 'file')
    .map((entry) => ({ key: asText(entry.key), value: asText(entry.value) }))
    .filter((entry) => entry.key)
}

interface BodyInfo {
  mode?: string
  raw?: string
  fields?: KeyValue[]
  disabledFields?: KeyValue[]
  graphqlQuery?: string
}

function readBody(body: unknown): BodyInfo {
  if (!isRecord(body)) return {}
  const mode = typeof body.mode === 'string' ? body.mode : undefined
  const graphql = isRecord(body.graphql) ? body.graphql : undefined
  const graphqlQuery = graphql ? asText(graphql.query) || undefined : undefined
  const urlencoded = formFields(body.urlencoded)
  const formdata = formFields(body.formdata)
  const disabledUrlencoded = formFields(body.urlencoded, true)
  const disabledFormdata = formFields(body.formdata, true)
  const pairs = (fields: KeyValue[]) => fields.map((entry) => `${entry.key}=${entry.value}`).join('&')

  if (mode === 'urlencoded') return { mode, fields: urlencoded, disabledFields: disabledUrlencoded, raw: pairs(urlencoded) || undefined }
  if (mode === 'formdata') return { mode, fields: formdata, disabledFields: disabledFormdata, raw: pairs(formdata) || undefined }
  if (mode === 'graphql') {
    const variables = graphql ? asText(graphql.variables) : ''
    return { mode, graphqlQuery, raw: graphqlQuery ? [graphqlQuery, variables].filter(Boolean).join('\n') : undefined }
  }
  if (mode === 'file') return { mode }
  if (mode === 'raw') return { mode, raw: asText(body.raw) || undefined }

  // Unknown or missing mode: keep the historical behavior (raw first, then urlencoded).
  const raw = typeof body.raw === 'string' ? body.raw : urlencoded.length ? pairs(urlencoded) : undefined
  return {
    mode,
    raw: raw || undefined,
    fields: urlencoded.length ? urlencoded : undefined,
    disabledFields: disabledUrlencoded.length ? disabledUrlencoded : undefined,
    graphqlQuery,
  }
}

function scriptSource(script: unknown): string {
  if (!isRecord(script)) return ''
  const exec = script.exec
  if (Array.isArray(exec)) return exec.map(asText).join('\n')
  return asText(exec)
}

function readEvents(events: unknown): Array<{ listen: string; source: string; disabled: boolean }> {
  if (!Array.isArray(events)) return []
  return events
    .filter((event): event is UnknownRecord => isRecord(event))
    .map((event) => ({ listen: asText(event.listen) || 'script', source: scriptSource(event.script), disabled: event.disabled === true }))
    .filter((event) => event.source.trim())
}

function readSavedResponses(responses: unknown): ParsedSavedResponse[] {
  if (!Array.isArray(responses)) return []
  return responses
    .slice(0, MAX_SAVED_RESPONSES_PER_REQUEST)
    .filter(isRecord)
    .map((response) => {
      const original = isRecord(response.originalRequest) ? response.originalRequest : undefined
      const originalAuth = original && isRecord(original.auth) ? (original.auth as PostmanAuth) : undefined
      const body = asText(response.body)
      const originalHeaders = original ? normalizeHeaders(original.header) : []
      const disabledRequestHeaders = originalHeaders.filter((header) => header.disabled).map(({ key, value }) => ({ key, value }))
      return {
        name: asText(response.name) || 'Example',
        headers: normalizeHeaders(response.header).map(({ key, value }) => ({ key, value })),
        body: body ? body.slice(0, MAX_RESPONSE_BODY_SCAN) : undefined,
        requestHeaders: originalHeaders.filter((header) => !header.disabled).map(({ key, value }) => ({ key, value })),
        disabledRequestHeaders: disabledRequestHeaders.length ? disabledRequestHeaders : undefined,
        requestUrl: original ? getUrlString(original.url) || undefined : undefined,
        requestAuthType: originalAuth && !isInheritedAuth(originalAuth) ? normalizeAuthType(originalAuth.type) : undefined,
        requestAuthFields: originalAuth && !isInheritedAuth(originalAuth) ? getAuthEntries(originalAuth) : undefined,
      }
    })
}

function getBasicAuthCreds(auth: PostmanAuth | undefined): { username: string; password: string } | undefined {
  const entries = getAuthEntries(auth, 'basic')
  if (!entries.length) return undefined
  const username = entries.find((e) => e.key === 'username')?.value ?? ''
  const password = entries.find((e) => e.key === 'password')?.value ?? ''
  if (!username && !password) return undefined
  return { username, password }
}

function strictSslSetting(behavior: unknown): boolean | undefined {
  if (!isRecord(behavior)) return undefined
  return typeof behavior.strictSSL === 'boolean' ? behavior.strictSSL : undefined
}

interface InheritedContext {
  auth?: PostmanAuth
  authSource: AuthSource
  authOwnerPath?: number[]
  strictSSL?: boolean
}

interface ParseAccumulator {
  requests: ParsedRequest[]
  methods: Record<string, number>
  authTypes: Record<string, number>
  variables: Set<string>
  idCounts: Map<string, number>
  scripts: ParsedScript[]
  authOwners: ParsedAuthOwner[]
  warnings: string[]
}

function warn(acc: ParseAccumulator, message: string): void {
  if (acc.warnings.length < MAX_WARNINGS) acc.warnings.push(message)
}

function parseItem(
  rawItem: unknown,
  folderPath: string[],
  itemPath: number[],
  inherited: InheritedContext,
  acc: ParseAccumulator
): void {
  if (!isRecord(rawItem)) {
    warn(acc, `Skipped a malformed item at position ${itemPath.join('.')}.`)
    return
  }
  if (itemPath.length > MAX_DEPTH) {
    warn(acc, `Skipped items nested deeper than ${MAX_DEPTH} levels.`)
    return
  }

  const name = asText(rawItem.name) || (rawItem.request ? 'Untitled request' : 'Untitled folder')
  const strictSSL = strictSslSetting(rawItem.protocolProfileBehavior) ?? inherited.strictSSL

  if (isRecord(rawItem.request) || typeof rawItem.request === 'string') {
    // A bare string request is the URL (Postman shorthand).
    const req: UnknownRecord = typeof rawItem.request === 'string' ? { url: rawItem.request } : rawItem.request
    const method = (asText(req.method) || 'GET').toUpperCase()
    const url = getUrlString(req.url)
    const allHeaders = normalizeHeaders(req.header)
    const headers = allHeaders.filter((h) => !h.disabled).map((h) => ({ key: h.key, value: h.value }))
    const disabledHeaders = allHeaders.filter((h) => h.disabled).map((h) => ({ key: h.key, value: h.value }))
    const body = readBody(req.body)
    const bodyRaw = body.raw

    const ownAuth = isRecord(req.auth) ? (req.auth as PostmanAuth) : undefined
    const usesOwnAuth = !!ownAuth && !isInheritedAuth(ownAuth)
    const effectiveAuth = usesOwnAuth ? ownAuth : inherited.auth
    const authSource: AuthSource = usesOwnAuth ? 'request' : effectiveAuth ? inherited.authSource : 'none'
    const auth = normalizeAuthType(effectiveAuth?.type)
    const basicAuth = auth === 'basic' ? getBasicAuthCreds(effectiveAuth) : undefined
    const authFields = effectiveAuth && auth !== 'basic' && auth !== 'noauth' ? getAuthEntries(effectiveAuth) : undefined

    const protocol = detectRequestProtocol({
      method,
      url,
      headers: allHeaders,
      bodyMode: body.mode,
      bodyRaw: bodyRaw || body.graphqlQuery,
      graphqlQuery: body.graphqlQuery,
    })

    const queryParams = getQueryParams(req.url, url)
    const events = readEvents(rawItem.event)
    const joinSources = (listen: string, disabled: boolean) =>
      events.filter((e) => e.listen === listen && e.disabled === disabled).map((e) => e.source).join('\n') || undefined
    const scripts = events.length
      ? {
          prerequest: joinSources('prerequest', false),
          test: joinSources('test', false),
          disabledPrerequest: joinSources('prerequest', true),
          disabledTest: joinSources('test', true),
        }
      : undefined

    const allText = [
      url,
      headers.map((h) => h.key + h.value).join(''),
      bodyRaw || body.graphqlQuery || '',
      (authFields ?? []).map((field) => field.value).join(' '),
      basicAuth ? `${basicAuth.username} ${basicAuth.password}` : '',
    ].join(' ')
    extractVariableNames(allText).forEach((v) => acc.variables.add(v))

    acc.methods[method] = (acc.methods[method] || 0) + 1
    acc.authTypes[auth] = (acc.authTypes[auth] || 0) + 1

    const baseId = `${folderPath.join('/')}/${name}`.replace(/^\//, '') || name
    const seen = (acc.idCounts.get(baseId) ?? 0) + 1
    acc.idCounts.set(baseId, seen)
    const id = seen > 1 ? `${baseId}#${seen}` : baseId

    const savedResponses = readSavedResponses(rawItem.response)

    acc.requests.push({
      id,
      name,
      method,
      protocol,
      url,
      itemPath,
      folderPath,
      auth,
      basicAuth,
      headers,
      disabledHeaders: disabledHeaders.length ? disabledHeaders : undefined,
      bodyRaw: bodyRaw || undefined,
      hasDescription: !!(descriptionText(req.description).trim() || descriptionText(rawItem.description).trim()),
      authSource,
      authOwnerPath: usesOwnAuth ? itemPath : effectiveAuth ? inherited.authOwnerPath : undefined,
      authFields: authFields?.length ? authFields : undefined,
      queryParams: queryParams.active.length ? queryParams.active : undefined,
      disabledQueryParams: queryParams.disabled.length ? queryParams.disabled : undefined,
      bodyMode: body.mode,
      bodyFields: body.fields?.length ? body.fields : undefined,
      disabledBodyFields: body.disabledFields?.length ? body.disabledFields : undefined,
      scripts,
      savedResponses: savedResponses.length ? savedResponses : undefined,
      tlsVerificationDisabled: strictSSL === false ? true : undefined,
    })
  }

  if (rawItem.item !== undefined && rawItem.item !== null) {
    if (!Array.isArray(rawItem.item)) {
      warn(acc, `Folder "${name}" has a non-array item list and was skipped.`)
      return
    }
    const newPath = [...folderPath, name]
    const folderAuth = isRecord(rawItem.auth) ? (rawItem.auth as PostmanAuth) : undefined
    const hasFolderAuth = !!folderAuth && !isInheritedAuth(folderAuth)
    const childContext: InheritedContext = hasFolderAuth
      ? { auth: folderAuth, authSource: 'folder', authOwnerPath: itemPath, strictSSL }
      : { ...inherited, strictSSL }
    if (hasFolderAuth) {
      acc.authOwners.push({
        owner: newPath.join(' / '),
        ownerPath: itemPath,
        type: normalizeAuthType(folderAuth?.type),
        fields: getAuthEntries(folderAuth),
      })
    }

    for (const event of readEvents(rawItem.event)) {
      acc.scripts.push({ owner: newPath.join(' / '), ownerPath: itemPath, listen: event.listen, source: event.source, disabled: event.disabled || undefined })
    }

    rawItem.item.forEach((child, index) => parseItem(child, newPath, [...itemPath, index], childContext, acc))
  }
}

function readCollectionVariables(variables: unknown): ParsedVariable[] {
  if (!Array.isArray(variables)) return []
  return variables
    .filter(isRecord)
    .map((variable) => ({
      key: asText(variable.key),
      value: asText(variable.value),
      type: typeof variable.type === 'string' ? variable.type : undefined,
      disabled: variable.disabled === true ? true : undefined,
    }))
    .filter((variable) => variable.key)
}

export function parseCollection(json: unknown): ParsedCollection {
  if (!isRecord(json) || !Array.isArray(json.item)) throw new Error('Invalid Postman collection format')
  const col = json as unknown as PostmanCollection & UnknownRecord

  const acc: ParseAccumulator = {
    requests: [],
    methods: {},
    authTypes: {},
    variables: new Set<string>(),
    idCounts: new Map<string, number>(),
    scripts: [],
    authOwners: [],
    warnings: [],
  }

  const collectionAuth = isRecord(col.auth) && !isInheritedAuth(col.auth) ? (col.auth as PostmanAuth) : undefined
  const rootContext: InheritedContext = {
    auth: collectionAuth,
    authSource: collectionAuth ? 'collection' : 'none',
    authOwnerPath: collectionAuth ? [] : undefined,
    strictSSL: strictSslSetting(col.protocolProfileBehavior),
  }

  if (collectionAuth) {
    acc.authOwners.push({
      owner: 'collection',
      ownerPath: [],
      type: normalizeAuthType(collectionAuth.type),
      fields: getAuthEntries(collectionAuth),
    })
  }

  for (const event of readEvents(col.event)) {
    acc.scripts.push({ owner: 'collection', ownerPath: [], listen: event.listen, source: event.source, disabled: event.disabled || undefined })
  }

  col.item.forEach((item, index) => parseItem(item, [], [index], rootContext, acc))

  const collectionVariables = readCollectionVariables(col.variable)
  const definedVariables = collectionVariables.map((v) => v.key)
  const allVars = [...acc.variables, ...definedVariables]
  const variables = [...new Set(allVars)]

  const folderMap = new Map<string, ParsedFolder>()
  acc.requests.forEach((r) => {
    const pathKey = r.folderPath.join('/')
    const folder = folderMap.get(pathKey) || {
      name: r.folderPath[r.folderPath.length - 1] || 'Root',
      path: r.folderPath,
      requestCount: 0,
      requests: [],
    }
    folder.requestCount++
    folder.requests.push(r)
    folderMap.set(pathKey, folder)
  })

  const rootRequests = acc.requests.filter((r) => r.folderPath.length === 0)
  if (rootRequests.length > 0 && !folderMap.has('')) {
    folderMap.set('', {
      name: 'Root',
      path: [],
      requestCount: rootRequests.length,
      requests: rootRequests,
    })
  }

  const folders = Array.from(folderMap.values()).filter((f) => f.requests.length > 0)

  const info: UnknownRecord = isRecord(col.info) ? col.info : {}
  const schema = asText(info.schema)
  const version = schema.includes('2.1') ? '2.1' : schema.includes('2.0') ? '2.0' : '2.1'

  return {
    name: asText(info.name) || 'Untitled',
    version,
    totalRequests: acc.requests.length,
    totalFolders: folders.length,
    methods: acc.methods,
    authTypes: acc.authTypes,
    variables,
    definedVariables,
    requests: acc.requests,
    folders,
    collectionVariables,
    collectionAuthType: collectionAuth ? normalizeAuthType(collectionAuth.type) : undefined,
    authOwners: acc.authOwners,
    scripts: acc.scripts,
    parseWarnings: acc.warnings,
  }
}
