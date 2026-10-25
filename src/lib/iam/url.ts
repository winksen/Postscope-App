import type { ParsedCollection, ParsedRequest } from '../parser'
import { lookupVariableValue } from '../environment'
import { isVariableOrEmpty } from '../variables'

const LEADING_VARIABLE = /^\{\{\s*([^{}]+?)\s*\}\}/

export interface SplitUrl {
  scheme?: string
  /** Lowercase host without port or userinfo, when it is literal or resolved from the selected environment. */
  host?: string
  port?: string
  /** Name of the variable that stands for the host when it could not be resolved. */
  hostVariable?: string
  /** Path with `{{variables}}` and `:params` replaced by `*`, without query or fragment. Always starts with `/`. */
  path: string
}

/** Resolves a leading `{{variable}}` through the selected environment, collection variables and globals (a few levels deep). */
function resolveLeading(url: string, parsed: ParsedCollection): { url: string; variable?: string } {
  let current = url.trim()
  let variable: string | undefined
  for (let depth = 0; depth < 3; depth += 1) {
    const match = current.match(LEADING_VARIABLE)
    if (!match) break
    const name = match[1].trim()
    variable ??= name
    const value = lookupVariableValue(parsed, name)
    if (!value || isVariableOrEmpty(value)) break
    current = value.replace(/\/+$/, '') + current.slice(match[0].length)
    variable = undefined
  }
  return { url: current, variable }
}

/** The URL with a leading `{{variable}}` replaced by its value, when the selected environment, collection or globals define one. */
export function resolveUrlText(url: string, parsed: ParsedCollection): string {
  return url.startsWith('{{') ? resolveLeading(url, parsed).url : url
}

export function normalizePath(path: string): string {
  const bare = path.split(/[?#]/)[0]
  if (!bare.includes('{{') && !bare.includes('/:') && !bare.includes('//')) {
    const trimmed = bare.length > 1 ? bare.replace(/\/+$/, '') : bare
    return trimmed.startsWith('/') ? trimmed || '/' : `/${trimmed}`
  }
  const segments = bare
    .split('/')
    .filter((segment, index) => segment !== '' || index === 0)
    .map((segment) => (/^\{\{.*\}\}$/.test(segment) || /^:[^/]+$/.test(segment) || segment.includes('{{') ? '*' : segment))
  const joined = segments.join('/').replace(/\/{2,}/g, '/')
  const withRoot = joined.startsWith('/') ? joined : `/${joined}`
  return withRoot.length > 1 ? withRoot.replace(/\/+$/, '') : withRoot
}

/** Splits a request URL into host and normalized path. Variables are never guessed: an unknown host stays unknown. */
export function splitUrl(rawUrl: string, parsed: ParsedCollection): SplitUrl {
  const resolved = resolveLeading(rawUrl, parsed)
  const text = resolved.url
  const scheme = text.match(/^([a-z][a-z0-9+.-]*):\/\//i)?.[1]?.toLowerCase()
  const rest = scheme ? text.slice(scheme.length + 3) : text
  const authorityEnd = rest.search(/[/?#]/)
  const authority = authorityEnd === -1 ? rest : rest.slice(0, authorityEnd)
  const remainder = authorityEnd === -1 ? '' : rest.slice(authorityEnd)

  // `{{baseUrl}}/users` with an unknown variable: the whole authority is the variable.
  if (authority.includes('{{')) {
    const name = authority.match(LEADING_VARIABLE)?.[1]?.trim() ?? resolved.variable
    return { scheme, hostVariable: name, path: normalizePath(remainder || '/') }
  }

  // Without a scheme and without a variable the first segment is only a host when it looks like one.
  const withoutUser = authority.replace(/^[^@]*@/, '')
  const hostPort = withoutUser.startsWith('[') ? withoutUser : withoutUser.replace(/:(\d+)$/, '')
  const port = withoutUser.match(/:(\d+)$/)?.[1]
  if (!scheme && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(hostPort) && !/^localhost$/i.test(hostPort)) {
    return { path: normalizePath(text) }
  }
  return { scheme, host: hostPort.toLowerCase(), port, path: normalizePath(remainder || '/') }
}

/** Decodes a query or form value without throwing. `+` is a space, as in `application/x-www-form-urlencoded`. */
export function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '))
  } catch {
    return value
  }
}

/**
 * Parameters a request sends in its query, form body or top-level JSON body, keyed by lowercase name. Disabled
 * entries are left out. Later sources never overwrite earlier ones, so the query string wins over the body.
 */
/** Body fields that identity checks read. A JSON or form body without any of them is not parsed at all. */
const RELEVANT_BODY_KEY =
  /(?:^|["&{\s,])(?:grant_type|response_type|client_id|client_secret|client_assertion(?:_type)?|scope|redirect_uri|code_verifier|code_challenge(?:_method)?|code|state|nonce|action|token|username|password|audience|resource|actor_token|subject_token)["\s]*[=:]/i

export function requestParams(request: ParsedRequest): Map<string, string> {
  const params = new Map<string, string>()
  const put = (key: string, value: string) => {
    const name = key.trim().toLowerCase()
    if (name && !params.has(name)) params.set(name, value)
  }
  for (const entry of request.queryParams ?? []) put(entry.key, entry.value)
  const urlQuery = request.url.split('#')[0].split('?')[1]
  if (urlQuery) {
    for (const pair of urlQuery.split('&')) {
      const index = pair.indexOf('=')
      if (index > 0) put(safeDecode(pair.slice(0, index)), safeDecode(pair.slice(index + 1)))
    }
  }
  for (const entry of request.bodyFields ?? []) put(entry.key, entry.value)
  const raw = request.bodyRaw?.trim()
  if (raw && raw.length < 64_000 && RELEVANT_BODY_KEY.test(raw)) {
    if (raw.startsWith('{')) {
      try {
        const json = JSON.parse(raw) as Record<string, unknown>
        for (const [key, value] of Object.entries(json))
          if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') put(key, String(value))
      } catch {
        /* a body with template tokens may not be strict JSON; the other sources still apply */
      }
    } else if (/^[\w.%~+-]+=/.test(raw)) {
      for (const pair of raw.split('&')) {
        const index = pair.indexOf('=')
        if (index > 0) put(safeDecode(pair.slice(0, index)), safeDecode(pair.slice(index + 1)))
      }
    }
  }
  return params
}
