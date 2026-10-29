/// <reference lib="webworker" />
import { parseCollection, type ParsedCollection } from '../lib/parser'
import { runAuditDetailed, type AuditOptions } from '../lib/auditor'
import { attachEnvironments, withActiveEnvironment } from '../lib/environment'
import { compactParsed } from '../lib/compactResult'

/** `main` is the collection on screen, `reference` the older version on the Compare page. */
type Slot = 'main' | 'reference'

type WorkerRequest =
  | {
      type?: 'analyze'
      id: number
      slot?: Slot
      raw: string
      options?: AuditOptions
      /** Raw environment and globals export texts to analyze together with the collection. */
      environments?: string[]
      activeEnvironment?: number
    }
  | {
      /** Re-run the audit on the collection this worker parsed last (rule settings or environment changed). */
      type: 'audit'
      id: number
      slot?: Slot
      options?: AuditOptions
      activeEnvironment?: number
    }

const ctx = self as unknown as DedicatedWorkerGlobalScope

/** The full parsed collections. The page only receives compact copies, so audits must start from these. */
const parsedBySlot = new Map<Slot, ParsedCollection>()

ctx.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data
  const slot = message.slot ?? 'main'
  try {
    let parsed: ParsedCollection
    if (message.type === 'audit') {
      const cached = parsedBySlot.get(slot)
      if (!cached) {
        ctx.postMessage({ id: message.id, ok: false, cacheMiss: true, error: 'No analysis to audit again' })
        return
      }
      parsed = message.activeEnvironment === undefined ? cached : withActiveEnvironment(cached, message.activeEnvironment)
    } else {
      const json = JSON.parse(message.raw) as unknown
      parsed = attachEnvironments(parseCollection(json), message.environments)
      if (message.activeEnvironment !== undefined) parsed = withActiveEnvironment(parsed, message.activeEnvironment)
    }
    parsedBySlot.set(slot, parsed)
    ctx.postMessage({ id: message.id, progress: 'audit' })
    const { findings, suppressed } = runAuditDetailed(parsed, message.options)
    ctx.postMessage({ id: message.id, progress: 'score' })
    ctx.postMessage({ id: message.id, ok: true, parsed: compactParsed(parsed), findings, suppressed })
  } catch (error) {
    ctx.postMessage({ id: message.id, ok: false, error: error instanceof Error ? error.message : 'Analysis failed' })
  }
}
