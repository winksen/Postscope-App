/**
 * Test fixtures. Fake credentials are assembled at runtime so no secret-shaped literal is committed
 * (keeps repository secret scanners quiet while still exercising the provider patterns).
 */
export const FAKE = {
  githubToken: ['ghp', '_', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'].join(''),
  awsKeyId: ['AKIA', 'IOSFODNN7', 'EXAMPLE'].join(''),
  jwt: ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'].join('.'),
  bearer: 'live-bearer-token-9f8e7d6c5b4a',
  apiKey: 'k3y-1234567890abcdef',
  password: 'S3cure!Passw0rd',
  clientSecret: 'cs-0a1b2c3d4e5f6a7b8c9d',
  refreshToken: 'rt-abcdefghijklmnopqrstuvwxyz012345',
}

export function kitchenSinkCollection(): Record<string, unknown> {
  return {
    info: { name: 'Kitchen sink', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    auth: { type: 'bearer', bearer: [{ key: 'token', value: FAKE.bearer, type: 'string' }] },
    protocolProfileBehavior: { strictSSL: false },
    event: [{ listen: 'prerequest', script: { exec: [`pm.environment.set("accessToken", "${FAKE.refreshToken}")`], type: 'text/javascript' } }],
    variable: [
      { key: 'baseUrl', value: 'http://api.corp.internal' },
      { key: 'clientSecret', value: FAKE.clientSecret },
      { key: 'apiKey', value: 'demo-api-key' },
    ],
    item: [
      {
        name: 'Auth',
        auth: { type: 'basic', basic: [{ key: 'username', value: 'svc' }, { key: 'password', value: FAKE.password }] },
        item: [
          {
            name: 'Login',
            request: {
              method: 'POST',
              header: [{ key: 'Content-Type', value: 'application/json' }],
              url: '{{baseUrl}}/login',
              body: { mode: 'raw', raw: JSON.stringify({ username: 'admin', password: FAKE.password }, null, 2) },
            },
            response: [
              {
                name: 'OK',
                originalRequest: { method: 'POST', header: [{ key: 'Authorization', value: `Bearer ${FAKE.jwt}` }], url: '{{baseUrl}}/login' },
                header: [{ key: 'Set-Cookie', value: 'session_id=abcdef1234567890abcdef; Path=/; HttpOnly' }],
                body: JSON.stringify({ access_token: FAKE.refreshToken, expires_in: 3600 }),
              },
            ],
          },
          {
            name: 'Token exchange',
            request: {
              method: 'POST',
              url: '{{baseUrl}}/oauth/token',
              body: {
                mode: 'urlencoded',
                urlencoded: [
                  { key: 'grant_type', value: 'client_credentials' },
                  { key: 'client_secret', value: FAKE.clientSecret },
                  { key: 'disabled_secret', value: 'ignored-secret-value', disabled: true },
                ],
              },
            },
          },
        ],
      },
      {
        name: 'Users',
        item: [
          {
            name: 'List users',
            event: [{ listen: 'test', script: { exec: ['console.log("token", pm.environment.get("token"))'] } }],
            request: {
              method: 'GET',
              auth: { type: 'noauth' },
              header: [
                { key: 'Authorization', value: 'Bearer {{auth-token}}' },
                { key: 'X-API-Key', value: FAKE.apiKey },
                { key: 'X-Trace', value: '' },
              ],
              url: {
                raw: `https://api.example.com/v1/users?api_key=${FAKE.apiKey}&page=2&pageToken=abcdefghijklmnop`,
                protocol: 'https',
                host: ['api', 'example', 'com'],
                path: ['v1', 'users'],
                query: [
                  { key: 'api_key', value: FAKE.apiKey },
                  { key: 'page', value: '2' },
                  { key: 'pageToken', value: 'abcdefghijklmnop' },
                ],
              },
            },
          },
          {
            name: 'Create user',
            request: {
              method: 'POST',
              auth: { type: 'apikey', apikey: [{ key: 'key', value: 'X-Key' }, { key: 'value', value: FAKE.apiKey }, { key: 'in', value: 'header' }] },
              header: 'Authorization: Token abcdefghijklmnopqrstuvwxyz\nX-Plain: value',
              url: 'https://admin:hunter2pass@legacy.example.com/users',
              body: { mode: 'raw', raw: 'not json but has a secret keyword' },
            },
          },
          {
            name: 'Get user with body',
            request: {
              method: 'GET',
              auth: { type: 'noauth' },
              url: 'http://localhost:8080/users/1',
              body: { mode: 'raw', raw: '{"filter":"active"}' },
              description: { content: 'Fetches one user', type: 'text/plain' },
            },
          },
          {
            name: 'Github hook',
            request: {
              method: 'POST',
              auth: { type: 'noauth' },
              header: [{ key: 'X-Hook-Signature', value: FAKE.githubToken }],
              url: 'https://hooks.example.com/notify',
            },
          },
        ],
      },
      'not-an-object',
      { name: 'Broken folder', item: { not: 'an array' } },
    ],
  }
}

/** A tidy collection that should produce no secret findings. */
export function cleanCollection(): Record<string, unknown> {
  return {
    info: { name: 'Clean', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}' }] },
    variable: [
      { key: 'baseUrl', value: 'https://api.example.com' },
      { key: 'token', value: '' },
      { key: 'apiKey', value: '' },
    ],
    item: [
      {
        name: 'Users',
        item: [
          {
            name: 'List users',
            request: { method: 'GET', url: '{{baseUrl}}/users', description: 'Lists users.' },
          },
          {
            name: 'Create user',
            request: {
              method: 'POST',
              header: [{ key: 'X-API-Key', value: '{{apiKey}}' }],
              url: '{{baseUrl}}/users',
              body: { mode: 'raw', raw: '{"name":"{{name}}","password":"{{user-password}}"}' },
              description: 'Creates a user.',
            },
          },
        ],
      },
    ],
  }
}

/** Secrets hidden in documentation, folder/request variables, path variables and saved example requests. */
export function scopedSecretsCollection(): Record<string, unknown> {
  return {
    info: {
      name: 'Scoped secrets',
      description: { content: `Internal collection. Maintainer token: ${FAKE.githubToken}`, type: 'text/markdown' },
    },
    variable: [{ key: 'baseUrl', value: 'https://api.example.com' }, { key: 'a', value: '1' }, { key: 'b', value: '2' }],
    item: [
      {
        name: 'Admin',
        description: `Run with password: ${FAKE.password} on staging.\nAuthorization: Bearer ${FAKE.bearer}`,
        variable: [
          { key: 'clientSecret', value: FAKE.clientSecret },
          { key: 'region', value: 'eu-west-1' },
        ],
        item: [
          {
            name: 'Get user',
            description: 'Looks up a user. The token: required for every call. Set api_key=your-api-key first.',
            variable: [{ key: 'apiKey', value: FAKE.apiKey }],
            request: {
              method: 'GET',
              auth: { type: 'noauth' },
              url: {
                raw: '{{baseUrl}}/users/:token',
                host: ['{{baseUrl}}'],
                path: ['users', ':token'],
                variable: [{ key: 'token', value: FAKE.refreshToken }, { key: 'id', value: '42' }],
              },
              description: 'Fetches one user.',
            },
            response: [
              {
                name: 'Example',
                originalRequest: {
                  method: 'POST',
                  url: { raw: '{{baseUrl}}/login?api_key=' + FAKE.apiKey, query: [{ key: 'api_key', value: FAKE.apiKey }] },
                  body: { mode: 'raw', raw: JSON.stringify({ username: 'admin', password: FAKE.password }) },
                },
                body: '{}',
              },
            ],
          },
        ],
      },
    ],
  }
}

const rep = (char: string, count: number) => char.repeat(count)

/**
 * One sample per provider pattern, assembled at runtime so no token-shaped literal is committed.
 * `near` values have the right prefix but the wrong length or alphabet and must not match.
 */
export const PROVIDER_SAMPLES: Record<string, { label: string; token: string; near: string }> = {
  'entra-client-secret': { label: 'Microsoft Entra ID client secret', token: ['abc', '8Q', '~', rep('x1Y', 11)].join(''), near: ['abc', '8Q', '~', 'short'].join('') },
  'okta-api-token': { label: 'Okta API token', token: ['SSWS', ' ', '00', rep('aB3_', 10)].join(''), near: ['SSWS', ' ', '00', 'tooshort'].join('') },
  'vault-service-token': { label: 'HashiCorp Vault service token', token: ['hvs', '.', rep('aB3-', 12)].join(''), near: ['hvs', '.', 'short'].join('') },
  'vault-batch-token': { label: 'HashiCorp Vault batch token', token: ['hvb', '.', rep('aB3-', 40)].join(''), near: ['hvb', '.', rep('aB3-', 10)].join('') },
  'vault-recovery-token': { label: 'HashiCorp Vault recovery token', token: ['hvr', '.', rep('aB3-', 12)].join(''), near: ['hvr', '.', 'short'].join('') },
  'postman-api-key': { label: 'Postman API key', token: ['PMAK', '-', rep('a1', 12), '-', rep('b2', 17)].join(''), near: ['PMAK', '-', rep('a1', 12), '-', rep('b2', 5)].join('') },
  'atlassian-token': { label: 'Atlassian API token', token: ['ATATT', '3', rep('xY9_', 45)].join(''), near: ['ATATT', '3', rep('xY9_', 5)].join('') },
  'shopify-token': { label: 'Shopify access token', token: ['shpat', '_', rep('0f', 16)].join(''), near: ['shpat', '_', rep('0f', 4)].join('') },
  'digitalocean-token': { label: 'DigitalOcean token', token: ['dop', '_v1_', rep('0a', 32)].join(''), near: ['dop', '_v1_', rep('0a', 8)].join('') },
  'dockerhub-token': { label: 'Docker Hub access token', token: ['dckr', '_pat_', rep('aB3_', 8)].join(''), near: ['dckr', '_pat_', 'short'].join('') },
  'grafana-service-account': { label: 'Grafana service account token', token: ['glsa', '_', rep('aB', 16), '_', rep('0f', 4)].join(''), near: ['glsa', '_', rep('aB', 4), '_', rep('0f', 4)].join('') },
  'grafana-cloud-token': { label: 'Grafana Cloud token', token: ['glc', '_', rep('aB3/', 12)].join(''), near: ['glc', '_', 'short'].join('') },
  'huggingface-token': { label: 'Hugging Face token', token: ['hf', '_', rep('aBcDe', 7).slice(0, 34)].join(''), near: ['hf', '_', rep('aBcDe', 7).slice(0, 20)].join('') },
  'databricks-token': { label: 'Databricks access token', token: ['dapi', rep('0a', 16)].join(''), near: ['dapi', rep('0a', 4)].join('') },
  'pypi-token': { label: 'PyPI upload token', token: ['pypi', '-', 'AgE', rep('xY9_', 20)].join(''), near: ['pypi', '-', 'AgE', 'short'].join('') },
  'square-token': { label: 'Square access token', token: ['sq0atp', '-', rep('aB3_', 5), 'aB'].join(''), near: ['sq0atp', '-', 'short'].join('') },
}
