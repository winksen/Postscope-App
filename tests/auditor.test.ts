import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCollection } from '../src/lib/parser'
import { runAudit, sanitizeAuditOptions, type Finding } from '../src/lib/auditor'
import { calculateScore } from '../src/lib/scorer'
import { requestHealthScore } from '../src/lib/requestFindings'
import { RULE_LIST } from '../src/lib/rules'
import { FAKE, PROVIDER_SAMPLES, cleanCollection, kitchenSinkCollection } from './fixtures'

function audit(json: unknown) {
  const parsed = parseCollection(json)
  const findings = runAudit(parsed)
  const byRule = new Map(findings.map((finding) => [finding.ruleId, finding]))
  const affectedNames = (ruleId: string) =>
    (byRule.get(ruleId as Finding['ruleId'])?.affected ?? []).map((id) => parsed.requests.find((r) => r.id === id)?.name)
  return { parsed, findings, byRule, affectedNames }
}

test('kitchen sink triggers every major rule family', () => {
  const { byRule } = audit(kitchenSinkCollection())
  for (const ruleId of [
    'HARDCODED_PASSWORD',
    'HARDCODED_TOKEN',
    'HARDCODED_API_KEY',
    'HARDCODED_SECRET',
    'HARDCODED_AUTH_CREDENTIAL',
    'SECRET_IN_QUERY',
    'CREDENTIALS_IN_URL',
    'SECRET_IN_SCRIPT',
    'SECRET_IN_COLLECTION_VARIABLE',
    'SECRET_IN_SAVED_RESPONSE',
    'KNOWN_SECRET_PATTERN',
    'INSECURE_HTTP',
    'TLS_VERIFICATION_DISABLED',
    'SECRET_LOGGED_IN_SCRIPT',
    'BASIC_AUTH_PLAINTEXT',
    'GET_WITH_BODY',
    'MISSING_AUTH',
  ]) {
    assert.ok(byRule.has(ruleId as Finding['ruleId']), `expected ${ruleId}`)
  }
})

test('finding ids are stable rule ids and unique per run', () => {
  const { findings } = audit(kitchenSinkCollection())
  assert.equal(new Set(findings.map((f) => f.id)).size, findings.length)
  for (const finding of findings) assert.equal(finding.id, finding.ruleId)
  const again = runAudit(parseCollection(kitchenSinkCollection()))
  assert.deepEqual(
    again.map((f) => f.id),
    findings.map((f) => f.id)
  )
})

test('findings are ordered critical, warning, info', () => {
  const { findings } = audit(kitchenSinkCollection())
  const order = { critical: 0, warning: 1, info: 2 }
  for (let i = 1; i < findings.length; i += 1) assert.ok(order[findings[i - 1].severity] <= order[findings[i].severity])
})

test('evidence never contains full secret values', () => {
  const { findings } = audit(kitchenSinkCollection())
  const serialized = JSON.stringify(findings)
  for (const secret of Object.values(FAKE)) assert.ok(!serialized.includes(secret), `leaked ${secret.slice(0, 6)}…`)
})

test('variables with dashes are not reported as hardcoded tokens', () => {
  const { affectedNames } = audit(kitchenSinkCollection())
  assert.ok(!affectedNames('HARDCODED_TOKEN').includes('List users'))
  assert.ok(affectedNames('HARDCODED_TOKEN').includes('Create user'))
})

test('pagination tokens are ignored and disabled fields are labelled', () => {
  const { byRule } = audit(kitchenSinkCollection())
  const queryEvidence = byRule.get('SECRET_IN_QUERY')?.evidence?.map((e) => e.location) ?? []
  assert.deepEqual(queryEvidence, ['query api_key'])
  const secretEvidence = byRule.get('HARDCODED_SECRET')?.evidence?.map((e) => e.location) ?? []
  assert.ok(secretEvidence.includes('body field disabled_secret (disabled)'))
})

