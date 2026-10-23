import type { ParsedCollection, ParsedRequest } from './parser'

/** Request bodies larger than this are shown (and kept in the page) only up to this many characters. */
export const MAX_DISPLAY_BODY = 64 * 1024

/**
 * The copy of a parsed collection that is sent from the analysis worker to the page. Findings are always computed
 * from the full text; the page only needs a display copy, so a body over 64 KB is cut to its first 64 KB and marked
 * with `bodyTruncated` and `bodySize`. Returns the input unchanged when no body is that large.
 */
export function compactParsed(parsed: ParsedCollection): ParsedCollection {
  if (!parsed.requests.some((request) => (request.bodyRaw?.length ?? 0) > MAX_DISPLAY_BODY)) return parsed
  const replaced = new Map<ParsedRequest, ParsedRequest>()
  const requests = parsed.requests.map((request) => {
    const body = request.bodyRaw
    if (!body || body.length <= MAX_DISPLAY_BODY) return request
    const compact: ParsedRequest = { ...request, bodyRaw: body.slice(0, MAX_DISPLAY_BODY), bodyTruncated: true, bodySize: body.length }
    replaced.set(request, compact)
    return compact
  })
  // Folders hold the same request objects; they must point at the compact ones or the large bodies are sent twice.
  const folders = parsed.folders.map((folder) => ({
    ...folder,
    requests: folder.requests.map((request) => replaced.get(request) ?? request),
  }))
  return { ...parsed, requests, folders }
}
