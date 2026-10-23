import { expect, test } from '@playwright/test'
import { PAGES, goToPage, importFile, settleStyles } from '../e2e/helpers'

const shot = { maxDiffPixelRatio: 0.004, animations: 'disabled' as const }

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(colorScheme, () => {
    test.use({ colorScheme })

    test('import page and every page', async ({ page }) => {
      await page.goto('/')
      await page.waitForLoadState('networkidle')
      await settleStyles(page)
      await expect.soft(page).toHaveScreenshot(`import-${colorScheme}.png`, shot)

      await importFile(page, 'security-issues.postman_collection.json')
      await settleStyles(page)
      for (const name of PAGES) {
        await goToPage(page, name)
        await page.waitForTimeout(900)
        await expect.soft(page).toHaveScreenshot(`page-${name}-${colorScheme}.png`, { ...shot, fullPage: false })
      }
      await goToPage(page, 'Requests')
      await page.getByRole('treeitem', { expanded: false }).first().click()
      await page.locator('[role="treeitem"]:not([aria-expanded])').first().click()
      await page.waitForTimeout(500)
      await expect.soft(page).toHaveScreenshot(`requests-selected-${colorScheme}.png`, shot)
    })

    test('dialogs', async ({ page }) => {
      await importFile(page, 'security-issues.postman_collection.json')
      await settleStyles(page)
      await page.keyboard.press('/')
      await page.keyboard.type('login')
      await page.waitForTimeout(400)
      await expect.soft(page).toHaveScreenshot(`search-${colorScheme}.png`, shot)
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await page.getByRole('button', { name: 'Audit rules' }).click()
      await page.waitForTimeout(400)
      await expect.soft(page).toHaveScreenshot(`rules-${colorScheme}.png`, shot)
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await goToPage(page, 'Security')
      await page.getByRole('button', { name: /View/ }).first().click()
      await page.waitForTimeout(400)
      await expect.soft(page).toHaveScreenshot(`finding-${colorScheme}.png`, shot)
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: 'Export' }).click()
      await page.waitForTimeout(400)
      await expect.soft(page).toHaveScreenshot(`export-menu-${colorScheme}.png`, shot)
    })
  })
}
