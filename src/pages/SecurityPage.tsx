import { useState } from 'react'
import {
  CheckCircle,
  ArrowSquareOut,
  FunnelSimple,
  Info,
  ShieldWarning,
  Warning,
  X,
} from '@phosphor-icons/react'
import { SeverityBadge } from '../components/SeverityBadge'
import { StatCard } from '../components/StatCard'
import type { Finding } from '../lib/auditor'
import { affectedLabels } from '../lib/findingDisplay'
import type { ParsedCollection } from '../lib/parser'
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

interface SecurityPageProps {
  parsed: ParsedCollection
  findings: Finding[]
  score: ScoreBreakdown
  search: string
}

const SEVERITIES = ['all', 'critical', 'warning', 'info'] as const
const CATEGORIES = ['all', 'secrets', 'variables', 'auth', 'hygiene'] as const

function findingMatchesQuery(f: Finding, q: string, requests: ParsedCollection['requests']): boolean {
  if (!q.trim()) return true
  const s = q.toLowerCase()
  const labels = affectedLabels(f, requests)
  return (
    f.title.toLowerCase().includes(s) ||
    f.description.toLowerCase().includes(s) ||
    f.category.includes(s) ||
    f.affected.some((id) => id.toLowerCase().includes(s)) ||
    labels.some((label) => label.toLowerCase().includes(s))
  )
}

