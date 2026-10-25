import { useMemo } from 'react'
import { Fingerprint, Key, ShieldWarning, UsersThree } from '@phosphor-icons/react'
import { SeverityBadge } from '../components/SeverityBadge'
import type { Finding } from '../lib/auditor'
import type { ParsedCollection } from '../lib/parser'
import type { AppLocation } from '../lib/appRoutes'
import { groupPrivileged } from '../lib/iam/admin'
import { buildLifecycleMatrix } from '../lib/iam/lifecycle'
import { broadScopeReason } from '../lib/iam/oauth'
import { profileOf } from '../lib/iam/platforms'
import { isEmptyProfile, type OAuthClient, type PlatformId } from '../lib/iam/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

interface IdentityPageProps {
  parsed: ParsedCollection
  /** Every active finding. The page picks the identity ones. */
  findings: Finding[]
  onLocationChange: (next: AppLocation, replace?: boolean) => void
}

const FAMILY_LABELS: Record<string, string> = {
  'access-management': 'Access management',
  ciam: 'Customer identity',
  governance: 'Governance and administration',
  'privileged-access': 'Privileged access',
  'cloud-iam': 'Cloud IAM',
}

const KIND_LABELS: Record<string, string> = {
  'role-assignment': 'Role assignment',
  'policy-change': 'Policy change',
  'credential-mint': 'Credential creation',
  'safe-admin': 'Safe or vault administration',
  'secret-retrieval': 'Secret retrieval',
  'secret-write': 'Secret write',
}

function platformName(id: string): string {
  return profileOf(id as PlatformId)?.fingerprint.name ?? (id === 'unspecified' ? 'Not detected' : id)
}

function RequestLink({ id, onOpen }: { id: string; onOpen: (id: string) => void }) {
  return (
    <button
      type="button"
      className="text-left text-primary underline-offset-2 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => onOpen(id)}
    >
      {id}
    </button>
  )
}

function ClientRow({ client, onOpen }: { client: OAuthClient; onOpen: (id: string) => void }) {
  const first = client.requestIds[0]
  return (
    <TableRow>
      <TableCell className="text-xs">
        <p className="font-medium">{client.clientId ?? 'no client id'}</p>
        <p className="text-muted-foreground">
          {client.source === 'auth-helper' ? `helper, ${client.owner}` : first ? <RequestLink id={first} onOpen={onOpen} /> : client.owner}
        </p>
      </TableCell>
      <TableCell className="text-xs">{client.grant.replace(/_/g, ' ')}</TableCell>
      <TableCell className="text-xs">{client.clientAuth.replace(/_/g, ' ')}</TableCell>
      <TableCell className="text-xs">
        <Badge
          variant={client.pkce === 'S256' ? 'success' : client.pkce === 'absent' || client.pkce === 'plain' ? 'warning' : 'secondary'}
          className="font-normal"
        >
          {client.pkce === 'not-applicable' ? 'n/a' : client.pkce}
        </Badge>
      </TableCell>
      <TableCell className="break-all text-xs">{client.redirectUris.length ? client.redirectUris.join(', ') : 'none'}</TableCell>
      <TableCell className="text-xs">
        <div className="flex flex-wrap gap-1">
          {client.scopes.length === 0 && <span className="text-muted-foreground">none</span>}
          {client.scopes.map((scope) => (
            <Badge key={scope} variant={broadScopeReason(scope, client) ? 'warning' : 'outline'} className="font-normal">
              {scope}
            </Badge>
          ))}
        </div>
      </TableCell>
    </TableRow>
  )
}

