import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { SAMPLES_DIR, pagesNav } from './helpers'

// Mode matrix: the summary on the import screen must match what the page really sends and stores. The server under
// test runs in static mode, so /api/config and the library endpoint are answered by the test.

const SESSION_KEY = 'postscope:collection-session'
const ENV_SENTINEL = 'ENV-SENTINEL-VALUE'

interface Scenario {
  name: string
  loggingMode: 'off' | 'hybrid' | 'on'
  storage?: 'incognito' | 'history'
  /** The person ticks "keep this collection for refresh". */
  keep?: boolean
  uploads: boolean
  session: boolean
  /** A keep checkbox is offered. */
  offersKeep: boolean
}

const SCENARIOS: Scenario[] = [
  { name: 'off', loggingMode: 'off', uploads: false, session: false, offersKeep: false },
  { name: 'hybrid, incognito', loggingMode: 'hybrid', storage: 'incognito', uploads: false, session: false, offersKeep: false },
  { name: 'hybrid, save to history', loggingMode: 'hybrid', storage: 'history', uploads: true, session: false, offersKeep: true },
  {
    name: 'hybrid, save to history and keep',
    loggingMode: 'hybrid',
    storage: 'history',
    keep: true,
    uploads: true,
    session: true,
    offersKeep: true,
  },
  { name: 'on', loggingMode: 'on', uploads: true, session: false, offersKeep: true },
  { name: 'on, keep for refresh', loggingMode: 'on', keep: true, uploads: true, session: true, offersKeep: true },
]

async function mockServer(page: Page, loggingMode: Scenario['loggingMode']) {
  const uploads: string[] = []
  await page.route('**/api/config', (route) =>
    route.fulfill({
      json: {
        appVersion: 'test',
        loggingMode,
        publicLandingPage: false,
        maxCollectionBytes: 15_000_000,
        libraryAllowDelete: true,
        libraryRedactSecrets: false,
        libraryEncrypted: false,
      },
    })
  )
  await page.route('**/api/collections**', (route) => {
    if (route.request().method() === 'POST') {
      uploads.push(route.request().postData() ?? '')
      return route.fulfill({
        status: 201,
        json: { id: 'mock-1', name: 'Mock', savedAt: Date.now(), requestCount: 1, size: 1, deduplicated: false },
      })
    }
    return route.fulfill({ json: [] })
  })
  return uploads
}

const files = () => [
  {
    name: 'default.postman_collection.json',
    mimeType: 'application/json',
    buffer: fs.readFileSync(path.join(SAMPLES_DIR, 'default.postman_collection.json')),
  },
  {
    name: 'dev.postman_environment.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ name: 'dev', values: [{ key: 'token', value: ENV_SENTINEL, enabled: true }] })),
  },
]

const sessionValue = (page: Page) => page.evaluate((key) => window.sessionStorage.getItem(key), SESSION_KEY)

for (const scenario of SCENARIOS) {
  test(`data handling summary matches behavior: ${scenario.name}`, async ({ page }) => {
    const uploads = await mockServer(page, scenario.loggingMode)
    await page.goto('/')
    const summary = page.getByTestId('data-handling')
    await expect(summary).toBeVisible()

    if (scenario.storage) {
      await page.getByRole('button', { name: scenario.storage === 'history' ? 'Save to history' : 'Incognito' }).click()
    }
    if (scenario.loggingMode === 'hybrid' && scenario.storage === 'history') await page.locator('#upload-consent').click()

    const keepBox = page.locator('#keep-session')
    await expect(keepBox).toHaveCount(scenario.offersKeep ? 1 : 0)
    if (scenario.offersKeep) await expect(keepBox).not.toBeChecked()
    if (scenario.keep) await keepBox.click()

    await expect(summary).toHaveAttribute('data-uploads', String(scenario.uploads))
    await expect(summary).toHaveAttribute('data-session', String(scenario.session))
    await expect(summary.locator('[data-row=environments]')).toContainText('never sent to the server')
    await expect(summary.locator('[data-row=collection]')).toContainText(
      scenario.uploads ? 'Sent to the app server' : 'not sent to the app server'
    )
    await expect(summary.locator('[data-row=refresh]')).toContainText(scenario.session ? 'restored' : 'Nothing is kept')

    await page.setInputFiles('input[type=file]', files())
    await expect(pagesNav(page)).toBeVisible()

    expect(uploads.length, 'collection uploads').toBe(scenario.uploads ? 1 : 0)
    const stored = await sessionValue(page)
    expect(stored !== null, 'session copy').toBe(scenario.session)
    if (stored) expect(stored).toContain(ENV_SENTINEL)
    expect(uploads.join(' ')).not.toContain('ENV-SENTINEL')

    // A refresh restores the input only when it was kept; otherwise the import screen returns.
    await page.reload()
    if (scenario.session) {
      await expect(pagesNav(page)).toBeVisible()
      await expect(page.getByTestId('session-expiry')).toBeVisible()
    } else {
      await expect(page.getByTestId('data-handling')).toBeVisible()
      await expect(pagesNav(page)).toHaveCount(0)
    }
  })
}

test('Forget removes the kept copy and returns to the import screen', async ({ page }) => {
  await mockServer(page, 'on')
  await page.goto('/')
  await page.locator('#keep-session').click()
  await page.setInputFiles('input[type=file]', files())
  await expect(pagesNav(page)).toBeVisible()
  expect(await sessionValue(page)).toContain(ENV_SENTINEL)

  await page.getByRole('button', { name: 'Forget' }).click()
  await expect(page.getByTestId('data-handling')).toBeVisible()
  expect(await sessionValue(page)).toBeNull()
  await page.reload()
  await expect(page.getByTestId('data-handling')).toBeVisible()
  expect(await sessionValue(page)).toBeNull()
})

test('an expired copy is not restored and is removed from storage', async ({ page }) => {
  await mockServer(page, 'on')
  await page.goto('/')
  await page.locator('#keep-session').click()
  await page.setInputFiles('input[type=file]', files())
  await expect(pagesNav(page)).toBeVisible()
  await page.evaluate((key) => {
    const copy = JSON.parse(window.sessionStorage.getItem(key) as string)
    copy.expiresAt = Date.now() - 1000
    window.sessionStorage.setItem(key, JSON.stringify(copy))
  }, SESSION_KEY)

  await page.reload()
  await expect(page.getByTestId('data-handling')).toBeVisible()
  expect(await sessionValue(page)).toBeNull()
  expect(await page.evaluate(() => JSON.stringify({ ...window.localStorage, ...window.sessionStorage }))).not.toContain(ENV_SENTINEL)
})

test('turning keep for refresh off removes the stored copy', async ({ page }) => {
  await mockServer(page, 'on')
  await page.goto('/')
  await page.locator('#keep-session').click()
  await page.setInputFiles('input[type=file]', files())
  await expect(pagesNav(page)).toBeVisible()
  await page.getByRole('button', { name: 'Forget' }).click()
  await page.locator('#keep-session').click()
  await page.locator('#keep-session').click()
  expect(await sessionValue(page)).toBeNull()
})
