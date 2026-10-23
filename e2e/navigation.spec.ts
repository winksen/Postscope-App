import { expect, test } from '@playwright/test'
import { collectProblems, currentPath, goToPage, importFile, navigateInApp, pagesNav } from './helpers'

const SAMPLE = 'security-issues.postman_collection.json'

test('pages have their own addresses and back and forward move between them', async ({ page }) => {
  const problems = collectProblems(page)
  await importFile(page, SAMPLE)
  expect(currentPath(page)).toBe('/')

  await goToPage(page, 'Security')
  expect(currentPath(page)).toBe('/security')
  await goToPage(page, 'Requests')
  expect(currentPath(page)).toBe('/requests')

  await page.goBack()
  expect(currentPath(page)).toBe('/security')
  await expect(page.getByRole('heading', { level: 1, name: 'Security findings' })).toBeVisible()
  await page.goForward()
  expect(currentPath(page)).toBe('/requests')
  await expect(page.getByRole('heading', { level: 1, name: 'Requests explorer' })).toBeVisible()
  expect(problems).toEqual([])
})

test('selecting a request puts it in the address, and back clears it', async ({ page }) => {
  await importFile(page, SAMPLE)
  await goToPage(page, 'Requests')
  await page.getByRole('treeitem', { expanded: false }).first().click()
  await page.locator('[role="treeitem"]:not([aria-expanded])').first().click()
  expect(currentPath(page)).toMatch(/^\/requests\/.+/)
  const selectedAddress = currentPath(page)

  await page.goBack()
  expect(currentPath(page)).toBe('/requests')
  await page.goForward()
  expect(currentPath(page)).toBe(selectedAddress)
  await expect(page.getByRole('treeitem', { selected: true })).toHaveCount(1)
})

test('filters and the open finding come from the address', async ({ page }) => {
  await importFile(page, SAMPLE)
  await goToPage(page, 'Security')

  await navigateInApp(page, '/security?severity=critical&rule=HARDCODED_TOKEN')
  await expect(page.locator('tbody tr')).toHaveCount(1)
  await expect(page.getByRole('button', { name: /HARDCODED_TOKEN/ })).toBeVisible()

  await navigateInApp(page, '/security?finding=HARDCODED_TOKEN')
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(currentPath(page)).not.toContain('finding=')

  // Garbage in the address is ignored and unknown pages return to the dashboard.
  await navigateInApp(page, '/security?severity=bogus&rule=not%20a%20rule')
  await expect(page.locator('tbody tr').first()).toBeVisible()
  await navigateInApp(page, '/nonsense/page')
  await expect(pagesNav(page)).toBeVisible()
  expect(currentPath(page)).toBe('/')
})

test('the request tree works with the keyboard', async ({ page }) => {
  await importFile(page, SAMPLE)
  await goToPage(page, 'Requests')
  const folders = page.getByRole('treeitem', { expanded: true }).or(page.getByRole('treeitem', { expanded: false }))
  const first = folders.first()
  await first.focus()
  if ((await first.getAttribute('aria-expanded')) === 'false') await page.keyboard.press('ArrowRight')
  await expect(first).toHaveAttribute('aria-expanded', 'true')

  await page.keyboard.press('ArrowDown')
  await expect(page.locator('[role="treeitem"]:focus')).toHaveAttribute('aria-level', '2')
  await page.keyboard.press('ArrowLeft')
  await expect(page.locator('[role="treeitem"]:focus')).toHaveAttribute('aria-level', '1')
  await page.keyboard.press('ArrowLeft')
  await expect(page.locator('[role="treeitem"]:focus')).toHaveAttribute('aria-expanded', 'false')
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('[role="treeitem"]:focus')).toHaveAttribute('aria-expanded', 'true')

  // One row at a time is in the tab order.
  await expect(page.locator('[role="tree"] [tabindex="0"]')).toHaveCount(1)
  await page.keyboard.press('End')
  await expect(page.locator('[role="treeitem"]:focus')).toHaveCount(1)
})

test('slash and Control+K open search, Escape closes it, and typing in a field is left alone', async ({ page }) => {
  await importFile(page, SAMPLE)
  await page.locator('main').click({ position: { x: 600, y: 300 } })
  await page.keyboard.press('/')
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Search requests' })).toBeFocused()
  await page.keyboard.type('login')
  await expect(page.getByRole('option').first()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await page.keyboard.press('Control+k')
  await expect(page.getByRole('dialog')).toBeVisible()
  // A slash typed into the search field is text, not another shortcut.
  await page.keyboard.type('a/b')
  await expect(page.getByRole('combobox', { name: 'Search requests' })).toHaveValue('a/b')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // Choosing a result opens the request through its address.
  await page.keyboard.press('/')
  const search = page.getByRole('combobox', { name: 'Search requests' })
  await expect(search).toBeFocused()
  await page.keyboard.type('login')
  await expect(page.getByRole('option').first()).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/requests\/.+/)
})

test('changing rule settings and the environment re-audits without losing the page', async ({ page }) => {
  const problems = collectProblems(page)
  await importFile(page, SAMPLE)
  const security = pagesNav(page).getByRole('button', { name: /Security/ })
  const before = await security.innerText()

  await page.getByRole('button', { name: 'Audit rules' }).click()
  const boxes = page.getByRole('dialog').getByRole('checkbox')
  for (let index = 0; index < 6; index += 1) await boxes.nth(index).click()
  await page.getByRole('button', { name: 'Save rules' }).click()
  await expect.poll(async () => security.innerText()).not.toBe(before)
  expect(problems).toEqual([])
})
