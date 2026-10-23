/**
 * A small JSON Schema validator for the subset the PostScope report schema uses: type, const, enum, required,
 * properties, additionalProperties, items, minItems, pattern, minimum, maximum, minLength and local `$ref`.
 * Keeping it in the repository avoids adding a validation dependency just for tests.
 */
type Schema = Record<string, unknown>

function typeOf(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number'
  return typeof value
}

function matchesType(value: unknown, type: string): boolean {
  const actual = typeOf(value)
  return actual === type || (type === 'number' && actual === 'integer')
}

export function validate(schema: Schema, value: unknown, root: Schema = schema, path = '$'): string[] {
  const errors: string[] = []
  if (typeof schema.$ref === 'string') {
    const target = schema.$ref.replace(/^#\//, '').split('/').reduce<unknown>((node, key) => (node as Record<string, unknown>)?.[key], root)
    if (!target) return [`${path}: unresolved reference ${schema.$ref}`]
    return validate(target as Schema, value, root, path)
  }
  if ('const' in schema && JSON.stringify(schema.const) !== JSON.stringify(value)) errors.push(`${path}: expected ${JSON.stringify(schema.const)}`)
  if (Array.isArray(schema.enum) && !schema.enum.some((option) => JSON.stringify(option) === JSON.stringify(value))) errors.push(`${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`)
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? (schema.type as string[]) : [schema.type as string]
    if (!types.some((type) => matchesType(value, type))) return [`${path}: expected ${types.join(' or ')} but got ${typeOf(value)}`]
  }
  if (typeof value === 'string') {
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: does not match ${schema.pattern}`)
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) errors.push(`${path}: shorter than ${schema.minLength}`)
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) errors.push(`${path}: below ${schema.minimum}`)
    if (typeof schema.maximum === 'number' && value > schema.maximum) errors.push(`${path}: above ${schema.maximum}`)
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) errors.push(`${path}: fewer than ${schema.minItems} items`)
    if (schema.items) value.forEach((item, index) => errors.push(...validate(schema.items as Schema, item, root, `${path}[${index}]`)))
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    for (const key of (schema.required as string[] | undefined) ?? []) if (!(key in record)) errors.push(`${path}: missing "${key}"`)
    const properties = (schema.properties as Record<string, Schema> | undefined) ?? {}
    for (const [key, child] of Object.entries(record)) {
      if (properties[key]) errors.push(...validate(properties[key], child, root, `${path}.${key}`))
      else if (schema.additionalProperties === false) errors.push(`${path}: unexpected property "${key}"`)
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') errors.push(...validate(schema.additionalProperties as Schema, child, root, `${path}.${key}`))
    }
  }
  return errors
}
