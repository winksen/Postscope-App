import type { ParsedCollection } from './parser'

export interface Finding {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  category: 'secrets' | 'variables' | 'auth' | 'hygiene';
  title: string;
  description: string;
  /** Stable request ids from the parser (not display names). */
  affected: string[];
  recommendation: string;
}

const SECRET_KEY_REGEX = /passw|password|passwd/i
const API_KEY_REGEX = /api.?key|x-api-key|apikey/i
const BODY_SECRET_REGEX = /secret|client_secret|access_token/i
const BEARER_OR_BASIC_REGEX = /^(Bearer|Basic)\s+.+$/i
const VARIABLE_PATTERN = /\{\{\w+\}\}/

function isVariable(value: string): boolean {
  return VARIABLE_PATTERN.test(value) || value.trim() === ''
}

function runCriticalChecks(parsed: ParsedCollection): Finding[] {
  const findings: Finding[] = []
  const affectedByRule = new Map<string, string[]>()

  for (const req of parsed.requests) {
    for (const h of req.headers) {
      if (SECRET_KEY_REGEX.test(h.key) && !isVariable(h.value) && h.value) {
        const key = 'HARDCODED_PASSWORD'
        if (!affectedByRule.has(key)) affectedByRule.set(key, [])
        affectedByRule.get(key)!.push(req.id)
      }
      if (h.key.toLowerCase() === 'authorization' && !isVariable(h.value) && h.value && BEARER_OR_BASIC_REGEX.test(h.value)) {
        const key = 'HARDCODED_TOKEN'
        if (!affectedByRule.has(key)) affectedByRule.set(key, [])
        affectedByRule.get(key)!.push(req.id)
      }
      if (API_KEY_REGEX.test(h.key) && !isVariable(h.value) && h.value) {
        const key = 'HARDCODED_API_KEY'
        if (!affectedByRule.has(key)) affectedByRule.set(key, [])
        affectedByRule.get(key)!.push(req.id)
      }
    }

    if (req.bodyRaw) {
      try {
        const parsedBody = JSON.parse(req.bodyRaw) as Record<string, unknown>
        const check = (obj: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(obj)) {
            if (BODY_SECRET_REGEX.test(k) && typeof v === 'string' && !isVariable(v) && v) {
              const key = 'HARDCODED_SECRET'
              if (!affectedByRule.has(key)) affectedByRule.set(key, [])
              affectedByRule.get(key)!.push(req.id)
              return
            }
            if (v && typeof v === 'object' && !Array.isArray(v)) check(v as Record<string, unknown>)
          }
        }
        check(parsedBody)
      } catch {
        if (BODY_SECRET_REGEX.test(req.bodyRaw) && !VARIABLE_PATTERN.test(req.bodyRaw)) {
          const key = 'HARDCODED_SECRET'
          if (!affectedByRule.has(key)) affectedByRule.set(key, [])
          affectedByRule.get(key)!.push(req.id)
        }
      }
    }
  }

  const ruleMeta: Record<string, { title: string; description: string; recommendation: string }> = {
    HARDCODED_PASSWORD: {
      title: 'Hardcoded password in headers or body',
      description: 'A password or credential field contains a literal value instead of a variable.',
      recommendation: 'Replace with {{variable}} reference and define in collection or environment variables.',
    },
    HARDCODED_TOKEN: {
      title: 'Hardcoded Authorization token',
      description: 'Authorization header contains a literal Bearer or Basic token.',
      recommendation: 'Store token in a variable and use {{token}} or {{apiKey}} in the header.',
    },
    HARDCODED_API_KEY: {
      title: 'Hardcoded API key',
      description: 'API key header contains a literal value instead of a variable.',
      recommendation: 'Use {{apiKey}} or similar variable reference.',
    },
    HARDCODED_SECRET: {
      title: 'Hardcoded secret in request body',
      description: 'Request body contains secret, client_secret, or access_token with literal value.',
      recommendation: 'Use variables for all sensitive fields in request bodies.',
    },
  }

  for (const [ruleId, affected] of affectedByRule) {
    const meta = ruleMeta[ruleId]
    if (meta) {
      findings.push({
        id: `${ruleId}-${Date.now()}`,
        severity: 'critical',
        category: 'secrets',
        title: meta.title,
        description: meta.description,
        affected: [...new Set(affected)],
        recommendation: meta.recommendation,
      })
    }
  }

  return findings
}

