import { expect, test } from '@playwright/test'
import { cleanCollection } from '../tests/fixtures'
import { pagesNav } from './helpers'

// A large import can be cancelled; control returns at once and the next import is not mixed up with the cancelled one.

function heavyCollection(): Buffer {
  const item = Array.from({ length: 700 }, (_, folder) => ({
    name: `Heavy folder ${folder}`,
    item: Array.from({ length: 60 }, (_, index) => ({
      name: `Request ${index}`,
      request: {
        method: ['GET', 'POST', 'PUT', 'DELETE'][index % 4],
        url: `https://api.example.com/f${folder}/r${index}?token=abc${folder}`,
        header: [{ key: 'Authorization', value: `Bearer literal-${folder}-${index}` }],
        description: 'Example.',
      },
    })),
  }))
  return Buffer.from(
    JSON.stringify({
      info: { name: 'Heavy collection', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item,
    })
  )
}

test('cancelling a large import returns control within a second and the next import is clean', async ({ page }) => {
  await page.goto('/')
  await page.setInputFiles('input[type=file]', {
    name: 'heavy.postman_collection.json',
    mimeType: 'application/json',
    buffer: heavyCollection(),
  })

  const progress = page.getByTestId('analysis-progress')
  await expect(progress).toBeVisible()
  await expect(progress.getByRole('status')).toHaveText(/Reading the collection|Checking requests|Calculating the score/)

  const clicked = Date.now()
  await progress.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByTestId('analysis-progress')).toHaveCount(0)
  await expect(page.getByText('Analysis cancelled')).toBeVisible()
  expect(Date.now() - clicked, 'control returns within one second').toBeLessThan(1000)
  await expect(pagesNav(page)).toHaveCount(0)

  // Give the cancelled analysis time to misbehave, then import something else: only that result may appear.
  await page.waitForTimeout(1500)
  await expect(pagesNav(page)).toHaveCount(0)
  await page.setInputFiles('input[type=file]', {
    name: 'small.postman_collection.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({ ...cleanCollection(), info: { ...(cleanCollection().info as object), name: 'Small after cancel' } })
    ),
  })
  await expect(pagesNav(page)).toBeVisible()
  await expect(page.getByText('Small after cancel').first()).toBeVisible()
  await expect(page.getByText('Heavy collection')).toHaveCount(0)
})
