import { useEffect, useMemo, useState } from 'react'
import { BadgeCheck, Download, RotateCcw, SlidersHorizontal, Wand2, Wrench } from 'lucide-react'
import type { Finding } from '../lib/auditor'
import type { ParsedCollection } from '../lib/parser'
import { calculateScore, type ScoreBreakdown } from '../lib/scorer'
import {
  applyRepairPlan,
  createRepairPlan,
  type AppliedRepair,
  type RepairFix,
  type RepairRiskLevel,
  type SkippedRepair,
} from '../lib/repairEngine'
import { downloadCollectionJson } from '../lib/collectionLibrary'
import { SeverityBadge } from '../components/SeverityBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

type CategoryFilter = 'all' | Finding['category']
type RiskFilter = 'all' | RepairRiskLevel

interface RepairApplyResult {
  findings: Finding[]
  score: ScoreBreakdown
}

interface RepairPageProps {
  parsed: ParsedCollection
  findings: Finding[]
  score: ScoreBreakdown
  rawJson: string
  originalRawJson: string
  onApplyRepairedCollection: (rawJson: string) => Promise<RepairApplyResult>
  onResetRepairs: () => Promise<void>
}

const CATEGORY_ORDER: Finding['category'][] = ['secrets', 'variables', 'auth', 'hygiene']
const CATEGORY_LABELS: Record<Finding['category'], string> = {
  secrets: 'Secrets',
  variables: 'Variables',
  auth: 'Auth',
  hygiene: 'Hygiene',
}

function riskVariant(risk: RepairRiskLevel): 'success' | 'warning' | 'outline' {
  if (risk === 'low') return 'success'
  if (risk === 'medium') return 'warning'
  return 'outline'
}

function countBySeverity(findings: Finding[]): Record<Finding['severity'], number> {
  return {
    critical: findings.filter((finding) => finding.severity === 'critical').length,
    warning: findings.filter((finding) => finding.severity === 'warning').length,
    info: findings.filter((finding) => finding.severity === 'info').length,
  }
}

function scoreTone(score: number): string {
  if (score >= 90) return 'text-[hsl(var(--success))]'
  if (score >= 55) return 'text-[hsl(var(--warning))]'
  return 'text-destructive'
}

