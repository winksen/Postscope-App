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
import {
  FileText,
  FolderOpen,
  GitBranch,
  Hash,
  Key,
  ShieldWarning,
  TreeStructure,
} from '@phosphor-icons/react'
import { StatCard } from '../components/StatCard'
import type { ParsedCollection } from '../lib/parser'
import type { Finding } from '../lib/auditor'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartTooltipFrame } from '@/components/charts/chart-tooltip'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

/** Auth / accent slice colors (blue → green → orange). */
const AUTH_COLORS: Record<string, string> = {
  noauth: 'hsl(215 14% 64%)',
  bearer: 'hsl(158 64% 42%)',
  basic: 'hsl(199 89% 48%)',
  apikey: 'hsl(38 92% 50%)',
  oauth1: 'hsl(271 70% 55%)',
  oauth2: 'hsl(271 70% 55%)',
  digest: 'hsl(173 58% 40%)',
  awsv4: 'hsl(24 90% 52%)',
}

const FALLBACK_AUTH_COLORS = [
  'hsl(340 75% 52%)',
  'hsl(187 72% 42%)',
  'hsl(142 65% 40%)',
  'hsl(285 70% 54%)',
  'hsl(48 95% 48%)',
] as const

/** Distinct color per HTTP verb; DELETE uses destructive red. */
const VERB_COLORS: Record<string, string> = {
  GET: 'hsl(158 64% 42%)',
  POST: 'hsl(199 89% 48%)',
  PUT: 'hsl(38 92% 50%)',
  PATCH: 'hsl(271 70% 55%)',
  DELETE: 'hsl(0 72% 51%)',
  HEAD: 'hsl(192 70% 39%)',
  OPTIONS: 'hsl(276 72% 48%)',
  TRACE: 'hsl(173 58% 40%)',
  CONNECT: 'hsl(24 90% 52%)',
}

const TREE_LEVEL_COLORS = [
  VERB_COLORS.GET,
  VERB_COLORS.POST,
  VERB_COLORS.PUT,
  VERB_COLORS.PATCH,
  VERB_COLORS.DELETE,
  VERB_COLORS.CONNECT,
  FALLBACK_AUTH_COLORS[0],
  FALLBACK_AUTH_COLORS[1],
  FALLBACK_AUTH_COLORS[4],
] as const

const FALLBACK_VERB_HUES = [340, 187, 48, 24, 142, 285, 35, 310]

const CHART_FONT = "'Elms Sans', ui-sans-serif, system-ui, sans-serif"

function fillForMethod(method: string, fallbackIndex: number): string {
  const known = VERB_COLORS[method]
  if (known) return known
  const h = FALLBACK_VERB_HUES[fallbackIndex % FALLBACK_VERB_HUES.length]
  return `hsl(${h} 72% 44%)`
}

function fillForAuth(name: string, fallbackIndex: number): string {
  const key = name.toLowerCase().replace(/[\s_-]+/g, '')
  return AUTH_COLORS[key] ?? FALLBACK_AUTH_COLORS[fallbackIndex % FALLBACK_AUTH_COLORS.length]
}

function fillForTreeLevel(depth: number): string {
  if (depth <= 0) return 'hsl(215 14% 64%)'
  const paletteColor = TREE_LEVEL_COLORS[depth - 1]
  if (paletteColor) return paletteColor
  const hue = (depth * 137.508) % 360
  return `hsl(${Math.round(hue)} 70% 48%)`
}

interface OverviewPageProps {
  parsed: ParsedCollection
  findings: Finding[]
}

interface StructureNode {
  name: string
  requests: string[]
  children: StructureNode[]
}

function variableNamesUsedInRequests(requests: ParsedCollection['requests']): Set<string> {
  const names = new Set<string>()
  for (const request of requests) {
    const blob = [request.url, ...request.headers.map((header) => header.key + header.value), request.bodyRaw ?? ''].join(' ')
    for (const match of blob.matchAll(/\{\{(\w+)\}\}/g)) {
      names.add(match[1])
    }
  }
  return names
}

function buildStructureTree(parsed: ParsedCollection): StructureNode {
  const root: StructureNode = { name: parsed.name, requests: [], children: [] }

  function childFor(parent: StructureNode, name: string): StructureNode {
    const existing = parent.children.find((child) => child.name === name)
    if (existing) return existing
    const created = { name, requests: [], children: [] }
    parent.children.push(created)
    return created
  }

  for (const request of parsed.requests) {
    let node = root
    for (const segment of request.folderPath) {
      node = childFor(node, segment)
    }
    node.requests.push(request.id)
  }

  const sortNode = (node: StructureNode) => {
    node.children.sort((a, b) => totalRequests(b) - totalRequests(a))
    node.children.forEach(sortNode)
  }
  sortNode(root)

  return root
}

function totalRequests(node: StructureNode): number {
  return node.requests.length + node.children.reduce((sum, child) => sum + totalRequests(child), 0)
}

