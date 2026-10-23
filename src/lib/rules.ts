import type { FindingCategory, Severity } from './severity'

export type RuleId =
  | 'HARDCODED_PASSWORD'
  | 'HARDCODED_TOKEN'
  | 'HARDCODED_API_KEY'
  | 'HARDCODED_SECRET'
  | 'HARDCODED_AUTH_CREDENTIAL'
  | 'SECRET_IN_QUERY'
  | 'CREDENTIALS_IN_URL'
  | 'SECRET_IN_SCRIPT'
  | 'SECRET_IN_COLLECTION_VARIABLE'
  | 'SECRET_IN_ENVIRONMENT'
  | 'SECRET_IN_SAVED_RESPONSE'
  | 'KNOWN_SECRET_PATTERN'
  | 'HARDCODED_BASEURL'
  | 'HARDCODED_ENV_URL'
  | 'UNDEFINED_VARIABLE'
  | 'MISSING_AUTH'
  | 'BASIC_AUTH_PLAINTEXT'
  | 'INSECURE_HTTP'
  | 'TLS_VERIFICATION_DISABLED'
  | 'SECRET_LOGGED_IN_SCRIPT'
  | 'HIGH_ENTROPY_LITERAL'
  | 'MISSING_DESCRIPTION'
  | 'NO_COLLECTION_VARIABLES'
  | 'UNUSED_COLLECTION_VARIABLE'
  | 'INCONSISTENT_AUTH'
  | 'EMPTY_HEADERS'
  | 'DUPLICATE_REQUEST_NAMES'
  | 'PLACEHOLDER_REQUEST_NAMES'
  | 'ROOT_LEVEL_REQUESTS'
  | 'DEEP_FOLDER_NESTING'
  | 'GET_WITH_BODY'
  | 'SUPPRESSION_EXPIRED'
  | 'SUPPRESSION_INVALID'

export interface RuleDefinition {
  id: RuleId
  title: string
  description: string
  recommendation: string
  severity: Severity
  category: FindingCategory
  /** CWE identifier used by SARIF/JSON reports. */
  cwe?: string
  /** OWASP API Security Top 10 (2023) mapping where one applies. */
  owasp?: string
}

