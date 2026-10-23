import type { AuditOptions, Finding } from './auditor'
import { splitFindingByOccurrence, type Occurrence } from './occurrences'
import type { ParsedCollection, ParsedRequest } from './parser'
import { isRuleId } from './rules'

/**
 * Reviewed suppressions. A suppression hides specific occurrences of a rule (not the whole rule) with a mandatory
 * reason, from `.postscope.json` or from a `postscope-ignore RULE_ID: reason` line in a description.
 * Suppressed occurrences stay visible in reports and never count toward the score or `--fail-on`.
 */
export interface ConfigSuppression {
  ruleId: string
  /** Glob on the request id (`Users/*`, `**`); when omitted the suppression matches every request. */
  request?: string
  /** Substring of the evidence location. */
  location?: string
  reason: string
  /** Last day (`YYYY-MM-DD`, UTC) the suppression applies. */
  expires?: string
}

export interface SuppressionInfo {
  reason: string
  source: 'config' | 'inline'
  expires?: string
}

export interface SuppressedFinding extends Finding {
  suppressed: true
  /** One entry per suppressed occurrence. */
  suppressions: Array<SuppressionInfo & { requestId?: string; location?: string }>
}

interface ActiveSuppression extends SuppressionInfo {
  ruleId: string
  matches: (occurrence: Occurrence) => boolean
}

export interface SuppressionNotice {
  ruleId: 'SUPPRESSION_EXPIRED' | 'SUPPRESSION_INVALID'
  location: string
}

export const INLINE_MARKER = 'postscope-ignore'
const DATE = /^\d{4}-\d{2}-\d{2}$/
/** `postscope-ignore RULE_ID [expires=YYYY-MM-DD]: reason`, optionally preceded by a list or quote marker. */
const INLINE_LINE = /^[\s>*+-]*postscope-ignore\b(.*)$/i
const INLINE_BODY = /^\s+([A-Za-z_]+)(?:\s+expires=(\S+))?\s*:\s*(.*?)\s*$/

/** Glob on request ids: `*` stays inside one folder level, `**` crosses folders, `?` is one character. */
export function globToRegExp(glob: string): RegExp {
  let source = ''
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i]
    if (char === '*' && glob[i + 1] === '*') {
      source += '.*'
      i += 1
    } else if (char === '*') source += '[^/]*'
    else if (char === '?') source += '[^/]'
    else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${source}$`)
}

export function isValidDate(value: string): boolean {
  if (!DATE.test(value)) return false
  const time = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
}

function isExpired(expires: string | undefined, now: Date): boolean {
  return !!expires && isValidDate(expires) && now.getTime() > Date.parse(`${expires}T23:59:59.999Z`)
}

function folderKey(request: ParsedRequest): string {
  return request.folderPath.join(' / ')
}

interface InlineParse {
  suppressions: ActiveSuppression[]
  expired: SuppressionNotice[]
  invalid: SuppressionNotice[]
}

function parseInline(parsed: ParsedCollection, requests: Map<string, ParsedRequest>, now: Date): InlineParse {
  const result: InlineParse = { suppressions: [], expired: [], invalid: [] }
  for (const description of parsed.descriptions ?? []) {
    const place =
      description.kind === 'collection'
        ? 'description (collection)'
        : description.kind === 'folder'
          ? `description (folder "${description.owner}")`
          : `description (request "${description.owner}")`
    for (const line of description.text.split(/\r?\n/)) {
      const marker = line.match(INLINE_LINE)
      if (!marker) continue
      const body = marker[1].match(INLINE_BODY)
      const [, ruleId, expires, reason] = body ?? []
      const label = `${place}: ${line.trim().slice(0, 80)}`
      if (!body || !isRuleId(ruleId.toUpperCase()) || !reason || (expires && !isValidDate(expires))) {
        result.invalid.push({
          ruleId: 'SUPPRESSION_INVALID',
          location: `${label} (needs "${INLINE_MARKER} RULE_ID: reason" with a known rule, a reason and an optional expires=YYYY-MM-DD)`,
        })
        continue
      }
      if (isExpired(expires, now)) {
        result.expired.push({ ruleId: 'SUPPRESSION_EXPIRED', location: `${label} (expired ${expires})` })
        continue
      }
      const upper = ruleId.toUpperCase()
      result.suppressions.push({
        ruleId: upper,
        reason,
        source: 'inline',
        expires,
        matches: (occurrence) => {
          if (description.kind === 'collection') return true
          if (!occurrence.requestId) return false
          if (description.kind === 'request') return occurrence.requestId === description.requestId
          const request = requests.get(occurrence.requestId)
          return !!request && (folderKey(request) === description.owner || folderKey(request).startsWith(`${description.owner} / `))
        },
      })
    }
  }
  return result
}

/** Splits findings into active and suppressed occurrences and reports expired or malformed suppressions. */
export function applySuppressions(
  parsed: ParsedCollection,
  findings: Finding[],
  options: Pick<AuditOptions, 'suppressions' | 'now'> = {}
): { active: Finding[]; suppressed: SuppressedFinding[]; notices: SuppressionNotice[] } {
  const now = options.now ?? new Date()
  const requests = new Map(parsed.requests.map((request) => [request.id, request]))
  const inline = parseInline(parsed, requests, now)
  const notices: SuppressionNotice[] = [...inline.invalid, ...inline.expired]
  const suppressions: ActiveSuppression[] = [...inline.suppressions]

  for (const entry of options.suppressions ?? []) {
    if (isExpired(entry.expires, now)) {
      notices.push({
        ruleId: 'SUPPRESSION_EXPIRED',
        location: `config suppression ${entry.ruleId}${entry.request ? ` for ${entry.request}` : ''} (expired ${entry.expires})`,
      })
      continue
    }
    const requestPattern = entry.request ? globToRegExp(entry.request) : null
    suppressions.push({
      ruleId: entry.ruleId,
      reason: entry.reason,
      source: 'config',
      expires: entry.expires,
      matches: (occurrence) => {
        if (requestPattern && !(occurrence.requestId && requestPattern.test(occurrence.requestId))) return false
        if (entry.location && !(occurrence.location && occurrence.location.includes(entry.location))) return false
        return true
      },
    })
  }

  if (suppressions.length === 0) return { active: findings, suppressed: [], notices }

  const active: Finding[] = []
  const suppressed: SuppressedFinding[] = []
  for (const finding of findings) {
    const candidates = suppressions.filter((suppression) => suppression.ruleId === finding.ruleId)
    if (candidates.length === 0) {
      active.push(finding)
      continue
    }
    const { kept, matched } = splitFindingByOccurrence(finding, (occurrence) =>
      candidates.find((suppression) => suppression.matches(occurrence))
    )
    if (kept) active.push(kept)
    if (matched) {
      suppressed.push({
        ...matched.finding,
        suppressed: true,
        suppressions: matched.matches.map(({ occurrence, match }) => ({
          reason: match.reason,
          source: match.source,
          expires: match.expires,
          requestId: occurrence.requestId,
          location: occurrence.location,
        })),
      })
    }
  }
  return { active, suppressed, notices }
}
