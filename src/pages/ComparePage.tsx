import { useMemo, useRef } from 'react'
import { ArrowDown, ArrowUp, ArrowsLeftRight, Books, CheckCircle, FileArrowUp, Minus, X } from '@phosphor-icons/react'
import { SeverityBadge } from '../components/SeverityBadge'
import { compareCollections, type CompareInput, type ComparedFinding, type ComparedRequest } from '../lib/compare'
import type { SavedCollectionMeta } from '../lib/collectionLibrary'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

interface ComparePageProps {
  /** The collection that is open now (the newer version). */
  current: CompareInput
  /** The older version to compare against, once one was chosen. */
  reference: CompareInput | null
  loading: boolean
  library: SavedCollectionMeta[]
  currentLibraryId: string | null
  onChooseFile: (file: File) => void
  onChooseLibrary: (id: string) => void
  onClear: () => void
}

function Delta({ value }: { value: number }) {
  if (value === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <Minus className="h-3.5 w-3.5" aria-hidden /> 0
      </span>
    )
  }
  const better = value > 0
  return (
    <span className={cn('inline-flex items-center gap-1 font-medium', better ? 'text-[hsl(var(--success))]' : 'text-destructive')}>
      {better ? <ArrowUp className="h-3.5 w-3.5" aria-hidden /> : <ArrowDown className="h-3.5 w-3.5" aria-hidden />}
      {better ? `+${value}` : value}
      <span className="sr-only">{better ? ' (better)' : ' (worse)'}</span>
    </span>
  )
}

function requestLabel(request: ComparedRequest): string {
  return `${request.folder ? `${request.folder} / ` : ''}${request.name}`
}

