import {
  AUTH_HEADER_SCHEME,
  SESSION_COOKIE,
  TOKEN_HEADER,
  findSecretPatterns,
  isLikelySecretValue,
  isSensitiveKey,
} from './secretPatterns'

/**
 * Credential literals inside Postman scripts. One scanner feeds both the auditor (evidence) and the redaction
 * engine (which replaces exactly the reported range), so what is reported is what gets removed.
 * Every regex is linear and line-bounded; nothing here evaluates or executes script code.
 */
export interface ScriptSecret {
  /** Short description for evidence, e.g. `sets accessToken`, `header Authorization`, `btoa credentials`. */
  label: string
  /** The literal credential (without a leading auth scheme such as `Bearer`). */
  value: string
  /** Offsets of `value` inside the scanned source. */
  start: number
  end: number
}

const SET_CALL = /pm\.(?:environment|collectionVariables|globals|variables|iterationData)\.set\(\s*(['"`])([^'"`\n]+)\1\s*,\s*(['"`])([^'"`\n]*)\3/g
const ASSIGNMENT = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(['"`])([^'"`\n]{6,})\2/g
const PROPERTY = /['"]?([A-Za-z_$][\w$-]*)['"]?\s*:\s*(['"`])([^'"`\n]{6,})\2/g
/** `{ key: 'Authorization', value: 'Bearer ...' }` as used by `pm.request.headers.add`, `pm.sendRequest` and auth helpers. */
const KEY_THEN_VALUE = /\bkey\s*:\s*(['"`])([^'"`\n]{1,100})\1\s*,[^{}]{0,120}?\bvalue\s*:\s*(['"`])([^'"`\n]*)\3/g
const VALUE_THEN_KEY = /\bvalue\s*:\s*(['"`])([^'"`\n]*)\1\s*,[^{}]{0,120}?\bkey\s*:\s*(['"`])([^'"`\n]{1,100})\3/g
/** `pm.request.headers.add('Authorization: Bearer ...')` */
const HEADER_STRING = /pm\.request\.headers\.(?:add|upsert)\s*\(\s*(['"`])([A-Za-z0-9-]{1,60})\s*:\s*([^'"`\n]*)\1/g
/** `btoa('user:password')` and `Buffer.from('user:password').toString('base64')` */
const BTOA = /\bbtoa\s*\(\s*(['"`])([^'"`\n:$\s]{1,64}):([^'"`\n]{6,})\1\s*\)/g
const BUFFER_BASE64 = /\bBuffer\.from\s*\(\s*(['"`])([^'"`\n:$\s]{1,64}):([^'"`\n]{6,})\1[^)\n]{0,40}\)\s*\.toString\(\s*['"`]base64['"`]\s*\)/g

const AUTHORIZATION_HEADER = /^(?:proxy-)?authorization$/i

interface Classified {
  label: string
  /** Offset of the credential inside `value`, after an auth scheme such as `Bearer `. */
  offset: number
}

/** Decides whether a named string literal (variable, property, header) is a credential. */
function classifyNamedLiteral(name: string, value: string): Classified | null {
  if (value.includes('${')) return null
  const trimmed = name.trim()
  if (AUTHORIZATION_HEADER.test(trimmed)) {
    if (AUTH_HEADER_SCHEME.test(value)) {
      const offset = value.match(/^\S+\s+/)?.[0].length ?? 0
      return isLikelySecretValue(value.slice(offset)) ? { label: `header ${trimmed}`, offset } : null
    }
    if (!/\s/.test(value) && value.length >= 16 && isLikelySecretValue(value)) return { label: `header ${trimmed}`, offset: 0 }
    return null
  }
  if (trimmed.toLowerCase() === 'cookie') {
    const cookie = value.match(SESSION_COOKIE)
    if (cookie && isLikelySecretValue(cookie[2]) && cookie[2].trim().length >= 8) {
      return { label: 'header Cookie', offset: value.indexOf(cookie[2], cookie.index ?? 0) }
    }
    return null
  }
  if ((isSensitiveKey(trimmed) || TOKEN_HEADER.test(trimmed)) && isLikelySecretValue(value) && !/^https?:\/\//i.test(value)) {
    return { label: trimmed, offset: 0 }
  }
  return null
}

export function findScriptSecrets(source: string | undefined | null, patternLimit = 5): ScriptSecret[] {
  if (!source) return []
  const found = new Map<number, ScriptSecret>()
  const add = (secret: ScriptSecret) => {
    if (!found.has(secret.start)) found.set(secret.start, secret)
  }
  /** `valueStart` is where the full literal begins; the classification offset skips an auth scheme. */
  const addNamed = (name: string, value: string, valueStart: number, labelPrefix = '') => {
    const classified = classifyNamedLiteral(name, value)
    if (!classified) return
    const start = valueStart + classified.offset
    add({ label: `${labelPrefix}${classified.label}`, value: value.slice(classified.offset), start, end: valueStart + value.length })
  }
  // The closing quote is the last character of every match below, so the literal ends one character earlier.
  const literalStart = (match: RegExpMatchArray, value: string) => (match.index ?? 0) + match[0].length - 1 - value.length

  for (const match of source.matchAll(SET_CALL)) {
    const key = match[2]
    const value = match[4]
    if (isSensitiveKey(key) && isLikelySecretValue(value)) {
      add({ label: `sets ${key}`, value, start: literalStart(match, value), end: literalStart(match, value) + value.length })
    }
  }
  for (const match of source.matchAll(KEY_THEN_VALUE)) addNamed(match[2], match[4], literalStart(match, match[4]))
  for (const match of source.matchAll(VALUE_THEN_KEY)) {
    const valueStart = (match.index ?? 0) + match[0].indexOf(match[1]) + 1
    addNamed(match[4], match[2], valueStart)
  }
  for (const match of source.matchAll(HEADER_STRING)) addNamed(match[2], match[3].trim(), literalStart(match, match[3]) + (match[3].length - match[3].trimStart().length))
  for (const pattern of [BTOA, BUFFER_BASE64]) {
    for (const match of source.matchAll(pattern)) {
      const password = match[3]
      if (!isLikelySecretValue(password) || password.includes('${')) continue
      const start = (match.index ?? 0) + match[0].indexOf(`${match[2]}:${password}`) + match[2].length + 1
      add({ label: 'btoa credentials', value: password, start, end: start + password.length })
    }
  }
  for (const pattern of [ASSIGNMENT, PROPERTY]) {
    for (const match of source.matchAll(pattern)) addNamed(match[1], match[3], literalStart(match, match[3]))
  }
  for (const secret of findSecretPatterns(source, patternLimit)) {
    add({ label: secret.label, value: secret.match, start: secret.index, end: secret.index + secret.match.length })
  }
  return [...found.values()].sort((a, b) => a.start - b.start)
}

/** Replaces every credential literal in a script with `replacement` and reports how many were replaced. */
export function scrubScript(source: string, replacement: string): { text: string; count: number } {
  const secrets = findScriptSecrets(source, 10_000)
  if (!secrets.length) return { text: source, count: 0 }
  let text = ''
  let cursor = 0
  let count = 0
  for (const secret of secrets) {
    if (secret.start < cursor) continue
    text += source.slice(cursor, secret.start) + replacement
    cursor = secret.end
    count += 1
  }
  return { text: text + source.slice(cursor), count }
}
