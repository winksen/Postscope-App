import { expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

export const SAMPLES_DIR = path.resolve('public/samples')
export const SAMPLES = fs.readdirSync(SAMPLES_DIR).filter((file) => file.endsWith('.postman_collection.json'))

/** The pages in the sidebar, in order. */
export const PAGES = ['Dashboard', 'Requests', 'Security', 'Hygiene', 'Repair', 'Score', 'Compare'] as const

/** Collects console errors and uncaught exceptions; a smoke test fails when any appear. */
export function collectProblems(page: Page): string[] {
  const problems: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => problems.push(`exception: ${error.message}`))
  return problems
}

export function pagesNav(page: Page) {
  return page.getByRole('navigation', { name: 'Pages' })
}

/** Opens the app, imports a file and waits for the dashboard. */
export async function importFile(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }) {
  await page.goto('/')
  await page.setInputFiles('input[type=file]', typeof file === 'string' ? path.join(SAMPLES_DIR, file) : file)
  await expect(pagesNav(page)).toBeVisible()
}

export async function goToPage(page: Page, name: (typeof PAGES)[number]) {
  await pagesNav(page).getByRole('button', { name }).click()
}

/** Turns off CSS transitions and animations, so colors are final when a test measures them (axe reads mid-transition colors). */
export async function settleStyles(page: Page) {
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' })
}

/** Changes the address without a reload, as a link click inside the app does. */
export async function navigateInApp(page: Page, url: string) {
  await page.evaluate((target) => {
    window.history.pushState({}, '', target)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, url)
}

export function currentPath(page: Page): string {
  const url = new URL(page.url())
  return url.pathname + url.search
}