/** Identity view of a collection: platforms, OAuth clients, scopes, tokens, lifecycle coverage and privileged operations. */
export function IdentityPage({ parsed, findings, onLocationChange }: IdentityPageProps) {
  const profile = parsed.identity
  const identityFindings = useMemo(() => findings.filter((finding) => finding.category === 'identity'), [findings])
  const lifecycle = useMemo(() => buildLifecycleMatrix(profile?.lifecycle ?? []), [profile])
  const privileged = useMemo(() => groupPrivileged(profile?.privileged ?? []), [profile])
  const openRequest = (id: string) => onLocationChange({ page: 'requests', requestId: id })
  const openFinding = (ruleId: string) => onLocationChange({ page: 'security', rule: ruleId })

  if (!profile || isEmptyProfile(profile)) {
    return (
      <div className="flex flex-col gap-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Identity</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            No identity platform, OAuth flow or token was found in this collection. The identity checks switch on by themselves when a
            collection talks to an identity provider, and they can be forced on in the Rules dialog.
          </p>
        </div>
      </div>
    )
  }

  const dangerCount = privileged.reduce((total, group) => total + group.dangerCount, 0)
  const broadScopes = profile.scopes.filter((scope) => broadScopeReason(scope.scope, { clientAuth: 'client_secret_basic' })).length

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Identity</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          What this collection says about identity: which platforms it talks to, how clients authenticate, which scopes and tokens it holds,
          whether accounts can be taken away as well as created, and which requests change privileges. Everything is read from the export,
          and values are masked.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Platforms', value: profile.platforms.length, icon: Fingerprint },
          { label: 'OAuth clients', value: profile.oauthClients.length, icon: Key },
          { label: 'Danger zone operations', value: dangerCount, icon: ShieldWarning },
          { label: 'Identity findings', value: identityFindings.length, icon: UsersThree },
        ].map(({ label, value, icon: Icon }) => (
          <Card key={label}>
            <CardContent className="flex items-center gap-3 p-4">
              <Icon className="h-6 w-6 text-muted-foreground" weight="fill" aria-hidden />
              <div>
                <p className="text-2xl font-semibold leading-none">{value}</p>
                <p className="mt-1 text-xs text-muted-foreground">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <section aria-labelledby="identity-platforms" className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <h2 id="identity-platforms" className="sr-only">
          Platforms
        </h2>
        {profile.platforms.length === 0 && (
          <p className="text-sm text-muted-foreground">No known identity platform was recognized. OAuth requests are listed below.</p>
        )}
        {profile.platforms.map((platform) => {
          const known = profileOf(platform.id)
          return (
            <Card key={platform.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{platform.name}</CardTitle>
                  <Badge variant="outline" className="shrink-0 font-normal">
                    {Math.round(platform.confidence * 100)}% confidence
                  </Badge>
                </div>
                <CardDescription>{FAMILY_LABELS[platform.family] ?? platform.family}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <p>
                  {platform.requestCount} request{platform.requestCount === 1 ? '' : 's'}
                  {platform.hosts.length ? `, ${platform.hosts.join(', ')}` : ''}
                </p>
                {known && (
                  <p className="text-muted-foreground">
                    Expected variables: {known.expectedVariables.map((name) => `{{${name}}}`).join(', ')}
                  </p>
                )}
                {platform.signals.length > 0 && <p className="text-muted-foreground">Signals: {platform.signals.slice(0, 3).join('; ')}</p>}
              </CardContent>
            </Card>
          )
        })}
      </section>

      {profile.oauthClients.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">OAuth clients</CardTitle>
            <CardDescription>
              Flow, client authentication, PKCE, redirect URIs and scopes. Broad scopes are highlighted ({broadScopes} in this collection).
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Flow</TableHead>
                  <TableHead>Authentication</TableHead>
                  <TableHead>PKCE</TableHead>
                  <TableHead>Redirect URIs</TableHead>
                  <TableHead>Scopes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {profile.oauthClients.map((client) => (
                  <ClientRow key={client.key} client={client} onOpen={openRequest} />
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {profile.tokens.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Tokens stored in the collection</CardTitle>
            <CardDescription>Only masked previews. Rotate and remove them. JWTs can be decoded from the request details.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kind</TableHead>
                  <TableHead>Where</TableHead>
                  <TableHead>Preview</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {profile.tokens.map((token, index) => (
                  <TableRow key={`${token.location}-${index}`}>
                    <TableCell className="text-xs">{token.kind.replace(/-/g, ' ')}</TableCell>
                    <TableCell className="text-xs">
                      {token.requestId ? <RequestLink id={token.requestId} onOpen={openRequest} /> : 'collection'}, {token.location}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{token.preview}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {lifecycle.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Joiner, mover, leaver coverage</CardTitle>
            <CardDescription>Requests that create, change and take away access, per platform.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Platform</TableHead>
                  <TableHead>Joiner</TableHead>
                  <TableHead>Mover</TableHead>
                  <TableHead>Disable</TableHead>
                  <TableHead>Remove access</TableHead>
                  <TableHead>Revoke sessions</TableHead>
                  <TableHead>Delete</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lifecycle.map((row) => (
                  <TableRow key={row.platform}>
                    <TableCell className="text-xs font-medium">{platformName(row.platform)}</TableCell>
                    {[row.joiner, row.mover, row.disable, row.removeAccess, row.revoke, row.delete].map((count, index) => (
                      <TableCell key={index} className="text-xs">
                        {count > 0 ? count : <span className="text-muted-foreground">none</span>}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {privileged.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Privileged operations</CardTitle>
            <CardDescription>
              Admin plane and PAM requests per platform. The danger zone holds state-changing operations and secret retrievals.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {privileged.map((group) => (
              <div key={group.platform}>
                <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {platformName(group.platform)} ({group.dangerCount} in the danger zone)
                </p>
                <ul className="space-y-1">
                  {group.operations.map((operation, index) => (
                    <li
                      key={`${operation.requestId}-${index}`}
                      className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/35 px-3 py-2 text-xs"
                    >
                      <Badge variant={operation.danger ? 'critical' : 'secondary'} className="font-normal">
                        {operation.danger ? 'Danger zone' : 'Read'}
                      </Badge>
                      <span>{KIND_LABELS[operation.kind] ?? operation.kind}</span>
                      <span className="font-mono text-muted-foreground">
                        {operation.method} {operation.path}
                      </span>
                      {operation.topTier && (
                        <Badge variant="warning" className="font-normal">
                          {operation.topTier}
                        </Badge>
                      )}
                      <RequestLink id={operation.requestId} onOpen={openRequest} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {profile.scim.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">SCIM provisioning targets</CardTitle>
            <CardDescription>Systems the collection provisions into, with the resources and methods used.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Target</TableHead>
                  <TableHead>Resources</TableHead>
                  <TableHead>Requests</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {profile.scim.map((target) => (
                  <TableRow key={target.target}>
                    <TableCell className="text-xs font-medium">{target.target}</TableCell>
                    <TableCell className="text-xs">{target.resources.join(', ')}</TableCell>
                    <TableCell className="text-xs">
                      {Object.entries(target.operations)
                        .map(([method, count]) => `${method} ${count}`)
                        .join(', ')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Identity findings</CardTitle>
          <CardDescription>The same findings appear on the Security page, filtered by the Identity category.</CardDescription>
        </CardHeader>
        <CardContent>
          {identityFindings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No identity findings.</p>
          ) : (
            <ul className="space-y-2">
              {identityFindings.map((finding) => (
                <li key={finding.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/35 px-3 py-2 text-sm">
                  <SeverityBadge severity={finding.severity} />
                  <span className="min-w-0 flex-1">{finding.title}</span>
                  <span className="text-xs text-muted-foreground">{finding.affected.length || finding.evidence?.length || 1}</span>
                  <Button variant="ghost" size="sm" onClick={() => openFinding(finding.ruleId)}>
                    View
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