function runWarningChecks(parsed: ParsedCollection): Finding[] {
  const findings: Finding[] = []
  const affectedByRule = new Map<string, string[]>()
  const urlVarPattern = /\{\{(baseUrl|base_url|host|url|BASE_URL)\}\}/i
  const envHostPattern = /(prod|staging|dev|localhost)(\.|\/|$)/i

  for (const req of parsed.requests) {
    const url = req.url || ''
    if (url && !urlVarPattern.test(url) && (url.startsWith('http://') || url.startsWith('https://'))) {
      const key = 'HARDCODED_BASEURL'
      if (!affectedByRule.has(key)) affectedByRule.set(key, [])
      affectedByRule.get(key)!.push(req.id)
    }
    if (url && envHostPattern.test(url) && !VARIABLE_PATTERN.test(url)) {
      const key = 'HARDCODED_ENV_URL'
      if (!affectedByRule.has(key)) affectedByRule.set(key, [])
      affectedByRule.get(key)!.push(req.id)
    }

    const mutationMethods = ['POST', 'PUT', 'PATCH', 'DELETE']
    const hasAuthHeader = req.headers.some((h) => h.key.toLowerCase() === 'authorization')
    if (mutationMethods.includes(req.method) && req.auth === 'noauth' && !hasAuthHeader) {
      const key = 'MISSING_AUTH'
      if (!affectedByRule.has(key)) affectedByRule.set(key, [])
      affectedByRule.get(key)!.push(req.id)
    }

    if (req.auth === 'basic' && req.basicAuth) {
      const { username, password } = req.basicAuth
      const literalUser = username && !isVariable(username)
      const literalPass = password && !isVariable(password)
      if (literalUser || literalPass) {
        const key = 'BASIC_AUTH_PLAINTEXT'
        if (!affectedByRule.has(key)) affectedByRule.set(key, [])
        affectedByRule.get(key)!.push(req.id)
      }
    }
  }

  const ruleMeta: Record<string, { title: string; description: string; recommendation: string }> = {
    HARDCODED_BASEURL: {
      title: 'Hardcoded base URL',
      description: 'Request URL uses literal scheme and host instead of {{baseUrl}} or similar variable.',
      recommendation: 'Use {{baseUrl}} or {{host}} for environment portability.',
    },
    HARDCODED_ENV_URL: {
      title: 'Environment-specific URL',
      description: 'URL contains literal environment identifiers (prod, staging, dev, localhost).',
      recommendation: 'Parameterize host with variables to support multiple environments.',
    },
    MISSING_AUTH: {
      title: 'Potentially unprotected mutation request',
      description: 'POST/PUT/PATCH/DELETE request has no auth and no Authorization header.',
      recommendation: 'Add collection or request-level auth if the endpoint requires authentication.',
    },
    BASIC_AUTH_PLAINTEXT: {
      title: 'Basic auth with literal credentials',
      description: 'Basic auth uses literal username/password instead of variables.',
      recommendation: 'Use {{username}} and {{password}} variables.',
    },
  }

  for (const [ruleId, affected] of affectedByRule) {
    const meta = ruleMeta[ruleId]
    if (meta) {
      findings.push({
        id: `${ruleId}-${Date.now()}`,
        severity: 'warning',
        category: ruleId.includes('URL') ? 'variables' : ruleId.includes('AUTH') ? 'auth' : 'variables',
        title: meta.title,
        description: meta.description,
        affected: [...new Set(affected)],
        recommendation: meta.recommendation,
      })
    }
  }

  return findings
}

