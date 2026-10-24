import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { describeLifetime, type JwtInspection, type JwtOccurrence } from '@/lib/iam/jwt'

export interface InspectedToken {
  occurrence: JwtOccurrence
  inspection: JwtInspection
}

const KIND_LABELS: Record<string, string> = {
  personal: 'Personal data',
  privilege: 'Privilege',
  scope: 'Scopes',
  time: 'Time',
  id: 'Identifier',
  other: 'Other',
}

/** Header and masked claims of the JWTs a request holds. Nothing here can be copied back into a working token: the signature and raw values are never shown. */
export function TokenInspector({ tokens }: { tokens: InspectedToken[] }) {
  return (
    <div className="space-y-5" data-testid="token-inspector">
      <p className="text-sm text-muted-foreground">
        Decoded in your browser. The signature is not checked and personal values are masked. Rotate and remove tokens that are stored in a
        collection.
      </p>
      {tokens.map(({ occurrence, inspection }, index) => (
        <section key={`${occurrence.location}-${index}`} className="space-y-3 rounded-xl border border-border p-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">{occurrence.location}</p>
            <Badge variant={inspection.alg.toLowerCase() === 'none' ? 'critical' : 'secondary'} className="font-normal">
              alg {inspection.alg}
            </Badge>
            {inspection.typ && (
              <Badge variant="outline" className="font-normal">
                typ {inspection.typ}
              </Badge>
            )}
            {inspection.idToken && (
              <Badge variant="warning" className="font-normal">
                ID token
              </Badge>
            )}
            {inspection.expired ? (
              <Badge variant="secondary" className="font-normal">
                Expired
              </Badge>
            ) : null}
          </div>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
            {inspection.issuer && (
              <>
                <dt className="text-muted-foreground">Issuer</dt>
                <dd>{inspection.issuer}</dd>
              </>
            )}
            {inspection.kid && (
              <>
                <dt className="text-muted-foreground">Key id</dt>
                <dd>{inspection.kid}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Expires</dt>
            <dd>{inspection.hasExp ? (inspection.expiresAt ?? 'invalid') : 'never (no exp claim)'}</dd>
            {inspection.lifetimeSeconds !== undefined && (
              <>
                <dt className="text-muted-foreground">Lifetime</dt>
                <dd>{describeLifetime(inspection.lifetimeSeconds)}</dd>
              </>
            )}
          </dl>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Claim</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Kind</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inspection.claims.map((claim) => (
                <TableRow key={claim.name}>
                  <TableCell className="font-mono text-xs">{claim.name}</TableCell>
                  <TableCell className="break-all text-xs">{claim.preview}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{KIND_LABELS[claim.kind]}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      ))}
    </div>
  )
}