const definitions: RuleDefinition[] = [
  // Critical: secrets
  {
    id: 'HARDCODED_PASSWORD',
    title: 'Hardcoded password in headers or body',
    description: 'A password or credential field contains a literal value instead of a variable.',
    recommendation: 'Replace with {{variable}} reference and define in collection or environment variables.',
    severity: 'critical',
    category: 'secrets',
    cwe: 'CWE-798',
  },
  {
    id: 'HARDCODED_TOKEN',
    title: 'Hardcoded Authorization token',
    description: 'Authorization header contains a literal Bearer or Basic token.',
    recommendation: 'Store token in a variable and use {{token}} or {{apiKey}} in the header.',
    severity: 'critical',
    category: 'secrets',
    cwe: 'CWE-798',
  },
  {
    id: 'HARDCODED_API_KEY',
    title: 'Hardcoded API key',
    description: 'API key header contains a literal value instead of a variable.',
    recommendation: 'Use {{apiKey}} or similar variable reference.',
    severity: 'critical',
    category: 'secrets',
    cwe: 'CWE-798',
  },
  {
    id: 'HARDCODED_SECRET',
    title: 'Hardcoded secret in request body',
    description: 'Request body contains secret, client_secret, or access_token with literal value.',
    recommendation: 'Use variables for all sensitive fields in request bodies.',
    severity: 'critical',
    category: 'secrets',
    cwe: 'CWE-798',
  },
  {
    id: 'HARDCODED_AUTH_CREDENTIAL',
    title: 'Hardcoded credential in auth settings',
    description:
      'A Postman auth helper (Bearer, API key, OAuth, AWS, Digest, …) stores a literal token or secret at request, folder, or collection level.',
    recommendation: 'Reference a variable such as {{token}} in the auth settings and keep the value in an environment or vault.',
    severity: 'critical',
    category: 'secrets',
    cwe: 'CWE-798',
    owasp: 'API2:2023 Broken Authentication',
  },
  {
    id: 'SECRET_IN_QUERY',
    title: 'Secret passed in query string',
    description:
      'A credential-like query parameter (token, api_key, password, …) carries a literal value. URLs end up in logs, proxies, and browser history.',
    recommendation: 'Send credentials in a header or auth helper and reference a variable instead of a literal value.',
    severity: 'critical',
    category: 'secrets',
    cwe: 'CWE-598',
    owasp: 'API2:2023 Broken Authentication',
  },
  {
    id: 'CREDENTIALS_IN_URL',
    title: 'Credentials embedded in URL',
    description: 'A request URL contains user:password@host credentials.',
    recommendation: 'Remove credentials from the URL and use Basic auth with {{username}} / {{password}} variables.',
    severity: 'critical',
    category: 'secrets',
    cwe: 'CWE-522',
  },
  {
    id: 'SECRET_IN_SCRIPT',
    title: 'Hardcoded secret in script',
    description:
      'A pre-request or test script contains a literal credential, such as pm.environment.set("token", "…") or a provider token.',
    recommendation: 'Read secrets with pm.environment.get / pm.vault and keep the values outside the collection export.',
    severity: 'critical',
    category: 'secrets',
    cwe: 'CWE-798',
  },
  {
    id: 'SECRET_IN_COLLECTION_VARIABLE',
    title: 'Secret stored in collection variable',
    description:
      'A collection variable with a credential-like name has a literal value, which is shared with everyone who receives the export.',
    recommendation: 'Clear the value in the collection and set it in a private environment, Postman vault, or CI secret store.',
    severity: 'critical',
    category: 'secrets',
    cwe: 'CWE-798',
  },
  {
    id: 'SECRET_IN_ENVIRONMENT',
    title: 'Secret stored in environment or globals export',
    description:
      'A Postman environment or globals file holds a credential in clear text. Postman exports "secret" typed variables unmasked, so the file leaks it just like the collection would.',
    recommendation:
      'Keep environment files out of source control and chat. Share a copy with the secret values emptied, and load real values from a vault or a private environment.',
    severity: 'critical',
    category: 'secrets',
    cwe: 'CWE-798',
  },
  {
    id: 'SECRET_IN_SAVED_RESPONSE',
    title: 'Secret in saved example response',
    description: 'A saved example response (or its original request) contains tokens, cookies, or credentials captured from a real call.',
    recommendation: 'Scrub or delete saved examples that captured real tokens before sharing the collection.',
    severity: 'critical',
    category: 'secrets',
    cwe: 'CWE-200',
  },
  {
    id: 'KNOWN_SECRET_PATTERN',
    title: 'Provider token detected',
    description: 'A value matches a known provider credential format (AWS, GitHub, Slack, Stripe, Google, JWT, private key, …).',
    recommendation: 'Revoke the exposed credential, rotate it, and replace the literal with a variable reference.',
    severity: 'critical',
    category: 'secrets',
    cwe: 'CWE-798',
  },

  // Warnings
  {
    id: 'HARDCODED_BASEURL',
    title: 'Hardcoded base URL',
    description: 'Request URL uses literal scheme and host instead of {{baseUrl}} or similar variable.',
    recommendation: 'Use {{baseUrl}} or {{host}} for environment portability.',
    severity: 'warning',
    category: 'variables',
  },
  {
    id: 'HARDCODED_ENV_URL',
    title: 'Environment-specific URL',
    description: 'URL host contains a literal environment label (prod, staging, uat, qa, dev, sandbox, localhost).',
    recommendation: 'Parameterize host with variables to support multiple environments.',
    severity: 'warning',
    category: 'variables',
  },
  {
    id: 'UNDEFINED_VARIABLE',
    title: 'Variables referenced but never defined',
    description:
      'Requests reference {{variables}} that no collection, folder, request, environment or globals definition provides and no script sets.',
    recommendation: 'Define the variable (collection variable or environment value), or fix the name if it is a typo.',
    severity: 'warning',
    category: 'variables',
  },
  {
    id: 'MISSING_AUTH',
    title: 'Potentially unprotected mutation request',
    description: 'POST/PUT/PATCH/DELETE request has no auth helper and no credential header, cookie, query credential or auth script.',
    recommendation: 'Add collection or request-level auth if the endpoint requires authentication.',
    severity: 'warning',
    category: 'auth',
    cwe: 'CWE-306',
    owasp: 'API2:2023 Broken Authentication',
  },
  {
    id: 'BASIC_AUTH_PLAINTEXT',
    title: 'Basic auth with literal credentials',
    description: 'Basic auth uses literal username/password instead of variables.',
    recommendation: 'Use {{username}} and {{password}} variables.',
    severity: 'warning',
    category: 'auth',
    cwe: 'CWE-798',
  },
  {
    id: 'INSECURE_HTTP',
    title: 'Plaintext HTTP endpoint',
    description: 'Requests target a non-local host over http://, so credentials and payloads travel unencrypted.',
    recommendation: 'Use https:// for every non-local endpoint, including the value of {{baseUrl}}.',
    severity: 'warning',
    category: 'auth',
    cwe: 'CWE-319',
    owasp: 'API8:2023 Security Misconfiguration',
  },
  {
    id: 'TLS_VERIFICATION_DISABLED',
    title: 'TLS certificate verification disabled',
    description: 'Postman SSL certificate verification (strictSSL) is turned off, which hides man-in-the-middle attacks.',
    recommendation: 'Re-enable certificate verification and trust internal CAs in Postman settings instead.',
    severity: 'warning',
    category: 'auth',
    cwe: 'CWE-295',
    owasp: 'API8:2023 Security Misconfiguration',
  },
  {
    id: 'SECRET_LOGGED_IN_SCRIPT',
    title: 'Sensitive value logged by script',
    description:
      'A script writes tokens, passwords, or Authorization data to the Postman console, which is often shared in screenshots and bug reports.',
    recommendation: 'Remove console logging of credentials or log a masked value.',
    severity: 'warning',
    category: 'secrets',
    cwe: 'CWE-532',
  },
  {
    id: 'HIGH_ENTROPY_LITERAL',
    title: 'High-entropy literal in a credential position',
    description:
      'A header, query parameter or body field with a credential-like name holds a long, random-looking literal that no other secret rule recognized.',
    recommendation: 'If the value is a credential, move it to a {{variable}} defined in a private environment or vault.',
    severity: 'warning',
    category: 'secrets',
    cwe: 'CWE-798',
  },

  // Info
  {
    id: 'MISSING_DESCRIPTION',
    title: 'Requests without description',
    description: 'Requests have no description.',
    recommendation: 'Add descriptions to document purpose and usage of each request.',
    severity: 'info',
    category: 'hygiene',
  },
  {
    id: 'NO_COLLECTION_VARIABLES',
    title: 'Few collection variables defined',
    description: 'The collection defines fewer than three variables.',
    recommendation: 'Define baseUrl, apiKey, and other shared values as collection variables.',
    severity: 'info',
    category: 'variables',
  },
  {
    id: 'UNUSED_COLLECTION_VARIABLE',
    title: 'Collection variables that are never used',
    description: 'Collection variables are defined but no request, script, auth setting or other variable references them.',
    recommendation: 'Remove variables nobody uses, or reference them where they belong. Unused values still ship with every export.',
    severity: 'info',
    category: 'hygiene',
  },
  {
    id: 'INCONSISTENT_AUTH',
    title: 'Multiple auth types in use',
    description: 'The collection mixes more than two auth types.',
    recommendation: 'Standardize on one or two auth strategies where possible.',
    severity: 'info',
    category: 'auth',
  },
  {
    id: 'EMPTY_HEADERS',
    title: 'Requests with empty header values',
    description: 'Requests have headers with empty values.',
    recommendation: 'Remove empty headers or populate with values.',
    severity: 'info',
    category: 'hygiene',
  },
  {
    id: 'DUPLICATE_REQUEST_NAMES',
    title: 'Duplicate request names',
    description: 'Requests share a name with another request in the same folder.',
    recommendation: 'Rename duplicate requests so search results, repair previews, and team reviews are easier to scan.',
    severity: 'info',
    category: 'hygiene',
  },
  {
    id: 'PLACEHOLDER_REQUEST_NAMES',
    title: 'Placeholder request names',
    description: 'Requests appear to use placeholder or copied names.',
    recommendation: 'Use action-oriented names that describe the endpoint purpose, such as “Create user” or “List invoices”.',
    severity: 'info',
    category: 'hygiene',
  },
  {
    id: 'ROOT_LEVEL_REQUESTS',
    title: 'Loose root-level requests',
    description: 'Requests sit at the collection root while the rest of the collection uses folders.',
    recommendation: 'Move root-level requests into the closest functional folder so the collection tree stays predictable.',
    severity: 'info',
    category: 'hygiene',
  },
  {
    id: 'DEEP_FOLDER_NESTING',
    title: 'Deep folder nesting',
    description: 'Requests are nested five or more folders deep.',
    recommendation: 'Flatten very deep branches where possible, or split large areas into clearer top-level product domains.',
    severity: 'info',
    category: 'hygiene',
  },
  {
    id: 'GET_WITH_BODY',
    title: 'GET or HEAD request with a body',
    description: 'GET/HEAD requests carry a request body, which many servers, proxies, and CDNs silently drop.',
    recommendation: 'Move the payload to query parameters or switch the request to POST.',
    severity: 'info',
    category: 'hygiene',
  },
  {
    id: 'SUPPRESSION_EXPIRED',
    title: 'Expired suppression',
    description: 'A suppression passed its expiry date and no longer hides anything, so the findings it covered are active again.',
    recommendation: 'Fix the underlying findings, or review the suppression and set a new expiry date with a fresh reason.',
    severity: 'info',
    category: 'hygiene',
  },
  {
    id: 'SUPPRESSION_INVALID',
    title: 'Malformed suppression',
    description:
      'A postscope-ignore line in a description is missing a reason, names an unknown rule, or has a bad expiry date, so it was not applied.',
    recommendation: 'Use "postscope-ignore RULE_ID: reason", optionally with expires=YYYY-MM-DD after the rule id.',
    severity: 'info',
    category: 'hygiene',
  },
]

export const RULES: Record<RuleId, RuleDefinition> = Object.fromEntries(
  definitions.map((definition) => [definition.id, definition])
) as Record<RuleId, RuleDefinition>

export const RULE_LIST: RuleDefinition[] = definitions

export function isRuleId(value: unknown): value is RuleId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(RULES, value)
}

export function getRule(id: string): RuleDefinition | undefined {
  return isRuleId(id) ? RULES[id] : undefined
}
