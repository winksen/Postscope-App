import { parseCollection } from './parser'
import { runAuditDetailed, type AuditOptions } from './auditor'
import type { SuppressedFinding } from './suppressions'
import { attachEnvironments, withActiveEnvironment } from './environment'
import { assertInputWithinLimits, isInputLimitError, utf8ByteLength } from './inputLimits'
import type { ParsedCollection } from './parser'
import type { Finding } from './auditor'

export interface AnalysisResult {
  parsed: ParsedCollection
  findings: Finding[]
  /** Occurrences hidden by reviewed suppressions (inline `postscope-ignore` lines). */
  suppressed: SuppressedFinding[]
}

/**
 * Analyses in the worker that take longer than this are aborted, and the worker is replaced. This cannot interrupt
 * work on the main thread: JavaScript cannot be stopped from a timer while it is running synchronously.
 */
const DEFAULT_TIMEOUT_MS = 120_000

/**
 * Without a worker the whole analysis runs on the main thread and blocks the page until it finishes. That is accepted
 * only for small files; a larger one is refused straight away with guidance instead of freezing the tab.
 */
export const FALLBACK_MAX_BYTES = 2_000_000

export class AnalysisNeedsWorkerError extends Error {
  readonly bytes: number
  constructor(bytes: number) {
    super(
      `This browser could not start the analysis worker, so only collections up to ${FALLBACK_MAX_BYTES / 1_000_000} MB can be analyzed here (this one is ${Math.ceil(bytes / 100_000) / 10} MB). Use a current browser with web workers allowed, or run "postscope scan" from the command line.`
    )
    this.name = 'AnalysisNeedsWorkerError'
    this.bytes = bytes
  }
}

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => resolve())
    } else {
      setTimeout(resolve, 0)
    }
  })
}

/** Parse and audit after yielding to the page; this runs on the calling thread (the browser uses the worker pipeline below). */
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
  // Limit errors carry a stable code prefix for logs and tests; people read the sentence after it.
  if (isInputLimitError(error)) return message.replace(/^[A-Z_]+: /, '')
  if (error instanceof AnalysisNeedsWorkerError) return message
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
  /** A stage the job has reached; the job is still running. */
  progress?: AnalysisStage
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
  slot: AnalysisSlot
  resolve: (result: AnalysisResult) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
  onProgress?: (stage: AnalysisStage) => void
}

class WorkerUnavailableError extends Error {
  constructor() {
    super('Analysis worker is unavailable')
    this.name = 'WorkerUnavailableError'
  }
}

/** The stages an analysis goes through, reported while it runs. */
export type AnalysisStage = 'parse' | 'audit' | 'score'

export class AnalysisCancelledError extends Error {
  constructor(message = 'Analysis was cancelled.') {
    super(message)
    this.name = 'AnalysisCancelledError'
  }
}

export function isAnalysisCancelled(error: unknown): boolean {
  return error instanceof AnalysisCancelledError || (error instanceof Error && error.name === 'AnalysisCancelledError')
}

/**
 * One worker per slot: the collection on screen and the older version on the Compare page analyze independently, so
 * cancelling or replacing one never touches the other.
 */
const workers = new Map<AnalysisSlot, Worker>()
let workerUnavailable = false
let nextJobId = 1
const pending = new Map<number, PendingJob>()

function failJobs(error: Error, slot?: AnalysisSlot): void {
  for (const [id, job] of pending) {
    if (slot !== undefined && job.slot !== slot) continue
    clearTimeout(job.timer)
    job.reject(error)
    pending.delete(id)
  }
}

/** Stops the worker of one slot (or all of them) and fails the jobs that were running there. */
function resetWorker(slot: AnalysisSlot, error: Error): void {
  workers.get(slot)?.terminate()
  workers.delete(slot)
  failJobs(error, slot)
}

