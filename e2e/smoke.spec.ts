import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { parseCollection } from '../src/lib/parser'
import { cleanCollection } from '../tests/fixtures'
import { PAGES, SAMPLES, SAMPLES_DIR, collectProblems, goToPage, importFile, pagesNav } from './helpers'

for (const sample of SAMPLES) {
  test(`${sample}: imports and every page renders without errors`, async ({ page }) => {
    const problems = collectProblems(page)
    await importFile(page, sample)
    for (const name of PAGES) {
      await goToPage(page, name)
      await expect(page.locator('main h1').first(), `${name} has a heading`).toBeVisible()
    }
    expect(problems).toEqual([])
  })
}

const EXPORTS = [
  { label: 'Markdown (.md)', extension: '.md', check: (text: string) => expect(text).toMatch(/^# PostScope report/) },
  { label: 'HTML (.html)', extension: '.html', check: (text: string) => expect(text).toMatch(/<html/i) },
  {
    label: 'JSON (.json)',
    extension: '.json',
    check: (text: string) => expect(JSON.parse(text)).toMatchObject({ tool: { name: 'PostScope' }, reportVersion: 2 }),
  },
  { label: 'SARIF for CI (.sarif)', extension: '.sarif', check: (text: string) => expect(JSON.parse(text).version).toBe('2.1.0') },
  {
    label: 'Sanitized copy (secrets removed)',
    extension: '.json',
    check: (text: string) => expect(JSON.parse(text).item).toBeInstanceOf(Array),
  },
  {
    label: 'Identity inventory (.csv)',
    extension: '.csv',
    check: (text: string) => expect(text).toMatch(/^endpoint class,platform,method,url,request,findings/),
  },
  {
    label: 'Sanitized copy (remove personal data)',
    extension: '.json',
    check: (text: string) => expect(JSON.parse(text).item).toBeInstanceOf(Array),
  },
]

test('every export format downloads a valid file with no secret in it', async ({ page }) => {
  const problems = collectProblems(page)
  const sample = 'secrets-auth.postman_collection.json'
  const secret = 'sk_live_12345_EXPOSED_KEY'
  expect(fs.readFileSync(path.join(SAMPLES_DIR, sample), 'utf8')).toContain(secret)
  await importFile(page, sample)

  for (const format of EXPORTS) {
    await page.getByRole('button', { name: 'Export' }).click()
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: format.label }).click()])
    expect(path.extname(download.suggestedFilename()), format.label).toBe(format.extension)
    const text = fs.readFileSync((await download.path()) as string, 'utf8')
    expect(text.length, format.label).toBeGreaterThan(50)
    format.check(text)
    expect(text, `${format.label} must not contain the credential`).not.toContain(secret)
  }
  expect(problems).toEqual([])
})

test('secrets are masked in the page until they are revealed', async ({ page }) => {
  const sample = 'secrets-auth.postman_collection.json'
  const secret = 'sk_live_12345_EXPOSED_KEY'
  const parsed = parseCollection(JSON.parse(fs.readFileSync(path.join(SAMPLES_DIR, sample), 'utf8')))
  const request = parsed.requests.find((candidate) => candidate.headers.some((header) => header.value === secret))
  expect(request, 'the sample has a request with the key in a header').toBeTruthy()

  await importFile(page, sample)
  const hidden = async (where: string) => expect(await page.content(), `${where} must not contain the credential`).not.toContain(secret)

  await hidden('dashboard')
  await goToPage(page, 'Security')
  await hidden('security page')
  await page.getByRole('button', { name: /View/ }).first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await hidden('finding detail')
  await page.keyboard.press('Escape')

  await page.evaluate((id) => {
    window.history.pushState({}, '', `/requests/${encodeURIComponent(id)}`)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, request!.id)
  await expect(page.getByRole('treeitem', { selected: true })).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Reveal value' }).first()).toBeVisible()
  await hidden('request details')

  await page.getByRole('button', { name: 'Reveal value' }).first().click()
  expect(await page.content(), 'revealing is an explicit action').toContain(secret)
})

test('a high score celebrates on the Score page without breaking the content security policy', async ({ page }) => {
  const problems = collectProblems(page)
  await importFile(page, {
    name: 'clean.postman_collection.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(cleanCollection())),
  })
  await goToPage(page, 'Score')
  await expect(page.locator('main h1').first()).toBeVisible()
  // The confetti starts once the gauge passes 90 and runs for about two seconds on a canvas it creates itself.
  await expect(page.locator('canvas').first()).toBeAttached({ timeout: 10_000 })
  await page.waitForTimeout(2500)
  expect(problems.filter((problem) => /content security policy|Refused to/i.test(problem))).toEqual([])
  expect(problems).toEqual([])
})

test('the Identity page is offered for collections with identity content only', async ({ page }) => {
  const problems = collectProblems(page)
  await importFile(page, 'secrets-auth.postman_collection.json')
  const identity = pagesNav(page).getByRole('button', { name: /^Identity/ })
  await expect(identity).toBeVisible()
  await identity.click()
  await expect(page.locator('main h1').first()).toHaveText('Identity')
  await expect(page.getByText('OAuth clients').first()).toBeVisible()
  expect(page.url()).toContain('/identity')

  await importFile(page, 'default.postman_collection.json')
  await expect(pagesNav(page).getByRole('button', { name: /^Identity/ })).toHaveCount(0)
  expect(problems).toEqual([])
})
