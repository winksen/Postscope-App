import { parseCollection } from './parser'
import { runAudit, type AuditOptions } from './auditor'
import type { ParsedCollection } from './parser'
import type { Finding } from './auditor'

export interface AnalysisResult {
  parsed: ParsedCollection
  findings: Finding[]
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
export async function analyzeCollection(json: unknown, options?: AuditOptions): Promise<AnalysisResult> {
  await yieldToMain()
  const parsed = parseCollection(json)
  await yieldToMain()
  const findings = runAudit(parsed, options)
  return { parsed, findings }
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

interface WorkerResponse {
  id: number
  ok: boolean
  parsed?: ParsedCollection
  findings?: Finding[]
  error?: string
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
      job.resolve({ parsed: event.data.parsed, findings: event.data.findings })
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

function runInWorker(raw: string, options: AuditOptions | undefined, timeoutMs: number): Promise<AnalysisResult> {
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
    instance.postMessage({ id, raw, options })
  })
}

/**
 * Parses and audits raw collection JSON. Runs in a Web Worker when available so even
 * very large files never block the UI; falls back to the main thread otherwise.
 */
export async function analyzeCollectionText(
  raw: string,
  options?: AuditOptions,
  { timeoutMs = DEFAULT_TIMEOUT_MS }: { timeoutMs?: number } = {}
): Promise<AnalysisResult> {
  try {
    return await runInWorker(raw, options, timeoutMs)
  } catch (error) {
    if (!(error instanceof WorkerUnavailableError)) throw error
  }
  await yieldToMain()
  const json = JSON.parse(raw) as unknown
  return analyzeCollection(json, options)
}
