import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseCollection } from '../src/lib/parser'
import { runAudit, runAuditDetailed, type Finding } from '../src/lib/auditor'
import { redactCollection } from '../src/lib/redaction'
import { PII_VARIABLES, scanPiiJson, scanPiiText, scanPiiValue, scrubPiiText, validIban } from '../src/lib/iam/pii'
import { classifyEndpoint, endpointContext } from '../src/lib/iam/endpoints'
import { requestParams, splitUrl } from '../src/lib/iam/url'

/** Fictional but checksum-valid values, generated at runtime so no real-looking identifier is committed. */
function makeIban(country: string, bban: string): string {
  const numeric = (text: string) => [...text].map((char) => (char >= 'A' ? String(char.charCodeAt(0) - 55) : char)).join('')
  const mod97 = (digits: string) => digits.split('').reduce((rest, digit) => (rest * 10 + Number(digit)) % 97, 0)
  const check = String(98 - mod97(numeric(`${bban}${country}00`))).padStart(2, '0')
  return `${country}${check}${bban}`
}

function makeCard(prefix: string, length: number): string {
  const body = prefix + '7'.repeat(length - prefix.length - 1)
  let sum = 0
  for (let index = 0; index < body.length; index += 1) {
    let digit = Number(body[body.length - 1 - index])
    if (index % 2 === 0) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
  }
  return body + String((10 - (sum % 10)) % 10)
}

function makeNir(base13: string): string {
  return base13 + String(97 - Number(BigInt(base13) % 97n)).padStart(2, '0')
}

function makeDni(number: number): string {
  return `${String(number).padStart(8, '0')}${'TRWAGMYFPDXBNJZSQVHLCKE'[number % 23]}`
}

const IBAN = makeIban('FR', '30006000011234567890189')
const IBAN_SPACED = IBAN.replace(/(.{4})/g, '$1 ').trim()
const CARD = makeCard('4', 16)
const NIR = makeNir('1850575123456')
const DNI = makeDni(12345678)
const EMAIL = 'jane.doe@acme-corp.com'

test('personal data is found with masked previews', () => {
  const kinds = (text: string) => scanPiiText(text).map((match) => match.kind)
  assert.deepEqual(kinds(`contact ${EMAIL} please`), ['email'])
  assert.deepEqual(kinds(`iban ${IBAN}`), ['iban'])
  assert.deepEqual(kinds(`iban ${IBAN_SPACED}`), ['iban'])
  assert.deepEqual(kinds(`card ${CARD}`), ['card'])
  assert.deepEqual(kinds(`card ${CARD.replace(/(.{4})/g, '$1 ').trim()}`), ['card'])
  assert.deepEqual(kinds('ssn 123-45-6789'), ['national-id'])
  assert.deepEqual(kinds(`nir ${NIR}`), ['national-id'])
  assert.deepEqual(kinds(`dni ${DNI}`), ['national-id'])
  assert.deepEqual(kinds('call +33 6 12 34 56 78 now'), ['phone'])

  const previews = scanPiiText(`${EMAIL} ${IBAN} ${CARD} 123-45-6789 +33612345678`).map((match) => match.preview)
  assert.deepEqual(previews, ['j•••@•••', `${IBAN.slice(0, 4)}••••`, `••••${CARD.slice(-4)}`, '•••-••-6789', '••••78'])
  const text = previews.join(' ')
  for (const secret of ['jane.doe', IBAN.slice(4), CARD.slice(0, 12), '123-45']) assert.ok(!text.includes(secret))
})

test('checksums keep ordinary numbers out', () => {
  const none = (text: string) => assert.deepEqual(scanPiiText(text), [], text)
  none('FR7630006000011234567890188')
  none(`card ${CARD.slice(0, 15)}0`)
  none('card 4111111111111112')
  none('order 1234567890123456')
  none('timestamp 1717243200000 and id 20240601123456')
  none('uuid 123e4567-e89b-12d3-a456-426614174000')
  none('ssn 000-12-3456 and 666-12-3456 and 900-12-3456')
  none('nir 185057512345600')
  none('dni 12345678A')
  none('version 1.2.3 +1')
  assert.equal(validIban(IBAN), true)
  assert.equal(validIban('DE00123456789012345678'), false)
})

test('reserved example domains and variables are not personal data', () => {
  assert.deepEqual(scanPiiText('a@example.com b@example.org c@mail.example d@x.test e@y.invalid f@localhost'), [])
  assert.deepEqual(scanPiiValue('email', '{{email}}'), [])
  assert.deepEqual(scanPiiValue('dob', '{{dob}}'), [])
  assert.equal(scanPiiText('a@acme-corp.com').length, 1)
})

