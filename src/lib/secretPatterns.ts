import { hasVariableReference } from './variables'

/**
 * High-signal secret detection shared by the auditor, the redaction engine and the UI masking.
 * Patterns are provider token formats with distinctive prefixes, so they rarely match ordinary data.
 * Every regex is linear (no nested quantifiers) to stay safe on very large inputs.
 */

export interface SecretPattern {
  id: string
  label: string
  regex: RegExp
}

export interface SecretMatch {
  patternId: string
  label: string
  match: string
  index: number
}

export const SECRET_PATTERNS: SecretPattern[] = [
  { id: 'private-key', label: 'Private key block', regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g },
  { id: 'aws-access-key', label: 'AWS access key ID', regex: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA|ANVA|AIPA)[0-9A-Z]{16}\b/g },
  { id: 'github-token', label: 'GitHub token', regex: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255})\b/g },
  { id: 'gitlab-token', label: 'GitLab token', regex: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
  { id: 'slack-token', label: 'Slack token', regex: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g },
  { id: 'slack-webhook', label: 'Slack webhook URL', regex: /https:\/\/hooks\.slack\.com\/services\/T[A-Za-z0-9]+\/B[A-Za-z0-9]+\/[A-Za-z0-9]+/g },
  { id: 'stripe-key', label: 'Stripe live key', regex: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/g },
  { id: 'google-api-key', label: 'Google API key', regex: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: 'anthropic-key', label: 'Anthropic API key', regex: /\bsk-ant-[A-Za-z0-9]{2,10}-[A-Za-z0-9_-]{32,}\b/g },
  { id: 'openai-key', label: 'OpenAI API key', regex: /\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{32,}\b|\bsk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20}\b/g },
  { id: 'sendgrid-key', label: 'SendGrid API key', regex: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g },
  { id: 'twilio-key', label: 'Twilio API key', regex: /\bSK[0-9a-fA-F]{32}\b/g },
  { id: 'npm-token', label: 'npm access token', regex: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { id: 'azure-storage-key', label: 'Azure storage account key', regex: /AccountKey=[A-Za-z0-9+/]{40,}={0,2}/g },
  { id: 'jwt', label: 'JSON Web Token', regex: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  {
    id: 'connection-string',
    label: 'Connection string with password',
    regex: /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|mariadb|rediss?|amqps?|mssql|sqlserver):\/\/[^\s:@/{}"']+:[^\s@/{}"']+@[^\s/"']+/gi,
  },
]

/** `Authorization` values that start with a known scheme followed by a credential. */
export const AUTH_HEADER_SCHEME = /^(Bearer|Basic|Token|Digest|Hawk|ApiKey|Api-Key|JWT|AWS4-HMAC-SHA256|SharedKey|OAuth)\s+\S+/i
export const TOKEN_HEADER = /^(x-(auth|access|session|refresh)-token|x-amz-security-token|private-token)$/i
/** A session-like cookie inside a `Cookie` header value: `[1]` is the name, `[2]` the value. */
export const SESSION_COOKIE = /(?:^|;\s*)([^=;\s]*(?:session|sess|sid|token|auth|jwt)[^=;\s]*)=([^;]+)/i

/** Above this size only the first chunk is scanned so pathological inputs cannot stall the UI. */
const MAX_SCAN_LENGTH = 512_000

export function findSecretPatterns(text: string | undefined | null, limit = 20): SecretMatch[] {
  if (!text) return []
  const source = text.length > MAX_SCAN_LENGTH ? text.slice(0, MAX_SCAN_LENGTH) : text
  const matches: SecretMatch[] = []
  for (const pattern of SECRET_PATTERNS) {
    pattern.regex.lastIndex = 0
    for (const match of source.matchAll(pattern.regex)) {
      matches.push({ patternId: pattern.id, label: pattern.label, match: match[0], index: match.index ?? 0 })
      if (matches.length >= limit) return matches
    }
  }
  return matches
}

export function containsSecretPattern(text: string | undefined | null): boolean {
  return findSecretPatterns(text, 1).length > 0
}

