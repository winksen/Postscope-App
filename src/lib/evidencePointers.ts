import type { Finding, FindingEvidence } from './auditor'
import { itemPointer } from './jsonPositions'
import type { ParsedCollection, ParsedRequest } from './parser'

/**
 * Maps the human-readable evidence locations (`header Authorization`, `query api_key`, `body password`, ...) to JSON
 * pointers inside the exported collection, so reports can point at the exact line. Pointers are resolved against
 * the raw collection after the audit; they never take part in fingerprints. When a location cannot be pinned to a
 * value, the pointer falls back to the request (or no pointer for collection-level evidence).
 */
type Json = Record<string, unknown>

function isRecord(value: unknown): value is Json {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function itemAt(raw: unknown, itemPath: readonly number[]): Json | undefined {
  let items: unknown = isRecord(raw) ? raw.item : undefined
  let current: Json | undefined
  for (const index of itemPath) {
    if (!Array.isArray(items) || !isRecord(items[index])) return undefined
    current = items[index] as Json
    items = current.item
  }
  return current
}

function indexOfKey(list: unknown, key: string, disabled: boolean): number {
  if (!Array.isArray(list)) return -1
  const wanted = key.trim().toLowerCase()
  const exact = list.findIndex(
    (entry) =>
      isRecord(entry) &&
      String(entry.key ?? '')
        .trim()
        .toLowerCase() === wanted &&
      (entry.disabled === true) === disabled
  )
  return exact !== -1
    ? exact
    : list.findIndex(
        (entry) =>
          isRecord(entry) &&
          String(entry.key ?? '')
            .trim()
            .toLowerCase() === wanted
      )
}

function eventIndex(events: unknown, listen: string, disabled: boolean): number {
  if (!Array.isArray(events)) return -1
  const index = events.findIndex(
    (event) => isRecord(event) && event.listen === listen && (event.disabled === true) === disabled && isRecord(event.script)
  )
  return index !== -1 ? index : events.findIndex((event) => isRecord(event) && event.listen === listen && isRecord(event.script))
}

function folderPointer(parsed: ParsedCollection, name: string): string | undefined {
  const owner =
    parsed.authOwners?.find((candidate) => candidate.owner === name) ??
    parsed.descriptions?.find((candidate) => candidate.kind === 'folder' && candidate.owner === name)
  return owner ? itemPointer(owner.ownerPath) : undefined
}

function requestPointer(raw: unknown, req: ParsedRequest, evidence: FindingEvidence, parsed: ParsedCollection): string | undefined {
  const item = itemAt(raw, req.itemPath)
  if (!item) return undefined
  const base = req.pointer
  const request = isRecord(item.request) ? item.request : undefined
  const location = evidence.location
  const disabled = /\(disabled\)/.test(location)
  const url = request?.url
  const urlPointer =
    typeof url === 'string'
      ? `${base}/request/url`
      : isRecord(url)
        ? `${base}/request/url${typeof url.raw === 'string' ? '/raw' : ''}`
        : `${base}/request`
  let match: RegExpMatchArray | null

  if ((match = location.match(/^(?:header|cookie) ([^\s(][^(]*?)(?: \(.*)?$/))) {
    const header = request?.header
    if (typeof header === 'string') return `${base}/request/header`
    const name = location.startsWith('cookie') ? 'Cookie' : match[1]
    const index = indexOfKey(header, name, disabled)
    if (index !== -1) return `${base}/request/header/${index}/value`
    return `${base}/request`
  }
  if ((match = location.match(/^query (.+?)(?: \(disabled\))?$/))) {
    const index = isRecord(url) ? indexOfKey(url.query, match[1], disabled) : -1
    return index !== -1 ? `${base}/request/url/query/${index}/value` : urlPointer
  }
  if ((match = location.match(/^path variable (.+)$/))) {
    const index = isRecord(url) ? indexOfKey(url.variable, match[1], false) : -1
    return index !== -1 ? `${base}/request/url/variable/${index}/value` : urlPointer
  }
  if ((match = location.match(/^body field (.+?)(?: \(disabled\))?$/))) {
    const body = isRecord(request?.body) ? request.body : undefined
    for (const mode of ['urlencoded', 'formdata'] as const) {
      const index = indexOfKey(body?.[mode], match[1], disabled)
      if (index !== -1) return `${base}/request/body/${mode}/${index}/value`
    }
    return `${base}/request/body`
  }
  if (/^(?:raw body|body|GraphQL variable)\b/.test(location)) {
    const body = isRecord(request?.body) ? request.body : undefined
    if (location.startsWith('GraphQL') && isRecord(body?.graphql)) return `${base}/request/body/graphql/variables`
    return typeof body?.raw === 'string' ? `${base}/request/body/raw` : `${base}/request/body`
  }
  if (/^URL userinfo|^host$|^[A-Z]+ \//.test(location)) return urlPointer
  if ((match = location.match(/^(pre-request|test) script(?: \(disabled\))?/))) {
    const index = eventIndex(item.event, match[1] === 'pre-request' ? 'prerequest' : 'test', disabled)
    return index !== -1 ? `${base}/event/${index}/script/exec` : base
  }
  if ((match = location.match(/^saved response "(.*?)"/))) {
    const responses = Array.isArray(item.response) ? item.response : []
    const index = responses.findIndex((response) => isRecord(response) && response.name === match![1])
    return index !== -1 ? `${base}/response/${index}` : `${base}/response`
  }
  if (/^description\b/.test(location)) {
    if (request && request.description !== undefined) return `${base}/request/description`
    return item.description !== undefined ? `${base}/description` : base
  }
  if (/ auth /.test(location) || /^basic auth/.test(location)) {
    const owner = location.match(/\(folder "(.*?)"\)/)
    if (owner) return folderPointer(parsed, owner[1]) ? `${folderPointer(parsed, owner[1])}/auth` : `${base}/request/auth`
    if (/\(collection level\)/.test(location)) return '/auth'
    return request?.auth !== undefined ? `${base}/request/auth` : `${base}/request`
  }
  if ((match = location.match(/^request variable (.+?)(?: \(.*\))?$/))) {
    const index = indexOfKey(item.variable, match[1], false)
    return index !== -1 ? `${base}/variable/${index}/value` : base
  }
  return request ? `${base}/request` : base
}

function collectionPointer(raw: unknown, parsed: ParsedCollection, evidence: FindingEvidence): string | undefined {
  if (!isRecord(raw)) return undefined
  const location = evidence.location
  let match: RegExpMatchArray | null
  if ((match = location.match(/^collection variable (\S+)/))) {
    const index = indexOfKey(raw.variable, match[1], false)
    return index !== -1 ? `/variable/${index}/value` : '/variable'
  }
  if ((match = location.match(/^folder variable (\S+) \(folder "(.*?)"\)/))) {
    const pointer =
      folderPointer(parsed, match[2]) ??
      parsed.scopedVariables?.map((variable) => (variable.owner === match![2] ? itemPointer(variable.ownerPath) : undefined)).find(Boolean)
    const item = pointer
      ? itemAt(raw, (parsed.scopedVariables ?? []).find((variable) => variable.owner === match![2])?.ownerPath ?? [])
      : undefined
    const index = indexOfKey(item?.variable, match[1], false)
    return pointer ? (index !== -1 ? `${pointer}/variable/${index}/value` : `${pointer}/variable`) : undefined
  }
  if ((match = location.match(/^collection (pre-request|test) script/))) {
    const index = eventIndex(raw.event, match[1] === 'pre-request' ? 'prerequest' : 'test', /\(disabled\)/.test(location))
    return index !== -1 ? `/event/${index}/script/exec` : '/event'
  }
  if (/^description \(collection\)/.test(location)) return '/info/description'
  if ((match = location.match(/^description \(folder "(.*?)"\)/))) {
    const pointer = folderPointer(parsed, match[1])
    return pointer ? `${pointer}/description` : undefined
  }
  if (/ auth /.test(location) || /^basic auth/.test(location)) {
    const owner = location.match(/\(folder "(.*?)"\)/)
    if (owner) {
      const pointer = folderPointer(parsed, owner[1])
      return pointer ? `${pointer}/auth` : undefined
    }
    return '/auth'
  }
  if (/^protocolProfileBehavior/.test(location)) return '/protocolProfileBehavior'
  return undefined
}

/** Returns the findings with a `pointer` on every evidence entry whose location can be resolved. Inputs are not modified. */
export function attachEvidencePointers<T extends Finding>(raw: unknown, parsed: ParsedCollection, findings: readonly T[]): T[] {
  const requests = new Map(parsed.requests.map((request) => [request.id, request]))
  return findings.map((finding) => {
    if (!finding.evidence?.length) return finding
    const evidence = finding.evidence.map((entry) => {
      const request = entry.requestId ? requests.get(entry.requestId) : undefined
      const pointer = request ? requestPointer(raw, request, entry, parsed) : collectionPointer(raw, parsed, entry)
      return pointer === undefined ? entry : { ...entry, pointer }
    })
    return { ...finding, evidence }
  })
}