export function SecurityPage({ parsed, findings, score, search }: SecurityPageProps) {
  const [severityFilter, setSeverityFilter] = useState<(typeof SEVERITIES)[number]>('all')
  const [categoryFilter, setCategoryFilter] = useState<(typeof CATEGORIES)[number]>('all')
  const [detail, setDetail] = useState<Finding | null>(null)

  const criticalCount = findings.filter((f) => f.severity === 'critical').length
  const warningCount = findings.filter((f) => f.severity === 'warning').length
  const infoCount = findings.filter((f) => f.severity === 'info').length
  const affectedRequests = new Set(findings.flatMap((finding) => finding.affected)).size

  const filtered = findings.filter((f) => {
    if (severityFilter !== 'all' && f.severity !== severityFilter) return false
    if (categoryFilter !== 'all' && f.category !== categoryFilter) return false
    if (!findingMatchesQuery(f, search, parsed.requests)) return false
    return true
  })

  const scoreBadgeVariant = score.total >= 90 ? 'success' : score.total >= 55 ? 'warning' : 'critical'

  const activeFilters = [
    severityFilter !== 'all' ? { key: 'severity', value: severityFilter, label: severityFilter } : null,
    categoryFilter !== 'all' ? { key: 'category', value: categoryFilter, label: categoryFilter } : null,
  ].filter(Boolean) as { key: string; value: string; label: string }[]

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Security findings</h1>
        <p className="text-sm text-muted-foreground">
          Audit results with filters and full recommendation detail.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          icon={ShieldWarning}
          value={criticalCount}
          label="Critical issues"
          subtext={criticalCount > 0 ? 'Needs immediate review' : 'No critical findings'}
          details={[
            { label: 'Affected requests', value: affectedRequests },
            { label: 'Total findings', value: findings.length },
          ]}
          gradient={criticalCount > 0 ? 'rose' : 'green'}
        />
        <StatCard
          icon={Warning}
          value={warningCount}
          label="Warnings"
          subtext={warningCount > 0 ? 'Recommended cleanup' : 'No warnings found'}
          details={[
            { label: 'Visible rows', value: filtered.length },
            { label: 'Current score', value: `${score.total}/100` },
          ]}
          gradient={warningCount > 0 ? 'amber' : 'green'}
        />
        <StatCard
          icon={Info}
          value={infoCount}
          label="Info items"
          subtext={infoCount > 0 ? 'Low-risk hygiene notes' : 'No info items'}
          details={[
            { label: 'Categories', value: new Set(findings.map((finding) => finding.category)).size },
            { label: 'Requests', value: parsed.totalRequests },
          ]}
          gradient="blue"
        />
      </div>

      {/* Compact filter bar */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <FunnelSimple className="h-4 w-4 text-muted-foreground" weight="fill" />
            <CardTitle className="text-base">Filters</CardTitle>
          </div>
          <CardDescription>Narrow the table by severity and category</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-4">
          <div className="grid w-full gap-2 sm:w-48">
            <Label htmlFor="sev" className="text-xs">Severity</Label>
            <Select value={severityFilter} onValueChange={(v) => setSeverityFilter(v as (typeof SEVERITIES)[number])}>
              <SelectTrigger id="sev" className="transition-colors duration-200 h-9">
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
          <div className="grid w-full gap-2 sm:w-48">
            <Label htmlFor="cat" className="text-xs">Category</Label>
            <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v as (typeof CATEGORIES)[number])}>
              <SelectTrigger id="cat" className="transition-colors duration-200 h-9">
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
          <div className="ml-auto flex items-center gap-2">
            <Badge variant={scoreBadgeVariant} className="text-xs tabular-nums">
              Score {score.total}/100
            </Badge>
          </div>
        </CardContent>
        {activeFilters.length > 0 && (
          <div className="px-5 pb-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Active:</span>
              {activeFilters.map((f) => (
                <button
                  key={f.key}
                  onClick={() => {
                    if (f.key === 'severity') setSeverityFilter('all')
                    if (f.key === 'category') setCategoryFilter('all')
                  }}
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
                >
                  {f.label}
                  <X className="h-3 w-3" weight="fill" />
                </button>
              ))}
              <button
                onClick={() => {
                  setSeverityFilter('all')
                  setCategoryFilter('all')
                }}
                className="text-xs text-muted-foreground underline-offset-2 hover:underline"
              >
                Clear all
              </button>
            </div>
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Findings</CardTitle>
          <CardDescription>
            {filtered.length} of {findings.length} rows
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 px-5 py-20 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[hsl(var(--success))]/10">
                <CheckCircle className="h-7 w-7 text-[hsl(var(--success))]" weight="fill" />
              </div>
              <p className="text-lg font-medium">Nothing to show</p>
              <p className="max-w-md text-sm text-muted-foreground">
                {findings.length === 0
                  ? 'No issues detected for this collection.'
                  : 'Adjust filters or search to see more results.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-[100px]">Severity</TableHead>
                    <TableHead className="w-[100px]">Category</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead className="text-right">Affected</TableHead>
                    <TableHead className="w-[100px] text-right">Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((f) => (
                    <TableRow
                      key={f.id}
                      className="cursor-pointer transition-colors duration-150 hover:bg-muted/45 group"
                      onClick={() => setDetail(f)}
                    >
                      <TableCell>
                        <SeverityBadge severity={f.severity} />
                      </TableCell>
                      <TableCell className="text-xs uppercase text-muted-foreground">{f.category}</TableCell>
                      <TableCell className="max-w-[320px]">
                        <span className="line-clamp-2 text-sm font-medium">{f.title}</span>
                        <span className="mt-0.5 line-clamp-1 block text-xs text-muted-foreground">{f.description}</span>
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {f.affected.length ? `${f.affected.length} paths` : '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1 text-muted-foreground opacity-60 transition-opacity hover:text-foreground group-hover:opacity-100"
                          onClick={(e) => {
                            e.stopPropagation()
                            setDetail(f)
                          }}
                        >
                          View
                          <ArrowSquareOut className="h-3.5 w-3.5" weight="fill" />
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
          <DialogContent className="max-w-2xl gap-0 overflow-hidden p-0">
            <DialogHeader className="space-y-3 bg-card p-6 text-left">
              <DialogDescription className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Finding detail
              </DialogDescription>
              <DialogTitle className="text-xl font-semibold leading-snug">{detail.title}</DialogTitle>
              <div className="flex flex-wrap items-center gap-2">
                <SeverityBadge severity={detail.severity} />
                <Badge variant="outline" className="text-[10px] uppercase">
                  {detail.category}
                </Badge>
              </div>
            </DialogHeader>

            <div className="space-y-5 p-6 max-h-[60vh] overflow-y-auto">
              <p className="text-sm text-muted-foreground">{detail.description}</p>
              {detail.affected.length > 0 && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Affected</p>
                  <p className="mt-1 text-sm text-foreground">
                    {affectedLabels(detail, parsed.requests)
                      .slice(0, 8)
                      .join(', ')}
                    {detail.affected.length > 8 ? ` +${detail.affected.length - 8}` : ''}
                  </p>
                </div>
              )}
              <div className="rounded-lg bg-muted/45 p-4">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Recommendation</p>
                <p className="mt-2 text-sm">{detail.recommendation}</p>
              </div>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  )
}
