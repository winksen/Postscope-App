import { expect, test, type Page } from '@playwright/test'

// Upload consent is bound to the origin and the server's storage policy. The test answers /api/config itself and
// changes the policy between reloads.

interface Policy {
  loggingMode: 'hybrid' | 'on'
  libraryRedactSecrets: boolean
  libraryEncrypted: boolean
  libraryRetentionDays: number
}

async function serve(page: Page, policy: Policy) {
  await page.route('**/api/config', (route) =>
    route.fulfill({
      json: { appVersion: 'test', publicLandingPage: false, maxCollectionBytes: 15_000_000, libraryAllowDelete: true, ...policy },
    })
  )
  await page.route('**/api/collections**', (route) => route.fulfill({ json: [] }))
}

const base: Policy = { loggingMode: 'hybrid', libraryRedactSecrets: false, libraryEncrypted: false, libraryRetentionDays: 0 }

async function acceptUpload(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Save to history' }).click()
  await page.locator('#upload-consent').click()
  await expect(page.locator('#upload-consent')).toBeChecked()
}

test('unchanged consent is kept across reloads without asking again', async ({ page }) => {
  await serve(page, base)
  await acceptUpload(page)
  await page.reload()
  await page.getByRole('button', { name: 'Save to history' }).click()
  await expect(page.locator('#upload-consent')).toBeChecked()
  await expect(page.getByTestId('consent-stale')).toHaveCount(0)
})

for (const [name, change] of [
  ['credential removal is switched on', { libraryRedactSecrets: true }],
  ['encryption is switched on', { libraryEncrypted: true }],
  ['a retention period is set', { libraryRetentionDays: 30 }],
] as const) {
  test(`consent is asked for again when ${name}`, async ({ page }) => {
    await serve(page, base)
    await acceptUpload(page)
    await page.unroute('**/api/config')
    await serve(page, { ...base, ...change })
    await page.reload()
    await page.getByRole('button', { name: 'Save to history' }).click()
    await expect(page.locator('#upload-consent')).not.toBeChecked()
    await expect(page.getByTestId('consent-stale')).toBeVisible()
  })
}

test('consent given under an older version of the app does not carry over', async ({ page }) => {
  await serve(page, base)
  await page.goto('/')
  await page.evaluate(() => window.localStorage.setItem('postscope:upload-risk-accepted', 'true'))
  await page.reload()
  await page.getByRole('button', { name: 'Save to history' }).click()
  await expect(page.locator('#upload-consent')).not.toBeChecked()
})

test('forced team logging is shown as an operator policy without a consent checkbox', async ({ page }) => {
  await serve(page, { ...base, loggingMode: 'on', libraryRetentionDays: 14 })
  await page.goto('/')
  await expect(page.getByText('Operator policy.')).toBeVisible()
  await expect(page.locator('#upload-consent')).toHaveCount(0)
  await expect(page.locator('[data-row=collection]')).toContainText('deleted after 14 days')
})