function runInfoChecks(parsed: ParsedCollection): Finding[] {
  const findings: Finding[] = []

  const noDesc = parsed.requests.filter((r) => !r.hasDescription)
  if (noDesc.length > 0) {
    findings.push({
      id: 'MISSING_DESCRIPTION-1',
      severity: 'info',
      category: 'hygiene',
      title: 'Requests without description',
      description: `${noDesc.length} request(s) have no description.`,
      affected: noDesc.map((r) => r.id),
      recommendation: 'Add descriptions to document purpose and usage of each request.',
    })
  }

  if (parsed.definedVariables.length < 3 && parsed.totalRequests > 0) {
    findings.push({
      id: 'NO_COLLECTION_VARIABLES-1',
      severity: 'info',
      category: 'variables',
      title: 'Few collection variables defined',
      description: `Collection defines ${parsed.definedVariables.length} variable(s). Consider at least baseUrl, apiKey, and environment-specific values.`,
      affected: [],
      recommendation: 'Define baseUrl, apiKey, and other shared values as collection variables.',
    })
  }

  const authTypeCount = Object.keys(parsed.authTypes).filter((k) => k !== 'noauth').length
  if (authTypeCount > 2) {
    findings.push({
      id: 'INCONSISTENT_AUTH-1',
      severity: 'info',
      category: 'auth',
      title: 'Multiple auth types in use',
      description: `Collection uses ${authTypeCount} different auth types. This may complicate maintenance.`,
      affected: [],
      recommendation: 'Standardize on one or two auth strategies where possible.',
    })
  }

  const emptyHeaders = parsed.requests.filter(
    (r) => r.headers.length > 0 && r.headers.every((h) => !h.value?.trim())
  )
  if (emptyHeaders.length > 0) {
    findings.push({
      id: 'EMPTY_HEADERS-1',
      severity: 'info',
      category: 'hygiene',
      title: 'Requests with empty header values',
      description: `${emptyHeaders.length} request(s) have headers with empty values.`,
      affected: emptyHeaders.map((r) => r.id),
      recommendation: 'Remove empty headers or populate with values.',
    })
  }

  const requestsByFolderAndName = new Map<string, string[]>()
  for (const request of parsed.requests) {
    const key = `${request.folderPath.join('/')}::${request.name.trim().toLowerCase()}`
    const ids = requestsByFolderAndName.get(key) ?? []
    ids.push(request.id)
    requestsByFolderAndName.set(key, ids)
  }
  const duplicateNameIds = [...requestsByFolderAndName.values()].filter((ids) => ids.length > 1).flat()
  if (duplicateNameIds.length > 0) {
    findings.push({
      id: 'DUPLICATE_REQUEST_NAMES-1',
      severity: 'info',
      category: 'hygiene',
      title: 'Duplicate request names',
      description: `${duplicateNameIds.length} request(s) share a name with another request in the same folder.`,
      affected: duplicateNameIds,
      recommendation: 'Rename duplicate requests so search results, repair previews, and team reviews are easier to scan.',
    })
  }

  const placeholderNamePattern = /^(new request|untitled|request|copy of\b|copy\b)/i
  const placeholderNames = parsed.requests.filter((request) => placeholderNamePattern.test(request.name.trim()))
  if (placeholderNames.length > 0) {
    findings.push({
      id: 'PLACEHOLDER_REQUEST_NAMES-1',
      severity: 'info',
      category: 'hygiene',
      title: 'Placeholder request names',
      description: `${placeholderNames.length} request(s) appear to use placeholder or copied names.`,
      affected: placeholderNames.map((request) => request.id),
      recommendation: 'Use action-oriented names that describe the endpoint purpose, such as “Create user” or “List invoices”.',
    })
  }

  const looseRootRequests = parsed.requests.filter((request) => request.folderPath.length === 0)
  if (looseRootRequests.length > 0 && parsed.totalFolders > 1) {
    findings.push({
      id: 'ROOT_LEVEL_REQUESTS-1',
      severity: 'info',
      category: 'hygiene',
      title: 'Loose root-level requests',
      description: `${looseRootRequests.length} request(s) sit at the collection root while the rest of the collection uses folders.`,
      affected: looseRootRequests.map((request) => request.id),
      recommendation: 'Move root-level requests into the closest functional folder so the collection tree stays predictable.',
    })
  }

  const deepNestedRequests = parsed.requests.filter((request) => request.folderPath.length >= 5)
  if (deepNestedRequests.length > 0) {
    findings.push({
      id: 'DEEP_FOLDER_NESTING-1',
      severity: 'info',
      category: 'hygiene',
      title: 'Deep folder nesting',
      description: `${deepNestedRequests.length} request(s) are nested five or more folders deep.`,
      affected: deepNestedRequests.map((request) => request.id),
      recommendation: 'Flatten very deep branches where possible, or split large areas into clearer top-level product domains.',
    })
  }

  return findings
}

export function runAudit(parsed: ParsedCollection): Finding[] {
  const critical = runCriticalChecks(parsed)
  const warning = runWarningChecks(parsed)
  const info = runInfoChecks(parsed)
  return [...critical, ...warning, ...info]
}