function maxDepth(node: StructureNode): number {
  if (node.children.length === 0) return 0
  return 1 + Math.max(...node.children.map(maxDepth))
}

function StructureBranch({
  node,
  depth = 0,
  isLast = true,
}: {
  node: StructureNode
  depth?: number
  isLast?: boolean
}) {
  const requestCount = totalRequests(node)
  const directRequests = node.requests.length
  const hasChildren = node.children.length > 0
  const shownChildren = depth >= 4 ? node.children.slice(0, 8) : node.children
  const hiddenChildren = node.children.length - shownChildren.length
  const levelColor = fillForTreeLevel(depth)

  return (
    <div className={cn('relative', depth > 0 && 'pl-4')}>
      {depth > 0 && (
        <>
          <span
            className={cn('absolute left-1 top-0 w-px', isLast ? 'h-6' : 'h-full')}
            style={{ backgroundColor: levelColor }}
            aria-hidden
          />
          <span className="absolute left-1 top-6 h-px w-5" style={{ backgroundColor: levelColor }} aria-hidden />
          <span
            className="absolute left-[0.0625rem] top-5 h-2 w-2 rounded-full"
            style={{ backgroundColor: levelColor }}
            aria-hidden
          />
        </>
      )}
      <div className="relative flex min-w-0 items-center gap-3 rounded-lg px-2 py-2">
        <span
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center',
          )}
          style={{ color: levelColor }}
        >
          <FolderOpen className="h-5 w-5" weight="fill" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium">{node.name}</p>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {requestCount} req
            </span>
            {hasChildren && (
              <span className="rounded-full bg-muted/60 px-2 py-0.5 text-[10px] text-muted-foreground">
                {node.children.length} folder{node.children.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
          {directRequests > 0 && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {directRequests} direct request{directRequests === 1 ? '' : 's'} at this level
            </p>
          )}
        </div>
      </div>
      {shownChildren.length > 0 && (
        <div className="ml-5 space-y-0.5">
          {shownChildren.map((child, index) => (
            <StructureBranch
              key={`${depth}-${child.name}`}
              node={child}
              depth={depth + 1}
              isLast={index === shownChildren.length - 1 && hiddenChildren === 0}
            />
          ))}
          {hiddenChildren > 0 && (
            <div className="pl-7 text-xs text-muted-foreground">+ {hiddenChildren} more folder branches</div>
          )}
        </div>
      )}
    </div>
  )
}

