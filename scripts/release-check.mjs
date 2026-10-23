// Fails when the release version differs between package.json, package-lock.json, the Dockerfile,
// compose.yaml and the newest CHANGELOG.md heading. Run by `npm run release:check` and in CI.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => readFileSync(path.join(root, file), 'utf8')

function firstMatch(file, pattern, label) {
  const match = pattern.exec(read(file))
  return { source: label ?? file, version: match ? match[1] : null }
}

const lock = JSON.parse(read('package-lock.json'))
const versions = [
  { source: 'package.json', version: JSON.parse(read('package.json')).version ?? null },
  { source: 'package-lock.json', version: lock.version ?? null },
  { source: 'package-lock.json (root package)', version: lock.packages?.['']?.version ?? null },
  firstMatch('Dockerfile', /^ARG APP_VERSION=(\S+)/m, 'Dockerfile ARG APP_VERSION'),
  firstMatch('compose.yaml', /POSTSCOPE_VERSION:-([^}\s]+)\}/, 'compose.yaml POSTSCOPE_VERSION default'),
  firstMatch('CHANGELOG.md', /^## (?:Update )?V?(\d+\.\d+\.\d+)/m, 'CHANGELOG.md newest heading'),
]

const expected = versions[0].version
const mismatches = versions.filter((entry) => entry.version !== expected)

if (!expected || mismatches.length > 0) {
  console.error('Release version mismatch:')
  for (const entry of versions) console.error(`  ${entry.source}: ${entry.version ?? 'missing'}`)
  process.exit(1)
}

console.log(`Release versions agree: ${expected}`)
