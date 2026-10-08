import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  findSecretPatterns,
  isLikelySecretValue,
  isSensitiveHeader,
  isSensitiveKey,
  maskSecret,
  redactSecretsInText,
} from '../src/lib/secretPatterns'
import { extractVariableNames, isVariableOrEmpty, toVariableName } from '../src/lib/variables'
import { FAKE } from './fixtures'

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
