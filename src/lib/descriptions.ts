import { SECRET_PATTERNS, isLikelySecretValue, isSensitiveKey } from './secretPatterns'

/**
 * Credentials pasted into Postman descriptions (collection, folder and request docs). Descriptions are free
 * text, so beyond provider token formats only `key: value` / `key=value` fragments whose value looks like a
 * credential (not a plain word) are reported.
 */
export interface DescriptionSecret {
  /** Offsets of the secret value inside the description text. */
  start: number
  end: number
  value: string
  label: string
  kind: 'pattern' | 'fragment'
}

/** Descriptions larger than this are truncated before scanning (and before being kept in memory). */
export const MAX_DESCRIPTION_LENGTH = 64_000
const MAX_FINDINGS = 50

/** `password: hunter2`, `api_key=abc123`, `` `client_secret`: `abc` `` and similar documentation snippets. */
const FRAGMENT = /(^|[\s`*|(,;])([A-Za-z_][\w.-]{0,63})[`*"']?\s*[:=]\s*[`"']?([^\s`'"<>|,;)]{8,200})/g
const AUTHORIZATION = /\b(Authorization|Proxy-Authorization)\s*[:=]\s*[`"']?(Bearer|Basic|Token)\s+([^\s`'"<>|,;)]{8,500})/gi

/** Prose such as `token: required` must not be reported: a credential has a digit or a symbol in it. */
function looksLikeCredential(value: string): boolean {
  if (/^(https?|ftp|file):/i.test(value) || value.startsWith('$') || value.startsWith('/')) return false
  return /[^A-Za-z]/.test(value) && isLikelySecretValue(value)
}

/** Sentence punctuation right after a value (`... api_key=abc123def.`) is not part of the credential. */
function trimTrailingPunctuation(value: string): string {
  return value.replace(/[.!?:]+$/, '')
}

export function findDescriptionSecrets(text: string | undefined | null): DescriptionSecret[] {
  if (!text) return []
  const source = text.length > MAX_DESCRIPTION_LENGTH ? text.slice(0, MAX_DESCRIPTION_LENGTH) : text
  const found: DescriptionSecret[] = []
  const taken = new Set<number>()
  const add = (secret: DescriptionSecret) => {
    if (found.length >= MAX_FINDINGS || taken.has(secret.start)) return
    taken.add(secret.start)
    found.push(secret)
  }

  for (const pattern of SECRET_PATTERNS) {
    pattern.regex.lastIndex = 0
    for (const match of source.matchAll(pattern.regex)) {
      const start = match.index ?? 0
      add({ start, end: start + match[0].length, value: match[0], label: pattern.label, kind: 'pattern' })
    }
  }
  for (const match of source.matchAll(AUTHORIZATION)) {
    const value = trimTrailingPunctuation(match[3])
    if (value.length < 8 || !isLikelySecretValue(value)) continue
    const start = (match.index ?? 0) + match[0].length - match[3].length
    add({ start, end: start + value.length, value, label: match[1], kind: 'fragment' })
  }
  for (const match of source.matchAll(FRAGMENT)) {
    const key = match[2]
    const value = trimTrailingPunctuation(match[3])
    if (value.length < 8 || !isSensitiveKey(key) || !looksLikeCredential(value)) continue
    const start = (match.index ?? 0) + match[0].length - match[3].length
    add({ start, end: start + value.length, value, label: key, kind: 'fragment' })
  }
  return found.sort((a, b) => a.start - b.start)
}

function scrubChunk(text: string, replacement: string): { text: string; count: number } {
  const secrets = findDescriptionSecrets(text)
  if (!secrets.length) return { text, count: 0 }
  let result = ''
  let cursor = 0
  let count = 0
  for (const secret of secrets) {
    // Overlapping matches (a token inside a `key: value` fragment) are replaced once.
    if (secret.start < cursor) continue
    result += text.slice(cursor, secret.start) + replacement
    cursor = secret.end
    count += 1
  }
  return { text: result + text.slice(cursor), count }
}

/**
 * Replaces every detected secret in a description with `replacement`. Returns the text unchanged when clean.
 * Text beyond the scan limit is processed in chunks (split at whitespace) so nothing is left unchecked.
 */
export function scrubDescription(text: string, replacement: string): { text: string; count: number } {
  if (text.length <= MAX_DESCRIPTION_LENGTH) return scrubChunk(text, replacement)
  let rest = text
  let output = ''
  let count = 0
  while (rest.length > 0) {
    let cut = rest.length
    if (rest.length > MAX_DESCRIPTION_LENGTH) {
      const window = rest.slice(0, MAX_DESCRIPTION_LENGTH)
      const space = Math.max(window.lastIndexOf('\n'), window.lastIndexOf(' '))
      cut = space > 0 ? space + 1 : MAX_DESCRIPTION_LENGTH
    }
    const scrubbed = scrubChunk(rest.slice(0, cut), replacement)
    output += scrubbed.text
    count += scrubbed.count
    rest = rest.slice(cut)
  }
  return { text: output, count }
}
