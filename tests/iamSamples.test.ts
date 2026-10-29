import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { parseCollection } from '../src/lib/parser'
import { runAudit } from '../src/lib/auditor'
import { SAMPLE_COLLECTIONS } from '../src/lib/sampleCollections'
import { redactCollection } from '../src/lib/redaction'

const dir = path.resolve('public/samples')

function load(file: string) {
  const parsed = parseCollection(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')))
  return { parsed, rules: new Set(runAudit(parsed).map((finding) => finding.ruleId as string)) }
}

const EXPECTED: Record<string, { platforms: string[]; rules: string[] }> = {
  'iam-access-management.postman_collection.json': {
    platforms: ['okta', 'entra'],
    rules: [
      'OAUTH_IMPLICIT_GRANT',
      'OAUTH_PASSWORD_GRANT',
      'OAUTH_PKCE_MISSING',
      'OAUTH_STATE_MISSING',
      'OAUTH_REDIRECT_URI_UNSAFE',
      'OAUTH_TOKEN_ENDPOINT_HTTP',
      'OAUTH_TOKEN_IN_URL',
      'OAUTH_BROAD_SCOPE',
      'OAUTH_CLIENT_SECRET_POST',
      'JWT_ALG_NONE',
      'JWT_SENSITIVE_CLAIMS',
      'SAML_ASSERTION_CAPTURED',
      'SAML_IDP_METADATA_HTTP',
      'SESSION_COOKIE_FLAGS',
      'TOKEN_REVOCATION_NOT_COVERED',
      'MIXED_TENANT_ENVIRONMENTS',
      'DEPRECATED_IDENTITY_API',
    ],
  },
  'iam-provisioning-governance.postman_collection.json': {
    platforms: ['sailpoint', 'okta'],
    rules: [
      'SCIM_BULK_DESTRUCTIVE',
      'SCIM_UNBOUNDED_LIST',
      'SCIM_PRIVILEGE_PATCH',
      'SCIM_CONTENT_TYPE',
      'JML_LEAVER_NOT_COVERED',
      'LEAVER_DELETE_WITHOUT_DISABLE',
      'GOVERNANCE_SELF_APPROVAL',
      'CERTIFICATION_BULK_APPROVE',
      'PII_IN_SAVED_RESPONSE',
    ],
  },
  'iam-privileged-access.postman_collection.json': {
    platforms: ['cyberark', 'beyondtrust', 'vault', 'okta', 'entra'],
    rules: [
      'PAM_RETRIEVED_SECRET_CAPTURED',
      'PAM_VAULT_TOKEN_LITERAL',
      'PAM_ROOT_TOKEN_USAGE',
      'PAM_RETRIEVAL_WITHOUT_REASON',
      'PAM_CHECKOUT_WITHOUT_CHECKIN',
      'PAM_PRIVILEGED_ACCOUNT_LITERAL',
      'PAM_SAFE_ADMIN_CHANGE',
      'PRIVILEGED_ROLE_ASSIGNMENT',
      'MFA_POLICY_WEAKENING',
      'CREDENTIAL_MINTING_ENDPOINT',
      'DEPRECATED_IDENTITY_API',
    ],
  },
}

test('the IAM samples are registered, valid and use fictional hosts', () => {
  for (const file of Object.keys(EXPECTED)) {
    const id = file.replace('.postman_collection.json', '')
    const entry = SAMPLE_COLLECTIONS.find((sample) => sample.id === id)
    assert.ok(entry, `${id} is in the sample list`)
    assert.equal(entry.path, `/samples/${file}`)
    const text = fs.readFileSync(path.join(dir, file), 'utf8')
    assert.ok(!text.includes(String.fromCharCode(0x2014)), 'no em dash')
    for (const host of text.match(/https?:\/\/[a-z0-9.-]+/gi) ?? []) {
      assert.match(
        host,
        /sample-widgets\.net|example-tenant\.|sample-tenant\.|graph\.(?:windows|microsoft)\.|login\.microsoftonline\.com|schema\.getpostman\.com/i,
        `${host} is fictional or a vendor API host`
      )
    }
  }
})

test('each IAM sample shows the findings it is meant to demonstrate', () => {
  for (const [file, expected] of Object.entries(EXPECTED)) {
    const { parsed, rules } = load(file)
    const detected = new Set(parsed.identity?.platforms.map((platform) => platform.id))
    for (const platform of expected.platforms) assert.ok(detected.has(platform as never), `${file}: platform ${platform}`)
    for (const rule of expected.rules) assert.ok(rules.has(rule), `${file}: ${rule}`)
  }
})

test('the IAM samples hold no real credentials, and sanitizing them leaves nothing for the credential rules', () => {
  for (const file of Object.keys(EXPECTED)) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8')
    assert.ok(!/AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|sk_live_|xox[bap]-/.test(text), `${file} has no provider token`)
    const raw = JSON.parse(text) as unknown
    const { json } = redactCollection(raw, { scrubPii: true })
    const audited = runAudit(parseCollection(json)).filter((finding) => finding.category === 'secrets' && finding.severity === 'critical')
    assert.deepEqual(
      audited.map((finding) => finding.ruleId),
      [],
      `${file} still has critical secrets after sanitizing`
    )
  }
})