function disabledCollection(): Record<string, unknown> {
  return {
    info: { name: 'Disabled entries' },
    variable: [
      { key: 'baseUrl', value: 'https://api.example.com' },
      { key: 'a', value: '1' },
      { key: 'b', value: '2' },
      { key: 'c', value: '3' },
    ],
    item: [
      {
        name: 'Leaky request',
        event: [{ listen: 'prerequest', disabled: true, script: { exec: [`pm.environment.set("accessToken", "${FAKE.refreshToken}")`] } }],
        request: {
          method: 'POST',
          auth: { type: 'noauth' },
          description: 'Has only disabled credentials.',
          header: [
            { key: 'Authorization', value: `Bearer ${FAKE.bearer}`, disabled: true },
            { key: 'X-Empty', value: '', disabled: true },
            { key: 'Content-Type', value: 'application/json' },
          ],
          url: {
            raw: '{{baseUrl}}/login',
            host: ['{{baseUrl}}'],
            path: ['login'],
            query: [{ key: 'api_key', value: FAKE.apiKey, disabled: true }],
          },
          body: {
            mode: 'urlencoded',
            urlencoded: [
              { key: 'username', value: 'admin' },
              { key: 'password', value: FAKE.password, disabled: true },
            ],
          },
        },
        response: [
          {
            name: 'Example',
            originalRequest: {
              method: 'POST',
              header: [{ key: 'X-API-Key', value: FAKE.apiKey, disabled: true }],
              url: '{{baseUrl}}/login',
            },
            body: '{}',
          },
        ],
      },
    ],
  }
}

test('disabled headers, query params, form fields and scripts are audited and labelled', () => {
  const { byRule, affectedNames } = audit(disabledCollection())
  const locations = (ruleId: string) => (byRule.get(ruleId as Finding['ruleId'])?.evidence ?? []).map((e) => e.location)
  assert.deepEqual(locations('HARDCODED_TOKEN'), ['header Authorization (disabled)'])
  assert.deepEqual(locations('SECRET_IN_QUERY'), ['query api_key (disabled)'])
  assert.deepEqual(locations('HARDCODED_PASSWORD'), ['body field password (disabled)'])
  assert.ok(locations('SECRET_IN_SCRIPT').some((location) => location === 'pre-request script (disabled): sets accessToken'))
  assert.ok(locations('SECRET_IN_SAVED_RESPONSE').some((location) => location.endsWith('original request header X-API-Key (disabled)')))
  assert.deepEqual(affectedNames('HARDCODED_TOKEN'), ['Leaky request'])
})

test('disabled entries do not suppress auth or hygiene checks', () => {
  const { affectedNames } = audit(disabledCollection())
  assert.deepEqual(affectedNames('MISSING_AUTH'), ['Leaky request'])
  assert.deepEqual(affectedNames('EMPTY_HEADERS'), [])
})

test('disabled placeholders and variables raise nothing', () => {
  const json = disabledCollection() as { item: Array<{ request: { header: unknown[] } }> }
  json.item[0].request.header = [{ key: 'Authorization', value: 'Bearer {{token}}', disabled: true }]
  const { byRule } = audit({
    ...json,
    item: [{ ...json.item[0], event: [], response: [], request: { ...json.item[0].request, url: '{{baseUrl}}/x', body: undefined } }],
  })
  assert.ok(!byRule.has('HARDCODED_TOKEN'))
  assert.ok(!byRule.has('SECRET_IN_QUERY'))
})

test('inherited auth suppresses MISSING_AUTH and flags inherited credentials', () => {
  const { affectedNames, byRule } = audit(kitchenSinkCollection())
  assert.ok(!affectedNames('MISSING_AUTH').includes('Login'))
  assert.ok(affectedNames('MISSING_AUTH').includes('Github hook'))
  assert.ok(affectedNames('BASIC_AUTH_PLAINTEXT').includes('Login'))
  const locations =
    byRule
      .get('HARDCODED_AUTH_CREDENTIAL')
      ?.evidence?.map((e) => e.location)
      .join('|') ?? ''
  assert.match(locations, /collection level/)
})

