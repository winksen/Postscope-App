import { test } from 'node:test'
import assert from 'node:assert/strict'
import v8 from 'node:v8'
import { FAKE } from './fixtures'
import { parseCollection } from '../src/lib/parser'
import { runAudit } from '../src/lib/auditor'
import { MAX_DISPLAY_BODY, compactParsed } from '../src/lib/compactResult'
import { compareCollections } from '../src/lib/compare'

function collectionWithBigBody() {
  // The credential sits after the first 64 KB: only the full text can reveal it.
  const filler = JSON.stringify({ padding: 'x'.repeat(MAX_DISPLAY_BODY * 20) }).slice(0, -1)
  const raw = `${filler},"password":"${FAKE.password}"}`
  return {
    info: { name: 'Big body', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    item: [
      {
        name: 'Folder',
        item: [
          {
            name: 'Upload',
            request: { method: 'POST', url: 'https://api.example.com/upload', body: { mode: 'raw', raw }, description: 'Uploads.' },
          },
        ],
      },
      { name: 'Small', request: { method: 'GET', url: 'https://api.example.com/small', description: 'Small.' } },
    ],
  }
}

test('collections without large bodies are returned as they are', () => {
  const parsed = parseCollection({
    info: { name: 'S', schema: 'x' },
    item: [{ name: 'A', request: { method: 'GET', url: 'https://example.com/a' } }],
  })
  assert.equal(compactParsed(parsed), parsed)
})

test('large bodies are cut for display, flagged, and shared by requests and folders', () => {
  const parsed = parseCollection(collectionWithBigBody())
  const compact = compactParsed(parsed)
  const upload = compact.requests.find((request) => request.name === 'Upload')!
  assert.equal(upload.bodyRaw!.length, MAX_DISPLAY_BODY)
  assert.equal(upload.bodyTruncated, true)
  assert.ok(upload.bodySize! > MAX_DISPLAY_BODY)
  assert.equal(compact.requests.find((request) => request.name === 'Small')!.bodyTruncated, undefined)
  // The folder lists the compact request, not the original one.
  assert.equal(compact.folders[0].requests[0], upload)
  // The input is not modified: audits of the full collection keep working.
  assert.ok(parsed.requests.find((request) => request.name === 'Upload')!.bodyRaw!.length > MAX_DISPLAY_BODY)
  assert.equal(parsed.requests.find((request) => request.name === 'Upload')!.bodyTruncated, undefined)
})

test('findings come from the full body, and the compact copy is much smaller to send', () => {
  const parsed = parseCollection(collectionWithBigBody())
  const fullFindings = runAudit(parsed)
  assert.ok(
    fullFindings.some((finding) => finding.ruleId === 'HARDCODED_PASSWORD'),
    'the full body reveals the password'
  )

  const compact = compactParsed(parsed)
  const compactFindings = runAudit(compact)
  assert.ok(
    !compactFindings.some((finding) => finding.ruleId === 'HARDCODED_PASSWORD'),
    'which is why audits must not start from the compact copy'
  )

  const fullSize = v8.serialize(parsed).length
  const compactSize = v8.serialize(compact).length
  assert.ok(compactSize < fullSize / 10, `compact ${compactSize} vs full ${fullSize}`)
  assert.ok(compactSize < MAX_DISPLAY_BODY * 3)
})

test('comparison notices a change in a truncated body through its size', () => {
  const before = compactParsed(parseCollection(collectionWithBigBody()))
  const changedJson = collectionWithBigBody()
  const upload = (changedJson.item[0] as { item: Array<{ request: { body: { raw: string } } }> }).item[0]
  upload.request.body.raw = upload.request.body.raw.replace(FAKE.password, `${FAKE.password}-rotated`)
  const after = compactParsed(parseCollection(changedJson))
  const comparison = compareCollections({ parsed: before, findings: [] }, { parsed: after, findings: [] })
  assert.deepEqual(
    comparison.requests.changed.map((change) => change.fields),
    [['body']]
  )
})
