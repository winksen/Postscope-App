import type { ReportContext, ReportFormat } from './reportExport'
import { RULE_LIST } from './rules'
import { redactSecretsInText } from './secretPatterns'

/**
 * Sharing profiles for reports.
 *
 * - `internal` is the default: names, hosts and paths stay, because the reader works in the same organization.
 * - `external` is for readers outside it (a vendor, an auditor, a public issue). Credentials are replaced, and so are
 *   collection, folder, request and environment names, hosts, URL paths, identity client ids and every identifier the
 *   operator lists as internal. Rule ids, titles, severities, scores, counts and endpoint classes stay, so the report
 *   still explains what is wrong and how to fix it.
 */
export type ReportProfile = 'internal' | 'external'

export const REPORT_PROFILES: readonly ReportProfile[] = ['internal', 'external']

export interface ReportPrivacy {
  profile: ReportProfile
  /** Extra strings that must never leave the organization: tenant names, project codes, domains, people. */
  internalIdentifiers?: string[]
}

export function isReportProfile(value: unknown): value is ReportProfile {
  return value === 'internal' || value === 'external'
}

/** File name stem for a download: the external profile does not repeat the collection name. */
export function reportStemForProfile(collectionName: string, privacy?: ReportPrivacy): string | null {
  return privacy?.profile === 'external' ? 'collection' : collectionName
}

const MIN_TERM_LENGTH = 3

let ruleCorpus: string | null = null
/** Everything the rules say, lower case. Words that appear in it are product vocabulary and are never treated as identifiers. */
function corpus(): string {
  ruleCorpus ??= JSON.stringify(RULE_LIST).toLowerCase()
  return ruleCorpus
}

function addVariants(terms: Map<string, string>, term: string, replacement: string): void {
  if (term.length < MIN_TERM_LENGTH) return
  const escapedHtml = term.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  const variants = new Set([
    term,
    JSON.stringify(term).slice(1, -1),
    escapedHtml,
    term.replace(/([\\`*_{}[\]<>|#])/g, '\\$1'),
    term.replace(/"/g, '""'),
  ])
  for (const variant of variants) if (variant.length >= MIN_TERM_LENGTH && !terms.has(variant)) terms.set(variant, replacement)
}

function hostOf(url: string): string | null {
  const match = /^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^/@\s]*@)?([^/:?#\s]+)/i.exec(url.trim())
  const host = match?.[1]
  if (!host || host.includes('{{') || host.startsWith(':') || !host.includes('.')) return null
  return host.toLowerCase()
}

/** Pseudonyms are numbered in the order things appear in the collection, so they are stable for one collection. */
function buildTerms(ctx: ReportContext, privacy: ReportPrivacy): Map<string, string> {
  const terms = new Map<string, string>()
  const known = corpus()
  const addIdentifier = (term: string | undefined, replacement: string) => {
    if (!term || term.length < MIN_TERM_LENGTH) return
    if (known.includes(term.toLowerCase())) return
    addVariants(terms, term, replacement)
  }

  // Configured identifiers win and are matched case-insensitively through extra lower and upper variants.
  for (const identifier of privacy.internalIdentifiers ?? []) {
    const trimmed = identifier.trim()
    if (trimmed.length < MIN_TERM_LENGTH) continue
    for (const variant of new Set([trimmed, trimmed.toLowerCase(), trimmed.toUpperCase()])) addVariants(terms, variant, '[internal]')
  }

  const { parsed } = ctx
  addIdentifier(parsed.name, 'Collection')
  if (ctx.sourceName) addVariants(terms, ctx.sourceName, 'collection.postman_collection.json')

  const folders = new Map<string, string>()
  parsed.requests.forEach((request, index) => {
    const label = request.folderPath.length ? `${request.folderPath.join(' / ')} / ${request.name}` : request.name
    const pseudonym = `Request ${index + 1}`
    // Full labels and ids first: they are long, unambiguous and contain the folder and request names.
    addVariants(terms, request.id, `request-${index + 1}`)
    addVariants(terms, label, pseudonym)
    request.folderPath.forEach((folder) => {
      if (!folders.has(folder)) folders.set(folder, `Folder ${folders.size + 1}`)
    })
    addIdentifier(request.name, pseudonym)
    const host = hostOf(request.url)
    if (host) addVariants(terms, host, `host-${terms.size}.invalid`)
  })
  for (const [folder, pseudonym] of folders) addIdentifier(folder, pseudonym)
  parsed.environments?.forEach((environment, index) => addIdentifier(environment.name, `Environment ${index + 1}`))

  const identity = parsed.identity
  if (identity) {
    identity.platforms.forEach((platform) => platform.hosts.forEach((host) => addVariants(terms, host, `host-${terms.size}.invalid`)))
    identity.endpoints.forEach((endpoint) => {
      if (endpoint.host && !endpoint.host.includes('{{')) addVariants(terms, endpoint.host, `host-${terms.size}.invalid`)
      if (endpoint.path.length > 6 && !known.includes(endpoint.path.toLowerCase())) addVariants(terms, endpoint.path, '/[path removed]')
    })
    identity.oauthClients.forEach((client, index) => {
      if (client.clientId && !client.clientId.includes('{{')) addVariants(terms, client.clientId, `client-${index + 1}`)
    })
  }
  return terms
}

/** Hosts that appear in the rule text (documentation links) or in the report skeleton are not the reader's data. */
function isProductHost(host: string): boolean {
  const lower = host.toLowerCase()
  return lower.includes('{{') || lower === 'github.com' || lower.endsWith('.example.invalid') || corpus().includes(lower)
}

/** Parse warnings quote names of items the parser skipped, which are not in the parsed collection. In JSON the quotes arrive escaped. */
const QUOTED_NAME = /\b(Folder|Request|Item|Collection|Variable) (\\?"|&quot;)[^"\n]{1,200}?(?:\\?"|&quot;)/g

const URL_PATTERN = /\b([a-z][a-z0-9+.-]*):\/\/([^\s/"'<>)\]\\?#]+)([^\s"'<>)\]\\]*)/gi

/** Replaces every remaining URL whose host is not product documentation, whether or not the collection listed it. */
function replaceUrls(text: string, hostNames: Map<string, string>): string {
  return text.replace(URL_PATTERN, (match, scheme: string, authority: string, rest: string) => {
    const hostPart = authority.includes('@') ? authority.slice(authority.lastIndexOf('@') + 1) : authority
    const host = hostPart.replace(/:\d+$/, '')
    if (isProductHost(host)) return match
    const key = host.toLowerCase()
    if (!hostNames.has(key)) hostNames.set(key, `host-${hostNames.size + 1}.invalid`)
    return `${scheme}://${hostNames.get(key)}${rest ? '/[path removed]' : ''}`
  })
}

/**
 * Applies the report's sharing profile to a finished report. The internal profile returns the report unchanged.
 * Works on the text of every format; names are matched as written, JSON-escaped, HTML-escaped and Markdown-escaped.
 */
export function applyReportProfile(_format: ReportFormat, output: string, ctx: ReportContext): string {
  const privacy = ctx.privacy
  if (!privacy || privacy.profile !== 'external') return output

  const terms = buildTerms(ctx, privacy)
  const ordered = [...terms.entries()].sort((a, b) => b[0].length - a[0].length)
  let result = output
  for (const [term, replacement] of ordered) result = result.split(term).join(replacement)
  result = replaceUrls(result, new Map())
  result = result.replace(QUOTED_NAME, '$1 $2[name removed]$2')
  return redactSecretsInText(result, () => '[redacted]')
}
