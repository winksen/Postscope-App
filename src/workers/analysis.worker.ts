/// <reference lib="webworker" />
import { parseCollection } from '../lib/parser'
import { runAudit, type AuditOptions } from '../lib/auditor'

interface AnalysisRequest {
  id: number
  raw: string
  options?: AuditOptions
}

const ctx = self as unknown as DedicatedWorkerGlobalScope

ctx.onmessage = (event: MessageEvent<AnalysisRequest>) => {
  const { id, raw, options } = event.data
  try {
    const json = JSON.parse(raw) as unknown
    const parsed = parseCollection(json)
    const findings = runAudit(parsed, options)
    ctx.postMessage({ id, ok: true, parsed, findings })
  } catch (error) {
    ctx.postMessage({ id, ok: false, error: error instanceof Error ? error.message : 'Analysis failed' })
  }
}
