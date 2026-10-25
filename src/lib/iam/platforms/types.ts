import type { ParsedRequest } from '../../parser'
import type { EndpointContext } from '../endpoints'
import type { DetectedPlatform, EndpointClass, PlatformId } from '../types'
import type { SplitUrl } from '../url'

export interface HeaderSignal {
  name: RegExp
  /** When set, the header value must match too. */
  value?: RegExp
  label: string
}

/** What identifies a platform in a request. Hosts and paths are written for normalized paths (variables replaced by `*`). */
export interface PlatformFingerprint {
  id: PlatformId
  name: string
  family: DetectedPlatform['family']
  /** Host suffix or exact host patterns. A match is the strongest signal. */
  hosts: RegExp[]
  /** Specific paths that only this platform uses. */
  strongPaths: RegExp[]
  /** Paths that are typical but could belong to other APIs. */
  paths: RegExp[]
  headers: HeaderSignal[]
  /** Token shapes in the header values and auth helper fields. */
  tokens: Array<{ pattern: RegExp; label: string }>
  ports: string[]
  /** Variable names that hint at the platform, such as `{{oktaDomain}}`. */
  variables: RegExp[]
  /** Postman auth helper types that point to the platform (for example `awsv4`). */
  authTypes: string[]
}

/** A value that names one tenant, organization, realm or environment of a platform. */
export interface TenantIdentifier {
  kind: 'tenant-id' | 'org-domain' | 'realm' | 'environment-id'
  /** The literal as written in the URL. */
  value: string
  /** The variable a collection should use instead, such as `oktaDomain`. */
  variable: string
}

export type TenantEnvironment = 'preview' | 'production' | 'development'

/** Everything PostScope knows about one identity platform beyond how to recognize it. */
export interface PlatformProfile {
  id: PlatformId
  fingerprint: PlatformFingerprint
  /** Token formats the platform issues, in words, for reports and the Identity page. */
  tokenFormats: string[]
  /** Variable names collections of this platform should use for tenant specific values. */
  expectedVariables: string[]
  /** Platform specific advice that rules add to their evidence. */
  recommendation: string
  /** Endpoint classes this platform adds to the shared classification. */
  endpointRules?: Array<[EndpointClass, (context: EndpointContext) => boolean]>
  /** Literal tenant identifiers in a request URL. */
  tenantIdentifiers(url: SplitUrl): TenantIdentifier[]
  /** Which kind of tenant a URL points at, when the host says so. */
  environmentOf?(url: SplitUrl): TenantEnvironment | undefined
  /** Descriptions of retired or legacy APIs the request uses. */
  deprecated?(request: ParsedRequest, url: SplitUrl): string[]
}

export const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Environment words in a host label: `acme-dev`, `acme.stg`, `test-acme`. */
export const NON_PRODUCTION_LABEL = /(?:^|[-.])(?:dev|develop|test|stg|stage|staging|qa|uat|preprod|sandbox|demo)(?:[-.]|$)/i
