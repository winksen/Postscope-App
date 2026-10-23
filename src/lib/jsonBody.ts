/**
 * Postman raw JSON bodies routinely contain unquoted variables (`{"id": {{userId}}}`), which strict
 * `JSON.parse` rejects. `parseTemplatedJson` swaps each unquoted `{{name}}` for a unique quoted `{{token}}` string
 * (so it still reads as a variable reference to the rules), parses the result, and lets callers put the original tokens back
 * after re-serializing.
 */

export interface TemplatedJson {
  value: unknown
  /** True when at least one unquoted variable was replaced. */
  templated: boolean
  /** Puts the original unquoted `{{name}}` tokens back into text produced by `JSON.stringify(value)`. */
  restore: (serialized: string) => string
}

/** Longest `{{ ... }}` reference that is treated as a variable. Keeps the scan linear on hostile input. */
const MAX_TOKEN_LENGTH = 200

function tokenPrefix(raw: string): string {
  let prefix = '__postscope_var_'
  while (raw.includes(prefix)) prefix += 'x'
  return prefix
}

/** Length of the `{{name}}` reference starting at `index`, or 0 when there is none. */
function variableLengthAt(raw: string, index: number): number {
  if (raw.charCodeAt(index) !== 123 || raw.charCodeAt(index + 1) !== 123) return 0
  const limit = Math.min(raw.length - 1, index + MAX_TOKEN_LENGTH)
  for (let end = index + 3; end <= limit; end += 1) {
    const code = raw.charCodeAt(end)
    if (code === 125) return raw.charCodeAt(end + 1) === 125 ? end + 2 - index : 0
    if (code === 123 || code === 34 || code === 10 || code === 13) return 0
  }
  return 0
}

/**
 * Parses JSON that may contain unquoted Postman variables outside of strings. Returns null when the text is
 * not JSON even after the substitution. Runs in linear time and never looks inside quoted strings.
 */
export function parseTemplatedJson(raw: string): TemplatedJson | null {
  const trimmed = raw.trim()
  if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) return null

  const prefix = tokenPrefix(trimmed)
  const originals: string[] = []
  const chunks: string[] = []
  let last = 0
  let inString = false

  for (let i = 0; i < trimmed.length; i += 1) {
    const code = trimmed.charCodeAt(i)
    if (inString) {
      if (code === 92) i += 1
      else if (code === 34) inString = false
      continue
    }
    if (code === 34) {
      inString = true
      continue
    }
    if (code !== 123) continue
    const length = variableLengthAt(trimmed, i)
    if (!length) continue
    chunks.push(trimmed.slice(last, i), `"{{${prefix}${originals.length}__}}"`)
    originals.push(trimmed.slice(i, i + length))
    i += length - 1
    last = i + 1
  }
  chunks.push(trimmed.slice(last))

  let value: unknown
  try {
    value = JSON.parse(originals.length ? chunks.join('') : trimmed)
  } catch {
    return null
  }

  const sentinel = new RegExp(`"\\{\\{${prefix}(\\d+)__\\}\\}"`, 'g')
  return {
    value,
    templated: originals.length > 0,
    restore: (serialized) =>
      originals.length ? serialized.replace(sentinel, (match, index: string) => originals[Number(index)] ?? match) : serialized,
  }
}

/** Indentation used by a JSON document, for re-serializing without reformatting it. */
export function detectIndent(raw: string): number | string {
  const match = raw.match(/\n([ \t]+)\S/)
  if (!match) return raw.includes('\n') ? 2 : 0
  return match[1].includes('\t') ? '\t' : match[1].length
}