test('a clean collection has no secret, auth, or transport findings', () => {
  const { findings, parsed } = audit(cleanCollection())
  assert.deepEqual(
    findings.filter((f) => f.severity !== 'info').map((f) => f.ruleId),
    []
  )
  assert.ok(calculateScore(parsed, findings).total >= 90)
})

test('local http endpoints are not flagged as insecure', () => {
  const { affectedNames } = audit(kitchenSinkCollection())
  assert.ok(!affectedNames('INSECURE_HTTP').includes('Get user with body'))
  assert.ok(affectedNames('INSECURE_HTTP').includes('Login'))
})

test('audit options disable rules and override severity', () => {
  const parsed = parseCollection(kitchenSinkCollection())
  const findings = runAudit(parsed, { disabledRules: ['INSECURE_HTTP'], severityOverrides: { GET_WITH_BODY: 'critical' } })
  assert.ok(!findings.some((f) => f.ruleId === 'INSECURE_HTTP'))
  assert.equal(findings.find((f) => f.ruleId === 'GET_WITH_BODY')?.severity, 'critical')
})

test('sanitizeAuditOptions drops unknown rules and invalid severities', () => {
  const options = sanitizeAuditOptions({
    disabledRules: ['INSECURE_HTTP', 'NOPE', 42],
    severityOverrides: { GET_WITH_BODY: 'warning', MISSING_AUTH: 'warning', FAKE: 'critical', HARDCODED_TOKEN: 'urgent' },
  })
  assert.deepEqual(options.disabledRules, ['INSECURE_HTTP'])
  assert.deepEqual(options.severityOverrides, { GET_WITH_BODY: 'warning' })
  assert.deepEqual(sanitizeAuditOptions('garbage'), {})
})

test('score and per-request health share the same penalty table', () => {
  const { findings, parsed } = audit(kitchenSinkCollection())
  const score = calculateScore(parsed, findings)
  assert.ok(score.total >= 0 && score.total <= 100)
  assert.equal(requestHealthScore([]), 100)
  assert.equal(requestHealthScore([{ severity: 'critical' } as Finding, { severity: 'warning' } as Finding]), 72)
})

test('every rule has complete metadata', () => {
  for (const rule of RULE_LIST) {
    assert.ok(rule.title && rule.description && rule.recommendation, rule.id)
  }
})

test('JSON bodies with unquoted variables still reveal literal secrets', () => {
  const { affectedNames, byRule } = audit({
    info: { name: 'Templated' },
    item: [
      {
        name: 'Unquoted',
        request: { method: 'POST', url: '{{baseUrl}}/a', body: { mode: 'raw', raw: `{"id": {{userId}}, "password": "${FAKE.password}"}` } },
      },
      {
        name: 'Only variables',
        request: {
          method: 'POST',
          url: '{{baseUrl}}/b',
          body: { mode: 'raw', raw: '{"id": {{userId}}, "password": {{password}}, "n": "{{x}}"}' },
        },
      },
      {
        name: 'Nested',
        request: {
          method: 'POST',
          url: '{{baseUrl}}/c',
          body: { mode: 'raw', raw: `{"a": [{{one}}, {"client_secret": "${FAKE.clientSecret}"}], "b": {{two}}}` },
        },
      },
    ],
  })
  assert.deepEqual(affectedNames('HARDCODED_PASSWORD'), ['Unquoted'])
  assert.deepEqual(affectedNames('HARDCODED_SECRET'), ['Nested'])
  assert.equal(byRule.get('HARDCODED_PASSWORD')?.evidence?.[0].location, 'body password')
})

