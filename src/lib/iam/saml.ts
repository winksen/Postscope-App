import type { ParsedCollection, ParsedRequest } from '../parser'
import { isLocalHost } from '../localHost'
import type { FindingSink } from './sink'
import type { IdentityProfile } from './types'
import { safeDecode, splitUrl } from './url'

/** Base64 text decoded at most this far. An assertion starts near the top of a response, so the first 256 KB are enough. */
const MAX_DECODE_BASE64 = 350_000
const MIN_SAML_VALUE = 80

const SAML_FIELD = /SAMLResponse["']?\s*[=:]\s*["']?([A-Za-z0-9+/=%_-]{80,})/g
const SAML_HTML_INPUT = /SAMLResponse["'][^>]{0,80}?value\s*=\s*["']([A-Za-z0-9+/=%_-]{80,})/gi
const ASSERTION_TAG = /<(?:[\w.-]+:)?Assertion[\s>]/
const ISSUER = /<(?:[\w.-]+:)?Issuer[^>]*>\s*([^<\s]{1,200})\s*</

function decodeBase64(value: string): string | null {
  try {
    const cleaned = safeDecode(value.replace(/\+/g, '%2B')).replace(/\s+/g, '')
    const clipped = cleaned.slice(0, Math.min(cleaned.length, MAX_DECODE_BASE64) - (Math.min(cleaned.length, MAX_DECODE_BASE64) % 4))
    const binary = atob(clipped)
    return binary
  } catch {
    return null
  }
}

/** Describes a SAML assertion without repeating any of its content. Returns null when the value is not a base64 SAML assertion. */
export function describeSamlAssertion(value: string): string | null {
  if (value.length < MIN_SAML_VALUE) return null
  const xml = decodeBase64(value)
  if (!xml || !ASSERTION_TAG.test(xml)) return null
  const issuer = ISSUER.exec(xml)?.[1]
  let issuerLabel = ''
  if (issuer) {
    try {
      issuerLabel = `, issuer ${new URL(issuer).host}`
    } catch {
      issuerLabel = ', issuer set'
    }
  }
  return `SAML assertion (${value.length} characters)${issuerLabel}`
}

export interface SamlOccurrence {
  requestId: string
  location: string
  preview: string
}

function fromText(text: string | undefined, requestId: string, location: string, out: SamlOccurrence[]): void {
  if (!text || !text.includes('SAMLResponse')) return
  for (const pattern of [SAML_FIELD, SAML_HTML_INPUT]) {
    pattern.lastIndex = 0
    for (const match of text.slice(0, 2_000_000).matchAll(pattern)) {
      const preview = describeSamlAssertion(match[1])
      if (preview) out.push({ requestId, location, preview })
      if (out.length >= 100) return
    }
  }
}

/** SAML responses with an assertion in a request (form field, query, raw body) or in a saved example. */
export function findSamlAssertions(request: ParsedRequest): SamlOccurrence[] {
  const out: SamlOccurrence[] = []
  for (const field of request.bodyFields ?? []) {
    if (field.key.trim().toLowerCase() === 'samlresponse') {
      const preview = describeSamlAssertion(field.value)
      if (preview) out.push({ requestId: request.id, location: 'body field SAMLResponse', preview })
    }
  }
  for (const param of request.queryParams ?? []) {
    if (param.key.trim().toLowerCase() === 'samlresponse') {
      const preview = describeSamlAssertion(param.value)
      if (preview) out.push({ requestId: request.id, location: 'query SAMLResponse', preview })
    }
  }
  fromText(request.bodyRaw, request.id, 'raw body SAMLResponse', out)
  for (const response of request.savedResponses ?? []) {
    const label = `saved response "${response.name}"`
    fromText(response.body, request.id, `${label} body SAMLResponse`, out)
    fromText(response.requestBody, request.id, `${label} original request body SAMLResponse`, out)
    if (response.requestUrl) fromText(response.requestUrl, request.id, `${label} original request URL SAMLResponse`, out)
  }
  return out
}

interface CookieFlags {
  name: string
  secure: boolean
  httpOnly: boolean
  sameSite: boolean
}

function parseSetCookie(value: string): CookieFlags | null {
  const [pair, ...attributes] = value.split(';')
  const name = pair.split('=')[0]?.trim()
  if (!name) return null
  const flags = attributes.map((attribute) => attribute.trim().toLowerCase())
  return {
    name,
    secure: flags.includes('secure'),
    httpOnly: flags.includes('httponly'),
    sameSite: flags.some((flag) => flag.startsWith('samesite=')),
  }
}

const SESSION_COOKIE_NAME = /session|sess|sid|token|auth|jwt/i

function missingFlags(cookie: CookieFlags): string[] {
  return [!cookie.secure && 'Secure', !cookie.httpOnly && 'HttpOnly', !cookie.sameSite && 'SameSite'].filter(
    (flag): flag is string => !!flag
  )
}

/** SAML and session checks of the `iam-am` pack (V0.2.4). */
export function checkSamlAndSessions(parsed: ParsedCollection, profile: IdentityProfile, out: FindingSink): void {
  for (const request of parsed.requests) {
    for (const hit of findSamlAssertions(request))
      out.add('SAML_ASSERTION_CAPTURED', request.id, { location: hit.location, preview: hit.preview })

    for (const response of request.savedResponses ?? []) {
      const label = `saved response "${response.name}"`
      const cookies: CookieFlags[] = []
      for (const header of response.headers) {
        if (header.key.trim().toLowerCase() !== 'set-cookie') continue
        const cookie = parseSetCookie(header.value)
        if (cookie && SESSION_COOKIE_NAME.test(cookie.name)) cookies.push(cookie)
      }
      for (const stored of response.cookies ?? []) {
        if (!SESSION_COOKIE_NAME.test(stored.name)) continue
        cookies.push({
          name: stored.name,
          secure: stored.secure === true,
          httpOnly: stored.httpOnly === true,
          sameSite: !!stored.sameSite && stored.sameSite.toLowerCase() !== 'none',
        })
      }
      for (const cookie of cookies) {
        const missing = missingFlags(cookie)
        if (missing.length)
          out.add('SESSION_COOKIE_FLAGS', request.id, {
            location: `${label} cookie ${cookie.name}`,
            preview: `missing ${missing.join(', ')}`,
          })
      }
    }
  }

  const requestsById = new Map(parsed.requests.map((request) => [request.id, request]))
  for (const endpoint of profile.endpoints) {
    if (endpoint.class !== 'saml.sso' && endpoint.class !== 'saml.acs') continue
    const request = requestsById.get(endpoint.requestId)
    if (!request) continue
    const url = splitUrl(request.url, parsed)
    if (url.scheme === 'http' && url.host && !isLocalHost(url.host))
      out.add('SAML_IDP_METADATA_HTTP', request.id, {
        location: `${endpoint.class} ${endpoint.method}`,
        preview: `http://${url.host}${url.path}`,
      })
  }
}
