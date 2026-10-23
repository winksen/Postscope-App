import fs from 'node:fs/promises'
import path from 'node:path'
import { getAuditLogDir, isLibraryAuditLogEnabled } from './runtimeConfig'
import { log } from './logger'

/**
 * Append-only audit trail of who saved, opened and removed library collections: one JSON object per line in
 * `data/audit/library-YYYY-MM.jsonl`. Entries name the collection and the actor but never contain collection
 * content or credentials. A failure to write an entry is logged and does not block the request.
 */
export type AuditAction = 'save' | 'open' | 'delete'

export interface AuditEntry {
  action: AuditAction
  /** Collection id. */
  id: string
  /** Sanitized collection name, when known. */
  name?: string
  /** Signed-in user reported by the trusted proxy, if any. */
  user?: string | null
  ip: string
  requestId?: string
  /** Credentials scrubbed by the server before storing (saves only). */
  redactedCount?: number
  /** The save matched a collection that already existed (saves only). */
  deduplicated?: boolean
}

let queue: Promise<unknown> = Promise.resolve()

export function auditLogPath(date = new Date()): string {
  return path.join(getAuditLogDir(), `library-${date.toISOString().slice(0, 7)}.jsonl`)
}

export function recordAudit(entry: AuditEntry, now = new Date()): Promise<void> {
  if (!isLibraryAuditLogEnabled()) return Promise.resolve()
  const line = JSON.stringify({
    ts: now.toISOString(),
    action: entry.action,
    id: entry.id,
    name: entry.name,
    user: entry.user ?? null,
    ip: entry.ip,
    requestId: entry.requestId,
    ...(entry.redactedCount ? { redactedCount: entry.redactedCount } : {}),
    ...(entry.deduplicated ? { deduplicated: true } : {}),
  })
  const write = queue.then(async () => {
    try {
      const file = auditLogPath(now)
      await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
      await fs.appendFile(file, `${line}\n`, { encoding: 'utf8', mode: 0o600, flag: 'a' })
    } catch (error) {
      log.warn('Could not write the library audit log', { error: error instanceof Error ? error.message : String(error) })
    }
  })
  queue = write
  return write
}

/** Resolves once every queued audit entry has been written (graceful shutdown, tests). */
export function flushAuditLog(): Promise<void> {
  return queue.then(() => undefined)
}
