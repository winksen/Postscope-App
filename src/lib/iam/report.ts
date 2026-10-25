import { buildLifecycleMatrix } from './lifecycle'
import { isEmptyProfile, type IdentityProfile } from './types'

/** The identity section of the JSON report. Everything in it is already masked: client ids and token previews never hold a full value. */
export function identityReportSection(profile: IdentityProfile | undefined) {
  if (!profile || isEmptyProfile(profile)) return undefined
  const endpointCounts: Record<string, number> = {}
  for (const endpoint of profile.endpoints) endpointCounts[endpoint.class] = (endpointCounts[endpoint.class] ?? 0) + 1
  return {
    platforms: profile.platforms.map((platform) => ({
      id: platform.id,
      name: platform.name,
      family: platform.family,
      confidence: platform.confidence,
      signals: platform.signals,
      requestCount: platform.requestCount,
      hosts: platform.hosts,
    })),
    endpointCounts,
    endpoints: profile.endpoints.map((endpoint) => ({
      requestId: endpoint.requestId,
      class: endpoint.class,
      platform: endpoint.platform,
      method: endpoint.method,
      host: endpoint.host,
      path: endpoint.path,
    })),
    oauthClients: profile.oauthClients.map((client) => ({
      source: client.source,
      owner: client.owner,
      grant: client.grant,
      clientId: client.clientId,
      clientAuth: client.clientAuth,
      pkce: client.pkce,
      redirectUris: client.redirectUris,
      scopes: client.scopes,
      tokenUrl: client.tokenUrl,
      authUrl: client.authUrl,
      platform: client.platform,
      requestIds: client.requestIds,
    })),
    scopes: profile.scopes.map((scope) => ({ scope: scope.scope, clients: scope.clients, requestCount: scope.requestIds.length })),
    grants: profile.grants.map((grant) => ({ grant: grant.grant, requestCount: grant.requestIds.length })),
    scim: (profile.scim ?? []).map((target) => ({
      target: target.target,
      platform: target.platform,
      resources: target.resources,
      operations: target.operations,
      requestCount: target.requestIds.length,
    })),
    lifecycle: buildLifecycleMatrix(profile.lifecycle ?? []),
    tokens: profile.tokens.map((token) => ({
      kind: token.kind,
      requestId: token.requestId,
      location: token.location,
      preview: token.preview,
    })),
  }
}
