import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { parseCollection } from '../src/lib/parser'
import { SAMPLES_DIR, importFile } from './helpers'

// The export menu can switch every report to the external sharing profile. The browser run covers the formats a
// person downloads for sharing; the unit tests cover the same logic for every format.

const SAMPLE = 'iam-access-management.postman_collection.json'

test('external sharing profile removes names and hosts from downloaded reports', async ({ page }) => {
  const parsed = parseCollection(JSON.parse(fs.readFileSync(path.join(SAMPLES_DIR, SAMPLE), 'utf8')))
  const hosts = new Set(
    parsed.requests
      .map((request) => /^(?:https?:\/\/)?([^/:?#]+)/.exec(request.url)?.[1])
      .filter((host): host is string => !!host && host.includes('.') && !host.includes('{{'))
  )
  expect(hosts.size, 'the sample uses literal hosts').toBeGreaterThan(0)
  const names = [parsed.name, ...parsed.requests.map((request) => request.name).filter((name) => name.length > 12)]

  await importFile(page, SAMPLE)
  await page.getByRole('button', { name: 'Export' }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Share outside the organization' }).click()

  for (const label of ['Markdown (.md)', 'HTML (.html)', 'JSON (.json)', 'SARIF for CI (.sarif)']) {
    await page.getByRole('button', { name: 'Export' }).click()
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: label }).click()])
    expect(download.suggestedFilename(), label).toMatch(/^collection\.postscope\./)
    const text = fs.readFileSync((await download.path()) as string, 'utf8')
    for (const host of hosts) expect(text.toLowerCase(), `${label} leaks ${host}`).not.toContain(host.toLowerCase())
    for (const name of names) expect(text, `${label} leaks "${name}"`).not.toContain(name)
  }
})
