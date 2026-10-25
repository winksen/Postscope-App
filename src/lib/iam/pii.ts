import { hasVariableReference } from '../variables'

/**
 * Personal data detection for identity collections: emails, phone numbers, bank and card numbers, national identifiers
 * with a checksum, dates of birth and employee ids. Everything is local string matching, values are masked in every
 * result, and numbers must pass their checksum so ordinary ids and timestamps are left alone.
 */
export type PiiKind = 'email' | 'phone' | 'iban' | 'card' | 'national-id' | 'date-of-birth' | 'employee-id'

export interface PiiMatch {
  kind: PiiKind
  /** Offsets of the matched text in the scanned string. */
  start: number
  end: number
  /** Masked display value. */
  preview: string
}

const KEY_DOB = /^(?:dob|date_?of_?birth|birth_?date|birthday|birth_?day)$/i
const KEY_EMPLOYEE = /^(?:employee_?(?:id|number|no|code)|emp_?(?:id|no)|staff_?(?:id|number)|personnel_?(?:id|number)|worker_?id)$/i
const KEY_PHONE = /^(?:phone|phone_?number|mobile|mobile_?number|mobile_?phone|msisdn|tel|telephone|cell|cell_?phone)$/i

const EMAIL = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,5}/g
const IBAN = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g
const CARD = /\b\d(?:[ -]?\d){12,18}\b/g
const SSN = /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g
const NIR = /(?<![\d])[12]\d{2}(?:0[1-9]|1[0-2]|[2-9]\d)\d{2}\d{3}\d{3}\d{2}(?![\d])/g
const SPANISH_ID = /\b(?:\d{8}|[XYZ]\d{7})[A-HJ-NP-TV-Z]\b/g
const PHONE_PLUS = /\+\d[\d\s().-]{7,17}\d/g

const RESERVED_DOMAIN = /(?:^|\.)(?:example\.(?:com|org|net)|[^.]+\.(?:example|test|invalid|localhost))$|^(?:localhost|example)$/i

function digitsOf(text: string): string {
  return text.replace(/\D/g, '')
}

function luhn(digits: string): boolean {
  let sum = 0
  let double = false
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = digits.charCodeAt(index) - 48
    if (double) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
    double = !double
  }
  return sum % 10 === 0
}

function cardPrefix(digits: string): boolean {
  if (/^4\d{12}(?:\d{3}(?:\d{3})?)?$/.test(digits)) return true // Visa
  if (/^(?:5[1-5]\d{14}|2(?:2[2-9]\d|[3-6]\d\d|7[01]\d|720)\d{12})$/.test(digits)) return true // Mastercard
  if (/^3[47]\d{13}$/.test(digits)) return true // American Express
  if (/^(?:6011\d{12}|65\d{14}|64[4-9]\d{13})$/.test(digits)) return true // Discover
  if (/^35(?:2[89]|[3-8]\d)\d{12}$/.test(digits)) return true // JCB
  return /^3(?:0[0-5]|[68]\d)\d{11}$/.test(digits) // Diners Club
}

/** ISO 13616 check: move the first four characters to the end, turn letters into numbers, and the number mod 97 is 1. */
export function validIban(value: string): boolean {
  const iban = value.replace(/\s/g, '').toUpperCase()
  if (iban.length < 15 || iban.length > 34 || !/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) return false
  let remainder = 0
  for (const char of iban.slice(4) + iban.slice(0, 4)) {
    const code = char.charCodeAt(0)
    const chunk = code >= 65 ? String(code - 55) : char
    for (const digit of chunk) remainder = (remainder * 10 + (digit.charCodeAt(0) - 48)) % 97
  }
  return remainder === 1
}

function validNir(digits: string): boolean {
  // The key is 97 minus the first 13 digits modulo 97. BigInt keeps the 13 digit number exact.
  const key = 97 - Number(BigInt(digits.slice(0, 13)) % 97n)
  return key === Number(digits.slice(13))
}

