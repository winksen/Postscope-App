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