function FindingRows({ findings, empty }: { findings: ComparedFinding[]; empty: string }) {
  if (findings.length === 0) return <p className="px-6 pb-6 text-sm text-muted-foreground">{empty}</p>
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-24">Severity</TableHead>
          <TableHead>Finding</TableHead>
          <TableHead>Where</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {findings.slice(0, 200).map((finding) => (
          <TableRow key={finding.fingerprint}>
            <TableCell>
              <SeverityBadge severity={finding.severity} />
            </TableCell>
            <TableCell>
              <p className="text-sm font-medium">{finding.title}</p>
              <p className="font-mono text-[11px] text-muted-foreground">{finding.ruleId}</p>
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {finding.requestName ?? finding.requestId ?? 'Collection'}
              {finding.location ? `: ${finding.location}` : ''}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function ListCard({ title, description, items }: { title: string; description: string; items: string[] }) {
  if (items.length === 0) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1 text-sm">
          {items.slice(0, 100).map((item) => (
            <li key={item} className="truncate" title={item}>
              {item}
            </li>
          ))}
          {items.length > 100 && <li className="text-muted-foreground">and {items.length - 100} more</li>}
        </ul>
      </CardContent>
    </Card>
  )
}

export function ComparePage({ current, reference, loading, library, currentLibraryId, onChooseFile, onChooseLibrary, onClear }: ComparePageProps) {
  const fileInput = useRef<HTMLInputElement>(null)
  const comparison = useMemo(() => (reference ? compareCollections(reference, current) : null), [reference, current])
  const candidates = library.filter((item) => item.id !== currentLibraryId)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Compare versions</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            See what changed between an older version and the collection that is open now: new and resolved findings, the score change, and requests that were added, removed or edited. Both files are analyzed in your browser.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            className="sr-only"
            aria-label="Choose the older collection file"
            tabIndex={-1}
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) onChooseFile(file)
            }}
          />
          <Button variant="secondary" size="sm" className="gap-2" disabled={loading} onClick={() => fileInput.current?.click()}>
            <FileArrowUp className="h-4 w-4" weight="fill" />
            {reference ? 'Choose another file' : 'Choose older file'}
          </Button>
          {reference && (
            <Button variant="ghost" size="sm" className="gap-2" onClick={onClear}>
              <X className="h-4 w-4" />
              Clear
            </Button>
          )}
        </div>
      </div>

      {!comparison && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ArrowsLeftRight className="h-4 w-4 text-muted-foreground" weight="fill" />
              Pick the older version of {current.parsed.name}
            </CardTitle>
            <CardDescription>The open collection is the newer one. Choose a file, or a collection from the team library.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading && <p role="status" className="text-sm text-muted-foreground">Analyzing the older version...</p>}
            {candidates.length > 0 && (
              <div className="space-y-2">
                <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <Books className="h-4 w-4" weight="fill" /> Team library
                </p>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {candidates.slice(0, 12).map((item) => (
                    <li key={item.id}>
                      <Button variant="secondary" className="h-auto w-full justify-between gap-3 py-2 text-left" disabled={loading} onClick={() => onChooseLibrary(item.id)}>
                        <span className="min-w-0 truncate text-sm">{item.name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{item.requestCount} requests</span>
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {comparison && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Card className="p-5">
              <p className="text-sm font-medium text-muted-foreground">Score</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {comparison.before.score} <span className="text-muted-foreground">to</span> {comparison.after.score}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Change <Delta value={comparison.scoreDelta.total} />, security <Delta value={comparison.scoreDelta.security} />, hygiene <Delta value={comparison.scoreDelta.hygiene} />
              </p>
            </Card>
            <Card className="p-5">
              <p className="text-sm font-medium text-muted-foreground">Findings</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {comparison.findings.added.length} new <span className="text-muted-foreground">/</span> {comparison.findings.resolved.length} resolved
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{comparison.findings.unchanged} unchanged occurrence(s)</p>
            </Card>
            <Card className="p-5">
              <p className="text-sm font-medium text-muted-foreground">Requests</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {comparison.before.totalRequests} <span className="text-muted-foreground">to</span> {comparison.after.totalRequests}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {comparison.requests.added.length} added, {comparison.requests.removed.length} removed, {comparison.requests.changed.length} changed
              </p>
            </Card>
          </div>

          <p className="text-xs text-muted-foreground">
            Before: <span className="font-medium text-foreground">{comparison.before.name}</span>. After: <span className="font-medium text-foreground">{comparison.after.name}</span>.
          </p>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">New findings</CardTitle>
              <CardDescription>Present now and not in the older version. A renamed request keeps its earlier findings.</CardDescription>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <FindingRows findings={comparison.findings.added} empty="No new findings." />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CheckCircle className="h-4 w-4 text-[hsl(var(--success))]" weight="fill" />
                Resolved findings
              </CardTitle>
              <CardDescription>In the older version and gone now.</CardDescription>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <FindingRows findings={comparison.findings.resolved} empty="No findings were resolved." />
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ListCard title="Added requests" description="Only in the open collection." items={comparison.requests.added.map((request) => `${request.method} ${requestLabel(request)}`)} />
            <ListCard title="Removed requests" description="Only in the older version." items={comparison.requests.removed.map((request) => `${request.method} ${requestLabel(request)}`)} />
            <ListCard
              title="Changed requests"
              description="Matched by id or by method and URL, with different content."
              items={comparison.requests.changed.map((change) => `${requestLabel(change.after)} (${change.fields.join(', ')})`)}
            />
            <ListCard
              title="Hosts and authentication"
              description="Hosts and auth types that appeared or disappeared."
              items={[
                ...comparison.newHosts.map((host) => `New host: ${host}`),
                ...comparison.removedHosts.map((host) => `Removed host: ${host}`),
                ...comparison.newAuthTypes.map((type) => `New auth type: ${type}`),
                ...comparison.removedAuthTypes.map((type) => `Removed auth type: ${type}`),
              ]}
            />
          </div>
          {comparison.requests.added.length + comparison.requests.removed.length + comparison.requests.changed.length + comparison.findings.added.length + comparison.findings.resolved.length === 0 && (
            <Badge variant="secondary" className="w-fit">No differences found</Badge>
          )}
        </>
      )}
    </div>
  )
}
