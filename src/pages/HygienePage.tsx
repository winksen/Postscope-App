import { useState } from 'react'
import {
  ArrowSquareOut,
  CheckCircle,
  ClipboardText,
  FunnelSimple,
  Sparkle,
} from '@phosphor-icons/react'
import { SeverityBadge } from '../components/SeverityBadge'
import { StatCard } from '../components/StatCard'
import type { Finding } from '../lib/auditor'
import { affectedLabels } from '../lib/findingDisplay'
import type { ParsedCollection } from '../lib/parser'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

interface HygienePageProps {
  parsed: ParsedCollection
  findings: Finding[]
  search: string
}

const SEVERITIES = ['all', 'critical', 'warning', 'info'] as const

function findingMatchesQuery(finding: Finding, q: string, requests: ParsedCollection['requests']): boolean {
  if (!q.trim()) return true
  const query = q.toLowerCase()
  const labels = affectedLabels(finding, requests)
  return (
    finding.title.toLowerCase().includes(query) ||
    finding.description.toLowerCase().includes(query) ||
    finding.recommendation.toLowerCase().includes(query) ||
    finding.affected.some((id) => id.toLowerCase().includes(query)) ||
    labels.some((label) => label.toLowerCase().includes(query))
  )
}

export function HygienePage({ parsed, findings, search }: HygienePageProps) {
  const [severityFilter, setSeverityFilter] = useState<(typeof SEVERITIES)[number]>('all')
  const [detail, setDetail] = useState<Finding | null>(null)

  const warningCount = findings.filter((finding) => finding.severity === 'warning').length
  const infoCount = findings.filter((finding) => finding.severity === 'info').length
  const affectedRequests = new Set(findings.flatMap((finding) => finding.affected)).size

  const filtered = findings.filter((finding) => {
    if (severityFilter !== 'all' && finding.severity !== severityFilter) return false
    return findingMatchesQuery(finding, search, parsed.requests)
  })

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Hygiene findings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Documentation, naming, and maintainability notes that are useful but not security-blocking.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          icon={Sparkle}
          label="Hygiene notes"
          value={findings.length}
          subtext={findings.length > 0 ? 'Maintainability items' : 'No hygiene notes'}
          details={[
            { label: 'Affected requests', value: affectedRequests },
            { label: 'Visible rows', value: filtered.length },
          ]}
          gradient={findings.length > 0 ? 'amber' : 'green'}
        />
        <StatCard
          icon={ClipboardText}
          label="Warnings"
          value={warningCount}
          subtext={warningCount > 0 ? 'Worth cleanup' : 'No warnings'}
          details={[
            { label: 'Info items', value: infoCount },
            { label: 'Total requests', value: parsed.totalRequests },
          ]}
          gradient={warningCount > 0 ? 'amber' : 'green'}
        />
        <StatCard
          icon={CheckCircle}
          label="Coverage"
          value={affectedRequests}
          subtext="Requests with hygiene notes"
          details={[
            { label: 'Unaffected', value: Math.max(parsed.totalRequests - affectedRequests, 0) },
            { label: 'Collection size', value: parsed.totalRequests },
          ]}
          gradient="blue"
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <FunnelSimple className="h-4 w-4 text-muted-foreground" weight="fill" />
            <CardTitle className="text-base">Filters</CardTitle>
          </div>
          <CardDescription>Narrow hygiene notes by severity</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-4">
          <div className="grid w-full gap-2 sm:w-48">
            <Label htmlFor="hygiene-severity" className="text-xs">Severity</Label>
            <Select value={severityFilter} onValueChange={(value) => setSeverityFilter(value as (typeof SEVERITIES)[number])}>
              <SelectTrigger id="hygiene-severity" className="h-9 transition-colors duration-200">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEVERITIES.map((severity) => (
                  <SelectItem key={severity} value={severity}>
                    {severity.charAt(0).toUpperCase() + severity.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {severityFilter !== 'all' && (
            <Button variant="ghost" size="sm" onClick={() => setSeverityFilter('all')}>
              Clear filter
            </Button>
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Findings</CardTitle>
          <CardDescription>{filtered.length} of {findings.length} rows</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 px-5 py-20 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[hsl(var(--success))]/10">
                <CheckCircle className="h-7 w-7 text-[hsl(var(--success))]" weight="fill" />
              </div>
              <p className="text-lg font-medium">Nothing to show</p>
              <p className="max-w-md text-sm text-muted-foreground">
                {findings.length === 0 ? 'No hygiene notes detected for this collection.' : 'Adjust filters or search to see more results.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-[100px]">Severity</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead className="text-right">Affected</TableHead>
                    <TableHead className="w-[100px] text-right">Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((finding) => (
                    <TableRow
                      key={finding.id}
                      className="cursor-pointer transition-colors duration-150 hover:bg-muted/45 group"
                      onClick={() => setDetail(finding)}
                    >
                      <TableCell>
                        <SeverityBadge severity={finding.severity} />
                      </TableCell>
                      <TableCell className="max-w-[440px]">
                        <span className="line-clamp-2 text-sm font-medium">{finding.title}</span>
                        <span className="mt-0.5 line-clamp-1 block text-xs text-muted-foreground">{finding.description}</span>
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {finding.affected.length ? `${finding.affected.length} paths` : '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1 text-muted-foreground opacity-60 transition-opacity hover:text-foreground group-hover:opacity-100"
                          onClick={(event) => {
                            event.stopPropagation()
                            setDetail(finding)
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

      <Dialog open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        {detail ? (
          <DialogContent className="max-w-2xl gap-0 overflow-hidden p-0">
            <DialogHeader className="space-y-3 bg-card p-6 text-left">
              <DialogDescription className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Hygiene detail
              </DialogDescription>
              <DialogTitle className="text-xl font-semibold leading-snug">{detail.title}</DialogTitle>
              <div className="flex flex-wrap items-center gap-2">
                <SeverityBadge severity={detail.severity} />
                <Badge variant="secondary" className="text-[10px] uppercase">
                  Hygiene
                </Badge>
              </div>
            </DialogHeader>

            <div className="max-h-[60vh] space-y-5 overflow-y-auto p-6">
              <p className="text-sm text-muted-foreground">{detail.description}</p>
              {detail.affected.length > 0 && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Affected</p>
                  <p className="mt-1 text-sm text-foreground">
                    {affectedLabels(detail, parsed.requests).slice(0, 8).join(', ')}
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