function validSpanishId(value: string): boolean {
  const letters = 'TRWAGMYFPDXBNJZSQVHLCKE'
  const first = value[0]
  const number = Number(
    first === 'X'
      ? `0${value.slice(1, 8)}`
      : first === 'Y'
        ? `1${value.slice(1, 8)}`
        : first === 'Z'
          ? `2${value.slice(1, 8)}`
          : value.slice(0, 8)
  )
  return letters[number % 23] === value[value.length - 1]
}

export function isReservedEmailDomain(domain: string): boolean {
  return RESERVED_DOMAIN.test(domain)
}

function maskEmail(value: string): string {
  return `${value[0]}•••@•••`
}

function maskTail(value: string, visible: number): string {
  return `${'•'.repeat(4)}${value.slice(-visible)}`
}

/** A run of digits can hold a card number next to other numbers, so try every group boundary inside it. */
function findCard(run: string): { start: number; end: number; digits: string } | null {
  const groups = [...run.matchAll(/\d+/g)].map((group) => ({ text: group[0], start: group.index! }))
  for (let first = 0; first < groups.length; first += 1) {
    let digits = ''
    for (let last = first; last < groups.length; last += 1) {
      digits += groups[last].text
      if (digits.length > 19) break
      if (digits.length >= 13 && cardPrefix(digits) && luhn(digits))
        return { start: groups[first].start, end: groups[last].start + groups[last].text.length, digits }
    }
  }
  return null
}

function pushIfNew(matches: PiiMatch[], match: PiiMatch): void {
  if (!matches.some((existing) => match.start < existing.end && match.end > existing.start)) matches.push(match)
}

/** Personal data inside free text (a body or response string). */
export function scanPiiText(text: string): PiiMatch[] {
  if (!text || text.length > 2_000_000) return []
  const matches: PiiMatch[] = []

  for (const match of text.matchAll(EMAIL)) {
    const domain = match[0].slice(match[0].indexOf('@') + 1)
    if (isReservedEmailDomain(domain)) continue
    pushIfNew(matches, { kind: 'email', start: match.index!, end: match.index! + match[0].length, preview: maskEmail(match[0]) })
  }
  for (const match of text.matchAll(IBAN)) {
    if (!validIban(match[0])) continue
    const compact = match[0].replace(/\s/g, '')
    pushIfNew(matches, {
      kind: 'iban',
      start: match.index!,
      end: match.index! + match[0].length,
      preview: `${compact.slice(0, 4)}${'•'.repeat(4)}`,
    })
  }
  for (const match of text.matchAll(CARD)) {
    const found = findCard(match[0])
    if (found)
      pushIfNew(matches, {
        kind: 'card',
        start: match.index! + found.start,
        end: match.index! + found.end,
        preview: maskTail(found.digits, 4),
      })
  }
  for (const match of text.matchAll(SSN))
    pushIfNew(matches, {
      kind: 'national-id',
      start: match.index!,
      end: match.index! + match[0].length,
      preview: `•••-••-${match[0].slice(-4)}`,
    })
  for (const match of text.matchAll(NIR)) {
    if (validNir(match[0]))
      pushIfNew(matches, { kind: 'national-id', start: match.index!, end: match.index! + match[0].length, preview: maskTail(match[0], 2) })
  }
  for (const match of text.matchAll(SPANISH_ID)) {
    if (validSpanishId(match[0]))
      pushIfNew(matches, { kind: 'national-id', start: match.index!, end: match.index! + match[0].length, preview: maskTail(match[0], 1) })
  }
  for (const match of text.matchAll(PHONE_PLUS)) {
    const digits = digitsOf(match[0])
    if (digits.length >= 8 && digits.length <= 15)
      pushIfNew(matches, { kind: 'phone', start: match.index!, end: match.index! + match[0].length, preview: maskTail(digits, 2) })
  }
  return matches
}

