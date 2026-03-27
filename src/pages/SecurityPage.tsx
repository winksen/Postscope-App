import { useEffect, useState } from 'react'
import { CheckCircle, ExternalLink } from 'lucide-react'
import { SeverityBadge } from '../components/SeverityBadge'
import type { Finding } from '../lib/auditor'
import type { ScoreBreakdown } from '../lib/scorer'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'

interface SecurityPageProps {
  findings: Finding[]
  score: ScoreBreakdown
  search: string
}

const SEVERITIES = ['all', 'critical', 'warning', 'info'] as const
const CATEGORIES = ['all', 'secrets', 'variables', 'auth', 'hygiene'] as const

function findingMatchesQuery(f: Finding, q: string): boolean {
  if (!q.trim()) return true
  const s = q.toLowerCase()
  return (
    f.title.toLowerCase().includes(s) ||
    f.description.toLowerCase().includes(s) ||
    f.category.includes(s) ||
    f.affected.some((a) => a.toLowerCase().includes(s))
  )
}

export function SecurityPage({ findings, score, search }: SecurityPageProps) {
  const [severityFilter, setSeverityFilter] = useState<(typeof SEVERITIES)[number]>('all')
  const [categoryFilter, setCategoryFilter] = useState<(typeof CATEGORIES)[number]>('all')
  const [detail, setDetail] = useState<Finding | null>(null)
  const [showSkeleton, setShowSkeleton] = useState(true)

  useEffect(() => {
    const t = window.setTimeout(() => setShowSkeleton(false), 220)
    return () => window.clearTimeout(t)
  }, [findings])

  const criticalCount = findings.filter((f) => f.severity === 'critical').length
  const warningCount = findings.filter((f) => f.severity === 'warning').length
  const infoCount = findings.filter((f) => f.severity === 'info').length

  const filtered = findings.filter((f) => {
    if (severityFilter !== 'all' && f.severity !== severityFilter) return false
    if (categoryFilter !== 'all' && f.category !== categoryFilter) return false
    if (!findingMatchesQuery(f, search)) return false
    return true
  })

  const scoreBadgeVariant = score.total >= 90 ? 'success' : score.total >= 55 ? 'warning' : 'critical'

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Security findings</h1>
        <p className="text-sm text-muted-foreground">
          Audit results with filters and full recommendation detail.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {criticalCount > 0 && (
          <span className="flex items-center gap-2 text-sm text-destructive">
            <span className="h-2 w-2 rounded-full bg-destructive" />
            {criticalCount} critical
          </span>
        )}
        {warningCount > 0 && (
          <span className="flex items-center gap-2 text-sm text-[hsl(var(--warning))]">
            <span className="h-2 w-2 rounded-full bg-[hsl(var(--warning))]" />
            {warningCount} warnings
          </span>
        )}
        {infoCount > 0 && (
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-primary" />
            {infoCount} info
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Badge variant={scoreBadgeVariant} className="font-mono text-xs tabular-nums">
            Score {score.total}/100
          </Badge>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">Filters</CardTitle>
          <CardDescription>Narrow the table by severity and category</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-6">
          <div className="grid w-full gap-2 sm:w-56">
            <Label htmlFor="sev">Severity</Label>
            <Select value={severityFilter} onValueChange={(v) => setSeverityFilter(v as (typeof SEVERITIES)[number])}>
              <SelectTrigger id="sev" className="transition-colors duration-200">
                <SelectValue placeholder="Severity" />
              </SelectTrigger>
              <SelectContent>
                {SEVERITIES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid w-full gap-2 sm:w-56">
            <Label htmlFor="cat">Category</Label>
            <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v as (typeof CATEGORIES)[number])}>
              <SelectTrigger id="cat" className="transition-colors duration-200">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c.charAt(0).toUpperCase() + c.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle className="text-lg">Findings</CardTitle>
          <CardDescription>
            {filtered.length} of {findings.length} rows
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {filtered.length === 0 && !showSkeleton ? (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
              <CheckCircle className="h-12 w-12 text-[hsl(var(--success))]" />
              <p className="text-lg font-medium">Nothing to show</p>
              <p className="max-w-md text-sm text-muted-foreground">
                {findings.length === 0
                  ? 'No issues detected for this collection.'
                  : 'Adjust filters or search to see more results.'}
              </p>
            </div>
          ) : showSkeleton ? (
            <div className="space-y-3 p-6">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <div className="overflow-x-auto border-t border-border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Severity</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead className="text-right">Affected</TableHead>
                    <TableHead className="w-[100px] text-right">Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((f) => (
                    <TableRow key={f.id} className="cursor-pointer" onClick={() => setDetail(f)}>
                      <TableCell>
                        <SeverityBadge severity={f.severity} />
                      </TableCell>
                      <TableCell className="font-mono text-xs uppercase text-muted-foreground">{f.category}</TableCell>
                      <TableCell className="max-w-[320px]">
                        <span className="line-clamp-2 text-sm font-medium">{f.title}</span>
                        <span className="mt-0.5 line-clamp-1 block text-xs text-muted-foreground">{f.description}</span>
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {f.affected.length ? `${f.affected.length} paths` : '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1 text-muted-foreground hover:text-primary"
                          onClick={(e) => {
                            e.stopPropagation()
                            setDetail(f)
                          }}
                        >
                          View
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        {detail ? (
          <DialogContent className="max-w-lg gap-4">
            <DialogHeader>
              <DialogDescription className="text-xs uppercase tracking-wider text-muted-foreground">
                Finding detail
              </DialogDescription>
              <DialogTitle className="text-xl">{detail.title}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={detail.severity} />
              <Badge variant="outline" className="font-mono text-[10px] uppercase">
                {detail.category}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">{detail.description}</p>
            {detail.affected.length > 0 && (
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Affected</p>
                <p className="mt-1 font-mono text-sm text-primary">
                  {detail.affected.slice(0, 8).join(', ')}
                  {detail.affected.length > 8 ? ` +${detail.affected.length - 8}` : ''}
                </p>
              </div>
            )}
            <div className="rounded-lg border border-border bg-muted/50 p-4">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Recommendation</p>
              <p className="mt-2 text-sm">{detail.recommendation}</p>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  )
}