test('field names mark dates of birth, employee ids and phone numbers', () => {
  assert.equal(scanPiiValue('dateOfBirth', '1985-05-12')[0]?.kind, 'date-of-birth')
  assert.equal(scanPiiValue('dob', '12/05/1985')[0]?.kind, 'date-of-birth')
  assert.equal(scanPiiValue('employeeId', 'E123456')[0]?.kind, 'employee-id')
  assert.equal(scanPiiValue('phone', '0612345678')[0]?.kind, 'phone')
  assert.equal(scanPiiValue('mobile', '(555) 123-4567')[0]?.kind, 'phone')
  assert.deepEqual(scanPiiValue('createdAt', '1985-05-12'), [], 'a date under another name is not a date of birth')
  assert.deepEqual(scanPiiValue('count', '0612345678'), [])
  assert.deepEqual(scanPiiValue('employeeId', ''), [])
  const hits = scanPiiJson({ users: [{ mail: EMAIL, profile: { dateOfBirth: '1985-05-12' } }] })
  assert.deepEqual(hits.map((hit) => `${hit.kind}@${hit.path}`).sort(), [
    'date-of-birth@users[0].profile.dateOfBirth',
    'email@users[0].mail',
  ])
})

test('scrubbing replaces whole values for named fields and spans inside text', () => {
  assert.deepEqual(
    scrubPiiText(`mail ${EMAIL} or ${IBAN}`, (kind) => `<${kind}>`),
    { text: 'mail <email> or <iban>', count: 2 }
  )
  assert.deepEqual(
    scrubPiiText('1985-05-12', (kind) => `<${kind}>`, 'dateOfBirth'),
    { text: '<date-of-birth>', count: 1 }
  )
  assert.deepEqual(
    scrubPiiText('nothing here', () => 'x'),
    { text: 'nothing here', count: 0 }
  )
})

interface Req {
  name: string
  method?: string
  url: string
  json?: unknown
  responses?: Array<{ name: string; body?: string; requestBody?: string }>
}