function getWorker(slot: AnalysisSlot): Worker | null {
  if (workerUnavailable || typeof Worker === 'undefined') return null
  const existing = workers.get(slot)
  if (existing) return existing
  let created: Worker
  try {
    created = new Worker(new URL('../workers/analysis.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    workerUnavailable = true
    return null
  }
  created.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const job = pending.get(event.data.id)
    if (!job) return
    if (event.data.progress) {
      job.onProgress?.(event.data.progress)
      return
    }
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
  created.onerror = (event) => {
    // A load/runtime failure: stop using workers and let callers fall back to the main thread.
    event.preventDefault?.()
    workerUnavailable = true
    for (const slot of [...workers.keys()]) resetWorker(slot, new WorkerUnavailableError())
  }
  workers.set(slot, created)
  return created
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

interface JobControl {
  timeoutMs: number
  signal?: AbortSignal
  onProgress?: (stage: AnalysisStage) => void
}

function runInWorker(job: WorkerJob, { timeoutMs, signal, onProgress }: JobControl): Promise<AnalysisResult> {
  if (signal?.aborted) return Promise.reject(new AnalysisCancelledError())
  const instance = getWorker(job.slot)
  if (!instance) return Promise.reject(new WorkerUnavailableError())
  const id = nextJobId++
  return new Promise<AnalysisResult>((resolve, reject) => {
    let onAbort: (() => void) | undefined
    const settle = () => {
      if (onAbort) signal?.removeEventListener('abort', onAbort)
    }
    const timer = setTimeout(() => {
      pending.delete(id)
      settle()
      // The worker may be stuck on this job; replace it so later analyses of this slot start fresh.
      resetWorker(job.slot, new Error('Analysis was cancelled because another analysis timed out.'))
      reject(new Error(`Analysis timed out after ${Math.round(timeoutMs / 1000)} seconds.`))
    }, timeoutMs)
    pending.set(id, {
      slot: job.slot,
      resolve: (result) => {
        settle()
        resolve(result)
      },
      reject: (error) => {
        settle()
        reject(error)
      },
      timer,
      onProgress,
    })
    if (signal) {
      onAbort = () => {
        if (!pending.has(id)) return
        pending.delete(id)
        clearTimeout(timer)
        // Terminating the slot's worker is what actually stops the work; the other slot keeps its worker and its cache.
        resetWorker(job.slot, new AnalysisCancelledError('Analysis was cancelled because it was replaced.'))
        reject(new AnalysisCancelledError())
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }
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
  /** Stops this analysis: its worker is replaced and the call rejects with `AnalysisCancelledError`. */
  signal?: AbortSignal
  /** Called as the analysis reaches each stage. */
  onProgress?: (stage: AnalysisStage) => void
}

/**
 * Parses and audits raw collection JSON, optionally with Postman environment and globals exports. Runs in a Web Worker when available so even
 * very large files never block the UI; falls back to the main thread otherwise. The worker keeps the full parsed
 * collection and returns a compact copy (see `compactResult.ts`), so later audits go through `auditAgain`.
 */
export async function analyzeCollectionText(
  raw: string,
  options?: AuditOptions,
  { timeoutMs = DEFAULT_TIMEOUT_MS, environments, activeEnvironment, slot = 'main', signal, onProgress }: AnalyzeTextOptions = {}
): Promise<AnalysisResult> {
  assertInputWithinLimits(raw, 'collection')
  environments?.forEach((text) => assertInputWithinLimits(text, 'environment'))
  if (signal?.aborted) throw new AnalysisCancelledError()
  onProgress?.('parse')
  try {
    return await runInWorker({ type: 'analyze', slot, raw, options, environments, activeEnvironment }, { timeoutMs, signal, onProgress })
  } catch (error) {
    if (!(error instanceof WorkerUnavailableError)) throw error
  }
  // The main thread cannot be interrupted once parsing starts, so the size is bounded before it does.
  const bytes = utf8ByteLength(raw)
  if (bytes > FALLBACK_MAX_BYTES) throw new AnalysisNeedsWorkerError(bytes)
  await yieldToMain()
  if (signal?.aborted) throw new AnalysisCancelledError()
  const json = JSON.parse(raw) as unknown
  let parsed = attachEnvironments(parseCollection(json), environments)
  if (activeEnvironment !== undefined) parsed = withActiveEnvironment(parsed, activeEnvironment)
  fallbackFull.set(slot, parsed)
  onProgress?.('audit')
  await yieldToMain()
  if (signal?.aborted) throw new AnalysisCancelledError()
  const { findings, suppressed } = runAuditDetailed(parsed, options)
  onProgress?.('score')
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
    return await runInWorker({ type: 'audit', slot, options, activeEnvironment }, { timeoutMs })
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
