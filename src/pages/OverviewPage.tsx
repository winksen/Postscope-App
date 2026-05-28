import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { FileText, FolderOpen, Key, Stack, ChartBar } from '@phosphor-icons/react'
import { StatCard } from '../components/StatCard'
import { RequestTree } from '../components/RequestTree'
import type { ParsedCollection, ParsedRequest } from '../lib/parser'
import type { Finding } from '../lib/auditor'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartTooltipFrame } from '@/components/charts/chart-tooltip'
import { Skeleton } from '@/components/ui/skeleton'
// cn removed - not needed

/** Auth / accent slice colors (blue → green → orange). */
const DASHBOARD_ACCENT = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
] as const

/** Distinct color per HTTP verb; DELETE uses destructive red. */
const VERB_COLORS: Record<string, string> = {
  GET: 'hsl(var(--chart-1))',
  POST: 'hsl(var(--chart-2))',
  PUT: 'hsl(var(--chart-3))',
  PATCH: 'hsl(var(--chart-4))',
  DELETE: 'hsl(var(--destructive))',
  HEAD: 'hsl(199 89% 46%)',
  OPTIONS: 'hsl(271 70% 52%)',
  TRACE: 'hsl(173 58% 40%)',
  CONNECT: 'hsl(25 90% 48%)',
}

const FALLBACK_VERB_HUES = [340, 187, 48, 24, 142, 285, 35, 310]

const CHART_FONT = "'Elms Sans', ui-sans-serif, system-ui, sans-serif"

function fillForMethod(method: string, fallbackIndex: number): string {
  const known = VERB_COLORS[method]
  if (known) return known
  const h = FALLBACK_VERB_HUES[fallbackIndex % FALLBACK_VERB_HUES.length]
  return `hsl(${h} 72% 44%)`
}

interface OverviewPageProps {
  parsed: ParsedCollection
  findings: Finding[]
  search: string
  isLoading?: boolean
}

function variableNamesUsedInRequests(requests: ParsedRequest[]): Set<string> {
  const names = new Set<string>()
  for (const r of requests) {
    const blob = [r.url, ...r.headers.map((h) => h.key + h.value), r.bodyRaw ?? ''].join(' ')
    for (const m of blob.matchAll(/\{\{(\w+)\}\}/g)) {
      names.add(m[1])
    }
  }
  return names
}

function OverviewPageSkeleton() {
  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-44 rounded-2xl" />)}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Skeleton className="h-[24rem] rounded-2xl" />
        <Skeleton className="h-[24rem] rounded-2xl" />
      </div>
      <Skeleton className="h-[22rem] rounded-2xl" />
    </div>
  )
}

