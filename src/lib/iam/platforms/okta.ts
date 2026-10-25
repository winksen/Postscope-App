import type { PlatformFingerprint, PlatformProfile } from './types'

const fingerprint: PlatformFingerprint = {
  id: 'okta',
  name: 'Okta Workforce Identity',
  family: 'access-management',
  hosts: [/(?:^|\.)(?:okta|oktapreview|okta-emea|okta-gov|trexcloud)\.com$/],
  strongPaths: [/^\/oauth2\/(?:default|aus[a-z0-9]+)\/v1\//i, /^\/api\/v1\/(?:authorizationservers|sessions|factors|idps|iam)\b/i],
  paths: [/^\/api\/v1\/(?:users|groups|apps|policies|roles|logs|org|zones|trustedorigins)\b/i],
  headers: [{ name: /^authorization$/i, value: /^SSWS\s/, label: 'Authorization: SSWS' }],
  tokens: [],
  ports: [],
  variables: [/okta/i],
  authTypes: [],
}

const ORG_HOST = /^([a-z0-9-]+)\.(okta|oktapreview|okta-emea|okta-gov)\.com$/

export const oktaProfile: PlatformProfile = {
  id: 'okta',
  fingerprint,
  tokenFormats: ['API token (SSWS), 42 characters', 'OAuth 2.0 access and ID tokens (JWT)', 'Session cookie (sid)'],
  expectedVariables: ['oktaDomain', 'oktaApiToken', 'oktaClientId'],
  recommendation: 'Use {{oktaDomain}} for the org URL, and OAuth 2.0 service apps with private_key_jwt instead of SSWS API tokens.',
  tenantIdentifiers: (url) => {
    if (!url.host || !ORG_HOST.test(url.host)) return []
    return [{ kind: 'org-domain', value: url.host, variable: 'oktaDomain' }]
  },
  environmentOf: (url) => {
    if (!url.host) return undefined
    if (/\.oktapreview\.com$/.test(url.host)) return 'preview'
    return ORG_HOST.test(url.host) ? 'production' : undefined
  },
  deprecated: (_request, url) =>
    /^\/api\/v1\/authn(?:\/|$)/i.test(url.path)
      ? ['Okta classic Authentication API (/api/v1/authn), replaced by OIDC and the interaction code flow']
      : [],
}