function build(requests: Req[]) {
  return {
    info: { name: 'Governance fixture', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    item: requests.map((request) => ({
      name: request.name,
      request: {
        method: request.method ?? 'GET',
        url: request.url,
        description: 'documented',
        header: [],
        ...(request.json !== undefined ? { body: { mode: 'raw', raw: JSON.stringify(request.json) } } : {}),
      },
      response: (request.responses ?? []).map((response) => ({
        name: response.name,
        originalRequest: {
          method: 'GET',
          url: request.url,
          ...(response.requestBody ? { body: { mode: 'raw', raw: response.requestBody } } : {}),
        },
        code: 200,
        header: [],
        body: response.body ?? '',
      })),
    })),
  }
}

function audit(requests: Req[]) {
  const parsed = parseCollection(build(requests))
  const findings = runAudit(parsed)
  const byRule = new Map<string, Finding>(findings.map((finding) => [finding.ruleId, finding]))
  const names = (ruleId: string) =>
    (byRule.get(ruleId)?.affected ?? []).map((id) => parsed.requests.find((request) => request.id === id)?.name ?? id)
  return { parsed, findings, byRule, names }
}

const SAILPOINT = 'https://acme.api.identitynow.com'

test('personal data in saved examples is a warning and in request bodies information, with masked evidence', () => {
  const body = JSON.stringify({ id: 'u1', mail: EMAIL, dateOfBirth: '1985-05-12', employeeId: 'E123456', bank: IBAN })
  const { byRule, names } = audit([
    { name: 'Create', method: 'POST', url: `${SAILPOINT}/v3/identities`, json: { mail: EMAIL, phone: '0612345678', note: 'ok' } },
    {
      name: 'Get',
      url: `${SAILPOINT}/v3/identities/1`,
      responses: [
        { name: '200', body },
        { name: 'Posted', requestBody: JSON.stringify({ card: CARD }) },
      ],
    },
    {
      name: 'Clean',
      url: `${SAILPOINT}/v3/identities/2`,
      responses: [{ name: '200', body: JSON.stringify({ id: 'x', mail: 'someone@example.com' }) }],
    },
  ])
  assert.equal(byRule.get('PII_IN_SAVED_RESPONSE')?.severity, 'warning')
  assert.equal(byRule.get('PII_IN_REQUEST_BODY')?.severity, 'info')
  assert.deepEqual(names('PII_IN_SAVED_RESPONSE'), ['Get'])
  assert.deepEqual(names('PII_IN_REQUEST_BODY'), ['Create'])
  const locations = (byRule.get('PII_IN_SAVED_RESPONSE')?.evidence ?? []).map((entry) => entry.location).join('\n')
  assert.match(locations, /body email at mail/)
  assert.match(locations, /body date-of-birth at dateOfBirth/)
  assert.match(locations, /body employee-id at employeeId/)
  assert.match(locations, /body iban at bank/)
  assert.match(locations, /original request body card/)
  const text = JSON.stringify([...byRule.values()].filter((finding) => finding.category === 'identity'))
  for (const secret of ['jane.doe', IBAN.slice(4), CARD.slice(0, 12), '1985-05-12', 'E123456', '0612345678'])
    assert.ok(!text.includes(secret), `leaks ${secret}`)
})

test('an approver who is also the requester is reported when both are literals', () => {
  const { names } = audit([
    {
      name: 'Self',
      method: 'POST',
      url: `${SAILPOINT}/v3/access-requests`,
      json: { requestedFor: [{ id: 'jane' }], requestedBy: 'jane', approver: 'jane' },
    },
    {
      name: 'Nested',
      method: 'POST',
      url: `${SAILPOINT}/v3/access-requests`,
      json: { requester: { id: 'U1' }, decision: { approvedBy: { id: 'u1' } } },
    },
    { name: 'Different', method: 'POST', url: `${SAILPOINT}/v3/access-requests`, json: { requestedBy: 'jane', approver: 'bob' } },
    { name: 'Variables', method: 'POST', url: `${SAILPOINT}/v3/access-requests`, json: { requestedBy: '{{user}}', approver: '{{user}}' } },
    { name: 'Not governance', method: 'POST', url: 'https://api.acme-corp.com/tickets', json: { requestedBy: 'jane', approver: 'jane' } },
  ])
  assert.deepEqual(names('GOVERNANCE_SELF_APPROVAL').sort(), ['Nested', 'Self'])
})

test('approving many certification items in one call is a warning', () => {
  const decisions = (count: number, decision = 'APPROVE') => Array.from({ length: count }, (_, index) => ({ id: `item${index}`, decision }))
  const { names, byRule } = audit([
    { name: 'Bulk', method: 'POST', url: `${SAILPOINT}/v3/certifications/{{id}}/decide`, json: decisions(8) },
    { name: 'Wrapped', method: 'POST', url: `${SAILPOINT}/v3/certifications/{{id}}/decide`, json: { decisions: decisions(5, 'approved') } },
    { name: 'Few', method: 'POST', url: `${SAILPOINT}/v3/certifications/{{id}}/decide`, json: decisions(2) },
    { name: 'Revokes', method: 'POST', url: `${SAILPOINT}/v3/certifications/{{id}}/decide`, json: decisions(8, 'REVOKE') },
    { name: 'Endpoint', method: 'POST', url: `${SAILPOINT}/v3/certifications/{{id}}/bulk-approve` },
    { name: 'List', url: `${SAILPOINT}/v3/certifications` },
  ])
  assert.deepEqual(names('CERTIFICATION_BULK_APPROVE').sort(), ['Bulk', 'Endpoint', 'Wrapped'])
  assert.equal(byRule.get('CERTIFICATION_BULK_APPROVE')?.severity, 'warning')
})

test('governance endpoints of the supported products are classified', () => {
  const classify = (method: string, url: string) => {
    const parsed = parseCollection({ info: { name: 'x' }, item: [{ name: 'r', request: { method, url } }] })
    const request = parsed.requests[0]
    return classifyEndpoint(endpointContext(request, splitUrl(request.url, parsed), requestParams(request)))
  }
  assert.equal(classify('POST', `${SAILPOINT}/v3/access-requests`), 'iga.access-request')
  assert.equal(classify('GET', `${SAILPOINT}/v3/certifications`), 'iga.certification')
  assert.equal(classify('GET', `${SAILPOINT}/v3/campaigns`), 'iga.certification')
  assert.equal(classify('GET', `${SAILPOINT}/beta/sod-policies`), 'iga.sod')
  assert.equal(classify('GET', `${SAILPOINT}/beta/sod-violations`), 'iga.sod')
  assert.equal(classify('POST', 'https://acme.saviyntcloud.com/ECM/api/v5/createrequest'), 'iga.access-request')
  assert.equal(classify('POST', 'https://oim.acme-corp.com/AppServer/api/entities/PersonWantsOrg'), 'iga.access-request')
  assert.equal(classify('GET', 'https://iiq.acme-corp.com/identityiq/scim/v2/Users'), 'scim.users')
  assert.equal(classify('GET', 'https://acme.omada.cloud/OData/DataObjects/Resource'), 'unknown')
})

test('personal data rules follow the iam-iga pack', () => {
  const raw = build([
    { name: 'Get', url: `${SAILPOINT}/v3/identities/1`, responses: [{ name: '200', body: JSON.stringify({ mail: EMAIL }) }] },
  ])
  assert.ok(runAuditDetailed(parseCollection(raw)).findings.some((finding) => finding.ruleId === 'PII_IN_SAVED_RESPONSE'))
  assert.ok(
    !runAuditDetailed(parseCollection(raw), { rulePacks: { disabled: ['iam-iga'] } }).findings.some(
      (finding) => finding.ruleId === 'PII_IN_SAVED_RESPONSE'
    )
  )
})

test('sanitizing can also remove personal data, request bodies keep runnable variables', () => {
  const raw = {
    ...build([
      {
        name: 'Create',
        method: 'POST',
        url: `${SAILPOINT}/v3/identities`,
        json: { mail: EMAIL, phone: '0612345678', manager: '{{manager}}' },
        responses: [
          {
            name: '201',
            body: JSON.stringify({ id: '1', mail: EMAIL, dateOfBirth: '1985-05-12', iban: IBAN }),
            requestBody: JSON.stringify({ mail: EMAIL }),
          },
        ],
      },
    ]),
  }
  const plain = redactCollection(raw)
  assert.ok(JSON.stringify(plain.json).includes(EMAIL), 'credential sanitizing alone keeps personal data')

  const scrubbed = redactCollection(raw, { scrubPii: true })
  const text = JSON.stringify(scrubbed.json)
  for (const secret of [EMAIL, IBAN, '0612345678', '1985-05-12']) assert.ok(!text.includes(secret), `still contains ${secret}`)
  const item = (
    scrubbed.json as {
      item: Array<{ request: { body: { raw: string } }; response: Array<{ body: string; originalRequest: { body: { raw: string } } }> }>
    }
  ).item[0]
  const request = JSON.parse(item.request.body.raw) as Record<string, string>
  assert.equal(request.mail, PII_VARIABLES.email)
  assert.equal(request.phone, PII_VARIABLES.phone)
  assert.equal(request.manager, '{{manager}}')
  assert.equal(JSON.parse(item.response[0].body).mail, '{{REDACTED}}')
  assert.equal(JSON.parse(item.response[0].originalRequest.body.raw).mail, '{{REDACTED}}')
  assert.ok(scrubbed.redactedCount >= 6)

  const again = redactCollection(scrubbed.json, { scrubPii: true })
  assert.equal(again.redactedCount, 0, 'scrubbing twice changes nothing')
  assert.ok(
    !JSON.stringify(redactCollection(raw, { scrubPii: true }).json).includes('jane.doe'),
    'the original input is not modified or leaked'
  )
  assert.ok(JSON.stringify(raw).includes(EMAIL), 'the input object is untouched')
})

test('the CLI removes personal data only with --sanitize and --redact-pii together', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'postscope-pii-'))
  try {
    const file = path.join(dir, 'ids.postman_collection.json')
    fs.writeFileSync(
      file,
      JSON.stringify(build([{ name: 'Create', method: 'POST', url: `${SAILPOINT}/v3/identities`, json: { mail: EMAIL } }]))
    )
    const run = (...args: string[]) =>
      spawnSync(process.execPath, ['--import', 'tsx', 'cli/postscope.ts', ...args], { encoding: 'utf8', cwd: process.cwd() })
    const out = path.join(dir, 'clean.json')
    const result = run(file, '--sanitize', out, '--redact-pii', '--fail-on', 'none')
    assert.equal(result.status, 0, result.stderr)
    assert.ok(!fs.readFileSync(out, 'utf8').includes(EMAIL))
    const keep = path.join(dir, 'keep.json')
    assert.equal(run(file, '--sanitize', keep, '--fail-on', 'none').status, 0)
    assert.ok(fs.readFileSync(keep, 'utf8').includes(EMAIL))
    const bad = run(file, '--redact-pii')
    assert.equal(bad.status, 2)
    assert.match(bad.stderr, /--redact-pii needs --sanitize/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
