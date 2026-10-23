/**
 * Locates JSON values inside the original text. SARIF wants a line and column for each result, and the parsed
 * collection no longer knows where anything was. The scanner walks the text once, keeps only the container stack
 * (memory is proportional to nesting depth, not file size) and records the position of the pointers asked for.
 *
 * Pointers follow RFC 6901 (`/item/0/request/header/1/value`). Lines and columns are 1-based; columns count UTF-16
 * code units, which is SARIF's default `columnKind`. CRLF, LF and lone CR line endings are all handled.
 */
export interface Position {
  line: number
  column: number
}

interface Frame {
  kind: 'object' | 'array'
  /** Pointer of the container itself. */
  prefix: string
  index: number
  key: string
  /** Object only: the next string is a key. */
  expectKey: boolean
  /** No wanted pointer lives below this container, so its contents are only skipped, never named. */
  skip: boolean
}

export function escapePointerSegment(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1')
}

/** JSON pointer for an `item` path such as `[0, 3]` (`/item/0/item/3`). */
export function itemPointer(itemPath: readonly number[]): string {
  return itemPath.map((index) => `/item/${index}`).join('')
}

export function locatePointers(text: string, wanted: ReadonlySet<string>): Map<string, Position> {
  const found = new Map<string, Position>()
  if (wanted.size === 0) return found

  // Every ancestor of a wanted pointer: containers outside this set cannot contain anything wanted.
  const ancestors = new Set<string>([''])
  for (const pointer of wanted) {
    let cut = pointer.lastIndexOf('/')
    while (cut > 0) {
      ancestors.add(pointer.slice(0, cut))
      cut = pointer.lastIndexOf('/', cut - 1)
    }
  }

  const frames: Frame[] = []
  let line = 1
  let lineStart = 0
  const length = text.length

  const valuePointer = (): string => {
    const frame = frames[frames.length - 1]
    if (!frame) return ''
    return `${frame.prefix}/${frame.kind === 'array' ? frame.index : escapePointerSegment(frame.key)}`
  }
  const record = (pointer: string, index: number) => {
    if (wanted.has(pointer) && !found.has(pointer)) found.set(pointer, { line, column: index - lineStart + 1 })
  }

  let i = 0
  while (i < length && found.size < wanted.size) {
    const char = text.charCodeAt(i)
    if (char === 10 || (char === 13 && text.charCodeAt(i + 1) !== 10)) {
      line += 1
      lineStart = i + 1
      i += 1
      continue
    }
    if (char === 32 || char === 9 || char === 13) {
      i += 1
      continue
    }
    const frame = frames[frames.length - 1]

    if (char === 34) {
      // String: either an object key or a value.
      const start = i
      i += 1
      let escaped = false
      while (i < length) {
        const code = text.charCodeAt(i)
        if (code === 92) {
          escaped = true
          i += 2
          continue
        }
        if (code === 34) break
        // Strings cannot contain raw newlines in valid JSON; keep counting lines for broken input anyway.
        if (code === 10) {
          line += 1
          lineStart = i + 1
        }
        i += 1
      }
      const raw = text.slice(start + 1, i)
      i += 1
      if (frame?.kind === 'object' && frame.expectKey) {
        if (!frame.skip) frame.key = escaped ? safeUnescape(raw) : raw
        frame.expectKey = false
      } else if (!frame?.skip) {
        record(valuePointer(), start)
      }
      continue
    }

    if (char === 123 || char === 91) {
      const skip = !!frame?.skip
      const pointer = skip ? '' : valuePointer()
      if (!skip) record(pointer, i)
      frames.push({ kind: char === 123 ? 'object' : 'array', prefix: pointer, index: 0, key: '', expectKey: char === 123, skip: skip || !ancestors.has(pointer) })
      i += 1
      continue
    }
    if (char === 125 || char === 93) {
      frames.pop()
      i += 1
      continue
    }
    if (char === 58) {
      i += 1
      continue
    }
    if (char === 44) {
      if (frame?.kind === 'array') frame.index += 1
      else if (frame) frame.expectKey = true
      i += 1
      continue
    }

    // Number, true, false or null.
    if (!frame?.skip) record(valuePointer(), i)
    while (i < length) {
      const code = text.charCodeAt(i)
      if (code === 44 || code === 125 || code === 93 || code === 32 || code === 9 || code === 10 || code === 13) break
      i += 1
    }
  }
  return found
}

function safeUnescape(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string
  } catch {
    return raw
  }
}
