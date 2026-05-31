import type { ParsedRequest } from './parser'

export function requestMatches(req: ParsedRequest, q: string): boolean {
  if (!q.trim()) return true
  const query = q.toLowerCase()
  return (
    req.name.toLowerCase().includes(query) ||
    req.url.toLowerCase().includes(query) ||
    req.method.toLowerCase().includes(query) ||
    req.protocol.toLowerCase().includes(query) ||
    req.folderPath.join('/').toLowerCase().includes(query)
  )
}

export function searchRequests(requests: ParsedRequest[], q: string): ParsedRequest[] {
  if (!q.trim()) return requests.slice(0, 50)
  return requests.filter((r) => requestMatches(r, q)).slice(0, 50)
}
