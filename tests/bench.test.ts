import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

test('the performance baseline is complete and CI enforces it', () => {
  const baseline = JSON.parse(fs.readFileSync('scripts/bench-baseline.json', 'utf8')) as {
    engine: { parseAuditRatio: number }
    bundle: Record<string, number>
  }
  assert.ok(baseline.engine.parseAuditRatio > 0)
  for (const key of ['landingJsGzip', 'analyzerJsGzip', 'dashboardJsGzip', 'workerJsGzip', 'cssGzip']) {
    assert.ok(baseline.bundle[key] > 0, key)
  }
  // The landing page must stay much lighter than the analyzer: it loads neither the parser nor the dashboard.
  assert.ok(baseline.bundle.landingJsGzip < baseline.bundle.analyzerJsGzip)
  assert.ok(baseline.bundle.analyzerJsGzip < baseline.bundle.dashboardJsGzip)

  const workflow = fs.readFileSync('.github/workflows/ci.yml', 'utf8')
  assert.match(workflow, /npm run bench -- --check/)
  assert.match(workflow, /upload-artifact/)
  assert.match(fs.readFileSync('package.json', 'utf8'), /"bench":/)
})

test('page chunks are loaded on demand', () => {
  const app = fs.readFileSync('src/pages/AnalyzeApp.tsx', 'utf8')
  for (const page of ['Overview', 'Requests', 'Security', 'Hygiene', 'Score', 'Repair', 'Compare']) {
    assert.match(app, new RegExp(`const ${page}Page = lazyPage\\(`), page)
    assert.doesNotMatch(app, new RegExp(`import \\{ ${page}Page \\}`), page)
  }
  const root = fs.readFileSync('src/App.tsx', 'utf8')
  assert.match(root, /const AnalyzeApp = lazy\(/)
  assert.doesNotMatch(root, /import \{ AnalyzeApp \}/)
  // Charts and animation libraries are imported only by lazily loaded code.
  for (const file of ['src/App.tsx', 'src/pages/LandingPage.tsx', 'src/main.tsx']) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /from 'recharts'|from 'framer-motion'/, file)
  }
})
