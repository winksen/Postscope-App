/** Compliance references a rule supports, in each framework's own control numbering. */
export interface RuleReferences {
  /** NIST SP 800-53 Rev. 5 controls. */
  nist80053?: string[]
  /** ISO/IEC 27001:2022 Annex A controls. */
  iso27001?: string[]
  /** CIS Critical Security Controls v8 safeguards. */
  cisV8?: string[]
  /** IETF RFC numbers. */
  rfc?: string[]
}

export interface RuleMetadata {
  tags: string[]
  references?: RuleReferences
}

const credential: RuleMetadata = {
  tags: ['credentials', 'secrets'],
  references: { nist80053: ['IA-5'], iso27001: ['A.5.17'], cisV8: ['5.2'] },
}

const configuration: RuleMetadata = {
  tags: ['configuration', 'variables'],
  references: { nist80053: ['CM-6'], iso27001: ['A.8.9'], cisV8: ['4.1'] },
}

/** Tags and compliance references of the core rules. Hygiene rules are about maintainability and carry tags only. */
export const CORE_RULE_METADATA: Record<string, RuleMetadata> = {
  HARDCODED_PASSWORD: credential,
  HARDCODED_TOKEN: credential,
  HARDCODED_API_KEY: credential,
  HARDCODED_SECRET: credential,
  HARDCODED_AUTH_CREDENTIAL: credential,
  SECRET_IN_SCRIPT: credential,
  SECRET_IN_COLLECTION_VARIABLE: credential,
  SECRET_IN_ENVIRONMENT: credential,
  SECRET_IN_SAVED_RESPONSE: { tags: ['credentials', 'secrets', 'examples'], references: credential.references },
  KNOWN_SECRET_PATTERN: credential,
  HIGH_ENTROPY_LITERAL: credential,
  SECRET_LOGGED_IN_SCRIPT: {
    tags: ['credentials', 'secrets', 'logging'],
    references: { nist80053: ['IA-5', 'AU-3'], iso27001: ['A.5.17', 'A.8.15'], cisV8: ['5.2'] },
  },
  SECRET_IN_QUERY: {
    tags: ['credentials', 'secrets', 'transport'],
    references: { nist80053: ['IA-5', 'SC-8'], iso27001: ['A.5.17', 'A.8.24'], cisV8: ['3.10'], rfc: ['6750'] },
  },
  CREDENTIALS_IN_URL: {
    tags: ['credentials', 'secrets', 'transport'],
    references: { nist80053: ['IA-5', 'SC-8'], iso27001: ['A.5.17', 'A.8.24'], cisV8: ['3.10'], rfc: ['3986'] },
  },
  HARDCODED_BASEURL: configuration,
  HARDCODED_ENV_URL: configuration,
  UNDEFINED_VARIABLE: configuration,
  MISSING_AUTH: {
    tags: ['authentication'],
    references: { nist80053: ['IA-2', 'AC-3'], iso27001: ['A.5.15', 'A.8.5'], cisV8: ['6.1'] },
  },
  BASIC_AUTH_PLAINTEXT: {
    tags: ['authentication', 'credentials'],
    references: { nist80053: ['IA-5', 'SC-8'], iso27001: ['A.5.17', 'A.8.5'], cisV8: ['5.2'], rfc: ['7617'] },
  },
  INSECURE_HTTP: {
    tags: ['transport', 'tls'],
    references: { nist80053: ['SC-8', 'SC-13'], iso27001: ['A.8.24'], cisV8: ['3.10'], rfc: ['8446'] },
  },
  TLS_VERIFICATION_DISABLED: {
    tags: ['transport', 'tls'],
    references: { nist80053: ['SC-8', 'SC-23'], iso27001: ['A.8.24'], cisV8: ['3.10'], rfc: ['6125'] },
  },
  INCONSISTENT_AUTH: { tags: ['authentication', 'maintainability'], references: { nist80053: ['IA-2'], iso27001: ['A.8.5'] } },
  MISSING_DESCRIPTION: { tags: ['documentation'] },
  NO_COLLECTION_VARIABLES: { tags: ['variables', 'maintainability'], references: configuration.references },
  UNUSED_COLLECTION_VARIABLE: { tags: ['variables', 'maintainability'], references: configuration.references },
  EMPTY_HEADERS: { tags: ['maintainability'] },
  DUPLICATE_REQUEST_NAMES: { tags: ['maintainability'] },
  PLACEHOLDER_REQUEST_NAMES: { tags: ['maintainability'] },
  ROOT_LEVEL_REQUESTS: { tags: ['maintainability'] },
  DEEP_FOLDER_NESTING: { tags: ['maintainability'] },
  GET_WITH_BODY: { tags: ['maintainability'] },
  SUPPRESSION_EXPIRED: { tags: ['governance', 'suppressions'] },
  SUPPRESSION_INVALID: { tags: ['governance', 'suppressions'] },
}

export function coreMetadataFor(id: string): RuleMetadata {
  return CORE_RULE_METADATA[id] ?? { tags: [] }
}
