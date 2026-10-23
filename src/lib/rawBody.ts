/**
 * Targeted scanners for raw request bodies that are not strict JSON (XML/SOAP, form-like text, JSON with
 * unusual formatting). Each scanner returns candidate `key` / `value` pairs with the range of the value so
 * the auditor can classify them and the redaction and repair engines can replace exactly that range.
 * All patterns are linear and bounded.
 */

export interface RawBodyField {
  key: string
  value: string
  /** Offsets of the value inside the scanned text. */
  start: number
  end: number
  kind: 'pair' | 'xml' | 'json'
}

const MAX_FIELDS = 500
const MAX_SCAN_LENGTH = 1_000_000

/** `key=value` pairs separated by `&`, whitespace, `;` or `,` (urlencoded text, query-like strings, properties). */
const PAIR = /(^|[&\s;,?])([A-Za-z_][\w.-]{0,63})=([^&\s;,<>"']{1,500})/g
/** `<password>literal</password>`, optionally namespaced (`<wsse:Password Type="...">literal</wsse:Password>`). */
const XML_ELEMENT = /<([\w.-]{1,32}:)?([\w.-]{1,64})(?:\s[^<>]{0,300})?>([^<>]{1,500})<\/\1?\2\s*>/g
/** `"key": "value"` fragments, for JSON-like text that does not parse (comments, trailing commas, templates). */
const JSON_FRAGMENT = /"([^"\\\r\n]{1,64})"\s*:\s*"((?:[^"\\\r\n]|\\.){1,500})"/g

/** Finds credential-shaped candidate fields in a non-JSON raw body. Callers decide which ones are secrets. */
export function scanRawBodyFields(raw: string | undefined): RawBodyField[] {
  if (!raw) return []
  const text = raw.length > MAX_SCAN_LENGTH ? raw.slice(0, MAX_SCAN_LENGTH) : raw
  const fields: RawBodyField[] = []
  const seen = new Set<number>()

  const add = (kind: RawBodyField['kind'], key: string, value: string, start: number) => {
    if (fields.length >= MAX_FIELDS || seen.has(start)) return
    seen.add(start)
    fields.push({ key, value, start, end: start + value.length, kind })
  }

  for (const match of text.matchAll(XML_ELEMENT)) {
    const start = (match.index ?? 0) + match[0].indexOf('>') + 1
    add('xml', match[2], match[3], start)
  }
  for (const match of text.matchAll(JSON_FRAGMENT)) {
    const start = (match.index ?? 0) + match[0].length - 1 - match[2].length
    add('json', match[1], match[2], start)
  }
  for (const match of text.matchAll(PAIR)) {
    const start = (match.index ?? 0) + match[1].length + match[2].length + 1
    add('pair', match[2], match[3], start)
  }
  return fields.sort((a, b) => a.start - b.start)
}

/** Replaces the given fields' values (right to left so offsets stay valid). */
export function replaceRawBodyFields(raw: string, replacements: Array<{ field: RawBodyField; value: string }>): string {
  let result = raw
  for (const { field, value } of [...replacements].sort((a, b) => b.field.start - a.field.start)) {
    result = result.slice(0, field.start) + value + result.slice(field.end)
  }
  return result
}