export function OverviewPage({ parsed, findings }: OverviewPageProps) {
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

  const authColorData = authPieData.map((entry, index) => ({
    ...entry,
    fill: fillForAuth(entry.name, index),
  }))

  const noauthCount = parsed.authTypes.noauth ?? 0
  const typedAuthSharePct =
    parsed.totalRequests > 0
      ? Math.round(((parsed.totalRequests - noauthCount) / parsed.totalRequests) * 100)
      : 0

  const maxFolderDepth =
    parsed.folders.length > 0 ? Math.max(...parsed.folders.map((f) => f.path.length)) : 0
  const avgRequestsPerFolder = parsed.totalFolders
    ? (parsed.totalRequests / parsed.totalFolders).toFixed(1)
    : '0'
  const busiestFolder =
    parsed.folders.length > 0
      ? parsed.folders.reduce((best, f) => (f.requestCount > best.requestCount ? f : best))
      : undefined
  const topMethod = methodEntries[0]
  const structureDetailRows = [
    { label: 'Folders', value: parsed.totalFolders },
    { label: 'Distinct methods', value: methodEntries.length },
    { label: 'Avg requests / folder', value: avgRequestsPerFolder },
    ...(topMethod ? [{ label: `Top method: ${topMethod[0]}`, value: topMethod[1] }] : []),
    ...(busiestFolder
      ? [
          {
            label: 'Busiest folder',
            value: `${busiestFolder.requestCount} req`,
          },
        ]
      : []),
    { label: 'Max nesting depth', value: maxFolderDepth },
  ]

  const criticalCount = findings.filter((finding) => finding.severity === 'critical').length
  const warningCount = findings.filter((finding) => finding.severity === 'warning').length
  const infoCount = findings.filter((finding) => finding.severity === 'info').length
  const affectedRequests = new Set(findings.flatMap((finding) => finding.affected)).size
  const securityDetailRows = [
    { label: 'Critical', value: criticalCount },
    { label: 'Warnings', value: warningCount },
    { label: 'Info', value: infoCount },
    { label: 'Affected requests', value: affectedRequests },
  ]
  const securitySubtext =
    findings.length === 0
      ? 'No findings detected'
      : criticalCount > 0
        ? `${criticalCount} critical findings need review`
        : `${warningCount} warnings / ${infoCount} info items`

  const varsUsedInRequests = variableNamesUsedInRequests(parsed.requests)
  const unusedDefinedVars = parsed.definedVariables.filter((key) => !varsUsedInRequests.has(key)).length
  const secretFindings = findings.filter((finding) => finding.category === 'secrets').length
  const secretAffectedRequests = new Set(
    findings.filter((finding) => finding.category === 'secrets').flatMap((finding) => finding.affected)
  ).size
  const variableFindingCount = findings.filter((finding) => finding.category === 'variables').length
  const variablesSecretsRows = [
    { label: 'Defined variables', value: parsed.definedVariables.length },
    { label: 'Used variables', value: varsUsedInRequests.size },
    { label: 'Unused definitions', value: unusedDefinedVars },
    { label: 'Secret findings', value: secretFindings },
    { label: 'Secret-affected requests', value: secretAffectedRequests },
  ]
  const variablesSecretsSubtext =
    secretFindings > 0
      ? `${secretFindings} secret finding${secretFindings === 1 ? '' : 's'} across ${secretAffectedRequests} request${secretAffectedRequests === 1 ? '' : 's'}`
      : `${parsed.definedVariables.length} defined / ${varsUsedInRequests.size} used variables`

  const structureTree = buildStructureTree(parsed)
  const rootDirectRequests = structureTree.requests.length
  const treeDepth = maxDepth(structureTree)
  const largestBranch = structureTree.children[0]
  const largestBranchRequests = largestBranch ? totalRequests(largestBranch) : 0
  const treeLevelLegend = Array.from({ length: treeDepth }, (_, index) => ({
    label: `Level ${index + 1}`,
    color: fillForTreeLevel(index + 1),
  }))

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
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Collection overview</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Structure, auth coverage, and request inventory for this import.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <StatCard
          icon={FileText}
          label="Collection structure"
          value={parsed.totalRequests}
          subtext={`${parsed.totalFolders} folders / ${avgRequestsPerFolder} req per folder`}
          details={structureDetailRows}
          gradient="blue"
        />
        <StatCard
          icon={ShieldWarning}
          label="Security findings"
          value={findings.length}
          subtext={securitySubtext}
          details={securityDetailRows}
          gradient={criticalCount > 0 ? 'rose' : warningCount > 0 ? 'amber' : 'green'}
        />
        <StatCard
          icon={Key}
          label="Variables & secrets"
          value={parsed.definedVariables.length}
          subtext={variablesSecretsSubtext}
          details={variablesSecretsRows}
          gradient={secretFindings > 0 ? 'rose' : variableFindingCount > 0 ? 'amber' : 'violet'}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>HTTP methods</CardTitle>
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

        <Card>
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
                    data={authColorData}
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
                    {authColorData.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={entry.fill}
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
              {authColorData.map((entry) => (
                <div key={entry.name} className="flex items-center gap-2 text-xs">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: entry.fill }}
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

      <div className="pt-2">
        <h2 className="text-2xl font-semibold tracking-tight">Collection structure map</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          A folder-first view of the imported collection, optimized for spotting deep or messy branches.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={FolderOpen}
          label="Top folders"
          value={structureTree.children.length}
          subtext="Root-level branches"
          details={[
            { label: 'Total folders', value: parsed.totalFolders },
            { label: 'Top branch size', value: `${largestBranchRequests} req` },
          ]}
          gradient="amber"
        />
        <StatCard
          icon={TreeStructure}
          label="Tree depth"
          value={treeDepth}
          subtext="Maximum folder nesting"
          details={[
            { label: 'Parser depth', value: maxFolderDepth },
            { label: 'Nested branches', value: parsed.folders.filter((folder) => folder.path.length > 1).length },
          ]}
          gradient="violet"
        />
        <StatCard
          icon={Hash}
          label="Root requests"
          value={rootDirectRequests}
          subtext="Directly under collection"
          details={[
            { label: 'Nested requests', value: parsed.totalRequests - rootDirectRequests },
            { label: 'Total requests', value: parsed.totalRequests },
          ]}
          gradient="blue"
        />
        <StatCard
          icon={GitBranch}
          label="Largest branch"
          value={`${largestBranchRequests} req`}
          subtext={largestBranch?.name ?? 'No folder branches'}
          details={[
            { label: 'Direct requests', value: largestBranch?.requests.length ?? 0 },
            { label: 'Child folders', value: largestBranch?.children.length ?? 0 },
          ]}
          gradient="green"
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Request collection tree</CardTitle>
          <CardDescription>
            Branch-level overview of the collection structure without expanding every request detail.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {treeLevelLegend.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
              {treeLevelLegend.map((level) => (
                <div key={level.label} className="flex items-center gap-2 text-xs">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: level.color }}
                    aria-hidden
                  />
                  <span className="font-medium text-muted-foreground">{level.label}</span>
                </div>
              ))}
            </div>
          )}
          <ScrollArea className="h-[26rem]">
            <div className="min-w-[42rem] py-2">
              <StructureBranch node={structureTree} />
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  )
}
