import { AUTH_HEADER_SCHEME, classifyBodySecret, isQuerySecret } from './auditor'
import { AUTH_FIELD_VARIABLES, isInheritedAuth, normalizeAuthType, secretFieldsFor } from './authSchemes'
import { isLikelySecretValue, isSensitiveHeader, isSensitiveKey, redactSecretsInText } from './secretPatterns'
import { toVariableName } from './variables'
import { cloneJson } from './repairEngine'
import { detectIndent, parseTemplatedJson } from './jsonBody'
import { replaceRawBodyFields, scanRawBodyFields } from './rawBody'

/** Marker for places that cannot hold a usable variable (saved responses, scripts, free text). */
export const REDACTED = '{{REDACTED}}'

export interface RedactionResult {
  json: unknown
  redactedCount: number
}

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

const RESPONSE_JSON_SECRET =
  /("(?:access_token|accessToken|refresh_token|refreshToken|id_token|idToken|token|password|client_secret|clientSecret|api_key|apiKey|secret|session_id|sessionId)"\s*:\s*")([^"\\]{4,})(")/g
const SCRIPT_SET_CALL = /(pm\.(?:environment|collectionVariables|globals|variables|iterationData)\.set\(\s*(['"`])([^'"`]+)\2\s*,\s*(['"`]))([^'"`]*)(\4)/g
const URL_CREDENTIALS = /^([a-z][a-z0-9+.-]*:\/\/)([^\s/@:{}]+):([^\s/@{}]+)@/i
const COOKIE_PAIR = /([^=;\s]+)=([^;]*)/g

class Redactor {
  count = 0

  text(value: string, replacer: (match: string) => string = () => REDACTED): string {
    const next = redactSecretsInText(value, replacer)
    if (next !== value) this.count += 1
    return next
  }

  auth(auth: unknown): void {
    if (!isRecord(auth) || isInheritedAuth(auth)) return
    const type = normalizeAuthType(auth.type)
    const fields = type === 'basic' ? ['password'] : secretFieldsFor(type)
    const block = auth[typeof auth.type === 'string' ? auth.type : type] ?? auth[type]
    const replacement = (field: string) => `{{${AUTH_FIELD_VARIABLES[field] ?? field}}}`
    if (Array.isArray(block)) {
      for (const entry of block) {
        if (isRecord(entry) && typeof entry.key === 'string' && fields.includes(entry.key) && isLikelySecretValue(entry.value)) {
          entry.value = replacement(entry.key)
          this.count += 1
        }
      }
    } else if (isRecord(block)) {
      for (const field of fields) {
        if (isLikelySecretValue(block[field])) {
          block[field] = replacement(field)
          this.count += 1
        }
      }
    }
  }

  /** Redacts `owner.header`, which Postman stores as an array or as a raw `Key: value` block. */
  headersOn(owner: UnknownRecord, runnable: boolean): void {
    const headers = owner.header
    if (typeof headers === 'string') {
      const lines = headers.split(/\r?\n/).map((line) => {
        const colon = line.indexOf(':')
        if (colon <= 0) return line
        const entry = { key: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim() }
        this.headers([entry], runnable)
        return `${entry.key}: ${entry.value}`
      })
      owner.header = lines.join('\n')
      return
    }
    this.headers(headers, runnable)
  }

  headers(headers: unknown, runnable: boolean): void {
    if (!Array.isArray(headers)) return
    for (const header of headers) {
      if (!isRecord(header) || typeof header.key !== 'string' || typeof header.value !== 'string') continue
      const lower = header.key.toLowerCase()
      if (lower === 'cookie' || lower === 'set-cookie') {
        const next = header.value.replace(COOKIE_PAIR, (pair, name: string, value: string) => {
          if (/^(path|domain|expires|max-age|samesite|secure|httponly)$/i.test(name.trim()) || !isLikelySecretValue(value)) return pair
          return `${name}=${runnable ? '{{sessionCookie}}' : REDACTED}`
        })
        if (next !== header.value) {
          header.value = next
          this.count += 1
        }
        continue
      }
      if (!isSensitiveHeader(header.key) || !isLikelySecretValue(header.value)) {
        header.value = this.text(header.value)
        continue
      }
      const scheme = header.value.trim().match(AUTH_HEADER_SCHEME)
      const variable = lower === 'authorization' || lower === 'proxy-authorization' ? 'token' : toVariableName(header.key, 'token')
      header.value = runnable ? `${scheme ? `${scheme[1]} ` : ''}{{${variable}}}` : REDACTED
      this.count += 1
    }
  }

  url(request: UnknownRecord): void {
    const url = request.url
    const scrub = (raw: string) => {
      let next = raw.replace(URL_CREDENTIALS, (match, scheme: string, user: string, password: string) =>
        password.includes('{{') ? match : `${scheme}${user}:{{password}}@`
      )
      next = next.replace(/([?&])([^=&#]+)=([^&#]*)/g, (pair, sep: string, key: string, value: string) => {
        let decoded = value
        try {
          decoded = decodeURIComponent(value)
        } catch {
          /* keep raw */
        }
        return isQuerySecret(key, decoded) ? `${sep}${key}={{${toVariableName(key)}}}` : pair
      })
      next = redactSecretsInText(next, () => REDACTED)
      if (next !== raw) this.count += 1
      return next
    }
    if (typeof url === 'string') {
      request.url = scrub(url)
      return
    }
    if (!isRecord(url)) return
    if (typeof url.raw === 'string') url.raw = scrub(url.raw)
    if (Array.isArray(url.query)) {
      for (const param of url.query) {
        if (isRecord(param) && typeof param.key === 'string' && typeof param.value === 'string' && isQuerySecret(param.key, param.value)) {
          param.value = `{{${toVariableName(param.key)}}}`
        }
      }
    }
  }

  jsonValue(value: unknown, depth = 0): void {
    if (depth > 50 || value === null || typeof value !== 'object') return
    if (Array.isArray(value)) {
      value.forEach((child) => this.jsonValue(child, depth + 1))
      return
    }
    const record = value as UnknownRecord
    for (const [key, child] of Object.entries(record)) {
      if (typeof child === 'string') {
        if (classifyBodySecret(key, child)) {
          record[key] = `{{${toVariableName(key)}}}`
          this.count += 1
        }
      } else {
        this.jsonValue(child, depth + 1)
      }
    }
  }

  /** Raw body text: JSON (with or without unquoted variables) is edited structurally, anything else field by field. */
  rawText(raw: string): string {
    const templated = parseTemplatedJson(raw)
    if (templated) {
      const before = this.count
      this.jsonValue(templated.value)
      return this.count === before ? raw : templated.restore(JSON.stringify(templated.value, null, detectIndent(raw)))
    }
    const replacements = scanRawBodyFields(raw)
      .filter((field) => classifyBodySecret(field.key, field.value))
      .map((field) => ({ field, value: `{{${toVariableName(field.key)}}}` }))
    this.count += replacements.length
    return this.text(replacements.length ? replaceRawBodyFields(raw, replacements) : raw)
  }

  body(body: unknown): void {
    if (!isRecord(body)) return
    for (const mode of ['urlencoded', 'formdata'] as const) {
      const fields = body[mode]
      if (!Array.isArray(fields)) continue
      for (const field of fields) {
        if (!isRecord(field) || typeof field.key !== 'string' || typeof field.value !== 'string') continue
        if (classifyBodySecret(field.key, field.value)) {
          field.value = `{{${toVariableName(field.key)}}}`
          this.count += 1
        }
      }
    }
    const raw = body.raw
    if (typeof raw === 'string' && raw.trim()) body.raw = this.rawText(raw)
    if (isRecord(body.graphql) && typeof body.graphql.variables === 'string') {
      const variables = body.graphql.variables
      const templated = parseTemplatedJson(variables)
      if (templated) {
        const before = this.count
        this.jsonValue(templated.value)
        if (this.count !== before) body.graphql.variables = templated.restore(JSON.stringify(templated.value, null, detectIndent(variables)))
      }
    }
  }

  script(events: unknown): void {
    if (!Array.isArray(events)) return
    for (const event of events) {
      if (!isRecord(event) || !isRecord(event.script)) continue
      const scrub = (line: string) => {
        let next = line.replace(SCRIPT_SET_CALL, (match, prefix: string, _q: string, key: string, _q2: string, value: string, suffix: string) =>
          isSensitiveKey(key) && isLikelySecretValue(value) ? `${prefix}${REDACTED}${suffix}` : match
        )
        next = redactSecretsInText(next, () => REDACTED)
        if (next !== line) this.count += 1
        return next
      }
      const exec = event.script.exec
      if (Array.isArray(exec)) event.script.exec = exec.map((line) => (typeof line === 'string' ? scrub(line) : line))
      else if (typeof exec === 'string') event.script.exec = scrub(exec)
    }
  }

  responses(responses: unknown): void {
    if (!Array.isArray(responses)) return
    for (const response of responses) {
      if (!isRecord(response)) continue
      this.headersOn(response, false)
      if (typeof response.body === 'string') {
        const before = response.body
        response.body = redactSecretsInText(
          before.replace(RESPONSE_JSON_SECRET, (match, prefix: string, value: string, suffix: string) =>
            isLikelySecretValue(value) ? `${prefix}${REDACTED}${suffix}` : match
          ),
          () => REDACTED
        )
        if (response.body !== before) this.count += 1
      }
      if (isRecord(response.originalRequest)) this.request(response.originalRequest)
    }
  }

  request(request: UnknownRecord): void {
    this.auth(request.auth)
    this.headersOn(request, true)
    this.url(request)
    this.body(request.body)
  }

  items(items: unknown, depth = 0): void {
    if (!Array.isArray(items) || depth > 100) return
    for (const item of items) {
      if (!isRecord(item)) continue
      this.auth(item.auth)
      this.script(item.event)
      if (isRecord(item.request)) this.request(item.request)
      this.responses(item.response)
      this.items(item.item, depth + 1)
    }
  }

  variables(variables: unknown): void {
    if (!Array.isArray(variables)) return
    for (const variable of variables) {
      if (!isRecord(variable) || typeof variable.key !== 'string' || typeof variable.value !== 'string') continue
      const pattern = redactSecretsInText(variable.value, () => REDACTED) !== variable.value
      if ((isSensitiveKey(variable.key) || variable.type === 'secret' || pattern) && isLikelySecretValue(variable.value)) {
        variable.value = ''
        this.count += 1
      }
    }
  }
}

/**
 * Returns a deep copy of a Postman collection with credentials removed: auth helper secrets,
 * sensitive headers, query strings, body fields, URL credentials, collection variable values,
 * script literals, saved example responses, and any provider-format token elsewhere.
 * Request-side values become `{{variables}}` so the sanitized copy stays runnable.
 */
export function redactCollection(input: unknown): RedactionResult {
  const json = cloneJson(input)
  if (!isRecord(json)) return { json, redactedCount: 0 }
  const redactor = new Redactor()
  redactor.auth(json.auth)
  redactor.script(json.event)
  redactor.variables(json.variable)
  redactor.items(json.item)
  return { json, redactedCount: redactor.count }
}
