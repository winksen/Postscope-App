/**
 * Enforces docs/VISUAL_STYLE.md: no em dash character (U+2014) anywhere in the project.
 *
 *   npm run check:style
 *
 * Checks every file tracked by git (or, outside a git checkout, every text file below the project), except the
 * lock file. The character is built from its code point so this file does not contain it.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// STYLE_CHECK_ROOT lets the tests point the check at a scratch folder.
const root = process.env.STYLE_CHECK_ROOT
  ? path.resolve(process.env.STYLE_CHECK_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const EM_DASH = String.fromCodePoint(0x2014)
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'dist-node', 'coverage', 'playwright-report', 'test-results', 'data'])
const SKIP_FILES = new Set(['package-lock.json'])
const BINARY = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|pdf|zip|gz)$/i

function trackedFiles() {
  try {
    const output = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    return output.split('\0').filter(Boolean)
  } catch {
    return null
  }
}

function walk(dir, found = []) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), found)
    } else {
      found.push(path.join(dir, entry.name))
    }
  }
  return found
}

const files = (trackedFiles() ?? walk('.')).filter((file) => !SKIP_FILES.has(path.basename(file)) && !BINARY.test(file))
const hits = []
for (const file of files) {
  const absolute = path.join(root, file)
  if (!fs.existsSync(absolute)) continue
  const lines = fs.readFileSync(absolute, 'utf8').split('\n')
  lines.forEach((line, index) => {
    if (line.includes(EM_DASH)) hits.push(`${file}:${index + 1}: ${line.trim().slice(0, 100)}`)
  })
}

if (hits.length) {
  console.error(
    `The em dash character is not used in this project (docs/VISUAL_STYLE.md). Use a colon, a comma or two sentences:\n${hits.join('\n')}`
  )
  process.exit(1)
}
console.log(`check:style passed (${files.length} files)`)
