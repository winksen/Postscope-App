import crypto from 'node:crypto'
import fs from 'node:fs'
import { log } from './logger'

/**
 * Encryption at rest for library records: AES-256-GCM with a random 12 byte IV per record. The record id is bound
 * in as additional authenticated data, so a file renamed to another id (or edited) fails to decrypt instead of
 * being read as someone else's collection.
 *
 * Envelope (the whole file): { v: 1, alg: "aes-256-gcm", kid, iv, tag, data } with base64 fields. `kid` names the
 * key that sealed the record so keys can be rotated without re-encrypting everything at once.
 */
export interface EncryptionKey {
  /** Short identifier derived from the key; safe to store and log. */
  id: string
  key: Buffer
}

export interface EncryptionKeys {
  current: EncryptionKey
  previous: EncryptionKey[]
}

export interface Envelope {
  v: 1
  alg: 'aes-256-gcm'
  kid: string
  iv: string
  tag: string
  data: string
}

export type EncryptionState = { enabled: false } | { enabled: true; keys: EncryptionKeys } | { enabled: true; error: string }

const KEY_BYTES = 32
const IV_BYTES = 12

export function keyId(key: Buffer): string {
  return crypto.createHash('sha256').update('postscope-key-id').update(key).digest('hex').slice(0, 16)
}

/** Accepts 32 bytes as 64 hex characters or as base64 (standard or URL-safe). Returns null for anything else. */
export function parseEncryptionKey(text: string): Buffer | null {
  const value = text.trim()
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, 'hex')
  if (/^[A-Za-z0-9+/_-]{43}={0,1}$/.test(value)) {
    const key = Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
    if (key.length === KEY_BYTES) return key
  }
  return null
}

function toKey(buffer: Buffer): EncryptionKey {
  return { id: keyId(buffer), key: buffer }
}

export interface RawKeySettings {
  /** `LIBRARY_ENCRYPTION_KEY` */
  key?: string
  /** `LIBRARY_ENCRYPTION_KEY_FILE` */
  keyFile?: string
  /** `LIBRARY_ENCRYPTION_KEY_PREVIOUS`: comma separated keys that may still decrypt old records. */
  previous?: string
  /** `LIBRARY_ENCRYPTION_KEY_PREVIOUS_FILE`: one key per line. */
  previousFile?: string
}

function readKeyFile(file: string): { text?: string; error?: string } {
  try {
    return { text: fs.readFileSync(file, 'utf8') }
  } catch (error) {
    return { error: `cannot read ${file} (${error instanceof Error ? error.message : String(error)})` }
  }
}

/** Resolves the key settings. `enabled: false` means no key is configured at all (records are stored in plaintext). */
export function resolveEncryptionState(settings: RawKeySettings): EncryptionState {
  if (!settings.key && !settings.keyFile) return { enabled: false }
  let currentText = settings.key
  if (settings.keyFile) {
    const file = readKeyFile(settings.keyFile)
    if (file.error) return { enabled: true, error: `LIBRARY_ENCRYPTION_KEY_FILE: ${file.error}` }
    currentText = file.text
  }
  const current = parseEncryptionKey(currentText ?? '')
  if (!current) return { enabled: true, error: 'The library encryption key must be 32 bytes written as 64 hex characters or as base64.' }

  const previousTexts: string[] = []
  if (settings.previous) previousTexts.push(...settings.previous.split(','))
  if (settings.previousFile) {
    const file = readKeyFile(settings.previousFile)
    if (file.error) return { enabled: true, error: `LIBRARY_ENCRYPTION_KEY_PREVIOUS_FILE: ${file.error}` }
    previousTexts.push(...(file.text ?? '').split(/\r?\n/))
  }
  const previous: EncryptionKey[] = []
  for (const text of previousTexts.map((item) => item.trim()).filter(Boolean)) {
    const key = parseEncryptionKey(text)
    if (!key) return { enabled: true, error: 'A previous library encryption key is not 32 bytes of hex or base64.' }
    if (!key.equals(current) && !previous.some((item) => item.key.equals(key))) previous.push(toKey(key))
  }
  return { enabled: true, keys: { current: toKey(current), previous } }
}

export function isEnvelope(value: unknown): value is Envelope {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<Envelope>
  return record.v === 1 && record.alg === 'aes-256-gcm' && typeof record.iv === 'string' && typeof record.tag === 'string' && typeof record.data === 'string'
}

const aad = (recordId: string) => Buffer.from(`postscope-library:v1:${recordId.toLowerCase()}`, 'utf8')

export function encryptRecord(plaintext: string, recordId: string, key: EncryptionKey): Envelope {
  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv('aes-256-gcm', key.key, iv)
  cipher.setAAD(aad(recordId))
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return { v: 1, alg: 'aes-256-gcm', kid: key.id, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }
}

export class DecryptionError extends Error {
  constructor(
    message: string,
    /** True when no configured key matches the key id of the record. */
    readonly unknownKey = false
  ) {
    super(message)
    this.name = 'DecryptionError'
  }
}

/** Decrypts an envelope with the key named by `kid`. Throws `DecryptionError` for tampering, a wrong id or a missing key. */
export function decryptRecord(envelope: Envelope, recordId: string, keys: EncryptionKeys): string {
  const candidates = [keys.current, ...keys.previous]
  const key = candidates.find((candidate) => candidate.id === envelope.kid)
  if (!key) throw new DecryptionError(`record was sealed with key ${envelope.kid ?? 'unknown'}, which is not configured`, true)
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key.key, Buffer.from(envelope.iv, 'base64'))
    decipher.setAAD(aad(recordId))
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8')
  } catch {
    throw new DecryptionError('record failed authentication (wrong key, wrong id or modified file)')
  }
}

/** Keyed hash used instead of a plain SHA-256 for deduplication once encryption is on. */
export function keyedHash(content: string, key: EncryptionKey): string {
  return crypto.createHmac('sha256', key.key).update(content).digest('hex')
}

const warned = new Set<string>()
export function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return
  warned.add(key)
  log.warn(message)
}
