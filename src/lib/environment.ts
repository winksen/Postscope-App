import type { ParsedCollection } from './parser'

/**
 * Postman environment (`*.postman_environment.json`) and globals (`*.postman_globals.json`) exports.
 * They carry the values collections only reference (tenant URLs, client secrets, tokens), and Postman exports
 * `secret` typed variables in clear text, so they need the same scrutiny as the collection.
 */
export type EnvironmentKind = 'environment' | 'globals'

export interface ParsedEnvironmentVariable {
  key: string
  value: string
  /** Postman variable type: `default`, `secret` or `any`. */
  type?: string
  enabled: boolean
}

export interface ParsedEnvironment {
  kind: EnvironmentKind
  name: string
  variables: ParsedEnvironmentVariable[]
}

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** Postman values may be numbers or booleans; objects and arrays carry no usable literal. */
function asText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

/** Returns what kind of environment export the JSON is, or null when it is not one (for example a collection). */
export function detectEnvironmentKind(json: unknown, fileName?: string): EnvironmentKind | null {
  if (!isRecord(json) || !Array.isArray(json.values) || Array.isArray(json.item)) return null
  const scope = typeof json._postman_variable_scope === 'string' ? json._postman_variable_scope.toLowerCase() : ''
  if (scope === 'globals') return 'globals'
  if (scope === 'environment') return 'environment'
  if (fileName && /\.postman_globals\.json$/i.test(fileName)) return 'globals'
  return 'environment'
}

/** True for a Postman collection (has an `item` array). */
export function isCollectionJson(json: unknown): boolean {
  return isRecord(json) && Array.isArray(json.item)
}

export function parseEnvironment(json: unknown, fileName?: string): ParsedEnvironment {
  const kind = detectEnvironmentKind(json, fileName)
  if (!kind || !isRecord(json)) throw new Error('Invalid Postman environment format')
  const values = Array.isArray(json.values) ? json.values : []
  const variables = values
    .filter(isRecord)
    .map((entry) => ({
      key: asText(entry.key),
      value: asText(entry.value),
      type: typeof entry.type === 'string' ? entry.type : undefined,
      enabled: entry.enabled !== false,
    }))
    .filter((variable) => variable.key)
  const fallback = kind === 'globals' ? 'Globals' : 'Environment'
  return { kind, name: asText(json.name).trim() || fallback, variables }
}

/** Parses environment export texts and attaches them to a parsed collection. Unreadable files become warnings. */
export function attachEnvironments(parsed: ParsedCollection, rawTexts: readonly string[] | undefined): ParsedCollection {
  if (!rawTexts?.length) return parsed
  const environments: ParsedEnvironment[] = []
  const warnings = [...(parsed.parseWarnings ?? [])]
  rawTexts.forEach((raw, index) => {
    try {
      environments.push(parseEnvironment(JSON.parse(raw) as unknown))
    } catch {
      warnings.push(`Environment file ${index + 1} could not be read and was skipped.`)
    }
  })
  return { ...parsed, environments, activeEnvironment: firstEnvironmentIndex(environments), parseWarnings: warnings }
}

/** Index of the first non-globals environment, which is selected until the user picks another. */
export function firstEnvironmentIndex(environments: readonly ParsedEnvironment[]): number | undefined {
  const index = environments.findIndex((environment) => environment.kind === 'environment')
  return index === -1 ? undefined : index
}

/** Copy of the parsed collection with another environment selected (the audit must be re-run afterwards). */
export function withActiveEnvironment(parsed: ParsedCollection, index: number): ParsedCollection {
  const environment = parsed.environments?.[index]
  return environment?.kind === 'environment' ? { ...parsed, activeEnvironment: index } : parsed
}

/** The environment selected for resolving `{{variables}}` (never a globals file). */
export function activeEnvironmentOf(parsed: ParsedCollection): ParsedEnvironment | undefined {
  const environment = parsed.activeEnvironment === undefined ? undefined : parsed.environments?.[parsed.activeEnvironment]
  return environment?.kind === 'environment' ? environment : undefined
}

/**
 * Value of a variable using Postman's precedence for the scopes PostScope knows about:
 * selected environment, then collection variables, then globals. Disabled entries are ignored.
 */
export function lookupVariableValue(parsed: ParsedCollection, key: string): string | undefined {
  const fromEnvironment = activeEnvironmentOf(parsed)?.variables.find((variable) => variable.enabled && variable.key === key)
  if (fromEnvironment?.value) return fromEnvironment.value
  const fromCollection = parsed.collectionVariables?.find((variable) => !variable.disabled && variable.key === key)
  if (fromCollection?.value) return fromCollection.value
  for (const environment of parsed.environments ?? []) {
    if (environment.kind !== 'globals') continue
    const fromGlobals = environment.variables.find((variable) => variable.enabled && variable.key === key)
    if (fromGlobals?.value) return fromGlobals.value
  }
  return undefined
}
