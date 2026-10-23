import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PAGE_IDS, buildAppPath, parseAppLocation, type AppLocation } from '../src/lib/appRoutes'

test('parses pages with and without a base path', () => {
  assert.deepEqual(parseAppLocation('/', '', ''), { page: 'overview' })
  assert.deepEqual(parseAppLocation('/analyze', '', '/analyze'), { page: 'overview' })
  assert.deepEqual(parseAppLocation('/analyze/', '', '/analyze'), { page: 'overview' })
  assert.deepEqual(parseAppLocation('/analyze/score', '', '/analyze'), { page: 'score' })
  assert.deepEqual(parseAppLocation('/score', '', ''), { page: 'score' })
  for (const page of PAGE_IDS) assert.equal(parseAppLocation(`/analyze/${page}`, '', '/analyze')?.page, page)
})

test('rejects addresses outside the analyzer', () => {
  assert.equal(parseAppLocation('/samples', '', ''), null)
  assert.equal(parseAppLocation('/other/score', '', '/analyze'), null)
  assert.equal(parseAppLocation('/analyzer', '', '/analyze'), null)
  assert.equal(parseAppLocation('/analyze/nope', '', '/analyze'), null)
  assert.equal(parseAppLocation('/analyze/score/extra', '', '/analyze'), null)
  assert.equal(parseAppLocation('/analyze/requests/a/b', '', '/analyze'), null)
})

test('reads filters and ignores unknown values', () => {
  assert.deepEqual(
    parseAppLocation(
      '/analyze/security',
      '?severity=critical&rule=HARDCODED_TOKEN&category=auth&view=suppressed&finding=MISSING_AUTH',
      '/analyze'
    ),
    {
      page: 'security',
      severity: 'critical',
      category: 'auth',
      rule: 'HARDCODED_TOKEN',
      finding: 'MISSING_AUTH',
      view: 'suppressed',
    }
  )
  assert.deepEqual(parseAppLocation('/analyze/security', '?severity=urgent&rule=not%20a%20rule&category=hygiene&view=other', '/analyze'), {
    page: 'security',
  })
  // The hygiene page has no category or view filter.
  assert.deepEqual(parseAppLocation('/analyze/hygiene', '?category=auth&view=suppressed&severity=info', '/analyze'), {
    page: 'hygiene',
    severity: 'info',
  })
  // Filters on other pages are ignored.
  assert.deepEqual(parseAppLocation('/analyze/score', '?severity=critical', '/analyze'), { page: 'score' })
})

test('request ids round trip, including slashes, spaces and dots', () => {
  for (const requestId of ['Users/List users', 'v1.2/Get item #3', 'Café/Crème', '100% sure?/a&b=c', 'a b']) {
    const path = buildAppPath('/analyze', { page: 'requests', requestId })
    assert.ok(!path.slice('/analyze/requests/'.length).includes('/'), path)
    const parsed = parseAppLocation(path, '', '/analyze')
    assert.deepEqual(parsed, { page: 'requests', requestId })
  }
  assert.equal(parseAppLocation('/analyze/requests/%E0%A4%A', '', '/analyze'), null)
})

test('building and parsing are inverse operations', () => {
  const cases: AppLocation[] = [
    { page: 'overview' },
    { page: 'requests' },
    { page: 'requests', requestId: 'Auth/Login' },
    { page: 'security', severity: 'warning', category: 'secrets', rule: 'HARDCODED_TOKEN', view: 'suppressed' },
    { page: 'security', finding: 'INSECURE_HTTP' },
    { page: 'hygiene', severity: 'info', rule: 'MISSING_DESCRIPTION' },
    { page: 'compare' },
  ]
  for (const base of ['', '/analyze']) {
    for (const location of cases) {
      const url = new URL(buildAppPath(base, location), 'https://example.test')
      assert.deepEqual(parseAppLocation(url.pathname, url.search, base), location)
    }
  }
  assert.equal(buildAppPath('', { page: 'overview' }), '/')
  assert.equal(buildAppPath('/analyze', { page: 'overview' }), '/analyze')
  assert.equal(
    buildAppPath('/analyze', { page: 'security', severity: 'critical', rule: 'HARDCODED_TOKEN' }),
    '/analyze/security?severity=critical&rule=HARDCODED_TOKEN'
  )
})

test('links carry no values: only ids, rule names and filter words', () => {
  const path = buildAppPath('/analyze', { page: 'security', severity: 'critical', rule: 'HARDCODED_TOKEN' })
  assert.match(path, /^\/analyze\/security\?severity=critical&rule=HARDCODED_TOKEN$/)
})

test('search shortcuts: Ctrl+K anywhere, slash only outside text fields and dialogs', async () => {
  const { isSearchShortcut, isTypingTarget } = await import('../src/lib/keyboard')
  const press = (key: string, extra: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; target: unknown }> = {}) => ({
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    target: { tagName: 'BODY' },
    ...extra,
  })

  assert.equal(isSearchShortcut(press('/')), true)
  assert.equal(isSearchShortcut(press('k', { ctrlKey: true })), true)
  assert.equal(isSearchShortcut(press('K', { metaKey: true })), true)
  assert.equal(isSearchShortcut(press('/', { target: { tagName: 'INPUT' } })), false)
  assert.equal(isSearchShortcut(press('/', { target: { tagName: 'textarea' } })), false)
  assert.equal(isSearchShortcut(press('/', { target: { tagName: 'DIV', isContentEditable: true } })), false)
  assert.equal(isSearchShortcut(press('/'), true), false)
  assert.equal(isSearchShortcut(press('k', { ctrlKey: true, target: { tagName: 'INPUT' } })), true)
  assert.equal(isSearchShortcut(press('/', { ctrlKey: true })), false)
  assert.equal(isSearchShortcut(press('a')), false)
  assert.equal(isTypingTarget(null), false)
})
