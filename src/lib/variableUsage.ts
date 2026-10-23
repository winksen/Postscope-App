import type { ParsedCollection, ParsedRequest } from './parser'
import { activeEnvironmentOf } from './environment'
import { extractVariableNames } from './variables'

/**
 * Which `{{variables}}` a collection references, defines and sets. Shared by the auditor (undefined and unused
 * variable rules) and the Overview statistics, so the numbers on screen match the findings.
 */
export interface VariableReference {
  name: string
  /** Request that references the variable; empty for collection and folder level scripts and variable values. */
  requestId: string
  /** Where it appears: `url`, `header X`, `query`, `body`, `auth`, `pre-request script`, ... */
  place: string
}

export interface VariableUsage {
  /** Every variable name referenced by an enabled part of the collection (the ones Postman would resolve). */
  references: VariableReference[]
  /** Names referenced anywhere in the export, including disabled entries, auth owners and variable values. */
  referencedAnywhere: Set<string>
  /** Names defined at collection, folder, request, environment or globals level (not scope aware). */
  definedAnywhere: Set<string>
  /** Names set by `pm.*.set('name', ...)` in any script. */
  setByScripts: Set<string>
  /** A script sets a variable with a computed name, so some references cannot be resolved statically. */
  hasDynamicSets: boolean
  /** Referenced names that nothing defines or sets, with the references that use them. */
  undefinedNames: Map<string, VariableReference[]>
  /** Collection variables that nothing references. */
  unusedCollectionVariables: string[]
  /** True when an environment (not only globals) is loaded, so undefined names may simply live elsewhere. */
  environmentLoaded: boolean
}