export function OverviewPage({ parsed, findings, search, isLoading = false }: OverviewPageProps) {
  if (isLoading) return <OverviewPageSkeleton />
  const methodEntries = Object.entries(parsed.methods).sort((a, b) => b[1] - a[1])
  let verbFallbackSlot = 0
  const methodData = methodEntries.map(([method, count]) => ({
    name: method,
    count,
    fill: fillForMethod(method, VERB_COLORS[method] ? 0 : verbFallbackSlot++),
  }))

  const authPieData = Object.entries(parsed.authTypes)
    .map(([name, value]) => ({ name, value }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value)

  if (authPieData.length === 0) {
    authPieData.push({ name: 'noauth', value: parsed.totalRequests })
  }

  const noauthCount = parsed.authTypes.noauth ?? 0
  const typedAuthSharePct =
    parsed.totalRequests > 0
      ? Math.round(((parsed.totalRequests - noauthCount) / parsed.totalRequests) * 100)
      : 0

  const varsUsedInRequests = variableNamesUsedInRequests(parsed.requests)
  const unusedDefinedVars = parsed.definedVariables.filter((k) => !varsUsedInRequests.has(k)).length

  const methodDetailRows = [
    { label: 'Distinct methods', value: methodEntries.length },
    ...methodEntries.slice(0, 3).map(([method, count]) => ({ label: method, value: count })),
  ]

  const maxFolderDepth =
    parsed.folders.length > 0 ? Math.max(...parsed.folders.map((f) => f.path.length)) : 0
  const avgRequestsPerFolder = parsed.totalFolders
    ? (parsed.totalRequests / parsed.totalFolders).toFixed(1)
    : '0'
  const busiestFolder =
    parsed.folders.length > 0
      ? parsed.folders.reduce((best, f) => (f.requestCount > best.requestCount ? f : best))
      : undefined
  const folderDetailRows = [
    { label: 'Max nesting depth', value: maxFolderDepth },
    { label: 'Avg requests / folder', value: avgRequestsPerFolder },
    ...(busiestFolder
      ? [
          {
            label: 'Busiest folder',
            value: `${busiestFolder.requestCount} req`,
          },
        ]
      : []),
  ]

  const variableDetailRows = [
    { label: 'Used in requests', value: varsUsedInRequests.size },
    { label: 'Unused definitions', value: unusedDefinedVars },
    { label: 'Unique names (total)', value: parsed.variables.length },
  ]

  const authTypeRows = Object.entries(parsed.authTypes)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({
      label: name,
      value: count,
    }))
  const distinctAuthTypes = authTypeRows.length

  const chartTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value?: number }[]; label?: string }) => {
    if (!active || !payload?.length) return null
    return (
      <ChartTooltipFrame>
        <p className="font-medium">{label}</p>
        <p className="text-muted-foreground">Count: {payload[0].value}</p>
      </ChartTooltipFrame>
    )
  }

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <div className="animate-fade-in">
        <h1 className="text-2xl font-semibold tracking-tight">Collection overview</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Structure, auth coverage, and request inventory for this import.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={FileText}
          label="Total requests"
          value={parsed.totalRequests}
          subtext={`${parsed.totalFolders} folders`}
          details={methodDetailRows}
          gradient="blue"
          delay={0}
        />
        <StatCard
          icon={FolderOpen}
          label="Folders"
          value={parsed.totalFolders}
          subtext={`${parsed.totalRequests} requests`}
          details={folderDetailRows}
          gradient="amber"
          delay={100}
        />
        <StatCard
          icon={Key}
          label="Variables defined"
          value={parsed.definedVariables.length}
          subtext={`${parsed.variables.length} unique names in collection`}
          details={variableDetailRows}
          gradient="violet"
          delay={200}
        />
        <StatCard
          icon={Stack}
          label="Auth profiles"
          value={distinctAuthTypes}
          subtext={`Across ${parsed.totalRequests} requests`}
          details={authTypeRows}
          gradient="green"
          delay={300}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="animate-fade-in animate-delay-200">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2"><ChartBar className="h-4 w-4 text-muted-foreground" />HTTP methods</CardTitle>
            <CardDescription>Distribution of verbs across the collection</CardDescription>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={methodData}
                  margin={{ top: 12, right: 8, left: 8, bottom: 4 }}
                  barCategoryGap="40%"
                >
                  <CartesianGrid
                    strokeDasharray="6 10"
                    vertical={false}
                    stroke="hsl(var(--border))"
                    strokeLinecap="round"
                  />
                  <XAxis
                    dataKey="name"
                    tickLine={false}
                    axisLine={false}
                    tick={{
                      fill: 'hsl(var(--muted-foreground))',
                      fontSize: 12,
                      fontWeight: 500,
                      fontFamily: CHART_FONT,
                    }}
                    interval={0}
                  />
                  <YAxis hide />
                  <Tooltip content={chartTooltip} cursor={{ fill: 'hsl(var(--muted) / 0.22)' }} />
                  <Bar dataKey="count" maxBarSize={26} radius={[13, 13, 13, 13]}>
                    {methodData.map((entry) => (
                      <Cell key={entry.name} fill={entry.fill} className="transition-all duration-200 hover:opacity-80" />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-4 text-center text-sm font-semibold text-foreground">Method mix</p>
            <p className="mx-auto mt-1 max-w-sm text-center text-xs leading-relaxed text-muted-foreground">
              Each verb keeps its own color; DELETE uses a destructive red. Taller bars are more common
              in this collection.
            </p>
          </CardContent>
        </Card>

        <Card className="animate-fade-in animate-delay-300">
          <CardHeader className="pb-2">
            <CardTitle>Authentication</CardTitle>
            <CardDescription>How requests declare auth in the collection</CardDescription>
          </CardHeader>
          <CardContent className="space-y-0 pt-2">
            <div className="mx-auto w-full max-w-md shrink-0 px-1 text-center">
              <p
                className="text-3xl font-semibold tabular-nums tracking-tight text-foreground"
                style={{ fontFamily: CHART_FONT }}
              >
                {typedAuthSharePct}
                <span className="text-2xl font-semibold text-muted-foreground">%</span>
              </p>
              <p className="text-xs font-medium leading-snug text-muted-foreground">typed auth share</p>
            </div>
            <div className="mx-auto h-[min(280px,42vw)] min-h-[240px] w-full max-w-md sm:h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart margin={{ top: -28, right: 8, left: 8, bottom: 4 }}>
                  <Pie
                    data={authPieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="88%"
                    startAngle={180}
                    endAngle={0}
                    innerRadius="46%"
                    outerRadius="82%"
                    paddingAngle={2}
                    stroke="hsl(var(--card))"
                    strokeWidth={2}
                    animationBegin={200}
                    animationDuration={800}
                  >
                    {authPieData.map((_, i) => (
                      <Cell
                        key={i}
                        fill={DASHBOARD_ACCENT[i % DASHBOARD_ACCENT.length]}
                        className="transition-all duration-200 hover:opacity-80"
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      const p = payload[0].payload as { name: string; value: number }
                      return (
                        <ChartTooltipFrame>
                          <p className="font-medium capitalize">{p.name}</p>
                          <p className="text-muted-foreground">{p.value} requests</p>
                        </ChartTooltipFrame>
                      )
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
              {authPieData.map((entry, i) => (
                <div key={entry.name} className="flex items-center gap-2 text-xs">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: DASHBOARD_ACCENT[i % DASHBOARD_ACCENT.length] }}
                  />
                  <span className="capitalize text-muted-foreground">{entry.name}</span>
                  <span className="tabular-nums font-semibold text-foreground">{entry.value}</span>
                </div>
              ))}
            </div>

            <p className="mt-5 text-center text-sm font-semibold text-foreground">Auth coverage</p>
            <p className="mx-auto mt-1 max-w-sm text-center text-xs leading-relaxed text-muted-foreground">
              {typedAuthSharePct}% of requests use a non-empty auth type. The arc shows how requests split
              across bearer, API keys, and other profiles.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="animate-fade-in animate-delay-400">
        <CardHeader>
          <CardTitle>Request tree</CardTitle>
          <CardDescription>Open a request to inspect headers, body, and related findings</CardDescription>
        </CardHeader>
        <CardContent>
          <RequestTree parsed={parsed} findings={findings} search={search} />
        </CardContent>
      </Card>
    </div>
  )
}
