import { expect, test } from '@playwright/test'
import { collectProblems, goToPage, importFile } from './helpers'

function collectionWithRequests(folders: number, perFolder: number): Buffer {
  const item = Array.from({ length: folders }, (_, folder) => ({
    name: `Folder ${folder}`,
    item: Array.from({ length: perFolder }, (_, index) => ({
      name: `Request ${index}`,
      request: {
        method: ['GET', 'POST', 'PUT', 'DELETE'][index % 4],
        url: `https://api.example.com/f${folder}/r${index}`,
        description: 'Example.',
      },
    })),
  }))
  const info = { name: 'Large', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }
  return Buffer.from(JSON.stringify({ info, item }))
}

test('a collection with 6000 requests opens quickly and the tree only renders the rows on screen', async ({ page }) => {
  const problems = collectProblems(page)
  const started = Date.now()
  await importFile(page, { name: 'large.postman_collection.json', mimeType: 'application/json', buffer: collectionWithRequests(400, 15) })
  expect(Date.now() - started, 'import and first render').toBeLessThan(15_000)

  await goToPage(page, 'Requests')
  await page.getByRole('button', { name: 'Expand all folders' }).click()
  const rows = page.getByRole('treeitem')
  await expect(rows.first()).toBeVisible()
  expect(await rows.count()).toBeLessThan(80)
  await expect(page.getByRole('tree')).toHaveAttribute('aria-label', /Collection requests/)

  // Scrolling renders other rows, and End and Home reach the ends of the whole list.
  await page.getByRole('tree').evaluate((tree) => {
    tree.scrollTop = 36 * 3000
  })
  await expect(rows.first()).toHaveAttribute('data-row-index', /^(29\d\d|30\d\d)$/)
  expect(await rows.count()).toBeLessThan(80)

  await rows.nth(4).focus()
  await page.keyboard.press('End')
  await expect(page.locator('[role="treeitem"]:focus')).toHaveAttribute('data-row-index', '6399')
  await page.keyboard.press('Home')
  await expect(page.locator('[role="treeitem"]:focus')).toHaveAttribute('data-row-index', '0')

  // An address in the middle of the list scrolls to the request and selects it.
  await page.evaluate(() => {
    window.history.pushState({}, '', `/requests/${encodeURIComponent('Folder 250/Request 7')}`)
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await expect(page.getByRole('treeitem', { selected: true })).toHaveCount(1)
  expect(problems).toEqual([])
})