/** Personal data in one value, using the field name when there is one (`dateOfBirth`, `employeeId`, `phone`). */
export function scanPiiValue(key: string | undefined, value: string): PiiMatch[] {
  const text = value.trim()
  if (!text || hasVariableReference(text) || text.length > 100_000) return []
  const name = key?.trim() ?? ''
  const whole = (kind: PiiKind, preview: string): PiiMatch[] => [{ kind, start: 0, end: value.length, preview }]
  if (KEY_DOB.test(name) && /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}(?:[T ].*)?$/.test(text)) return whole('date-of-birth', '••••-••-••')
  if (KEY_EMPLOYEE.test(name) && /^[A-Za-z0-9._-]{2,40}$/.test(text)) return whole('employee-id', `${text[0]}•••`)
  if (KEY_PHONE.test(name) && /^[+(\d][\d\s().-]{5,}$/.test(text) && digitsOf(text).length >= 7 && digitsOf(text).length <= 15)
    return whole('phone', maskTail(digitsOf(text), 2))
  return scanPiiText(value)
}

export interface PiiJsonHit extends PiiMatch {
  /** Location of the value, such as `users[0].emails[1]`. */
  path: string
}

/** Walks a parsed JSON value and reports personal data with the path of each field. */
export function scanPiiJson(value: unknown, basePath = '', depth = 0, hits: PiiJsonHit[] = []): PiiJsonHit[] {
  if (depth > 20 || hits.length >= 500) return hits
  if (typeof value === 'string') {
    for (const match of scanPiiValue(undefined, value)) hits.push({ ...match, path: basePath || 'value' })
    return hits
  }
  if (Array.isArray(value)) {
    value.slice(0, 500).forEach((entry, index) => scanPiiJson(entry, `${basePath}[${index}]`, depth + 1, hits))
    return hits
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const path = basePath ? `${basePath}.${key}` : key
      if (typeof entry === 'string') for (const match of scanPiiValue(key, entry)) hits.push({ ...match, path })
      else scanPiiJson(entry, path, depth + 1, hits)
    }
  }
  return hits
}

/** Placeholder for a kind, written into request bodies so the sanitized collection can still be run with values supplied. */
export const PII_VARIABLES: Record<PiiKind, string> = {
  email: '{{email}}',
  phone: '{{phoneNumber}}',
  iban: '{{iban}}',
  card: '{{cardNumber}}',
  'national-id': '{{nationalId}}',
  'date-of-birth': '{{dateOfBirth}}',
  'employee-id': '{{employeeId}}',
}

export type PiiReplacer = (kind: PiiKind) => string

/** Replaces personal data in free text. Returns the new text and the number of replacements. */
export function scrubPiiText(text: string, replacer: PiiReplacer, key?: string): { text: string; count: number } {
  const matches = scanPiiValue(key, text).sort((a, b) => b.start - a.start)
  let next = text
  for (const match of matches) next = next.slice(0, match.start) + replacer(match.kind) + next.slice(match.end)
  return { text: next, count: matches.length }
}

/** Replaces personal data inside a parsed JSON value in place and returns how many values changed. */
export function scrubPiiJson(value: unknown, replacer: PiiReplacer, depth = 0): number {
  if (depth > 50 || !value || typeof value !== 'object') return 0
  let count = 0
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      if (typeof entry === 'string') {
        const result = scrubPiiText(entry, replacer)
        if (result.count) {
          value[index] = result.text
          count += result.count
        }
      } else count += scrubPiiJson(entry, replacer, depth + 1)
    })
    return count
  }
  const record = value as Record<string, unknown>
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === 'string') {
      const result = scrubPiiText(entry, replacer, key)
      if (result.count) {
        record[key] = result.text
        count += result.count
      }
    } else count += scrubPiiJson(entry, replacer, depth + 1)
  }
  return count
}
