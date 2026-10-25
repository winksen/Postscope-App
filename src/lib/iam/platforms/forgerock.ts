import { NON_PRODUCTION_LABEL, type PlatformFingerprint, type PlatformProfile } from './types'

const fingerprint: PlatformFingerprint = {
  id: 'forgerock',
  name: 'ForgeRock and Ping Advanced Identity Cloud',
  family: 'access-management',
  hosts: [/(?:^|\.)forgeblocks\.com$/, /(?:^|\.)forgerock\.io$/],
  strongPaths: [/^\/am\/oauth2\//i, /^\/openidm\//i, /^\/am\/json\//i],
  paths: [],
  headers: [
    { name: /^x-openam-username$/i, label: 'X-OpenAM-Username' },
    { name: /^x-openam-password$/i, label: 'X-OpenAM-Password' },
  ],
  tokens: [],
  ports: [],
  variables: [/forgerock|openam|openidm|forgeblocks/i],
  authTypes: [],
}

const TENANT_HOST = /^([a-z0-9-]+)\.forgeblocks\.com$/
const REALM_PATH = /\/realms\/(?:root\/realms\/)?([^/*]+)/i

export const forgerockProfile: PlatformProfile = {
  id: 'forgerock',
  fingerprint,
  tokenFormats: [
    'OAuth 2.0 access and ID tokens (JWT or opaque)',
    'SSO session token (iPlanetDirectoryPro cookie)',
    'Service account JWT bearer assertions',
  ],
  expectedVariables: ['tenantFqdn', 'realm', 'openamClientId'],
  recommendation: 'Use {{tenantFqdn}} and {{realm}} for the tenant, and never send X-OpenAM-Username and X-OpenAM-Password as literals.',
  tenantIdentifiers: (url) => {
    const found: Array<{ kind: 'org-domain' | 'realm'; value: string; variable: string }> = []
    if (url.host && TENANT_HOST.test(url.host)) found.push({ kind: 'org-domain', value: url.host, variable: 'tenantFqdn' })
    const realm = url.host && TENANT_HOST.test(url.host) ? REALM_PATH.exec(url.path)?.[1] : undefined
    if (realm && realm !== 'root') found.push({ kind: 'realm', value: realm, variable: 'realm' })
    return found
  },
  environmentOf: (url) => {
    const label = url.host ? TENANT_HOST.exec(url.host)?.[1] : undefined
    if (!label) return undefined
    return NON_PRODUCTION_LABEL.test(label) ? 'development' : 'production'
  },
}
