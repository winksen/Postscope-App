/**
 * Postman variable helpers. Postman variable names may contain dashes, dots and spaces
 * (`{{base-url}}`, `{{auth.token}}`), and `{{$guid}}`-style names are built-in dynamic variables.
 */

const VARIABLE_REFERENCE_GLOBAL = /\{\{\s*([^{}]+?)\s*\}\}/g
const VARIABLE_REFERENCE = /\{\{[^{}]+\}\}/

export function hasVariableReference(value: string): boolean {
  return VARIABLE_REFERENCE.test(value)
}

/** True for empty values and values that reference a variable anywhere. */
export function isVariableOrEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true
  const text = String(value)
  return text.trim() === '' || hasVariableReference(text)
}

/** Names of user variables referenced in `text`; built-in `{{$dynamic}}` variables are excluded. */
export function extractVariableNames(text: string): string[] {
  if (!text || !text.includes('{{')) return []
  const names = new Set<string>()
  for (const match of text.matchAll(VARIABLE_REFERENCE_GLOBAL)) {
    const name = match[1].trim()
    if (name && !name.startsWith('$')) names.add(name)
  }
  return [...names]
}

/** Turns an arbitrary key (query param, header) into a readable Postman variable name. */
export function toVariableName(key: string, fallback = 'secret'): string {
  const cleaned = key
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^[_.-]+|[_.-]+$/g, '')
  return cleaned || fallback
}