const SENSITIVE_KEY = /(password|passwd|passphrase|(^|[-_.])pass$|^pwd$|secret|token|api[-_.]?key|apikey|access[-_.]?key|private[-_.]?key|client[-_.]?assertion|credential|auth[-_.]?key|session[-_.]?(id|key)|signing[-_.]?key|bearer|^cookie$|^jwt$|^sid$)/i
const NON_SECRET_SUFFIX = /(url|uri|endpoint|host|type|name|expiry|expires(_?in)?|expiration|ttl|length|header|prefix|field|path|location|count|hint|policy|format|version|enabled|required|mode|placement|addTo|add_to)$/i
const PAGINATION_TOKEN = /^(page|next|prev|previous|continuation|cursor|sync|delta|start)[-_.]?token$/i

/** Heuristic for names (header, field, variable, query param) whose values are usually credentials. */
export function isSensitiveKey(key: string | undefined | null): boolean {
  const name = (key ?? '').trim()
  if (!name) return false
  if (NON_SECRET_SUFFIX.test(name) || PAGINATION_TOKEN.test(name)) return false
  return SENSITIVE_KEY.test(name)
}

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'x-api-key',
  'api-key',
  'apikey',
  'x-auth-token',
  'x-access-token',
  'x-session-token',
  'x-refresh-token',
  'x-amz-security-token',
  'private-token',
  'x-functions-key',
  'ocp-apim-subscription-key',
])

export function isSensitiveHeader(key: string | undefined | null): boolean {
  const name = (key ?? '').trim().toLowerCase()
  if (!name) return false
  return SENSITIVE_HEADERS.has(name) || isSensitiveKey(name)
}

const PLACEHOLDER_VALUE = /^(<[^>]*>|\[[^\]]*\]|x{3,}|\*{3,}|•{3,}|\.{3,}|-+|_+|changeme|change[-_ ]?me|replace[-_ ]?me|your[-_ ].*|todo|tbd|n\/a|placeholder|example|sample|dummy|test|null|undefined|none|nil|true|false|string|secret|password|token|value|bearer|basic)$/i
const PLACEHOLDER_PREFIX = /^(demo|sample|example|fake|dummy|mock|placeholder|your|my|test)[-_ .]/i

/** A literal value that plausibly holds a credential (not empty, not a variable, not a placeholder). */
export function isLikelySecretValue(value: unknown): boolean {
  if (value === undefined || value === null) return false
  const text = String(value).trim()
  if (text.length < 4) return false
  if (hasVariableReference(text)) return false
  if (PLACEHOLDER_VALUE.test(text) || PLACEHOLDER_PREFIX.test(text)) return false
  return true
}

const AUTH_SCHEME = /^(Bearer|Basic|Token|Digest|Hawk|ApiKey|Api-Key|JWT|Negotiate|NTLM|AWS4-HMAC-SHA256|SharedKey|OAuth)\s+/i

/** Masks a credential for display, keeping an auth scheme prefix and, for long values, the first characters. */
export function maskSecret(value: string): string {
  const text = String(value ?? '')
  if (!text) return ''
  const scheme = text.match(AUTH_SCHEME)?.[0] ?? ''
  const secret = text.slice(scheme.length)
  if (!secret) return scheme.trim()
  const visible = secret.length >= 20 ? secret.slice(0, 4) : ''
  return `${scheme}${visible}${'•'.repeat(6)} (${secret.length} chars)`
}

/** Replaces every detected secret pattern occurrence inside free text with a masked form. */
export function redactSecretsInText(text: string, replacer: (match: string) => string = maskSecret): string {
  if (!text) return text
  let result = text
  for (const pattern of SECRET_PATTERNS) {
    pattern.regex.lastIndex = 0
    result = result.replace(pattern.regex, (match) => replacer(match))
  }
  return result
}

/** Short masked preview used in finding evidence; never contains the full secret. */
export function evidencePreview(value: string, maxLength = 80): string {
  const masked = maskSecret(value)
  return masked.length > maxLength ? `${masked.slice(0, maxLength - 1)}…` : masked
}
