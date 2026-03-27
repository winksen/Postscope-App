import type { ParsedCollection } from './parser'

export interface Finding {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  category: 'secrets' | 'variables' | 'auth' | 'hygiene';
  title: string;
  description: string;
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
        affectedByRule.get(key)!.push(req.name)
      }
      if (h.key.toLowerCase() === 'authorization' && !isVariable(h.value) && h.value && BEARER_OR_BASIC_REGEX.test(h.value)) {
        const key = 'HARDCODED_TOKEN'
        if (!affectedByRule.has(key)) affectedByRule.set(key, [])
        affectedByRule.get(key)!.push(req.name)
      }
      if (API_KEY_REGEX.test(h.key) && !isVariable(h.value) && h.value) {
        const key = 'HARDCODED_API_KEY'
        if (!affectedByRule.has(key)) affectedByRule.set(key, [])
        affectedByRule.get(key)!.push(req.name)
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
              affectedByRule.get(key)!.push(req.name)
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
          affectedByRule.get(key)!.push(req.name)
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
      affectedByRule.get(key)!.push(req.name)
    }
    if (url && envHostPattern.test(url) && !VARIABLE_PATTERN.test(url)) {
      const key = 'HARDCODED_ENV_URL'
      if (!affectedByRule.has(key)) affectedByRule.set(key, [])
      affectedByRule.get(key)!.push(req.name)
    }

    const mutationMethods = ['POST', 'PUT', 'PATCH', 'DELETE']
    const hasAuthHeader = req.headers.some((h) => h.key.toLowerCase() === 'authorization')
    if (mutationMethods.includes(req.method) && req.auth === 'noauth' && !hasAuthHeader) {
      const key = 'MISSING_AUTH'
      if (!affectedByRule.has(key)) affectedByRule.set(key, [])
      affectedByRule.get(key)!.push(req.name)
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
      affected: noDesc.map((r) => r.name),
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
      affected: emptyHeaders.map((r) => r.name),
      recommendation: 'Remove empty headers or populate with values.',
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
