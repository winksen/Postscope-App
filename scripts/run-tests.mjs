// Runs every tests/*.test.ts file with Node's built-in test runner through tsx.
// Listing files here (instead of a glob argument) keeps `npm test` working on Node 20 and 22.
import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const files = readdirSync('tests')
  .filter((file) => file.endsWith('.test.ts'))
  .sort()
  .map((file) => `tests/${file}`)

const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...process.argv.slice(2), ...files], { stdio: 'inherit' })
process.exit(result.status ?? 1)
