// Compiles the CLI and the server to plain ESM JavaScript so they run with `node` alone: no tsx, no TypeScript
// toolchain and no node_modules. Everything they import from src/ is bundled in.
//
//   npm run build:node                      -> dist-node/cli.js and dist-node/server.js
//   node scripts/build-node.mjs --outdir x  -> same files in another folder
//
// The GitHub Action (action.yml) repeats these esbuild options for the CLI; keep them in sync.
import { build } from 'esbuild'
import { chmodSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const flag = process.argv.indexOf('--outdir')
const outdir = path.resolve(flag === -1 ? path.join(root, 'dist-node') : process.argv[flag + 1])

const shared = {
  absWorkingDir: root,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  legalComments: 'none',
  logLevel: 'warning',
}

await build({ ...shared, entryPoints: { cli: 'cli/postscope.ts' }, outdir, banner: { js: '#!/usr/bin/env node' } })
await build({ ...shared, entryPoints: { server: 'server/index.ts' }, outdir })
chmodSync(path.join(outdir, 'cli.js'), 0o755)
console.log(`Built ${path.relative(root, path.join(outdir, 'cli.js'))} and ${path.relative(root, path.join(outdir, 'server.js'))}`)