test('XML, form-like and fragment raw bodies are scanned field by field', () => {
  const { affectedNames, byRule } = audit({
    info: { name: 'Raw bodies' },
    item: [
      {
        name: 'SOAP',
        request: {
          method: 'POST',
          url: 'https://x.test/s',
          body: {
            mode: 'raw',
            raw: `<wsse:UsernameToken><wsse:Password Type="PasswordText">${FAKE.password}</wsse:Password></wsse:UsernameToken>`,
          },
        },
      },
      {
        name: 'SOAP variable',
        request: { method: 'POST', url: 'https://x.test/s', body: { mode: 'raw', raw: '<Password>{{pw}}</Password><Name>Bob</Name>' } },
      },
      {
        name: 'Pairs',
        request: {
          method: 'POST',
          url: 'https://x.test/t',
          body: { mode: 'raw', raw: `grant_type=client_credentials&client_secret=${FAKE.clientSecret}&scope=read` },
        },
      },
      {
        name: 'Fragment',
        request: { method: 'POST', url: 'https://x.test/f', body: { mode: 'raw', raw: `// note\n{"password": "${FAKE.password}", }` } },
      },
      {
        name: 'Plain text',
        request: { method: 'POST', url: 'https://x.test/p', body: { mode: 'raw', raw: 'this mentions a secret but has no value' } },
      },
    ],
  })
  assert.deepEqual(affectedNames('HARDCODED_PASSWORD'), ['SOAP', 'Fragment'])
  assert.deepEqual(affectedNames('HARDCODED_SECRET'), ['Pairs'])
  assert.deepEqual(
    byRule.get('HARDCODED_PASSWORD')?.evidence?.map((e) => e.location),
    ['raw body Password', 'raw body password']
  )
})

function urlCollection(
  requests: Array<{ name: string; method?: string; url: unknown; header?: unknown[]; auth?: unknown; event?: unknown[] }>,
  extra: Record<string, unknown> = {}
) {
  return {
    info: { name: 'Urls' },
    ...extra,
    item: requests.map((request) => ({
      name: request.name,
      event: request.event,
      request: {
        method: request.method ?? 'GET',
        url: request.url,
        header: request.header,
        auth: request.auth ?? { type: 'noauth' },
        description: 'd',
      },
    })),
  }
}

test('base URL detection is not fooled by a variable later in the URL', () => {
  const { affectedNames } = audit(
    urlCollection([
      { name: 'Variable in query', url: 'https://api.acme.io/x?next={{baseUrl}}' },
      { name: 'Variable base', url: '{{baseUrl}}/users' },
      { name: 'Custom variable name', url: '{{gatewayHost}}/users' },
      { name: 'Variable host', url: 'https://{{host}}/users' },
      { name: 'Partly variable host', url: 'https://api.{{region}}.acme.io/users' },
      { name: 'Literal', url: 'https://api.acme.io/users' },
    ])
  )
  assert.deepEqual(affectedNames('HARDCODED_BASEURL'), ['Variable in query', 'Literal'])
})

test('environment URL detection looks at host labels, not path segments', () => {
  const { affectedNames, byRule } = audit(
    urlCollection([
      { name: 'Path segment', url: 'https://api.acme.io/v1/prod/items' },
      { name: 'Product host', url: 'https://product.acme.io/items' },
      { name: 'UAT label', url: 'https://api-uat.acme.io/items' },
      { name: 'Staging label', url: 'https://staging.acme.io/items' },
      { name: 'Preprod label', url: 'https://api.preprod.acme.io/items' },
      { name: 'Variable only in path', url: 'https://sandbox.acme.io/{{tenant}}/items' },
      { name: 'Variable host', url: 'https://{{env}}.acme.io/items' },
      { name: 'Localhost', url: 'http://localhost:3000/items' },
      { name: 'Scheme-less', url: 'api.qa.acme.io/items' },
      { name: 'Variable base', url: '{{baseUrl}}/prod/items' },
    ])
  )
  assert.deepEqual(affectedNames('HARDCODED_ENV_URL'), [
    'UAT label',
    'Staging label',
    'Preprod label',
    'Variable only in path',
    'Localhost',
    'Scheme-less',
  ])
  assert.deepEqual(
    byRule.get('HARDCODED_ENV_URL')?.evidence?.map((item) => item.preview),
    ['api-uat.acme.io', 'staging.acme.io', 'api.preprod.acme.io', 'sandbox.acme.io', 'localhost', 'api.qa.acme.io']
  )
})

