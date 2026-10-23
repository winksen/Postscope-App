import { expect, test } from '@playwright/test'
import { settleStyles } from '../e2e/helpers'

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(colorScheme, () => {
    test.use({ colorScheme, baseURL: 'http://127.0.0.1:3198' })
    test('landing and samples', async ({ page }) => {
      await page.goto('/')
      await page.waitForLoadState('networkidle')
      await settleStyles(page)
      await expect.soft(page).toHaveScreenshot(`landing-${colorScheme}.png`, { maxDiffPixelRatio: 0.004, fullPage: true })
      await page.goto('/samples')
      await page.waitForLoadState('networkidle')
      await settleStyles(page)
      await expect.soft(page).toHaveScreenshot(`samples-${colorScheme}.png`, { maxDiffPixelRatio: 0.004 })
    })
  })
}
