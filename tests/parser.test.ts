import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCollection } from '../src/lib/parser'
import { kitchenSinkCollection } from './fixtures'

test('rejects input without an item array', () => {
  assert.throws(() => parseCollection(null), /Invalid Postman collection format/)
  assert.throws(() => parseCollection({ info: {} }), /Invalid Postman collection format/)
  assert.throws(() => parseCollection({ item: { not: 'array' } }), /Invalid Postman collection format/)
})

test('parses a malformed export without throwing and reports warnings', () => {
  const parsed = parseCollection(kitchenSinkCollection())
  assert.equal(parsed.totalRequests, 6)
  assert.ok(parsed.parseWarnings && parsed.parseWarnings.length >= 2)
  assert.ok(parsed.parseWarnings.some((warning) => warning.includes('Broken folder')))
})

test('keeps the historical request id scheme, including duplicate suffixes', () => {
  const parsed = parseCollection({
    info: { name: 'Ids' },
    item: [
      { name: 'Folder', item: [{ name: 'Same', request: { url: 'a' } }, { name: 'Same', request: { url: 'b' } }] },
      { name: 'Root request', request: { url: 'c' } },
    ],
  })
  assert.deepEqual(parsed.requests.map((r) => r.id), ['Folder/Same', 'Folder/Same#2', 'Root request'])
  assert.deepEqual(parsed.requests[1].itemPath, [0, 1])
})

test('resolves auth inheritance from folders and the collection', () => {
  const parsed = parseCollection(kitchenSinkCollection())
  const byName = new Map(parsed.requests.map((r) => [r.name, r]))

  const login = byName.get('Login')!
  assert.equal(login.auth, 'basic')
  assert.equal(login.authSource, 'folder')
  assert.deepEqual(login.authOwnerPath, [0])
  assert.equal(login.basicAuth?.username, 'svc')

  const list = byName.get('List users')!
  assert.equal(list.auth, 'noauth')
  assert.equal(list.authSource, 'request')

  const createUser = byName.get('Create user')!
  assert.equal(createUser.auth, 'apikey')
  assert.ok(createUser.authFields?.some((field) => field.key === 'value'))

  assert.equal(parsed.collectionAuthType, 'bearer')
  assert.equal(parsed.authOwners?.length, 2)
})

test('treats requests without auth as inheriting the collection auth', () => {
  const parsed = parseCollection({
    info: { name: 'Inherit' },
    auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}' }] },
    item: [{ name: 'A', request: { method: 'POST', url: '{{baseUrl}}/a' } }, { name: 'B', request: { method: 'POST', url: 'x', auth: { type: 'inherit' } } }],
  })
  assert.deepEqual(parsed.requests.map((r) => [r.auth, r.authSource]), [
    ['bearer', 'collection'],
    ['bearer', 'collection'],
  ])
  assert.deepEqual(parsed.authTypes, { bearer: 2 })
})

test('normalizes headers, query params, bodies, descriptions, scripts and responses', () => {
  const parsed = parseCollection(kitchenSinkCollection())
  const byName = new Map(parsed.requests.map((r) => [r.name, r]))

  const createUser = byName.get('Create user')!
  assert.deepEqual(createUser.headers.map((h) => h.key), ['Authorization', 'X-Plain'])

  const list = byName.get('List users')!
  assert.deepEqual(list.queryParams?.map((q) => q.key), ['api_key', 'page', 'pageToken'])
  assert.ok(list.scripts?.test?.includes('console.log'))

  const exchange = byName.get('Token exchange')!
  assert.equal(exchange.bodyMode, 'urlencoded')
  assert.deepEqual(exchange.bodyFields?.map((f) => f.key), ['grant_type', 'client_secret'])

  const withBody = byName.get('Get user with body')!
  assert.equal(withBody.hasDescription, true)

  const login = byName.get('Login')!
  assert.equal(login.savedResponses?.length, 1)
  assert.equal(login.savedResponses?.[0].requestHeaders[0].key, 'Authorization')
  assert.equal(login.tlsVerificationDisabled, true)

  assert.equal(parsed.scripts?.[0].owner, 'collection')
})

test('extracts variables with dashes and dots but skips dynamic variables', () => {
  const parsed = parseCollection({
    info: { name: 'Vars' },
    item: [{ name: 'A', request: { url: '{{base-url}}/x/{{$guid}}', header: [{ key: 'Authorization', value: 'Bearer {{auth.token}}' }] } }],
  })
  assert.ok(parsed.variables.includes('base-url'))
  assert.ok(parsed.variables.includes('auth.token'))
  assert.ok(!parsed.variables.some((name) => name.startsWith('$')))
})

test('builds URLs from object form with path segment objects', () => {
  const parsed = parseCollection({
    info: { name: 'Url' },
    item: [{ name: 'A', request: { url: { host: ['api', 'example', 'com'], path: ['v1', { value: 'users' }] } } }],
  })
  assert.equal(parsed.requests[0].url, 'api.example.com/v1/users')
})

test('guards against pathological nesting depth', () => {
  let item: Record<string, unknown> = { name: 'leaf', request: { url: 'x' } }
  for (let i = 0; i < 150; i += 1) item = { name: `f${i}`, item: [item] }
  const parsed = parseCollection({ info: { name: 'Deep' }, item: [item] })
  assert.equal(parsed.totalRequests, 0)
  assert.ok(parsed.parseWarnings?.some((warning) => warning.includes('deeper than')))
})

test('keeps disabled headers, query params, form fields and events next to the active ones', () => {
  const parsed = parseCollection({
    info: { name: 'Disabled' },
    event: [{ listen: 'test', disabled: true, script: { exec: ['console.log(1)'] } }],
    item: [
      {
        name: 'R',
        event: [
          { listen: 'prerequest', script: { exec: ['active()'] } },
          { listen: 'prerequest', disabled: true, script: { exec: ['inactive()'] } },
        ],
        request: {
          method: 'POST',
          header: [
            { key: 'A', value: '1' },
            { key: 'B', value: '2', disabled: true },
          ],
          url: { raw: 'https://x.test/p?a=1', query: [{ key: 'a', value: '1' }, { key: 'b', value: '2', disabled: true }] },
          body: { mode: 'formdata', formdata: [{ key: 'f', value: 'v' }, { key: 'g', value: 'w', disabled: true }, { key: 'file', type: 'file', disabled: true }] },
        },
        response: [{ name: 'Ex', originalRequest: { header: [{ key: 'H', value: 'x', disabled: true }], url: 'https://x.test' } }],
      },
    ],
  })
  const [request] = parsed.requests
  assert.deepEqual(request.headers, [{ key: 'A', value: '1' }])
  assert.deepEqual(request.disabledHeaders, [{ key: 'B', value: '2' }])
  assert.deepEqual(request.queryParams, [{ key: 'a', value: '1' }])
  assert.deepEqual(request.disabledQueryParams, [{ key: 'b', value: '2' }])
  assert.deepEqual(request.bodyFields, [{ key: 'f', value: 'v' }])
  assert.deepEqual(request.disabledBodyFields, [{ key: 'g', value: 'w' }])
  assert.equal(request.scripts?.prerequest, 'active()')
  assert.equal(request.scripts?.disabledPrerequest, 'inactive()')
  assert.deepEqual(request.savedResponses?.[0].disabledRequestHeaders, [{ key: 'H', value: 'x' }])
  assert.equal(parsed.scripts?.[0].disabled, true)
})
