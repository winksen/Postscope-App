import type { FindingCategory, Severity } from './severity'

/**
 * Addresses inside the analyzer. A link names a page, a request and filters, never collection content: request ids
 * are the `folder/name` ids the parser creates, and values, evidence and bodies are never part of a URL.
 */
export const PAGE_IDS = ['overview', 'requests', 'security', 'hygiene', 'repair', 'score', 'compare'] as const
export type PageId = (typeof PAGE_IDS)[number]

export const FILTER_SEVERITIES = ['critical', 'warning', 'info'] as const
export const FILTER_CATEGORIES = ['secrets', 'variables', 'auth'] as const

export interface AppLocation {
  page: PageId
  /** Selected request, on the `requests` page. */
  requestId?: string
  /** Findings pages: severity filter. */
  severity?: Severity
  /** Security page: category filter. */
  category?: Exclude<FindingCategory, 'hygiene'>
  /** Findings pages: only findings of this rule. */
  rule?: string
  /** Findings pages: the finding of this rule is open in the detail dialog. */
  finding?: string
  /** Security page: show the suppressed findings. */
  view?: 'suppressed'
}

const RULE_ID = /^[A-Z][A-Z0-9_]{1,63}$/
const MAX_ID_LENGTH = 1000

export function isPageId(value: string): value is PageId {
  return (PAGE_IDS as readonly string[]).includes(value)
}

function normalizeBase(basePath: string): string {
  return basePath.replace(/\/+$/, '')
}

function safeDecode(segment: string): string | undefined {
  try {
    const decoded = decodeURIComponent(segment)
    return decoded && decoded.length <= MAX_ID_LENGTH ? decoded : undefined
  } catch {
    return undefined
  }
}

/**
 * Reads the page, request and filters from a URL. Returns null when the path is not an analyzer address.
 * Unknown or malformed filter values are ignored rather than rejected.
 */
export function parseAppLocation(pathname: string, search: string, basePath = ''): AppLocation | null {
  const base = normalizeBase(basePath)
  let rest = pathname
  if (base) {
    if (rest !== base && !rest.startsWith(`${base}/`)) return null
    rest = rest.slice(base.length)
  }
  const segments = rest.split('/').filter(Boolean)
  if (segments.length === 0) return { page: 'overview' }

  const [page, ...tail] = segments
  if (!isPageId(page)) return null
  const location: AppLocation = { page }

  if (page === 'requests' && tail.length === 1) {
    const requestId = safeDecode(tail[0])
    if (requestId === undefined) return null
    location.requestId = requestId
  } else if (tail.length > 0) {
    return null
  }

  if (page === 'security' || page === 'hygiene') {
    const params = new URLSearchParams(search)
    const severity = params.get('severity')
    if (severity && (FILTER_SEVERITIES as readonly string[]).includes(severity)) location.severity = severity as Severity
    const category = params.get('category')
    if (page === 'security' && category && (FILTER_CATEGORIES as readonly string[]).includes(category)) location.category = category as AppLocation['category']
    const rule = params.get('rule')
    if (rule && RULE_ID.test(rule)) location.rule = rule
    const finding = params.get('finding')
    if (finding && RULE_ID.test(finding)) location.finding = finding
    if (page === 'security' && params.get('view') === 'suppressed') location.view = 'suppressed'
  }
  return location
}

/** The path and query string for a location (the inverse of `parseAppLocation`). */
export function buildAppPath(basePath: string, location: AppLocation): string {
  const base = normalizeBase(basePath)
  if (location.page === 'overview') return base || '/'
  let path = `${base}/${location.page}`
  if (location.page === 'requests' && location.requestId) path += `/${encodeURIComponent(location.requestId)}`

  const params = new URLSearchParams()
  if (location.page === 'security' || location.page === 'hygiene') {
    if (location.severity) params.set('severity', location.severity)
    if (location.page === 'security' && location.category) params.set('category', location.category)
    if (location.rule) params.set('rule', location.rule)
    if (location.finding) params.set('finding', location.finding)
    if (location.page === 'security' && location.view) params.set('view', location.view)
  }
  const query = params.toString()
  return query ? `${path}?${query}` : path
}
