import fs from 'node:fs'
import path from 'node:path'

/**
 * Turns the paths given on the command line into the list of files to scan: files stay as they are, directories
 * are searched for `*.postman_collection.json`, and glob patterns (`collections/**\/*.postman_collection.json`)
 * are expanded here so quoted patterns work on shells that do not expand them (CI runners, Windows).
 */
const COLLECTION_SUFFIX = '.postman_collection.json'
const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git'])
const MAX_DEPTH = 40
const MAX_ENTRIES = 200_000

export class NoMatchError extends Error {}

export function hasGlobMagic(value: string): boolean {
  return /[*?{}[\]]/.test(value)
}

/** Converts a glob to a regular expression on forward-slash paths: `**` crosses folders, `*` and `?` do not. */
export function globToPathRegExp(glob: string): RegExp {
  let source = ''
  let braces = 0
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i]
    if (char === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          source += '(?:.*/)?'
          i += 2
        } else {
          source += '.*'
          i += 1
        }
      } else source += '[^/]*'
    } else if (char === '?') source += '[^/]'
    else if (char === '{') {
      braces += 1
      source += '(?:'
    } else if (char === '}' && braces > 0) {
      braces -= 1
      source += ')'
    } else if (char === ',' && braces > 0) source += '|'
    else if (char === '[') {
      const end = glob.indexOf(']', i + 1)
      if (end === -1) source += '\\['
      else {
        source += `[${glob.slice(i + 1, end).replace(/\\/g, '\\\\')}]`
        i = end
      }
    } else source += char.replace(/[.+^$()|\\\]]/g, '\\$&')
  }
  return new RegExp(`^${source}$`)
}

/** The leading part of a glob that contains no wildcard, which is where the search starts. */
function staticBase(pattern: string): string {
  const segments = pattern.split('/')
  const fixed: string[] = []
  for (const segment of segments) {
    if (hasGlobMagic(segment)) break
    fixed.push(segment)
  }
  // The last segment of a pattern without wildcards is the file itself, not a folder to search.
  if (fixed.length === segments.length) fixed.pop()
  return fixed.join('/') || (pattern.startsWith('/') ? '/' : '.')
}

function* walk(directory: string, depth = 0, budget = { entries: 0 }): Generator<string> {
  if (depth > MAX_DEPTH) return
  let names: fs.Dirent[]
  try {
    names = fs.readdirSync(directory, { withFileTypes: true })
  } catch {
    return
  }
  names.sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of names) {
    if (++budget.entries > MAX_ENTRIES) return
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) yield* walk(full, depth + 1, budget)
    } else if (entry.isFile()) yield full
  }
}

const slashed = (value: string) => value.split(path.sep).join('/')

/** Expands one command line argument. */
export function expandInput(input: string): string[] {
  if (input === '-') return [input]
  if (fs.existsSync(input)) {
    if (!fs.statSync(input).isDirectory()) return [input]
    const found = [...walk(input)].filter((file) => file.endsWith(COLLECTION_SUFFIX))
    if (!found.length) throw new NoMatchError(`${input}: no *${COLLECTION_SUFFIX} files found in this folder`)
    return found
  }
  if (!hasGlobMagic(input)) return [input]

  const pattern = slashed(input)
  const base = staticBase(pattern)
  const matcher = globToPathRegExp(pattern.replace(/^\.\//, ''))
  const found = [...walk(base)].filter((file) => matcher.test(slashed(file).replace(/^\.\//, '')))
  if (!found.length) throw new NoMatchError(`${input}: no files match this pattern`)
  return found
}

/** Expands every argument, removes duplicates and keeps a stable order. */
export function expandInputs(inputs: string[]): string[] {
  const seen = new Set<string>()
  const files: string[] = []
  for (const input of inputs) {
    for (const file of expandInput(input)) {
      const key = file === '-' ? file : path.resolve(file)
      if (seen.has(key)) continue
      seen.add(key)
      files.push(file)
    }
  }
  return files
}

/** Environment and globals exports stored in the same folder as a collection, for `--auto-env`. */
export function findSiblingEnvironments(collectionFile: string): string[] {
  if (collectionFile === '-') return []
  const directory = path.dirname(collectionFile)
  try {
    return fs
      .readdirSync(directory)
      .filter((name) => /\.postman_(?:environment|globals)\.json$/i.test(name))
      .sort()
      .map((name) => path.join(directory, name))
  } catch {
    return []
  }
}
