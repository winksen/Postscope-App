/**
 * One set of limits for every way a collection or environment file enters PostScope: the browser (file, paste,
 * saved copy), the CLI and the server. The checks are cheap (a byte count and one pass over the text) and run before
 * any JSON parsing, so an oversized or deeply nested input is refused with the same error everywhere.
 */

export type InputKind = 'collection' | 'environment'

export const INPUT_LIMITS = {
  /** Largest collection accepted for analysis, in UTF-8 bytes. */
  collectionBytes: 50_000_000,
  /** Largest environment or globals export, in UTF-8 bytes. */
  environmentBytes: 10_000_000,
  /**
   * Deepest nesting of arrays and objects. A collection with folders nested to the parser's own limit (100 levels,
   * two JSON levels each) still fits; anything deeper would only risk exhausting the stack in `JSON.parse`.
   */
  jsonDepth: 256,
} as const

export type InputLimitCode = 'INPUT_EMPTY' | 'INPUT_TOO_LARGE' | 'INPUT_TOO_DEEP'

export class InputLimitError extends Error {
  readonly code: InputLimitCode
  constructor(code: InputLimitCode, message: string) {
    super(`${code}: ${message}`)
    this.name = 'InputLimitError'
    this.code = code
  }
}

export function isInputLimitError(error: unknown): error is InputLimitError {
  return error instanceof InputLimitError || (error instanceof Error && error.name === 'InputLimitError')
}

const KIND_LABEL: Record<InputKind, string> = { collection: 'Collection', environment: 'Environment file' }

export function maxBytesFor(kind: InputKind): number {
  return kind === 'environment' ? INPUT_LIMITS.environmentBytes : INPUT_LIMITS.collectionBytes
}

/** Size of the text as UTF-8, which is what a file on disk or a request body costs. `String.length` undercounts it. */
export function utf8ByteLength(text: string): number {
  let bytes = 0
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      // A surrogate pair is one code point of four bytes.
      const next = text.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        index += 1
      } else bytes += 3
    } else bytes += 3
  }
  return bytes
}

/**
 * Deepest nesting of `[` and `{` outside strings, counted without parsing. Stops as soon as `limit` is exceeded, so
 * the cost on a hostile input is bounded by the position of the offending bracket.
 */
export function jsonNestingDepth(text: string, limit: number = INPUT_LIMITS.jsonDepth): number {
  let depth = 0
  let max = 0
  let inString = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charCodeAt(index)
    if (inString) {
      if (char === 0x5c) index += 1
      else if (char === 0x22) inString = false
      continue
    }
    if (char === 0x22) inString = true
    else if (char === 0x5b || char === 0x7b) {
      depth += 1
      if (depth > max) {
        max = depth
        if (max > limit) return max
      }
    } else if (char === 0x5d || char === 0x7d) depth = Math.max(0, depth - 1)
  }
  return max
}

/** Rounded up, so a size that is over the limit never prints as equal to it. */
function megabytes(bytes: number): string {
  return `${Math.ceil(bytes / 100_000) / 10} MB`
}

/** Size check for a known byte count, used by the browser for files (`File.size`) before reading them. */
export function checkInputBytes(bytes: number, kind: InputKind, name?: string): InputLimitError | null {
  const label = name ? `${KIND_LABEL[kind]} ${name}` : KIND_LABEL[kind]
  if (bytes === 0) return new InputLimitError('INPUT_EMPTY', `${label} is empty.`)
  const max = maxBytesFor(kind)
  if (bytes > max) return new InputLimitError('INPUT_TOO_LARGE', `${label} is ${megabytes(bytes)}; the limit is ${megabytes(max)}.`)
  return null
}

/** Size and nesting check for text that is already in memory. Returns the error instead of throwing. */
export function checkInputText(text: string, kind: InputKind, name?: string): InputLimitError | null {
  const sized = checkInputBytes(utf8ByteLength(text), kind, name)
  if (sized) return sized
  const label = name ? `${KIND_LABEL[kind]} ${name}` : KIND_LABEL[kind]
  const depth = jsonNestingDepth(text)
  if (depth > INPUT_LIMITS.jsonDepth)
    return new InputLimitError('INPUT_TOO_DEEP', `${label} is nested more than ${INPUT_LIMITS.jsonDepth} levels deep.`)
  return null
}

export function assertInputWithinLimits(text: string, kind: InputKind, name?: string): void {
  const error = checkInputText(text, kind, name)
  if (error) throw error
}
