/// <reference lib="webworker" />
import { parseCollection } from '../lib/parser'
import { runAuditDetailed, type AuditOptions } from '../lib/auditor'
import { attachEnvironments } from '../lib/environment'

interface AnalysisRequest {
  id: number
  raw: string
  options?: AuditOptions
  /** Raw environment and globals export texts to analyze together with the collection. */
  environments?: string[]
}

const ctx = self as unknown as DedicatedWorkerGlobalScope

ctx.onmessage = (event: MessageEvent<AnalysisRequest>) => {
  const { id, raw, options, environments } = event.data
  try {
    const json = JSON.parse(raw) as unknown
    const parsed = attachEnvironments(parseCollection(json), environments)
    const { findings, suppressed } = runAuditDetailed(parsed, options)
    ctx.postMessage({ id, ok: true, parsed, findings, suppressed })
  } catch (error) {
    ctx.postMessage({ id, ok: false, error: error instanceof Error ? error.message : 'Analysis failed' })
  }
}
