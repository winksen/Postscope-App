/**
 * Maintenance commands for the shared library folder.
 *
 *   node dist-node/library.js status             how many records are plaintext or encrypted, and with which key
 *   node dist-node/library.js encrypt [--dry-run]  encrypt plaintext records and rewrite records sealed with an old key
 *
 * Reads the same settings as the server (LIBRARY_ENCRYPTION_KEY[_FILE], LIBRARY_ENCRYPTION_KEY_PREVIOUS[_FILE],
 * DATA_DIR, .env). Run it while the server is stopped, or restart the server afterwards so its cache is rebuilt.
 * From a clone: `npm run library:encrypt`.
 */
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ensureAppEnv } from './loadEnv'
import { getLibraryDir, getLibraryEncryption } from './runtimeConfig'
import { libraryStatus, migrateLibrary } from './libraryMaintenance'

const HELP = `PostScope library maintenance

Usage: library <status | encrypt> [--dry-run]

  status     Count records by storage (plaintext, encrypted, per key)
  encrypt    Encrypt plaintext records and rewrite records sealed with an older key (--dry-run shows what would change)

Exit codes: 0 done, 1 some records failed, 2 usage or configuration error.
`

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv
  if (!command || command === '-h' || command === '--help') {
    if (command) {
      process.stdout.write(HELP)
      return 0
    }
    process.stderr.write(HELP)
    return 2
  }
  ensureAppEnv()
  const dir = getLibraryDir()

  if (command === 'status') {
    const status = await libraryStatus(dir)
    const state = getLibraryEncryption()
    process.stdout.write(`Library folder: ${dir}\n`)
    process.stdout.write(
      `Records: ${status.records} (${status.plaintext} plaintext, ${status.encrypted} encrypted, ${status.unreadable.length} unreadable)\n`
    )
    for (const [kid, count] of Object.entries(status.byKey)) {
      const label =
        state.enabled && 'keys' in state
          ? kid === state.keys.current.id
            ? 'current key'
            : state.keys.previous.some((key) => key.id === kid)
              ? 'previous key'
              : 'key not configured'
          : 'no key configured'
      process.stdout.write(`  key ${kid}: ${count} (${label})\n`)
    }
    process.stdout.write(
      `Encryption: ${state.enabled ? ('error' in state ? `misconfigured (${state.error})` : `on, current key ${state.keys.current.id}`) : 'off'}\n`
    )
    return status.unreadable.length ? 1 : 0
  }

  if (command === 'encrypt') {
    const unknown = rest.filter((arg) => arg !== '--dry-run')
    if (unknown.length) {
      process.stderr.write(`Unknown option "${unknown[0]}"\n\n${HELP}`)
      return 2
    }
    const state = getLibraryEncryption()
    if (!state.enabled) {
      process.stderr.write('Set LIBRARY_ENCRYPTION_KEY (or LIBRARY_ENCRYPTION_KEY_FILE) before encrypting the library.\n')
      return 2
    }
    if ('error' in state) {
      process.stderr.write(`Library encryption is misconfigured: ${state.error}\n`)
      return 2
    }
    const dryRun = rest.includes('--dry-run')
    const report = await migrateLibrary(dir, state.keys, { dryRun })
    process.stdout.write(
      `${dryRun ? 'Dry run: ' : ''}${report.scanned} record(s) scanned, ${report.encrypted} ${dryRun ? 'to encrypt' : 'encrypted'}, ${report.rotated} ${dryRun ? 'to rewrite' : 'rewritten'} with the current key, ${report.alreadyCurrent} already current, ${report.failed.length} failed\n`
    )
    for (const failure of report.failed) process.stderr.write(`  ${failure.id}: ${failure.reason}\n`)
    if (!dryRun && (report.encrypted || report.rotated)) process.stdout.write('Restart the server so it reloads the library.\n')
    return report.failed.length ? 1 : 0
  }

  process.stderr.write(`Unknown command "${command}"\n\n${HELP}`)
  return 2
}

function isEntryPoint(): boolean {
  if (!process.argv[1]) return false
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isEntryPoint()) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code
    },
    (error) => {
      process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`)
      process.exitCode = 2
    }
  )
}
