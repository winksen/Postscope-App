import { parseCollection } from './parser'
import { runAuditDetailed, type AuditOptions } from './auditor'
import type { SuppressedFinding } from './suppressions'
import { attachEnvironments, withActiveEnvironment } from './environment'
import type { ParsedCollection } from './parser'
import type { Finding } from './auditor'

export interface AnalysisResult {
  parsed: ParsedCollection
  findings: Finding[]
  /** Occurrences hidden by reviewed suppressions (inline `postscope-ignore` lines). */
  suppressed: SuppressedFinding[]
}

/** Analyses that take longer than this are aborted so a pathological file cannot hang the tab. */
const DEFAULT_TIMEOUT_MS = 120_000

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => resolve())
    } else {
      setTimeout(resolve, 0)
    }
  })
}

/** Parse and audit off the critical path so large collections stay responsive. */
export async function analyzeCollection(json: unknown, options?: AuditOptions, environments?: readonly string[]): Promise<AnalysisResult> {
  await yieldToMain()
  const parsed = attachEnvironments(parseCollection(json), environments)
  await yieldToMain()
  const { findings, suppressed } = runAuditDetailed(parsed, options)
  return { parsed, findings, suppressed }
}

/** Friendly message for invalid JSON / non-collection input. */
export function describeAnalysisError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '')
  if (/JSON|Unexpected token|position \d+/i.test(message)) return 'The file is not valid JSON.'
  if (/Invalid Postman collection/i.test(message)) return 'This JSON does not look like a Postman collection (it needs an item array).'
  if (/timed out/i.test(message)) return message
  return 'Failed to parse collection. Ensure it is a valid Postman collection JSON.'
}

// ---------------------------------------------------------------------------
// Web Worker pipeline
// ---------------------------------------------------------------------------

/** The collection an analysis belongs to: the one on screen, or the older version on the Compare page. */
export type AnalysisSlot = 'main' | 'reference'

interface WorkerResponse {
  id: number
  ok: boolean
  /** The worker has no analysis to audit again (it was restarted). */
  cacheMiss?: boolean
  parsed?: ParsedCollection
  findings?: Finding[]
  suppressed?: SuppressedFinding[]
  error?: string
}

class CacheMissError extends Error {
  constructor() {
    super('No analysis to audit again')
    this.name = 'CacheMissError'
  }
}

interface PendingJob {
  resolve: (result: AnalysisResult) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

class WorkerUnavailableError extends Error {
  constructor() {
    super('Analysis worker is unavailable')
    this.name = 'WorkerUnavailableError'
  }
}

let worker: Worker | null = null
let workerUnavailable = false
let nextJobId = 1
const pending = new Map<number, PendingJob>()

function failAll(error: Error): void {
  for (const [id, job] of pending) {
    clearTimeout(job.timer)
    job.reject(error)
    pending.delete(id)
  }
}

function resetWorker(): void {
  worker?.terminate()
  worker = null
}

function getWorker(): Worker | null {
  if (workerUnavailable || typeof Worker === 'undefined') return null
  if (worker) return worker
  try {
    worker = new Worker(new URL('../workers/analysis.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    workerUnavailable = true
    return null
  }
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const job = pending.get(event.data.id)
    if (!job) return
    pending.delete(event.data.id)
    clearTimeout(job.timer)
    if (event.data.ok && event.data.parsed && event.data.findings) {
      job.resolve({ parsed: event.data.parsed, findings: event.data.findings, suppressed: event.data.suppressed ?? [] })
    } else if (event.data.cacheMiss) {
      job.reject(new CacheMissError())
    } else {
      job.reject(new Error(event.data.error || 'Analysis failed'))
    }
  }
  worker.onerror = (event) => {
    // A load/runtime failure: stop using the worker and let callers fall back to the main thread.
    event.preventDefault?.()
    workerUnavailable = true
    resetWorker()
    failAll(new WorkerUnavailableError())
  }
  return worker
}

type WorkerJob =
  | {
      type: 'analyze'
      slot: AnalysisSlot
      raw: string
      options?: AuditOptions
      environments?: readonly string[]
      activeEnvironment?: number
    }
  | { type: 'audit'; slot: AnalysisSlot; options?: AuditOptions; activeEnvironment?: number }

function runInWorker(job: WorkerJob, timeoutMs: number): Promise<AnalysisResult> {
  const instance = getWorker()
  if (!instance) return Promise.reject(new WorkerUnavailableError())
  const id = nextJobId++
  return new Promise<AnalysisResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      // The worker may be stuck on this job; recycle it so later analyses start fresh.
      resetWorker()
      failAll(new Error('Analysis was cancelled because another analysis timed out.'))
      reject(new Error(`Analysis timed out after ${Math.round(timeoutMs / 1000)} seconds.`))
    }, timeoutMs)
    pending.set(id, { resolve, reject, timer })
    instance.postMessage({ id, ...job })
  })
}

/** Full parsed collections kept when there is no worker, so audits can start from them like the worker's cache. */
const fallbackFull = new Map<AnalysisSlot, ParsedCollection>()

export interface AnalyzeTextOptions {
  timeoutMs?: number
  environments?: readonly string[]
  /** Index of the environment to select instead of the first one. */
  activeEnvironment?: number
  slot?: AnalysisSlot
}

/**
 * Parses and audits raw collection JSON, optionally with Postman environment and globals exports. Runs in a Web Worker when available so even
 * very large files never block the UI; falls back to the main thread otherwise. The worker keeps the full parsed
 * collection and returns a compact copy (see `compactResult.ts`), so later audits go through `auditAgain`.
 */
export async function analyzeCollectionText(
  raw: string,
  options?: AuditOptions,
  { timeoutMs = DEFAULT_TIMEOUT_MS, environments, activeEnvironment, slot = 'main' }: AnalyzeTextOptions = {}
): Promise<AnalysisResult> {
  try {
    return await runInWorker({ type: 'analyze', slot, raw, options, environments, activeEnvironment }, timeoutMs)
  } catch (error) {
    if (!(error instanceof WorkerUnavailableError)) throw error
  }
  await yieldToMain()
  const json = JSON.parse(raw) as unknown
  let parsed = attachEnvironments(parseCollection(json), environments)
  if (activeEnvironment !== undefined) parsed = withActiveEnvironment(parsed, activeEnvironment)
  fallbackFull.set(slot, parsed)
  const { findings, suppressed } = runAuditDetailed(parsed, options)
  return { parsed, findings, suppressed }
}

/**
 * Audits the last analyzed collection again with other rule settings or another selected environment, without
 * parsing it again. Resolves to null when there is nothing to audit (the worker was restarted): analyze the text again.
 */
export async function auditAgain(
  options?: AuditOptions,
  {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    activeEnvironment,
    slot = 'main',
  }: Pick<AnalyzeTextOptions, 'timeoutMs' | 'activeEnvironment' | 'slot'> = {}
): Promise<AnalysisResult | null> {
  try {
    return await runInWorker({ type: 'audit', slot, options, activeEnvironment }, timeoutMs)
  } catch (error) {
    if (error instanceof CacheMissError) return null
    if (!(error instanceof WorkerUnavailableError)) throw error
  }
  const cached = fallbackFull.get(slot)
  if (!cached) return null
  const parsed = activeEnvironment === undefined ? cached : withActiveEnvironment(cached, activeEnvironment)
  fallbackFull.set(slot, parsed)
  const { findings, suppressed } = runAuditDetailed(parsed, options)
  return { parsed, findings, suppressed }
}
