import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { FileText, FolderOpen, Key, Layers } from 'lucide-react'
import { StatCard } from '../components/StatCard'
import { RequestTree } from '../components/RequestTree'
import type { ParsedCollection } from '../lib/parser'
import type { Finding } from '../lib/auditor'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartTooltipFrame } from '@/components/charts/chart-tooltip'

const METHOD_COLORS: Record<string, string> = {
  GET: 'hsl(var(--chart-2))',
  POST: 'hsl(var(--chart-1))',
  PUT: 'hsl(var(--chart-3))',
  PATCH: 'hsl(var(--chart-4))',
  DELETE: 'hsl(var(--chart-5))',
}

const PIE_COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
  'hsl(var(--muted-foreground))',
]

interface OverviewPageProps {
  parsed: ParsedCollection
  findings: Finding[]
  search: string
}

export function OverviewPage({ parsed, findings, search }: OverviewPageProps) {
  const methodData = Object.entries(parsed.methods).map(([method, count]) => ({
    name: method,
    count,
    fill: METHOD_COLORS[method] ?? 'hsl(var(--muted-foreground))',
  }))

  const authData = Object.entries(parsed.authTypes)
    .filter(([k]) => k !== 'noauth')
    .map(([name, value]) => ({ name, value }))

  if (authData.length === 0) {
    authData.push({ name: 'noauth', value: parsed.totalRequests })
  }

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
      <div>
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
        />
        <StatCard
          icon={FolderOpen}
          label="Folders"
          value={parsed.totalFolders}
          subtext={`${parsed.totalRequests} requests`}
        />
        <StatCard
          icon={Key}
          label="Variables defined"
          value={parsed.definedVariables.length}
          subtext={`${parsed.variables.length} referenced`}
        />
        <StatCard
          icon={Layers}
          label="Auth profiles"
          value={Object.keys(parsed.authTypes).filter((k) => k !== 'noauth').length || 1}
          subtext={Object.entries(parsed.authTypes)
            .map(([k, v]) => `${k}: ${v}`)
            .join(', ')}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="transition-shadow duration-200 hover:shadow-md">
          <CardHeader>
            <CardTitle>HTTP methods</CardTitle>
            <CardDescription>Distribution of verbs across the collection</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={methodData} layout="vertical" margin={{ left: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
                  <XAxis
                    type="number"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={44}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                  />
                  <Tooltip content={chartTooltip} cursor={{ fill: 'hsl(var(--muted) / 0.35)' }} />
                  <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                    {methodData.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="transition-shadow duration-200 hover:shadow-md">
          <CardHeader>
            <CardTitle>Authentication</CardTitle>
            <CardDescription>How requests declare auth in the collection</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={authData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={56}
                    outerRadius={78}
                    paddingAngle={2}
                    stroke="hsl(var(--background))"
                  >
                    {authData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
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
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <text
                    x="50%"
                    y="50%"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    style={{ fill: 'hsl(var(--foreground))', fontSize: '1.35rem', fontWeight: 600 }}
                  >
                    {parsed.totalRequests}
                  </text>
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="transition-shadow duration-200 hover:shadow-md">
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