function FixRow({
  fix,
  selected,
  onToggle,
}: {
  fix: RepairFix
  selected: boolean
  onToggle: (checked: boolean) => void
}) {
  const isManual = fix.status === 'manual'

  return (
    <div className="grid gap-4 border-t border-border px-4 py-4 first:border-t-0 sm:grid-cols-[auto_minmax(0,1fr)] sm:px-5">
      <Checkbox
        className="mt-1"
        checked={!isManual && selected}
        disabled={isManual}
        onCheckedChange={(checked) => onToggle(checked === true)}
        aria-label={`Select ${fix.title}`}
      />
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold leading-6">{fix.title}</h3>
              {isManual ? (
                <Badge variant="outline" className="text-[10px] uppercase">
                  Manual review
                </Badge>
              ) : null}
              <Badge variant={riskVariant(fix.risk)} className="text-[10px] uppercase">
                {fix.risk} risk
              </Badge>
              <SeverityBadge severity={fix.findingSeverity} />
            </div>
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{fix.description}</p>
          </div>
          <Badge variant="secondary" className="shrink-0 tabular-nums">
            {fix.affectedRequestCount ? `${fix.affectedRequestCount} request${fix.affectedRequestCount === 1 ? '' : 's'}` : 'collection'}
          </Badge>
        </div>

        {(fix.beforeSnippet || fix.afterSnippet) && (
          <div className="grid gap-2 lg:grid-cols-2">
            <div className="min-w-0 rounded-lg border border-border bg-muted/40 px-3 py-2">
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Before</p>
              <p className="break-words text-xs text-muted-foreground">{fix.beforeSnippet || 'Not available'}</p>
            </div>
            <div className="min-w-0 rounded-lg border border-border bg-background px-3 py-2">
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">After</p>
              <p className="break-words text-xs text-foreground">{fix.afterSnippet || 'Manual guidance only'}</p>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="uppercase">{fix.category}</span>
          <span className="text-muted-foreground/40">/</span>
          <span className="truncate">Finding: {fix.findingTitle}</span>
        </div>
      </div>
    </div>
  )
}

export function RepairPage({
  parsed,
  findings,
  score,
  rawJson,
  originalRawJson,
  onApplyRepairedCollection,
  onResetRepairs,
}: RepairPageProps) {
  const rawObject = useMemo(() => JSON.parse(rawJson) as unknown, [rawJson])
  const plan = useMemo(() => createRepairPlan(rawObject, parsed, findings), [rawObject, parsed, findings])
  const [selected, setSelected] = useState<Set<string>>(() => new Set(plan.defaultSelectedFixIds))
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all')
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all')
  const [applying, setApplying] = useState(false)
  const [lastRun, setLastRun] = useState<{
    applied: AppliedRepair[]
    skipped: SkippedRepair[]
    beforeScore: number
    afterScore: number
  } | null>(null)

  useEffect(() => {
    setSelected(new Set(plan.defaultSelectedFixIds))
  }, [plan.defaultSelectedFixIds])

  const selectedFixes = plan.fixes.filter((fix) => selected.has(fix.id) && fix.status === 'auto')
  const selectedFindingIds = new Set(selectedFixes.map((fix) => fix.sourceFindingId))
  const estimatedFindings = findings.filter((finding) => !selectedFindingIds.has(finding.id))
  const estimatedScore = calculateScore(parsed, estimatedFindings)
  const beforeCounts = countBySeverity(findings)
  const estimatedCounts = countBySeverity(estimatedFindings)
  const hasRepairsApplied = rawJson !== originalRawJson

  const filteredFixes = plan.fixes.filter((fix) => {
    if (categoryFilter !== 'all' && fix.category !== categoryFilter) return false
    if (riskFilter !== 'all' && fix.risk !== riskFilter) return false
    return true
  })

  const grouped = CATEGORY_ORDER.map((category) => ({
    category,
    fixes: filteredFixes.filter((fix) => fix.category === category),
  })).filter((group) => group.fixes.length > 0)

  const toggleFix = (fixId: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(fixId)
      else next.delete(fixId)
      return next
    })
  }

  const selectSafeFixes = () => {
    setSelected(new Set(plan.fixes.filter((fix) => fix.status === 'auto' && fix.selectedByDefault).map((fix) => fix.id)))
  }

  const clearSelection = () => setSelected(new Set())

  const handleApply = async () => {
    setApplying(true)
    try {
      const result = applyRepairPlan(rawObject, [...selected], plan)
      const nextRawJson = JSON.stringify(result.fixedJson, null, 2)
      const next = await onApplyRepairedCollection(nextRawJson)
      setLastRun({
        applied: result.applied,
        skipped: result.skipped,
        beforeScore: score.total,
        afterScore: next.score.total,
      })
    } finally {
      setApplying(false)
    }
  }

  const handleExport = () => {
    downloadCollectionJson(`${parsed.name}-repaired`, rawJson)
  }

  const handleReset = async () => {
    await onResetRepairs()
    setLastRun(null)
  }

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <div className="animate-fade-in">
        <h1 className="text-2xl font-semibold tracking-tight">Repair Center</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review safe collection fixes, apply only what you choose, then export the repaired JSON.
        </p>
      </div>

      <Card className="animate-fade-in animate-delay-100">
        <CardContent className="grid gap-4 p-4 lg:grid-cols-[1fr_auto] lg:items-center lg:p-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-lg bg-muted/40 px-3 py-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Available fixes</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{plan.autoFixCount}</p>
            </div>
            <div className="rounded-lg bg-muted/40 px-3 py-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Selected</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{selectedFixes.length}</p>
            </div>
            <div className="rounded-lg bg-muted/40 px-3 py-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Manual items</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{plan.manualCount}</p>
            </div>
            <div className="rounded-lg bg-muted/40 px-3 py-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Estimated score</p>
              <p className={cn('mt-1 text-xl font-semibold tabular-nums', scoreTone(estimatedScore.total))}>
                {estimatedScore.total}/100
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 lg:justify-end">
            <Button className="gap-2" disabled={selectedFixes.length === 0 || applying} onClick={() => void handleApply()}>
              <Wand2 className="h-4 w-4" />
              {applying ? 'Applying...' : 'Apply selected'}
            </Button>
            <Button variant="outline" className="gap-2" disabled={!hasRepairsApplied && !lastRun} onClick={handleExport}>
              <Download className="h-4 w-4" />
              Export repaired
            </Button>
            <Button variant="secondary" className="gap-2" disabled={!hasRepairsApplied && !lastRun} onClick={() => void handleReset()}>
              <RotateCcw className="h-4 w-4" />
              Reset repairs
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <Card className="animate-fade-in animate-delay-200">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-base">Selection controls</CardTitle>
              </div>
              <CardDescription>Choose fixes deliberately; manual guidance stays visible but disabled.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-end gap-3">
              <Button variant="outline" size="sm" className="gap-2" onClick={selectSafeFixes}>
                <BadgeCheck className="h-4 w-4" />
                Select all safe fixes
              </Button>
              <Button variant="ghost" size="sm" onClick={clearSelection}>
                Clear selection
              </Button>
              <div className="ml-0 grid w-full gap-2 sm:w-40 lg:ml-auto">
                <Label className="text-xs">Category</Label>
                <Select value={categoryFilter} onValueChange={(value) => setCategoryFilter(value as CategoryFilter)}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All categories</SelectItem>
                    {CATEGORY_ORDER.map((category) => (
                      <SelectItem key={category} value={category}>{CATEGORY_LABELS[category]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid w-full gap-2 sm:w-36">
                <Label className="text-xs">Risk</Label>
                <Select value={riskFilter} onValueChange={(value) => setRiskFilter(value as RiskFilter)}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All risk</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="manual">Manual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden animate-fade-in animate-delay-300">
            <CardHeader>
              <CardTitle className="text-base">Fix list</CardTitle>
              <CardDescription>{filteredFixes.length} repair item{filteredFixes.length === 1 ? '' : 's'} shown</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {grouped.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]">
                    <Wrench className="h-6 w-6" />
                  </div>
                  <p className="text-sm font-medium">No repairs match this view</p>
                  <p className="max-w-sm text-sm text-muted-foreground">Adjust filters or review the Security page for remaining guidance.</p>
                </div>
              ) : (
                grouped.map((group) => (
                  <section key={group.category} className="border-t border-border first:border-t-0">
                    <div className="flex items-center justify-between bg-muted/30 px-5 py-3">
                      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{CATEGORY_LABELS[group.category]}</h2>
                      <Badge variant="secondary" className="tabular-nums">{group.fixes.length}</Badge>
                    </div>
                    {group.fixes.map((fix) => (
                      <FixRow
                        key={fix.id}
                        fix={fix}
                        selected={selected.has(fix.id)}
                        onToggle={(checked) => toggleFix(fix.id, checked)}
                      />
                    ))}
                  </section>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit animate-fade-in animate-delay-300">
          <CardHeader>
            <CardTitle className="text-base">Impact preview</CardTitle>
            <CardDescription>No changes are made until you apply selected fixes.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Before score</span>
                <span className="font-semibold tabular-nums">{score.total}/100</span>
              </div>
              <Progress value={score.total} className="h-2" />
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Estimated after</span>
                <span className={cn('font-semibold tabular-nums', scoreTone(estimatedScore.total))}>
                  {estimatedScore.total}/100
                </span>
              </div>
              <Progress value={estimatedScore.total} className="h-2" />
            </div>

            <Separator />

            <div className="grid grid-cols-3 gap-2 text-center">
              {(['critical', 'warning', 'info'] as const).map((severity) => (
                <div key={severity} className="rounded-lg border border-border px-2 py-2">
                  <p className="text-[10px] uppercase text-muted-foreground">{severity}</p>
                  <p className="mt-1 text-sm tabular-nums">
                    {beforeCounts[severity]} {'->'} {estimatedCounts[severity]}
                  </p>
                </div>
              ))}
            </div>

            {lastRun && (
              <>
                <Separator />
                <div className="space-y-3">
                  <div className="rounded-lg border border-[hsl(var(--success)/0.25)] bg-[hsl(var(--success)/0.08)] px-3 py-2">
                    <p className="text-xs font-medium text-[hsl(var(--success))]">Applied {lastRun.applied.length} fix group{lastRun.applied.length === 1 ? '' : 's'}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Actual score moved from {lastRun.beforeScore}/100 to {lastRun.afterScore}/100 after re-analysis.
                    </p>
                  </div>
                  {lastRun.applied.slice(0, 3).map((item) => (
                    <p key={item.fixId} className="text-xs text-muted-foreground">{item.summary}</p>
                  ))}
                  {lastRun.skipped.length > 0 && (
                    <p className="text-xs text-muted-foreground">{lastRun.skipped.length} selected target{lastRun.skipped.length === 1 ? '' : 's'} skipped because no safe patch was available.</p>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
