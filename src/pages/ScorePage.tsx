import { useEffect, useState } from 'react'
import { ScoreGauge } from '../components/ScoreGauge'
import type { Finding } from '../lib/auditor'
import type { ScoreBreakdown } from '../lib/scorer'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Key, Link, Lock, Sparkles, CheckCircle, AlertCircle, Lightbulb, Download } from 'lucide-react'
import { cn } from '@/lib/utils'

function getProgressTone(value: number): string {
  if (value >= 90) return 'bg-[hsl(var(--chart-2))]'
  if (value >= 75) return 'bg-[hsl(var(--chart-1))]'
  if (value >= 55) return 'bg-[hsl(var(--chart-3))]'
  if (value >= 35) return 'bg-[hsl(var(--chart-4))]'
  return 'bg-[hsl(var(--chart-5))]'
}

function getScoreTone(value: number): string {
  if (value >= 90) return 'text-[hsl(var(--chart-2))]'
  if (value >= 75) return 'text-[hsl(var(--chart-1))]'
  if (value >= 55) return 'text-[hsl(var(--chart-3))]'
  if (value >= 35) return 'text-[hsl(var(--chart-4))]'
  return 'text-[hsl(var(--chart-5))]'
}

const CATEGORY_ICONS = {
  secrets: Key,
  variables: Link,
  auth: Lock,
  hygiene: Sparkles,
}

const CATEGORY_LABELS: Record<keyof ScoreBreakdown['categories'], string> = {
  secrets: 'Secrets',
  variables: 'Variables',
  auth: 'Auth',
  hygiene: 'Hygiene',
}

interface ScorePageProps {
  score: ScoreBreakdown
  findings: Finding[]
}

