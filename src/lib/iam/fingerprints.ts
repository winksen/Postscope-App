import type { ParsedCollection, ParsedRequest } from '../parser'
import { extractVariableNames } from '../variables'
import { PLATFORM_PROFILES } from './platforms'
import type { HeaderSignal, PlatformFingerprint } from './platforms/types'
import type { DetectedPlatform, PlatformId } from './types'
import { splitUrl, type SplitUrl } from './url'

export type { HeaderSignal, PlatformFingerprint }

const WEIGHT = { host: 0.6, strongPath: 0.5, path: 0.3, header: 0.5, token: 0.5, port: 0.2, variable: 0.15, authType: 0.3 }

/** Signals that must add up to this much on one request for a platform to be reported. */
const DETECTION_THRESHOLD = 0.5
const MAX_LISTED = 50

/**
 * The platform table. Hosts and paths are written for normalized paths (variables replaced by `*`), and every
 * pattern is anchored or bounded so none of them backtracks badly on long values.
 */
export const PLATFORM_FINGERPRINTS: PlatformFingerprint[] = [...PLATFORM_PROFILES.map((profile) => profile.fingerprint)]

function union(patterns: RegExp[]): RegExp {
  return new RegExp(patterns.map((pattern) => `(?:${pattern.source})`).join('|'), 'i')
}

/**
 * One combined pattern per signal kind. A request that matches none of them cannot match any platform, which spares
 * the per-platform loop for almost every request of a collection that is not about identity. Variable names are left
 * out on purpose: with a weight of 0.15 they can never reach the detection threshold without another signal.
 */
const ANY_HOST = union(PLATFORM_FINGERPRINTS.flatMap((fingerprint) => fingerprint.hosts))
const ANY_PATH = union(PLATFORM_FINGERPRINTS.flatMap((fingerprint) => [...fingerprint.strongPaths, ...fingerprint.paths]))
const ANY_TOKEN = union(PLATFORM_FINGERPRINTS.flatMap((fingerprint) => fingerprint.tokens.map((token) => token.pattern)))
const SIGNAL_HEADER = new RegExp(
  `^(?:${[...new Set(PLATFORM_FINGERPRINTS.flatMap((fingerprint) => fingerprint.headers.map((header) => header.name.source.replace(/^\^|\$$/g, ''))))].join('|')})$`,
  'i'
)
const SIGNAL_PORTS = new Set(PLATFORM_FINGERPRINTS.flatMap((fingerprint) => fingerprint.ports))
const SIGNAL_AUTH = new Set(PLATFORM_FINGERPRINTS.flatMap((fingerprint) => fingerprint.authTypes))

function hasAnySignal(request: ParsedRequest, url: SplitUrl): boolean {
  if (url.host && ANY_HOST.test(url.host)) return true
  if (ANY_PATH.test(url.path)) return true
  if (url.port && SIGNAL_PORTS.has(url.port)) return true
  if (SIGNAL_AUTH.has(request.auth)) return true
  if (request.headers.some((header) => SIGNAL_HEADER.test(header.key.trim()))) return true
  return tokenSources(request).some((text) => ANY_TOKEN.test(text))
}

const ANY_STRONG_PATH = union(PLATFORM_FINGERPRINTS.flatMap((fingerprint) => fingerprint.strongPaths))

/**
 * True when a request has a signal that only an identity platform produces: its host, a path or header that is specific
 * to it, a token shape, or the Vault port. Typical but generic paths such as `/api/v1/users` do not count.
 */
export function hasStrongPlatformSignal(request: ParsedRequest, url: SplitUrl): boolean {
  if (url.host && ANY_HOST.test(url.host)) return true
  if (ANY_STRONG_PATH.test(url.path)) return true
  if (url.port && SIGNAL_PORTS.has(url.port)) return true
  if (request.headers.some((header) => SIGNAL_HEADER.test(header.key.trim()))) return true
  return tokenSources(request).some((text) => ANY_TOKEN.test(text))
}

export interface RequestPlatformMatch {
  id: PlatformId
  score: number
  signals: string[]
}

function tokenSources(request: ParsedRequest): string[] {
  return [...request.headers.map((header) => header.value), ...(request.authFields ?? []).map((field) => field.value)]
}

