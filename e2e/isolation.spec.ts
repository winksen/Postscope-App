import { expect, test, type Page } from '@playwright/test'
import { goToPage, pagesNav } from './helpers'

// Findings and scores always belong to the environment and rule settings that are selected now, however quickly the
// selection changes.

const collection = {
  info: { name: 'Environment isolation', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  item: [{ name: 'Users', request: { method: 'GET', url: '{{baseUrl}}/users', description: 'List users.', header: [] } }],
}
const environment = (name: string, baseUrl: string) => ({
  name: `${name} environment`,
  mimeType: 'application/json',
  buffer: Buffer.from(
    JSON.stringify({ name, values: [{ key: 'baseUrl', value: baseUrl, enabled: true }], _postman_variable_scope: 'environment' })
  ),
})

async function importWithEnvironments(page: Page) {
  await page.goto('/')
  await page.setInputFiles('input[type=file]', [
    { name: 'isolation.postman_collection.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(collection)) },
    { ...environment('Insecure', 'http://api.example.com'), name: 'insecure.postman_environment.json' },
    { ...environment('Secure', 'https://api.example.com'), name: 'secure.postman_environment.json' },
  ])
  await expect(pagesNav(page)).toBeVisible()
}

async function choose(page: Page, name: string) {
  await page.getByRole('combobox', { name: 'Active environment' }).click()
  await page.getByRole('option', { name, exact: true }).click()
}

async function insecureFindingShown(page: Page) {
  await goToPage(page, 'Security')
  await expect(page.getByText('Total findings')).toBeVisible()
  await page.waitForTimeout(300)
  return (await page.locator('main').innerText()).includes('travel unencrypted')
}

test('quickly switching environments ends on the environment that was chosen last', async ({ page }) => {
  await importWithEnvironments(page)
  expect(await insecureFindingShown(page), 'the first environment is the insecure one').toBe(true)

  for (const name of ['Secure', 'Insecure', 'Secure', 'Insecure', 'Secure']) await choose(page, name)
  await expect(page.getByRole('combobox', { name: 'Active environment' })).toContainText('Secure')
  await page.waitForTimeout(500)
  expect(await insecureFindingShown(page), 'findings follow the last choice').toBe(false)
  await expect(page.getByRole('combobox', { name: 'Active environment' })).toContainText('Secure')

  await choose(page, 'Insecure')
  await page.waitForTimeout(500)
  expect(await insecureFindingShown(page)).toBe(true)
})

test('a rule change right after an environment choice keeps that environment', async ({ page }) => {
  await importWithEnvironments(page)
  await choose(page, 'Secure')
  await page.getByRole('button', { name: 'Audit rules' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: /Save/ }).click()
  await page.waitForTimeout(800)
  expect(await insecureFindingShown(page), 'the chosen environment survives the rule change').toBe(false)
})