function CategoryBar({
  keyName,
  value,
  delay,
}: {
  keyName: keyof ScoreBreakdown['categories']
  value: number
  delay: number
}) {
  const Icon = CATEGORY_ICONS[keyName]
  const [animatedValue, setAnimatedValue] = useState(0)

  useEffect(() => {
    const duration = 800
    const startTime = Date.now()
    const tick = () => {
      const elapsed = Date.now() - startTime
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setAnimatedValue(Math.round(value * eased))
      if (progress < 1) requestAnimationFrame(tick)
    }
    const timer = setTimeout(tick, delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return (
    <div className="space-y-2 animate-fade-in" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <div className={cn('flex h-7 w-7 items-center justify-center rounded-md bg-primary/10', getScoreTone(value))}>
            <Icon className="h-3.5 w-3.5" />
          </div>
          <span className="text-muted-foreground">{CATEGORY_LABELS[keyName]}</span>
        </div>
        <span className={cn('font-mono text-xs tabular-nums font-semibold', getScoreTone(value))}>
          {animatedValue}/100
        </span>
      </div>
      <Progress value={animatedValue} indicatorClassName={getProgressTone(value)} className="h-2" />
    </div>
  )
}

function ActionCard({
  advice,
  index,
  priority,
}: {
  advice: string
  index: number
  priority: 'P0' | 'P1' | 'P2'
}) {
  const priorityConfig = {
    P0: { icon: AlertCircle, color: 'bg-destructive/10 text-destructive border-destructive/20' },
    P1: { icon: Lightbulb, color: 'bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))] border-[hsl(var(--warning))]/20' },
    P2: { icon: CheckCircle, color: 'bg-[hsl(var(--success))]/10 text-[hsl(var(--success))] border-[hsl(var(--success))]/20' },
  }

  const config = priorityConfig[priority]
  const Icon = config.icon

  return (
    <div
      className={cn(
        'flex gap-3 rounded-xl border bg-card px-4 py-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm animate-fade-in'
      )}
      style={{ animationDelay: `${index * 100}ms` }}
    >
      <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border', config.color)}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1">
          <Badge variant="outline" className="text-[10px] h-5 px-1.5">
            {priority}
          </Badge>
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">{advice}</p>
      </div>
    </div>
  )
}

export function ScorePage({ score, findings }: ScorePageProps) {
  const advice: { text: string; priority: 'P0' | 'P1' | 'P2' }[] = []
  const critical = findings.filter((f) => f.severity === 'critical')
  const warning = findings.filter((f) => f.severity === 'warning')

  if (critical.length > 0) {
    advice.push({ text: 'Fix hardcoded secrets and tokens immediately. Use {{variables}} for all sensitive values.', priority: 'P0' })
  }
  if (warning.some((f) => f.category === 'variables')) {
    advice.push({ text: 'Replace hardcoded URLs with {{baseUrl}} or environment variables for portability.', priority: 'P1' })
  }
  if (warning.some((f) => f.category === 'auth')) {
    advice.push({ text: 'Add authentication to mutation requests (POST, PUT, PATCH, DELETE) where applicable.', priority: 'P1' })
  }
  if (findings.some((f) => f.category === 'hygiene')) {
    advice.push({ text: 'Add descriptions to requests and define collection variables for better maintainability.', priority: 'P2' })
  }
  if (advice.length === 0) {
    advice.push(
      { text: 'Keep variables and auth consistent across environments.', priority: 'P2' },
      { text: 'Document requests with descriptions for team clarity.', priority: 'P2' },
      { text: 'Use collection variables for baseUrl, apiKey, and environment-specific values.', priority: 'P2' }
    )
  }

  const handleExport = () => {
    const report = {
      score: score.total,
      grade: score.grade,
      summary: score.summary,
      categories: score.categories,
      findings: findings.length,
      advice: advice.map((a) => a.text),
      generatedAt: new Date().toISOString(),
    }
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `postscope-report-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <div className="animate-fade-in">
        <h1 className="text-2xl font-semibold tracking-tight">Security score</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Weighted posture across secrets, variables, auth, and hygiene.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2 animate-fade-in animate-delay-100">
          <CardHeader>
            <CardTitle className="text-lg">Overall grade</CardTitle>
            <CardDescription>Animated from zero on each import refresh</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center pb-10 pt-2">
            <ScoreGauge score={score.total} grade={score.grade} summary={score.summary} />
          </CardContent>
        </Card>

        <Card className="animate-fade-in animate-delay-200">
          <CardHeader>
            <CardTitle className="text-lg">Category mix</CardTitle>
            <CardDescription>Contribution to the headline score</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {Object.entries(score.categories).map(([key, value], idx) => (
              <CategoryBar key={key} keyName={key as keyof ScoreBreakdown['categories']} value={value} delay={idx * 150} />
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="animate-fade-in animate-delay-300">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg">Guidance</CardTitle>
            <CardDescription>What to do next based on this run</CardDescription>
          </div>
          <Button variant="outline" size="sm" className="gap-2" onClick={handleExport}>
            <Download className="h-3.5 w-3.5" />
            Export
          </Button>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="summary" className="w-full">
            <TabsList className="grid w-full max-w-md grid-cols-2">
              <TabsTrigger value="summary">Summary</TabsTrigger>
              <TabsTrigger value="detail">Detail</TabsTrigger>
            </TabsList>
            <TabsContent value="summary" className="mt-4 space-y-3">
              {advice.slice(0, 3).map((a, i) => (
                <ActionCard key={i} advice={a.text} index={i} priority={a.priority} />
              ))}
            </TabsContent>
            <TabsContent value="detail" className="mt-4">
              <Separator className="mb-4" />
              <ul className="space-y-3">
                {advice.map((a, i) => (
                  <li key={i} className="flex gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3 animate-fade-in" style={{ animationDelay: `${i * 100}ms` }}>
                    <span className={cn('mt-0.5 h-2 w-2 shrink-0 rounded-full', a.priority === 'P0' ? 'bg-destructive' : a.priority === 'P1' ? 'bg-[hsl(var(--warning))]' : 'bg-[hsl(var(--success))]')} />
                    <div>
                      <Badge variant="outline" className="text-[10px] h-5 px-1.5 mb-1">
                        {a.priority}
                      </Badge>
                      <p className="text-sm leading-relaxed text-muted-foreground">{a.text}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