const SCRIPT_GET = /pm\.(environment|collectionVariables|globals|variables|iterationData)\.(?:get|has)\(\s*(['"`])([^'"`\n]+)\2/g
const SCRIPT_SET = /pm\.(environment|collectionVariables|globals|variables)\.set\(\s*(['"`])([^'"`\n]+)\2/g
const SCRIPT_DYNAMIC_SET = /pm\.(?:environment|collectionVariables|globals|variables)\.set\(\s*[^'"`\s)]/
const SCRIPT_REPLACE_IN = /replaceIn\(\s*(['"`])([^'"`\n]*)\1/g

interface ScriptScan {
  gets: Array<{ scope: string; name: string }>
  sets: string[]
  inline: string[]
  dynamicSet: boolean
}

function scanScript(source: string | undefined): ScriptScan {
  const scan: ScriptScan = { gets: [], sets: [], inline: [], dynamicSet: false }
  if (!source) return scan
  for (const match of source.matchAll(SCRIPT_GET)) scan.gets.push({ scope: match[1], name: match[3].trim() })
  for (const match of source.matchAll(SCRIPT_SET)) scan.sets.push(match[3].trim())
  for (const match of source.matchAll(SCRIPT_REPLACE_IN)) scan.inline.push(...extractVariableNames(match[2]))
  scan.dynamicSet = SCRIPT_DYNAMIC_SET.test(source)
  return scan
}

function requestParts(req: ParsedRequest): Array<{ place: string; text: string }> {
  return [
    { place: 'url', text: req.url },
    ...req.headers.map((header) => ({ place: `header ${header.key.trim()}`, text: `${header.key} ${header.value}` })),
    ...(req.pathVariables ?? []).map((variable) => ({ place: 'path variable', text: variable.value })),
    { place: 'body', text: req.bodyRaw ?? '' },
    {
      place: 'auth',
      text: [
        ...(req.authFields ?? []).map((field) => field.value),
        req.basicAuth ? `${req.basicAuth.username} ${req.basicAuth.password}` : '',
      ].join(' '),
    },
  ]
}

function disabledParts(req: ParsedRequest): string[] {
  return [
    ...(req.disabledHeaders ?? []).map((header) => `${header.key} ${header.value}`),
    ...(req.disabledQueryParams ?? []).map((param) => `${param.key} ${param.value}`),
    ...(req.disabledBodyFields ?? []).map((field) => `${field.key} ${field.value}`),
  ]
}

/** Folder and request variables are only visible inside their own folder or request. */
function scopedVariableVisible(variable: { scope: string; ownerPath: number[] }, req: ParsedRequest): boolean {
  if (variable.scope === 'request') return variable.ownerPath.join('.') === req.itemPath.join('.')
  return variable.ownerPath.length < req.itemPath.length && variable.ownerPath.every((index, position) => req.itemPath[position] === index)
}

export function analyzeVariableUsage(parsed: ParsedCollection): VariableUsage {
  const references: VariableReference[] = []
  const referencedAnywhere = new Set<string>()
  const setByScripts = new Set<string>()
  const iterationData = new Set<string>()
  let hasDynamicSets = false

  const note = (names: string[], requestId: string, place: string) => {
    for (const name of names) {
      references.push({ name, requestId, place })
      referencedAnywhere.add(name)
    }
  }
  const scanScriptInto = (source: string | undefined, requestId: string, place: string) => {
    const scan = scanScript(source)
    scan.sets.forEach((name) => setByScripts.add(name))
    scan.gets.forEach(({ scope, name }) => {
      if (scope === 'iterationData') iterationData.add(name)
      else note([name], requestId, place)
    })
    note(scan.inline, requestId, place)
    if (scan.dynamicSet) hasDynamicSets = true
  }

  for (const req of parsed.requests) {
    for (const part of requestParts(req)) note(extractVariableNames(part.text), req.id, part.place)
    for (const text of disabledParts(req)) extractVariableNames(text).forEach((name) => referencedAnywhere.add(name))
    scanScriptInto(req.scripts?.prerequest, req.id, 'pre-request script')
    scanScriptInto(req.scripts?.test, req.id, 'test script')
    for (const source of [req.scripts?.disabledPrerequest, req.scripts?.disabledTest]) {
      const scan = scanScript(source)
      scan.gets.forEach(({ name }) => referencedAnywhere.add(name))
      scan.sets.forEach((name) => setByScripts.add(name))
    }
    for (const response of req.savedResponses ?? []) {
      const text = [
        response.requestUrl,
        response.requestBody,
        ...response.requestHeaders.map((header) => `${header.key} ${header.value}`),
      ].join(' ')
      extractVariableNames(text).forEach((name) => referencedAnywhere.add(name))
    }
  }
  for (const script of parsed.scripts ?? []) {
    const place =
      script.listen === 'prerequest' ? 'pre-request script' : script.listen === 'test' ? 'test script' : `${script.listen} script`
    if (script.disabled) {
      const scan = scanScript(script.source)
      scan.gets.forEach(({ name }) => referencedAnywhere.add(name))
      scan.sets.forEach((name) => setByScripts.add(name))
    } else {
      scanScriptInto(script.source, '', `${script.owner === 'collection' ? 'collection' : `folder "${script.owner}"`} ${place}`)
    }
  }
  for (const owner of parsed.authOwners ?? []) {
    extractVariableNames(owner.fields.map((field) => field.value).join(' ')).forEach((name) => referencedAnywhere.add(name))
  }
  const valuesToScan = [
    ...(parsed.collectionVariables ?? []).map((variable) => variable.value),
    ...(parsed.scopedVariables ?? []).map((variable) => variable.value),
    ...(parsed.environments ?? []).flatMap((environment) => environment.variables.map((variable) => variable.value)),
  ]
  for (const value of valuesToScan) extractVariableNames(value).forEach((name) => referencedAnywhere.add(name))

  const active = activeEnvironmentOf(parsed)
  const globals = (parsed.environments ?? []).filter((environment) => environment.kind === 'globals')
  const environmentVariables = [...(active?.variables ?? []), ...globals.flatMap((environment) => environment.variables)].filter(
    (variable) => variable.enabled
  )
  const collectionDefined = new Set(
    (parsed.collectionVariables ?? []).filter((variable) => !variable.disabled).map((variable) => variable.key)
  )
  const environmentDefined = new Set(environmentVariables.map((variable) => variable.key))
  const definedAnywhere = new Set([
    ...collectionDefined,
    ...environmentDefined,
    ...(parsed.scopedVariables ?? []).filter((variable) => !variable.disabled).map((variable) => variable.key),
  ])

  const requestsById = new Map(parsed.requests.map((req) => [req.id, req]))
  const undefinedNames = new Map<string, VariableReference[]>()
  for (const reference of references) {
    const { name } = reference
    if (collectionDefined.has(name) || environmentDefined.has(name) || setByScripts.has(name) || iterationData.has(name)) continue
    const req = requestsById.get(reference.requestId)
    const scoped = (parsed.scopedVariables ?? []).some(
      (variable) =>
        !variable.disabled && variable.key === name && (req ? scopedVariableVisible(variable, req) : variable.scope === 'folder')
    )
    if (scoped) continue
    const list = undefinedNames.get(name) ?? []
    list.push(reference)
    undefinedNames.set(name, list)
  }

  const unusedCollectionVariables = [...new Set((parsed.collectionVariables ?? []).map((variable) => variable.key))].filter(
    (key) => !referencedAnywhere.has(key) && !iterationData.has(key)
  )

  return {
    references,
    referencedAnywhere,
    definedAnywhere,
    setByScripts,
    hasDynamicSets,
    undefinedNames,
    unusedCollectionVariables,
    environmentLoaded: !!active,
  }
}
