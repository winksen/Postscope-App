import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { DecryptionError, decryptRecord, encryptRecord, isEnvelope, keyedHash, type EncryptionKeys } from './libraryCrypto'

/**
 * Offline maintenance of the library folder: report how records are stored, encrypt plaintext records, and rewrite
 * records sealed with an older key. Every record is written to a temp file, read back and compared before it
 * replaces the original, so an interrupted run never loses a collection.
 */
const ID_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.json$/i

export interface LibraryStatus {
  records: number
  plaintext: number
  encrypted: number
  /** Encrypted records per key id. */
  byKey: Record<string, number>
  unreadable: string[]
}

export interface MigrationReport {
  dryRun: boolean
  scanned: number
  /** Plaintext records that were (or would be) encrypted. */
  encrypted: number
  /** Records sealed with an older key that were (or would be) rewritten with the current key. */
  rotated: number
  alreadyCurrent: number
  failed: Array<{ id: string; reason: string }>
}

async function recordFiles(dir: string): Promise<Array<{ id: string; file: string }>> {
  let names: string[]
  try {
    names = await fs.readdir(dir)
  } catch {
    return []
  }
  return names
    .map((name) => ({ name, match: ID_FILE.exec(name) }))
    .filter((entry): entry is { name: string; match: RegExpExecArray } => entry.match !== null)
    .map(({ name, match }) => ({ id: match[1].toLowerCase(), file: path.join(dir, name) }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

export async function libraryStatus(dir: string): Promise<LibraryStatus> {
  const status: LibraryStatus = { records: 0, plaintext: 0, encrypted: 0, byKey: {}, unreadable: [] }
  for (const { id, file } of await recordFiles(dir)) {
    status.records += 1
    try {
      const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as unknown
      if (isEnvelope(parsed)) {
        status.encrypted += 1
        status.byKey[parsed.kid] = (status.byKey[parsed.kid] ?? 0) + 1
      } else if (parsed && typeof parsed === 'object' && typeof (parsed as { rawJson?: unknown }).rawJson === 'string') {
        status.plaintext += 1
      } else {
        status.unreadable.push(id)
      }
    } catch {
      status.unreadable.push(id)
    }
  }
  return status
}

async function replaceFile(file: string, contents: string): Promise<void> {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
  await fs.writeFile(tmp, contents, { encoding: 'utf8', mode: 0o600 })
  try {
    await fs.rename(tmp, file)
  } catch (error) {
    await fs.rm(tmp, { force: true })
    throw error
  }
}

/** Encrypts plaintext records and rewrites records sealed with an older key, using the current key. */
export async function migrateLibrary(dir: string, keys: EncryptionKeys, { dryRun = false } = {}): Promise<MigrationReport> {
  const report: MigrationReport = { dryRun, scanned: 0, encrypted: 0, rotated: 0, alreadyCurrent: 0, failed: [] }
  for (const { id, file } of await recordFiles(dir)) {
    report.scanned += 1
    try {
      const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as unknown
      let plaintext: string
      let wasEncrypted = false
      if (isEnvelope(parsed)) {
        if (parsed.kid === keys.current.id) {
          report.alreadyCurrent += 1
          continue
        }
        plaintext = decryptRecord(parsed, id, keys)
        wasEncrypted = true
      } else {
        plaintext = JSON.stringify(parsed)
      }

      const record = JSON.parse(plaintext) as { rawJson?: unknown; id?: unknown; contentHash?: unknown }
      if (typeof record.rawJson !== 'string' || typeof record.id !== 'string' || record.id.toLowerCase() !== id) throw new Error('not a library record')
      // The deduplication hash becomes a keyed hash under the current key.
      record.contentHash = keyedHash(record.rawJson, keys.current)
      const sealed = JSON.stringify(encryptRecord(JSON.stringify(record), id, keys.current))
      if (JSON.parse(decryptRecord(JSON.parse(sealed), id, keys)).rawJson !== record.rawJson) throw new Error('verification after encryption failed')

      if (!dryRun) await replaceFile(file, sealed)
      if (wasEncrypted) report.rotated += 1
      else report.encrypted += 1
    } catch (error) {
      report.failed.push({ id, reason: error instanceof DecryptionError || error instanceof Error ? error.message : String(error) })
    }
  }
  return report
}