test('requests with API keys, cookies, query credentials or auth scripts are not reported as unprotected', () => {
  const { affectedNames, byRule } = audit(
    urlCollection(
      [
        { name: 'Bare', method: 'POST', url: '{{baseUrl}}/users' },
        { name: 'API key header', method: 'POST', url: '{{baseUrl}}/a', header: [{ key: 'X-API-Key', value: '{{apiKey}}' }] },
        { name: 'Session cookie', method: 'PUT', url: '{{baseUrl}}/b', header: [{ key: 'Cookie', value: 'session={{session}}' }] },
        {
          name: 'Query credential',
          method: 'PATCH',
          url: { raw: '{{baseUrl}}/c?api_key={{key}}', query: [{ key: 'api_key', value: '{{key}}' }] },
        },
        {
          name: 'Own script',
          method: 'DELETE',
          url: '{{baseUrl}}/d',
          event: [
            {
              listen: 'prerequest',
              script: { exec: ["pm.request.headers.upsert({ key: 'Authorization', value: 'Bearer ' + pm.environment.get('t') })"] },
            },
          ],
        },
        { name: 'CSRF only', method: 'POST', url: '{{baseUrl}}/e', header: [{ key: 'X-CSRF-Token', value: '{{csrf}}' }] },
        { name: 'Disabled key', method: 'POST', url: '{{baseUrl}}/f', header: [{ key: 'X-API-Key', value: '{{apiKey}}', disabled: true }] },
      ],
      {}
    )
  )
  assert.deepEqual(affectedNames('MISSING_AUTH'), ['Bare', 'CSRF only', 'Disabled key'])
  assert.deepEqual(
    byRule.get('MISSING_AUTH')?.evidence?.map((item) => item.location),
    ['POST /users', 'POST /e', 'POST /f']
  )
})

test('collection and folder pre-request scripts that set Authorization suppress MISSING_AUTH', () => {
  const script = (exec: string) => [{ listen: 'prerequest', script: { exec: [exec] } }]
  const json = {
    info: { name: 'Scripts' },
    event: script("pm.request.headers.add('Authorization: Bearer ' + pm.collectionVariables.get('t'))"),
    item: [
      {
        name: 'Folder',
        event: script('pm.request.auth = { type: "bearer" }'),
        item: [{ name: 'In folder', request: { method: 'POST', url: '{{baseUrl}}/x', auth: { type: 'noauth' }, description: 'd' } }],
      },
      { name: 'At root', request: { method: 'POST', url: '{{baseUrl}}/y', auth: { type: 'noauth' }, description: 'd' } },
    ],
  }
  assert.deepEqual(audit(json).affectedNames('MISSING_AUTH'), [])
  const unrelated = { ...json, event: script("console.log('hello')"), item: [json.item[0], json.item[1]] }
  assert.deepEqual(audit(unrelated).affectedNames('MISSING_AUTH'), ['At root'])
  const disabled = {
    ...json,
    event: [{ listen: 'prerequest', disabled: true, script: { exec: ["pm.request.headers.add('Authorization: Bearer x')"] } }],
  }
  assert.deepEqual(audit(disabled).affectedNames('MISSING_AUTH'), ['At root'])
})

function headerCollection(headers: Array<{ key: string; value: string }>, extra: Record<string, unknown> = {}) {
  return {
    info: { name: 'Headers' },
    item: headers.map((header, index) => ({
      name: `R${index}`,
      request: { method: 'GET', url: '{{baseUrl}}/x', auth: { type: 'noauth' }, description: 'd', header: [header], ...extra },
    })),
  }
}

