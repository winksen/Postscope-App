import { expect, test } from '@playwright/test'
import { cleanCollection } from '../tests/fixtures'
import { pagesNav } from './helpers'

// With web workers unavailable the analysis would run on the page itself and freeze it. Small files are still
// analyzed that way; a large one is refused straight away and the page keeps responding.

const file = (name: string, collection: unknown) => ({
  name,
  mimeType: 'application/json',
  buffer: Buffer.from(JSON.stringify(collection)),
})

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'Worker', { value: undefined, configurable: true })
  })
})

test('a large file is refused promptly and the page stays usable, a small one still analyzes', async ({ page }) => {
  await page.goto('/')
  expect(await page.evaluate(() => typeof window.Worker)).toBe('undefined')

  const started = Date.now()
  await page.setInputFiles('input[type=file]', file('large.postman_collection.json', { ...cleanCollection(), note: 'x'.repeat(3_000_000) }))
  await expect(page.getByText(/could not start the analysis worker/)).toBeVisible({ timeout: 5000 })
  expect(Date.now() - started, 'refused promptly').toBeLessThan(8000)
  await expect(pagesNav(page)).toHaveCount(0)

  // The page still responds: it can switch the import mode and then analyze a small collection.
  await page.getByRole('button', { name: 'Paste JSON' }).click()
  await expect(page.getByRole('textbox').first()).toBeVisible()
  await page.getByRole('button', { name: 'Upload file' }).click()
  await page.setInputFiles('input[type=file]', file('small.postman_collection.json', cleanCollection()))
  await expect(pagesNav(page)).toBeVisible()
})
