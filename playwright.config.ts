import { defineConfig } from '@playwright/test'

const port = Number(process.env.E2E_PORT ?? 3199)

/**
 * Browser tests run against the compiled server, so build first:
 *
 *   npm run build && npm run build:node && npm run test:e2e
 *
 * The browser comes from Playwright's own install (`npx playwright install chromium`). A machine with a preinstalled
 * Chromium sets PLAYWRIGHT_BROWSERS_PATH, or PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to the binary.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined },
  },
  webServer: {
    command: 'node dist-node/server.js',
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: { PORT: String(port), LOGGING_MODE: 'off', PUBLIC_LANDING_PAGE: 'false', HOST: '127.0.0.1' },
  },
})
