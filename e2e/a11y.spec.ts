import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { PAGES, goToPage, importFile, settleStyles } from './helpers'

/** Serious and critical axe violations, as short readable lines. */
async function violations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).analyze()
  return results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => `${violation.id} (${violation.nodes.length}): ${violation.nodes[0]?.target.join(' ')}`)
}

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`accessibility, ${colorScheme} theme`, () => {
    test.use({ colorScheme })

    test('import page and every page of the analyzer have no serious violations', async ({ page }) => {
      await page.goto('/')
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await settleStyles(page)
      expect(await violations(page), 'import page').toEqual([])

      await importFile(page, 'security-issues.postman_collection.json')
      await settleStyles(page)
      for (const name of PAGES) {
        await goToPage(page, name)
        await expect(page.locator('main h1').first()).toBeVisible()
        expect(await violations(page), name).toEqual([])
      }
    })

    test('dialogs and an open request have no serious violations', async ({ page }) => {
      await importFile(page, 'security-issues.postman_collection.json')
      await settleStyles(page)

      await page.keyboard.press('/')
      await expect(page.getByRole('dialog')).toBeVisible()
      expect(await violations(page), 'search dialog').toEqual([])
      await page.keyboard.press('Escape')

      await page.getByRole('button', { name: 'Audit rules' }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      expect(await violations(page), 'rules dialog').toEqual([])
      await page.keyboard.press('Escape')

      await goToPage(page, 'Security')
      await page.getByRole('button', { name: /View/ }).first().click()
      await expect(page.getByRole('dialog')).toBeVisible()
      expect(await violations(page), 'finding dialog').toEqual([])
      await page.keyboard.press('Escape')

      await goToPage(page, 'Requests')
      await page.getByRole('treeitem', { expanded: false }).first().click()
      await page.locator('[role="treeitem"]:not([aria-expanded])').first().click()
      expect(await violations(page), 'requests with a selection').toEqual([])
    })
  })
}