/** Scores every platform for one request. Only matches at or above the detection threshold are returned. */
export function fingerprintRequest(request: ParsedRequest, url: SplitUrl): RequestPlatformMatch[] {
  const matches: RequestPlatformMatch[] = []
  if (!hasAnySignal(request, url)) return matches
  const variableNames = extractVariableNames(request.url)
  const tokenTexts = tokenSources(request)
  for (const fingerprint of PLATFORM_FINGERPRINTS) {
    let score = 0
    const signals: string[] = []
    const add = (weight: number, label: string) => {
      score += weight
      if (!signals.includes(label)) signals.push(label)
    }
    if (url.host && fingerprint.hosts.some((pattern) => pattern.test(url.host!))) add(WEIGHT.host, `host ${url.host}`)
    const strong = fingerprint.strongPaths.find((pattern) => pattern.test(url.path))
    if (strong) add(WEIGHT.strongPath, `path ${url.path}`)
    else if (fingerprint.paths.some((pattern) => pattern.test(url.path))) add(WEIGHT.path, `path ${url.path}`)
    for (const signal of fingerprint.headers) {
      const header = request.headers.find(
        (entry) => signal.name.test(entry.key.trim()) && (!signal.value || signal.value.test(entry.value.trim()))
      )
      if (header) add(WEIGHT.header, `header ${signal.label}`)
    }
    for (const token of fingerprint.tokens)
      if (tokenTexts.some((text) => token.pattern.test(text))) add(WEIGHT.token, `token ${token.label}`)
    if (url.port && fingerprint.ports.includes(url.port)) add(WEIGHT.port, `port ${url.port}`)
    if (variableNames.some((name) => fingerprint.variables.some((pattern) => pattern.test(name)))) add(WEIGHT.variable, 'variable name')
    if (fingerprint.authTypes.includes(request.auth)) add(WEIGHT.authType, `auth ${request.auth}`)
    if (score >= DETECTION_THRESHOLD) matches.push({ id: fingerprint.id, score: Math.min(1, score), signals })
  }
  return matches.sort((a, b) => b.score - a.score)
}

/** Detects the identity platforms a collection talks to. Several platforms per collection are normal. */
export function fingerprintPlatforms(
  parsed: ParsedCollection,
  urls?: ReadonlyMap<string, SplitUrl>
): {
  platforms: DetectedPlatform[]
  byRequest: Map<string, RequestPlatformMatch[]>
} {
  const byRequest = new Map<string, RequestPlatformMatch[]>()
  const found = new Map<PlatformId, { best: number; signals: Set<string>; requestIds: string[]; count: number; hosts: Set<string> }>()
  for (const request of parsed.requests) {
    const url = urls?.get(request.id) ?? splitUrl(request.url, parsed)
    const matches = fingerprintRequest(request, url)
    if (!matches.length) continue
    byRequest.set(request.id, matches)
    for (const match of matches) {
      const entry = found.get(match.id) ?? { best: 0, signals: new Set<string>(), requestIds: [], count: 0, hosts: new Set<string>() }
      entry.best = Math.max(entry.best, match.score)
      match.signals.forEach((signal) => entry.signals.size < 6 && entry.signals.add(signal))
      entry.count += 1
      if (entry.requestIds.length < MAX_LISTED) entry.requestIds.push(request.id)
      if (url.host && entry.hosts.size < 5) entry.hosts.add(url.host)
      found.set(match.id, entry)
    }
  }
  const platforms: DetectedPlatform[] = []
  for (const fingerprint of PLATFORM_FINGERPRINTS) {
    const entry = found.get(fingerprint.id)
    if (!entry) continue
    platforms.push({
      id: fingerprint.id,
      name: fingerprint.name,
      family: fingerprint.family,
      confidence: Math.round(Math.min(1, entry.best + Math.min(0.2, 0.04 * (entry.count - 1))) * 100) / 100,
      signals: [...entry.signals],
      requestIds: entry.requestIds,
      requestCount: entry.count,
      hosts: [...entry.hosts],
    })
  }
  return { platforms: platforms.sort((a, b) => b.confidence - a.confidence || b.requestCount - a.requestCount), byRequest }
}
