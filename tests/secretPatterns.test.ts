import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SECRET_PATTERNS,
  decodeBasicCredentials,
  findSecretPatterns,
  isHighEntropyLiteral,
  isLikelySecretValue,
  isSensitiveHeader,
  isSensitiveKey,
  maskSecret,
  maskUsername,
  redactSecretsInText,
  shannonEntropy,
} from '../src/lib/secretPatterns'
import { extractVariableNames, isVariableOrEmpty, toVariableName } from '../src/lib/variables'
import { FAKE, PROVIDER_SAMPLES } from './fixtures'

test('detects provider token formats', () => {
  const text = `gh ${FAKE.githubToken} aws ${FAKE.awsKeyId} jwt ${FAKE.jwt} mongodb://user:pa55word@db.example.com/app`
  const ids = findSecretPatterns(text).map((match) => match.patternId)
  for (const id of ['github-token', 'aws-access-key', 'jwt', 'connection-string']) assert.ok(ids.includes(id), id)
})

test('does not flag connection strings whose password is a variable', () => {
  assert.equal(findSecretPatterns('postgres://user:{{dbPassword}}@db/app').length, 0)
})

test('classifies sensitive keys without common false positives', () => {
  for (const key of ['password', 'newPassword', 'client_secret', 'access_token', 'apiKey', 'x-api-key', 'sessionId', 'privateKey']) {
    assert.equal(isSensitiveKey(key), true, key)
  }
  for (const key of ['bypass', 'compass', 'tokenUrl', 'token_type', 'secretName', 'pageToken', 'passwordPolicy', 'username']) {
    assert.equal(isSensitiveKey(key), false, key)
  }
  assert.equal(isSensitiveHeader('Authorization'), true)
  assert.equal(isSensitiveHeader('Content-Type'), false)
})

test('treats placeholders and variables as non-secrets', () => {
  for (const value of ['', '{{token}}', 'Bearer {{auth-token}}', '<string>', 'changeme', 'your-api-key', 'demo-key-1', 'xxx', 'abc']) {
    assert.equal(isLikelySecretValue(value), false, value)
  }
  assert.equal(isLikelySecretValue(FAKE.password), true)
})

test('masks values without revealing short secrets', () => {
  assert.equal(maskSecret('hunter22'), '•••••• (8 chars)')
  assert.match(maskSecret(`Bearer ${FAKE.jwt}`), /^Bearer eyJh•+ \(\d+ chars\)$/)
  assert.ok(!redactSecretsInText(`token=${FAKE.githubToken}`).includes(FAKE.githubToken))
})

test('variable helpers', () => {
  assert.deepEqual(extractVariableNames('{{a}} {{ b-c }} {{$guid}} {{a}}'), ['a', 'b-c'])
  assert.equal(isVariableOrEmpty('  '), true)
  assert.equal(isVariableOrEmpty('Bearer {{x.y}}'), true)
  assert.equal(isVariableOrEmpty('literal'), false)
  assert.equal(toVariableName('x-api key!'), 'x-api_key')
})

test('detects every added provider token format and ignores near misses', () => {
  for (const [id, sample] of Object.entries(PROVIDER_SAMPLES)) {
    const found = findSecretPatterns(`value=${sample.token};`)
    assert.deepEqual(
      found.map((match) => [match.patternId, match.label]),
      [[id, sample.label]],
      id
    )
    assert.equal(found[0].match.includes(sample.token) || sample.token.includes(found[0].match), true, id)
    assert.deepEqual(findSecretPatterns(`value=${sample.near};`), [], `${id} near miss`)
    assert.ok(!redactSecretsInText(`x ${sample.token} y`).includes(sample.token), `${id} redaction`)
  }
})

test('every provider pattern has a sample', () => {
  const covered = new Set(Object.keys(PROVIDER_SAMPLES))
  const added = SECRET_PATTERNS.map((pattern) => pattern.id).filter(
    (id) =>
      ![
        'private-key',
        'aws-access-key',
        'github-token',
        'gitlab-token',
        'slack-token',
        'slack-webhook',
        'stripe-key',
        'google-api-key',
        'anthropic-key',
        'openai-key',
        'sendgrid-key',
        'twilio-key',
        'npm-token',
        'azure-storage-key',
        'jwt',
        'connection-string',
      ].includes(id)
  )
  assert.deepEqual(added.sort(), [...covered].sort())
})

test('decodes Basic credentials and masks the user name', () => {
  const token = (text: string) => `Basic ${Buffer.from(text).toString('base64')}`
  assert.deepEqual(decodeBasicCredentials(token('svc:S3cure!Passw0rd')), { username: 'svc', password: 'S3cure!Passw0rd' })
  assert.deepEqual(decodeBasicCredentials(token('svc:{{password}}')), { username: 'svc', password: '{{password}}' })
  assert.equal(decodeBasicCredentials('Basic not*base64'), null)
  assert.equal(decodeBasicCredentials(token('nocolon')), null)
  assert.equal(decodeBasicCredentials('Basic'), null)
  assert.equal(maskUsername('service-account'), 's••••••')
  assert.equal(maskUsername('a'), '•')
})

test('high entropy literals ignore ids, URLs, sentences and short values', () => {
  assert.equal(isHighEntropyLiteral('q8Zr2LmXa9PdW4sT7vBn3KcYe6'), true)
  assert.equal(isHighEntropyLiteral('Bearer q8Zr2LmXa9PdW4sT7vBn3KcYe6'), true)
  for (const value of [
    '123e4567-e89b-12d3-a456-426614174000',
    'a3f9c2d41b7e4a8f90c1',
    'https://example.com/a/very/long/path/value',
    'this is a long sentence of ordinary words',
    'aaaaaaaaaaaaaaaaaaaaaaaa',
    'short-value',
    '{{a_very_long_variable_reference_name}}',
  ]) {
    assert.equal(isHighEntropyLiteral(value), false, value)
  }
  assert.equal(isHighEntropyLiteral('a3f9c2d41b7e4a8f90c1d2e3f4a5b6c7'), true)
  assert.ok(shannonEntropy('abcdefgh') > 2.9 && shannonEntropy('aaaa') === 0)
})
