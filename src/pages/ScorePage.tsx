import { ScoreGauge } from '../components/ScoreGauge'
import type { Finding } from '../lib/auditor'
import type { ScoreBreakdown } from '../lib/scorer'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

function getProgressTone(value: number): string {
  if (value >= 90) return 'bg-[hsl(var(--chart-2))]'
  if (value >= 75) return 'bg-[hsl(var(--chart-1))]'
  if (value >= 55) return 'bg-[hsl(var(--chart-3))]'
  if (value >= 35) return 'bg-[hsl(var(--chart-4))]'
  return 'bg-[hsl(var(--chart-5))]'
}

interface ScorePageProps {
  score: ScoreBreakdown
  findings: Finding[]
}

const CATEGORY_LABELS: Record<keyof ScoreBreakdown['categories'], string> = {
  secrets: 'Secrets',
  variables: 'Variables',
  auth: 'Auth',
  hygiene: 'Hygiene',
}

export function ScorePage({ score, findings }: ScorePageProps) {
  const advice: string[] = []
  const critical = findings.filter((f) => f.severity === 'critical')
  const warning = findings.filter((f) => f.severity === 'warning')
  if (critical.length > 0) {
    advice.push('Fix hardcoded secrets and tokens immediately. Use {{variables}} for all sensitive values.')
  }
  if (warning.some((f) => f.category === 'variables')) {
    advice.push('Replace hardcoded URLs with {{baseUrl}} or environment variables for portability.')
  }
  if (warning.some((f) => f.category === 'auth')) {
    advice.push('Add authentication to mutation requests (POST, PUT, PATCH, DELETE) where applicable.')
  }
  if (findings.some((f) => f.category === 'hygiene')) {
    advice.push('Add descriptions to requests and define collection variables for better maintainability.')
  }
  if (advice.length === 0) {
    advice.push('Keep variables and auth consistent across environments.')
    advice.push('Document requests with descriptions for team clarity.')
    advice.push('Use collection variables for baseUrl, apiKey, and environment-specific values.')
  }

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Security score</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Weighted posture across secrets, variables, auth, and hygiene.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg">Overall grade</CardTitle>
            <CardDescription>Animated from zero on each import refresh</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center pb-10 pt-2">
            <ScoreGauge score={score.total} grade={score.grade} summary={score.summary} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Category mix</CardTitle>
            <CardDescription>Contribution to the headline score</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {Object.entries(score.categories).map(([key, value]) => (
              <div key={key} className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {CATEGORY_LABELS[key as keyof ScoreBreakdown['categories']]}
                  </span>
                  <span className="font-mono text-xs tabular-nums text-foreground">{value}/100</span>
                </div>
                <Progress value={value} indicatorClassName={getProgressTone(value)} />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Guidance</CardTitle>
          <CardDescription>What to do next based on this run</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="summary" className="w-full">
            <TabsList className="grid w-full max-w-md grid-cols-2">
              <TabsTrigger value="summary">Summary</TabsTrigger>
              <TabsTrigger value="detail">Detail</TabsTrigger>
            </TabsList>
            <TabsContent value="summary" className="mt-4 space-y-3">
              {advice.slice(0, 3).map((a, i) => (
                <div key={i} className="flex gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3 transition-colors duration-200 hover:bg-muted/60">
                  <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  <p className="text-sm leading-relaxed text-muted-foreground">{a}</p>
                </div>
              ))}
            </TabsContent>
            <TabsContent value="detail" className="mt-4">
              <Separator className="mb-4" />
              <ul className="space-y-2 text-sm text-muted-foreground">
                {advice.map((a, i) => (
                  <li key={i} className="leading-relaxed">
                    <span className="mr-2 font-medium text-primary">{i + 1}.</span>
                    {a}
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
