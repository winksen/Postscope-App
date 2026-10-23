import { defineConfig } from '@playwright/test'

/**
 * Screenshot comparison for styling changes (Tailwind or design token updates). Snapshots are not committed because they
 * depend on the operating system and fonts of the machine that took them:
 *
 *   git checkout <before>   && npm run build && npm run build:node && npm run test:visual -- --update-snapshots
 *   git checkout <after>    && npm run build && npm run build:node && npm run test:visual
 *
 * It covers the import page, every analyzer page, the main dialogs, the landing page and the samples page, in the
 * light and the dark theme. Failures leave `*-diff.png` files under `test-results/`.
 */
export default defineConfig({
  testDir: 'visual',
  timeout: 90_000,
  workers: 2,
  snapshotPathTemplate: 'visual/__screenshots__/{arg}{ext}',
  use: {
    baseURL: 'http://127.0.0.1:3199',
    viewport: { width: 1440, height: 900 },
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined },
  },
  webServer: [
    {
      command: 'node dist-node/server.js',
      url: 'http://127.0.0.1:3199/api/health',
      reuseExistingServer: true,
      env: { PORT: '3199', LOGGING_MODE: 'off', PUBLIC_LANDING_PAGE: 'false', HOST: '127.0.0.1' },
    },
    {
      command: 'node dist-node/server.js',
      url: 'http://127.0.0.1:3198/api/health',
      reuseExistingServer: true,
      env: { PORT: '3198', LOGGING_MODE: 'off', PUBLIC_LANDING_PAGE: 'true', HOST: '127.0.0.1' },
    },
  ],
})
