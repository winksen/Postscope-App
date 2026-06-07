/**
 * Generates a realistic messy Postman mega-collection.
 * Each top-level folder has its own structure, auth/method skew, and "team story".
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, '../public/samples/messy-large.postman_collection.json')

const MIN_REQUESTS = 120

let seed = 0
function rng() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff
}

function pick(arr) {
  return arr[Math.floor(rng() * arr.length)]
}

function pickWeighted(entries) {
  const total = entries.reduce((s, e) => s + e.weight, 0)
  let r = rng() * total
  for (const e of entries) {
    r -= e.weight
    if (r <= 0) return e.value
  }
  return entries.at(-1).value
}

function folder(name, ...children) {
  return { name, item: children.filter(Boolean) }
}

function req(name, opts) {
  const {
    method = 'GET',
    auth = 'noauth',
    url,
    body,
    graphql,
    description,
    basicCreds,
    extraHeaders = [],
  } = opts

  const request = { method, auth: { type: auth }, url }

  if (graphql) {
    request.header = [{ key: 'Content-Type', value: 'application/json' }, ...extraHeaders]
    request.body = { mode: 'graphql', graphql }
  } else if (body) {
    request.header = [{ key: 'Content-Type', value: 'application/json' }, ...extraHeaders]
    request.body = { mode: 'raw', raw: typeof body === 'string' ? body : JSON.stringify(body) }
  } else if (extraHeaders.length) {
    request.header = extraHeaders
  }
  if (auth === 'bearer') {
    request.header = [...(request.header || []), { key: 'Authorization', value: 'Bearer {{token}}' }]
  }
  if (auth === 'apikey') {
    request.header = [...(request.header || []), { key: 'X-Api-Key', value: '{{apiKey}}' }]
  }
  if (auth === 'basic' && basicCreds) {
    request.auth = {
      type: 'basic',
      basic: [
        { key: 'username', value: basicCreds.username },
        { key: 'password', value: basicCreds.password },
      ],
    }
  }
  if (description) request.description = description

  return { name, request }
}

function makeFromProfile(name, profile, url, extra = {}) {
  const method = pickWeighted(profile.methods)
  const auth = pickWeighted(profile.auths)
  return req(name, { method, auth, url, ...extra })
}

// --- Collection profiles (skewed method + auth distributions) ---

const PROFILES = {
  prodRest: {
    methods: [
      { value: 'GET', weight: 50 },
      { value: 'POST', weight: 20 },
      { value: 'PATCH', weight: 10 },
      { value: 'PUT', weight: 5 },
      { value: 'DELETE', weight: 5 },
      { value: 'HEAD', weight: 6 },
      { value: 'OPTIONS', weight: 4 },
    ],
    auths: [
      { value: 'bearer', weight: 72 },
      { value: 'apikey', weight: 15 },
      { value: 'oauth2', weight: 8 },
      { value: 'noauth', weight: 5 },
    ],
  },
  deprecatedFlat: {
    methods: [
      { value: 'GET', weight: 30 },
      { value: 'POST', weight: 30 },
      { value: 'PUT', weight: 12 },
      { value: 'DELETE', weight: 10 },
      { value: 'PATCH', weight: 5 },
      { value: 'HEAD', weight: 8 },
      { value: 'OPTIONS', weight: 5 },
    ],
    auths: [
      { value: 'basic', weight: 45 },
      { value: 'noauth', weight: 30 },
      { value: 'bearer', weight: 15 },
      { value: 'apikey', weight: 10 },
    ],
  },
  mobileBff: {
    methods: [
      { value: 'GET', weight: 72 },
      { value: 'POST', weight: 18 },
      { value: 'HEAD', weight: 6 },
      { value: 'OPTIONS', weight: 3 },
      { value: 'PATCH', weight: 1 },
    ],
    auths: [
      { value: 'bearer', weight: 92 },
      { value: 'noauth', weight: 8 },
    ],
  },
  internalOps: {
    methods: [
      { value: 'POST', weight: 38 },
      { value: 'DELETE', weight: 22 },
      { value: 'PATCH', weight: 20 },
      { value: 'GET', weight: 15 },
      { value: 'PUT', weight: 5 },
    ],
    auths: [
      { value: 'basic', weight: 50 },
      { value: 'apikey', weight: 35 },
      { value: 'bearer', weight: 10 },
      { value: 'noauth', weight: 5 },
    ],
  },
  partnerApi: {
    methods: [
      { value: 'GET', weight: 40 },
      { value: 'POST', weight: 35 },
      { value: 'PUT', weight: 12 },
      { value: 'DELETE', weight: 8 },
      { value: 'PATCH', weight: 5 },
    ],
    auths: [
      { value: 'apikey', weight: 55 },
      { value: 'oauth2', weight: 35 },
      { value: 'bearer', weight: 7 },
      { value: 'noauth', weight: 3 },
    ],
  },
  legacy: {
    methods: [
      { value: 'GET', weight: 62 },
      { value: 'POST', weight: 28 },
      { value: 'PUT', weight: 6 },
      { value: 'DELETE', weight: 4 },
    ],
    auths: [
      { value: 'noauth', weight: 70 },
      { value: 'basic', weight: 25 },
      { value: 'apikey', weight: 5 },
    ],
  },
  webhooks: {
    methods: [
      { value: 'POST', weight: 65 },
      { value: 'GET', weight: 20 },
      { value: 'PUT', weight: 10 },
      { value: 'DELETE', weight: 5 },
    ],
    auths: [
      { value: 'noauth', weight: 40 },
      { value: 'apikey', weight: 35 },
      { value: 'basic', weight: 15 },
      { value: 'bearer', weight: 10 },
    ],
  },
  scratch: {
    methods: [
      { value: 'GET', weight: 25 },
      { value: 'POST', weight: 25 },
      { value: 'PATCH', weight: 20 },
      { value: 'PUT', weight: 15 },
      { value: 'DELETE', weight: 15 },
    ],
    auths: [
      { value: 'noauth', weight: 30 },
      { value: 'bearer', weight: 25 },
      { value: 'basic', weight: 20 },
      { value: 'apikey', weight: 15 },
      { value: 'oauth2', weight: 10 },
    ],
  },
}

function buildAcmeV3() {
  const p = PROFILES.prodRest
  const b = '{{baseUrl}}/v3'
  return folder(
    'Acme Core API v3 [PRODUCTION]',
    folder(
      'Auth',
      makeFromProfile('Login', p, `${b}/auth/login`, { body: { email: '{{userEmail}}', password: '{{userPassword}}' }, description: 'Primary login' }),
      makeFromProfile('Refresh session', p, `${b}/auth/refresh`, { body: { refreshToken: '{{token}}' } }),
      makeFromProfile('Logout', p, `${b}/auth/logout`)
    ),
    folder(
      'Users',
      folder(
        'CRUD',
        makeFromProfile('List users', p, `${b}/users?page=1&limit=50`),
        makeFromProfile('Create user', p, `${b}/users`, { body: { name: 'Jane', role: 'member' } }),
        makeFromProfile('Get user by id', p, `${b}/users/{{userId}}`),
        makeFromProfile('Update user', p, `${b}/users/{{userId}}`, { body: { role: 'admin' } }),
        makeFromProfile('Delete user', p, `${b}/users/{{userId}}`)
      ),
      folder(
        'Permissions',
        makeFromProfile('List roles', p, `${b}/users/roles`),
        makeFromProfile('Assign role', p, `${b}/users/{{userId}}/roles`, { body: { roleId: 'role_admin' } })
      )
    ),
    folder(
      'Billing',
      makeFromProfile('List invoices', p, `${b}/billing/invoices`),
      makeFromProfile('Create invoice', p, `${b}/billing/invoices`, { body: { customerId: 'cus_1', amount: 9900 } }),
      folder(
        'Subscriptions',
        makeFromProfile('List subscriptions', p, `${b}/billing/subscriptions`),
        makeFromProfile('Cancel subscription', p, `${b}/billing/subscriptions/{{subId}}/cancel`)
      )
    ),
    folder(
      'Webhooks',
      makeFromProfile('Register webhook', p, `${b}/webhooks`, { body: { url: 'https://hooks.acme.io/in' } }),
      makeFromProfile('List deliveries', p, `${b}/webhooks/deliveries?status=failed`)
    ),
    makeFromProfile('Health check', p, `${b}/health`, { auth: 'noauth' }),
    req('Users CORS preflight', { method: 'OPTIONS', auth: 'noauth', url: `${b}/users` }),
    req('Billing HEAD probe', { method: 'HEAD', auth: 'bearer', url: `${b}/billing/invoices` })
  )
}

function buildAcmeV2Deprecated() {
  const p = PROFILES.deprecatedFlat
  const b = '{{baseUrl}}/v2'
  // Mostly flat - someone exported v2 and never reorganized
  return folder(
    'Acme Core API v2 - DEPRECATED',
    makeFromProfile('getUsers', p, `${b}/users`),
    makeFromProfile('getUsers_old', p, `${b}/users`),
    makeFromProfile('GET /users (duplicate)', p, `${b}/users`),
    makeFromProfile('create_user', p, `${b}/users`, { body: { name: 'test' } }),
    makeFromProfile('CREATE_USER', p, `${b}/users`, { body: { name: 'Test User' } }),
    makeFromProfile('deleteUser', p, `${b}/users/22`),
    makeFromProfile('Delete User copy', p, `${b}/users/22`),
    makeFromProfile('whoami', p, `${b}/whoami`),
    makeFromProfile('legacy ping', p, 'https://legacy-internal.example.net/api/ping'),
    makeFromProfile('bulk import users', p, `${b}/users/import`, { body: { csvUrl: 's3://bucket/users.csv' } }),
    folder(
      'misc - do not delete',
      makeFromProfile('temp endpoint', p, `${b}/misc/temp-fix-441`),
      makeFromProfile('another temp', p, `${b}/misc/temp-fix-441`),
      makeFromProfile('PATCH accounts (forgot why)', p, `${b}/accounts/patch-all`, { body: { force: true } })
    ),
    makeFromProfile('orphan at root', p, `${b}/unknown-endpoint`),
    req('v2 graphql (deprecated path)', {
      method: 'POST',
      auth: 'basic',
      url: `${b}/graphql`,
      graphql: { query: 'query { users { id email } }' },
    })
  )
}

function buildMobileBff() {
  const p = PROFILES.mobileBff
  const b = '{{baseUrl}}/bff/mobile'
  // Shallow, read-heavy - mobile team keeps everything near the root
  return folder(
    'Mobile BFF (iOS + Android)',
    makeFromProfile('Home feed', p, `${b}/feed?version=3`),
    makeFromProfile('Home feed v2 fallback', p, `${b}/feed?version=2`),
    makeFromProfile('Product carousel', p, `${b}/home/carousel`),
    makeFromProfile('Promo banner', p, `${b}/home/promo`),
    makeFromProfile('Cart summary', p, `${b}/cart/summary`),
    makeFromProfile('Add to cart', p, `${b}/cart/items`, { body: { sku: 'SKU-1', qty: 1 } }),
    makeFromProfile('Checkout preview', p, `${b}/checkout/preview`),
    makeFromProfile('Place order', p, `${b}/checkout/submit`, { body: { paymentMethod: 'apple_pay' } }),
    makeFromProfile('Push token register', p, `${b}/push/register`, { body: { token: '{{deviceToken}}' } }),
    makeFromProfile('Push preferences', p, `${b}/push/preferences`),
    makeFromProfile('Experiment flags', p, `${b}/experiments/active`),
    makeFromProfile('Deep link resolver', p, `${b}/deeplink/resolve?url={{deeplink}}`),
    folder(
      'iOS only',
      makeFromProfile('StoreKit receipt validate', p, `${b}/ios/receipt/validate`, { body: { receipt: 'base64...' } }),
      makeFromProfile('App Store review mode', p, `${b}/ios/review-mode`)
    ),
    makeFromProfile('Android FCM topic subscribe', p, `${b}/android/fcm/subscribe`, { body: { topic: 'promos' } }),
    req('Feed WebSocket handshake', { method: 'GET', auth: 'bearer', url: 'wss://realtime.acme-corp.io/bff/feed' }),
    req('Checkout OPTIONS', { method: 'OPTIONS', auth: 'noauth', url: `${b}/checkout/preview` })
  )
}

function buildInternalAdmin() {
  const p = PROFILES.internalOps
  const b = '{{baseUrl}}/internal/admin'
  return folder(
    'Internal Admin & Ops',
    folder(
      'Dashboard',
      makeFromProfile('Ops overview', p, `${b}/dashboard/overview`, { basicCreds: { username: 'ops_ro', password: 'readonly-2024' } }),
      folder(
        'Metrics',
        folder(
          'Daily rollup',
          folder(
            'By region',
            makeFromProfile('EU daily metrics', p, `${b}/metrics/daily/eu`),
            makeFromProfile('US daily metrics', p, `${b}/metrics/daily/us`)
          ),
          makeFromProfile('Global daily', p, `${b}/metrics/daily/global`)
        )
      )
    ),
    folder(
      'Audit Logs',
      makeFromProfile('Search audit events', p, `${b}/audit/search?q=login`),
      folder(
        'Exports',
        folder(
          'archive 2024',
          folder(
            'Q1',
            makeFromProfile('Download Q1 audit export', p, `${b}/audit/exports/2024/q1.csv`),
            makeFromProfile('Regenerate Q1 export', p, `${b}/audit/exports/2024/q1/regenerate`, { body: { reason: 'compliance' } })
          )
        )
      )
    ),
    folder(
      'Support Tools',
      makeFromProfile('Impersonate user', p, `${b}/support/impersonate`, { body: { userId: '{{userId}}' }, basicCreds: { username: 'support_lead', password: 'break-glass' } }),
      makeFromProfile('Force password reset', p, `${b}/support/users/{{userId}}/reset-password`, { body: { notify: false } }),
      makeFromProfile('Purge user cache', p, `${b}/support/cache/purge`, { body: { userId: '{{userId}}' } })
    ),
    makeFromProfile('Kill switch - payments', p, `${b}/ops/kill-switch/payments`, { body: { enabled: true } }),
    req('Audit export gRPC', {
      method: 'POST',
      auth: 'basic',
      url: `${b}/grpc/audit.AuditService/Export`,
      extraHeaders: [{ key: 'X-Protocol', value: 'grpc' }],
      body: { format: 'csv' },
      basicCreds: { username: 'ops_ro', password: 'readonly-2024' },
    })
  )
}

function buildPartnerIntegrations() {
  const p = PROFILES.partnerApi
  const b = '{{baseUrl}}/partners'
  return folder(
    'Partner Integrations',
    // OAuth flat at top - integration guide structure
    makeFromProfile('OAuth authorize', p, `${b}/oauth/authorize?client_id={{clientId}}`),
    makeFromProfile('OAuth token exchange', p, `${b}/oauth/token`, { body: { grant_type: 'authorization_code', code: '{{authCode}}' } }),
    makeFromProfile('OAuth revoke', p, `${b}/oauth/revoke`, { body: { token: '{{token}}' } }),
    folder(
      'Merchants',
      makeFromProfile('Create merchant', p, `${b}/merchants`, { body: { legalName: 'Acme LLC' } }),
      folder(
        'Onboarding',
        folder(
          'KYC',
          folder(
            'Documents',
            makeFromProfile('Upload KYC document', p, `${b}/merchants/{{merchantId}}/kyc/documents`, { body: { type: 'passport', url: 'https://...' } }),
            makeFromProfile('Verify KYC status', p, `${b}/merchants/{{merchantId}}/kyc/status`)
          ),
          makeFromProfile('Submit onboarding', p, `${b}/merchants/{{merchantId}}/onboarding/submit`)
        )
      ),
      makeFromProfile('List merchant payouts', p, `${b}/merchants/{{merchantId}}/payouts`)
    ),
    folder(
      'Sandbox',
      makeFromProfile('Seed sandbox data', p, `${b}/sandbox/seed`, { body: { profile: 'default' } }),
      makeFromProfile('Reset sandbox', p, `${b}/sandbox/reset`, { body: { confirm: true } })
    ),
    req('Partner MCP initialize', {
      method: 'POST',
      auth: 'oauth2',
      url: `${b}/mcp/rpc`,
      extraHeaders: [{ key: 'X-Protocol', value: 'mcp' }],
      body: '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}',
    })
  )
}

function buildLegacyMonolith() {
  const p = PROFILES.legacy
  // Completely flat - 18 siblings, no subfolders
  const items = [
    req('GET /ping', { method: 'GET', auth: 'noauth', url: 'http://legacy-internal.example.net/ping' }),
    req('POST /sync/accounts', { method: 'POST', auth: 'basic', url: 'http://legacy-internal.example.net/sync/accounts', basicCreds: { username: 'batch', password: 'batch123' }, body: { full: true } }),
    req('GET /accounts/list', { method: 'GET', auth: 'noauth', url: 'http://legacy-internal.example.net/accounts/list' }),
    req('GET /accounts/list (copy)', { method: 'GET', auth: 'noauth', url: 'http://legacy-internal.example.net/accounts/list' }),
  ]
  for (let i = 1; i <= 12; i++) {
    items.push(makeFromProfile(`cron job ${i}`, p, `http://legacy-internal.example.net/cron/job-${i}`))
  }
  items.push(req('HEAD /ping', { method: 'HEAD', auth: 'noauth', url: 'http://legacy-internal.example.net/ping' }))
  items.push(req('OPTIONS /accounts', { method: 'OPTIONS', auth: 'noauth', url: 'http://legacy-internal.example.net/accounts/list' }))
  return folder('Legacy Monolith - DO NOT USE', ...items)
}

function buildWebhooksMess() {
  const p = PROFILES.webhooks
  const b = '{{baseUrl}}/hooks'
  return folder(
    'Copy of Copy of Webhooks',
    folder(
      'incoming',
      makeFromProfile('Stripe payment succeeded', p, `${b}/stripe/payment-succeeded`, { body: { id: 'evt_1' } }),
      makeFromProfile('stripe payment succeeded', p, `${b}/stripe/payment-succeeded`, { body: { id: 'evt_1' } }),
      folder(
        'incoming',
        makeFromProfile('Duplicate nested incoming handler', p, `${b}/incoming/generic`, { body: { source: 'unknown' } })
      )
    ),
    folder(
      'retry queue',
      makeFromProfile('List stuck jobs', p, `${b}/retry/stuck`),
      makeFromProfile('Retry all stuck', p, `${b}/retry/stuck/replay-all`, { body: { maxAgeHours: 24 } })
    ),
    folder(
      'dead letter',
      makeFromProfile('Peek dead letter', p, `${b}/dlq/peek`),
      makeFromProfile('Replay dead letter item', p, `${b}/dlq/{{messageId}}/replay`, { body: {} })
    ),
    makeFromProfile('Root webhook test', p, `${b}/test`, { body: { ping: true } }),
    req('Webhook endpoint HEAD', { method: 'HEAD', auth: 'apikey', url: `${b}/test` })
  )
}

function buildScratchWip() {
  const p = PROFILES.scratch
  const b = '{{baseUrl}}/wip'
  return folder(
    '_scratch / WIP / untitled',
    folder('empty folder - ignore', folder('also empty')),
    makeFromProfile('does this work??', p, `${b}/test/ping`),
    makeFromProfile('DELETE ME', p, `https://api.example.com/debug/{{randomId}}`),
    folder(
      'jason experiments',
      req('graphql attempt', {
        method: 'POST',
        auth: 'noauth',
        url: `${b}/graphql`,
        graphql: { query: 'query { users { id name } }' },
      }),
      req('websocket???', { method: 'GET', auth: 'noauth', url: `wss://wip.acme-corp.io/ws/handshake` }),
      req('MCP tools/call (wip)', {
        method: 'MCP',
        auth: 'noauth',
        url: `${b}/mcp`,
        body: '{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"ping"}}',
      })
    ),
    folder('TODO rename', makeFromProfile('untitled request 47', p, `${b}/unknown/47`)),
    makeFromProfile('orphan POST at root', p, `${b}/orphan`, { body: { note: 'forgot context' } })
  )
}

function buildPossibleDuplicatesSection() {
  const p = PROFILES.scratch
  const pairs = [
    ['List orders', '{{baseUrl}}/v3/orders?page=1'],
    ['list orders', '{{baseUrl}}/v3/orders?page=1'],
    ['GET orders (Sarah copy)', '{{baseUrl}}/v3/orders?page=1'],
    ['Fetch user profile', '{{baseUrl}}/v3/users/{{userId}}'],
    ['Get User Profile', '{{baseUrl}}/v3/users/{{userId}}'],
    ['get user profile v2', '{{baseUrl}}/v3/users/{{userId}}'],
    ['Create webhook endpoint', '{{baseUrl}}/hooks/register'],
    ['create webhook endpoint', '{{baseUrl}}/hooks/register'],
    ['Webhook register (duplicate)', '{{baseUrl}}/hooks/register'],
    ['Search products', '{{baseUrl}}/v3/products?q=notebook'],
    ['search products', '{{baseUrl}}/v3/products?q=notebook'],
    ['Product search - backup', '{{baseUrl}}/v3/products?q=notebook'],
  ]

  return folder(
    'Possible Duplicates (review queue)',
    folder(
      'Same URL - different names',
      ...pairs.map(([name, url]) => makeFromProfile(name, p, url))
    ),
    folder(
      'Same name - different URLs',
      req('Health check', { method: 'GET', auth: 'noauth', url: '{{baseUrl}}/health' }),
      req('Health check', { method: 'GET', auth: 'noauth', url: '{{baseUrl}}/v3/health' }),
      req('Health check', { method: 'GET', auth: 'noauth', url: 'https://staging.api.acme-corp.io/health' }),
      req('Health check', { method: 'GET', auth: 'noauth', url: 'http://legacy-internal.example.net/health' })
    ),
    folder(
      'Copy-paste drift',
      makeFromProfile('Update order status', p, '{{baseUrl}}/v3/orders/{{orderId}}', { body: { status: 'shipped' } }),
      makeFromProfile('Update order status (Copy)', p, '{{baseUrl}}/v3/orders/{{orderId}}', { body: { status: 'SHIPPED' } }),
      makeFromProfile('Update order status (Copy 2)', p, '{{baseUrl}}/v3/orders/{{orderId}}?notify=true', { body: { status: 'shipped' } })
    )
  )
}

function buildDeepNestingSection() {
  const p = PROFILES.internalOps
  const b = '{{baseUrl}}/archive/deep'
  return folder(
    'Extra Deep Nesting (stress test)',
    folder(
      'Level 1 - migrated export',
      folder(
        'Level 2 - old team folder',
        folder(
          'Level 3 - Q4 cleanup',
          folder(
            'Level 4 - billing sub-tree',
            folder(
              'Level 5 - invoices branch',
              folder(
                'Level 6 - line items',
                folder(
                  'Level 7 - tax overrides',
                  folder(
                    'Level 8 - jurisdiction rules',
                    makeFromProfile('Apply EU VAT rule', p, `${b}/invoices/{{invoiceId}}/tax/eu/vat`, { body: { rate: 0.2 } }),
                    makeFromProfile('Apply US sales tax rule', p, `${b}/invoices/{{invoiceId}}/tax/us/sales`, { body: { state: 'CA' } })
                  ),
                  makeFromProfile('List tax overrides', p, `${b}/invoices/{{invoiceId}}/tax/overrides`)
                ),
                makeFromProfile('Bulk update line items', p, `${b}/invoices/{{invoiceId}}/lines/bulk`, { body: { ops: [] } })
              ),
              makeFromProfile('Get invoice PDF', p, `${b}/invoices/{{invoiceId}}/pdf`)
            ),
            makeFromProfile('Archive old invoices', p, `${b}/invoices/archive`, { body: { before: '2023-01-01' } })
          ),
          makeFromProfile('Legacy report stub', p, `${b}/reports/legacy/stub`)
        ),
        makeFromProfile('Orphan in level 2', p, `${b}/orphan/l2`)
      ),
      makeFromProfile('Root of deep tree ping', p, `${b}/ping`)
    ),
    folder(
      'Wide + deep hybrid',
      folder('branch A', folder('A1', folder('A1a', makeFromProfile('Deep leaf A1a', p, `${b}/wide/a/1/a`)))),
      folder('branch B', folder('B1', folder('B1a', folder('B1a-i', makeFromProfile('Deep leaf B1a-i', p, `${b}/wide/b/1/a/i`))))),
      folder('branch C', makeFromProfile('Shallow leaf C', p, `${b}/wide/c/shallow`))
    )
  )
}

function buildMixedProtocolsSection() {
  const b = '{{baseUrl}}'
  return folder(
    'Mixed Protocols Dump (imported)',
    folder(
      'HTTP edge cases',
      req('Global HEAD health', { method: 'HEAD', auth: 'noauth', url: `${b}/health` }),
      req('API gateway OPTIONS', {
        method: 'OPTIONS',
        auth: 'noauth',
        url: `${b}/v3/users`,
        extraHeaders: [{ key: 'Access-Control-Request-Method', value: 'PATCH' }],
      }),
      req('CDN asset HEAD', { method: 'HEAD', auth: 'noauth', url: 'https://cdn.acme-corp.io/assets/logo.png' })
    ),
    folder(
      'GraphQL misc',
      req('Search orders GQL', {
        method: 'POST',
        auth: 'bearer',
        url: `${b}/graphql`,
        graphql: { query: 'query($q: String!) { orders(search: $q) { id total } }', variables: '{"q":"open"}' },
      }),
      req('Admin schema dump', {
        method: 'GRAPHQL',
        auth: 'apikey',
        url: `${b}/admin/graphql`,
        body: '{"query":"query { __schema { types { name kind } } }"}',
      }),
      makeFromProfile('Legacy GQL via POST', PROFILES.scratch, `${b}/v2/graphql`, {
        body: '{"query":"mutation { ping }"}',
      })
    ),
    folder(
      'MCP + agents',
      req('tools/list', {
        method: 'POST',
        auth: 'bearer',
        url: `${b}/agent/mcp`,
        extraHeaders: [{ key: 'X-Protocol', value: 'mcp' }],
        body: '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}',
      }),
      req('tools/call export_users', {
        method: 'MCP',
        auth: 'oauth2',
        url: `${b}/agent/mcp/rpc`,
        body: '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"export_users"}}',
      })
    ),
    folder(
      'gRPC stubs',
      req('UserService/GetUser', {
        method: 'POST',
        auth: 'bearer',
        url: `${b}/grpc/users.UserService/GetUser`,
        extraHeaders: [{ key: 'X-Protocol', value: 'grpc' }],
        body: { user_id: '{{userId}}' },
      }),
      req('BillingService/ListInvoices', {
        method: 'GRPC',
        auth: 'apikey',
        url: `${b}/grpc/billing.BillingService/ListInvoices`,
        body: { page: 1 },
      })
    ),
    folder(
      'Realtime',
      req('Notifications SSE', {
        method: 'GET',
        auth: 'bearer',
        url: `${b}/notifications/stream`,
        extraHeaders: [
          { key: 'Accept', value: 'text/event-stream' },
          { key: 'X-Protocol', value: 'sse' },
        ],
      }),
      req('Order updates WebSocket', { method: 'GET', auth: 'bearer', url: 'wss://realtime.acme-corp.io/orders' }),
      req('Debug WS (no auth)', { method: 'GET', auth: 'noauth', url: 'ws://localhost:9090/debug' })
    ),
    req('orphan GraphQL at section root', {
      method: 'POST',
      auth: 'noauth',
      url: `${b}/graphql`,
      graphql: { query: 'query { ping }' },
    })
  )
}

const collection = {
  info: {
    name: 'PostScope Enterprise Messy Demo (120+ requests)',
    description:
      'Synthetic mega-collection simulating merged team exports: distinct child collections, duplicate clusters, extreme nesting, and uneven auth/method distributions.',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    _postman_id: 'sample-messy-heavy-001',
  },
  variable: [
    { key: 'baseUrl', value: 'https://staging.api.acme-corp.io' },
    { key: 'legacyHost', value: 'https://legacy-internal.example.net' },
    { key: 'token', value: '' },
    { key: 'apiKey', value: 'demo-key-not-for-prod' },
    { key: 'tenantId', value: 'tenant_7f3a' },
    { key: 'env', value: 'staging' },
  ],
  item: [
    buildAcmeV3(),
    buildAcmeV2Deprecated(),
    buildMobileBff(),
    buildInternalAdmin(),
    buildPartnerIntegrations(),
    buildLegacyMonolith(),
    buildWebhooksMess(),
    buildScratchWip(),
    buildPossibleDuplicatesSection(),
    buildDeepNestingSection(),
    buildMixedProtocolsSection(),
  ],
}

function countRequests(items) {
  let n = 0
  for (const item of items) {
    if (item.request) n++
    if (item.item) n += countRequests(item.item)
  }
  return n
}

function maxDepth(items, d = 0) {
  let max = d
  for (const item of items) {
    if (item.item?.length) max = Math.max(max, maxDepth(item.item, d + 1))
  }
  return max
}

function countByField(items, acc = { methods: {}, auths: {}, protocols: {} }) {
  for (const item of items) {
    if (item.request) {
      const m = item.request.method
      const a = item.request.auth?.type || 'noauth'
      acc.methods[m] = (acc.methods[m] || 0) + 1
      acc.auths[a] = (acc.auths[a] || 0) + 1
    }
    if (item.item) countByField(item.item, acc)
  }
  return acc
}

const total = countRequests(collection.item)
if (total < MIN_REQUESTS) {
  console.error(`Expected ${MIN_REQUESTS}+ requests, got ${total}`)
  process.exit(1)
}

writeFileSync(OUT, JSON.stringify(collection, null, 2))
const stats = countByField(collection.item)
console.log(`Wrote ${OUT}`)
console.log(`Top-level sections: ${collection.item.length}`)
console.log(`Total requests: ${total}`)
console.log(`Max nesting depth: ${maxDepth(collection.item)}`)
console.log('Methods:', stats.methods)
console.log('Auth types:', stats.auths)
