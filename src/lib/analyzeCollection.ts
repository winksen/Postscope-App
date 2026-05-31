import { parseCollection } from './parser'
import { runAudit } from './auditor'
import type { ParsedCollection } from './parser'
import type { Finding } from './auditor'

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
export async function analyzeCollection(json: unknown): Promise<{
  parsed: ParsedCollection
  findings: Finding[]
}> {
  await yieldToMain()
  const parsed = parseCollection(json)
  await yieldToMain()
  const findings = runAudit(parsed)
  return { parsed, findings }
}
