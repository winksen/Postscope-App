import type { Finding } from './auditor'
import { findingOccurrences, splitFindingByOccurrence } from './occurrences'

/**
 * A baseline records the occurrences that exist today so CI can fail only on new ones. Entries hold rule ids,
 * request ids and evidence locations (never values), so the file is safe to commit and review.
 */
export interface BaselineEntry {
  fingerprint: string
  ruleId: string
  requestId?: string
  location?: string
}

export interface Baseline {
  version: 1
  tool: 'PostScope'
  createdAt: string
  entries: BaselineEntry[]
}

export function buildBaseline(findings: Finding[], createdAt: Date = new Date()): Baseline {
  const byFingerprint = new Map<string, BaselineEntry>()
  for (const finding of findings) {
    for (const item of findingOccurrences(finding)) {
      byFingerprint.set(item.fingerprint, {
        fingerprint: item.fingerprint,
        ruleId: item.ruleId,
        requestId: item.requestId,
        location: item.location,
      })
    }
  }
  const entries = [...byFingerprint.values()].sort(
    (a, b) =>
      a.ruleId.localeCompare(b.ruleId) ||
      (a.requestId ?? '').localeCompare(b.requestId ?? '') ||
      (a.location ?? '').localeCompare(b.location ?? '')
  )
  return { version: 1, tool: 'PostScope', createdAt: createdAt.toISOString(), entries }
}

/** Reads a baseline file. Throws a descriptive error for anything that is not a version 1 baseline. */
export function parseBaseline(input: unknown): Baseline {
  if (!input || typeof input !== 'object') throw new Error('not a PostScope baseline')
  const raw = input as { version?: unknown; entries?: unknown; createdAt?: unknown }
  if (raw.version !== 1) throw new Error(`unsupported baseline version ${String(raw.version)}`)
  if (!Array.isArray(raw.entries)) throw new Error('baseline has no entries list')
  const entries: BaselineEntry[] = []
  for (const entry of raw.entries) {
    const item = entry as Partial<BaselineEntry> | null
    if (!item || typeof item.fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(item.fingerprint) || typeof item.ruleId !== 'string') {
      throw new Error('baseline contains an invalid entry')
    }
    entries.push({
      fingerprint: item.fingerprint,
      ruleId: item.ruleId,
      requestId: typeof item.requestId === 'string' ? item.requestId : undefined,
      location: typeof item.location === 'string' ? item.location : undefined,
    })
  }
  return { version: 1, tool: 'PostScope', createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '', entries }
}

/** Removes every occurrence that is in the baseline. Findings with no new occurrence disappear. */
export function applyBaseline(findings: Finding[], baseline: Baseline): { findings: Finding[]; hidden: number } {
  const known = new Set(baseline.entries.map((entry) => entry.fingerprint))
  const remaining: Finding[] = []
  let hidden = 0
  for (const finding of findings) {
    const { kept, matched } = splitFindingByOccurrence(finding, (occurrence) => (known.has(occurrence.fingerprint) ? true : undefined))
    if (matched) hidden += matched.matches.length
    if (kept) remaining.push(kept)
  }
  return { findings: remaining, hidden }
}