test('Basic Authorization headers are decoded before judging them', () => {
  const basic = (text: string) => `Basic ${Buffer.from(text).toString('base64')}`
  const { findings, byRule } = audit(
    headerCollection([
      { key: 'Authorization', value: basic('svc-account:{{password}}') },
      { key: 'Authorization', value: basic('svc-account:changeme') },
      { key: 'Authorization', value: basic(`svc-account:${FAKE.password}`) },
      { key: 'Authorization', value: basic(`api:key-${'0123456789abcdef'.repeat(2)}`) },
      { key: 'Authorization', value: 'Basic not*base64*but-long-enough-to-look-like-a-token' },
    ])
  )
  const evidence = byRule.get('HARDCODED_TOKEN')?.evidence ?? []
  assert.deepEqual(
    evidence.map((item) => item.requestId),
    ['R2', 'R3', 'R4']
  )
  assert.equal(evidence[0].location, 'header Authorization (basic credentials for user s••••••)')
  assert.equal(evidence[1].location, 'header Authorization (basic credentials for user a••) (Mailgun API key)')
  assert.ok(evidence.every((item) => !JSON.stringify(item).includes(FAKE.password)))
  assert.ok(!findings.some((finding) => finding.ruleId === 'HIGH_ENTROPY_LITERAL'))
})

test('Vault tokens and other sensitive headers are reported', () => {
  const { byRule } = audit(
    headerCollection([
      { key: 'X-Vault-Token', value: 's.AbCdEfGhIjKlMnOpQrStUvWx' },
      { key: 'X-Vault-Token', value: '{{vaultToken}}' },
      { key: 'X-Custom', value: PROVIDER_SAMPLES['vault-service-token'].token },
      { key: 'X-Webhook-Secret', value: 'q8Zr2LmXa9PdW4sT7vBn3KcYe6' },
    ])
  )
  assert.deepEqual(
    byRule.get('HARDCODED_TOKEN')?.evidence?.map((item) => item.requestId),
    ['R0']
  )
  assert.deepEqual(
    byRule.get('KNOWN_SECRET_PATTERN')?.evidence?.map((item) => item.location),
    ['header X-Custom (HashiCorp Vault service token)']
  )
  assert.deepEqual(
    byRule.get('HIGH_ENTROPY_LITERAL')?.evidence?.map((item) => item.location),
    ['header X-Webhook-Secret']
  )
})

test('HIGH_ENTROPY_LITERAL covers credential-named fields no other rule reported and skips the rest', () => {
  const { byRule, affectedNames } = audit({
    info: { name: 'Entropy' },
    item: [
      {
        name: 'Body',
        request: {
          method: 'POST',
          url: {
            raw: '{{baseUrl}}/a?signing_key=q8Zr2LmXa9PdW4sT7vBn3KcYe6&session_id=123e4567-e89b-12d3-a456-426614174000',
            query: [
              { key: 'signing_key', value: 'q8Zr2LmXa9PdW4sT7vBn3KcYe6' },
              { key: 'session_id', value: '123e4567-e89b-12d3-a456-426614174000' },
            ],
          },
          auth: { type: 'noauth' },
          description: 'd',
          body: {
            mode: 'raw',
            raw: JSON.stringify({
              signing_key: 'Zx8Qw3Lm9Pd2Vb7Kc4Ye1TrNs5',
              client_secret: 'Zx8Qw3Lm9Pd2Vb7Kc4Ye1TrNs5',
              username: 'q8Zr2LmXa9PdW4sT7vBn3KcYe6',
              credential_hint: 'a plain sentence about credentials',
            }),
          },
        },
      },
    ],
  })
  const locations = (byRule.get('HIGH_ENTROPY_LITERAL')?.evidence ?? []).map((item) => item.location)
  assert.deepEqual(locations, ['body signing_key'])
  assert.deepEqual(affectedNames('HIGH_ENTROPY_LITERAL'), ['Body'])
  assert.equal(byRule.get('HIGH_ENTROPY_LITERAL')?.severity, 'warning')
  assert.equal(byRule.get('HIGH_ENTROPY_LITERAL')?.category, 'secrets')
})
