import {
  ArrowRight,
  ChartBar,
  FileCode,
  Lightning,
  MagnifyingGlass,
  ShieldCheck,
  Stethoscope,
} from '@phosphor-icons/react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  FeatureCard,
  MarketingBackground,
  MarketingCtaButton,
  MarketingHeader,
} from '@/components/marketing/marketing-shell'

const STEPS = [
  {
    step: '01',
    title: 'Import your collection',
    description: 'Drop a Postman export or browse for a JSON file — parsing happens entirely in your browser.',
    icon: FileCode,
  },
  {
    step: '02',
    title: 'Instant audit',
    description: 'Security findings, duplicate routes, auth gaps, and structure issues surface in milliseconds.',
    icon: MagnifyingGlass,
  },
  {
    step: '03',
    title: 'Act on insights',
    description: 'Explore requests, review severity-ranked issues, and track your collection health score.',
    icon: ChartBar,
  },
] as const

export function LandingPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <MarketingBackground />

      <MarketingHeader
        actions={
          <MarketingCtaButton to="/analyze">
            Open analyzer
          </MarketingCtaButton>
        }
      />

      <main className="relative px-6 pb-24 pt-28">
        <section className="mx-auto flex max-w-4xl flex-col items-center text-center">
          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl animate-fade-in">
            Understand your <span className="text-orange-400">Postman</span> collections{' '}
            <span className="text-primary">in Seconds</span>
          </h1>

          <p className="mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg animate-fade-in">
            PostScope audits API collections locally — security risks, structural debt, and coverage gaps
            without uploading your data to any server.
          </p>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-3 animate-fade-in">
            <Button size="lg" className="gap-2 shadow-sm" asChild>
              <Link to="/analyze">
                Analyze a collection
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="secondary" asChild>
              <Link to="/analyze">Try a sample collection</Link>
            </Button>
          </div>
        </section>

        <section className="mx-auto mt-20 grid max-w-4xl grid-cols-1 gap-4 sm:grid-cols-3">
          <FeatureCard
            icon={ShieldCheck}
            title="Privacy-first"
            description="Parsed locally, never uploaded to any server."
            delay={100}
          />
          <FeatureCard
            icon={Lightning}
            title="Instant analysis"
            description="Results in milliseconds, no waiting."
            delay={200}
          />
          <FeatureCard
            icon={ChartBar}
            title="Visual insights"
            description="Charts and security scoring at a glance."
            delay={300}
          />
        </section>

        <section className="mx-auto mt-24 max-w-4xl">
          <div className="mb-10 text-center">
            <p className="text-sm font-medium text-primary">How it works</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              From export to actionable insights
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground sm:text-base">
              Three steps to a healthier, safer API collection — no account required.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {STEPS.map(({ step, title, description, icon: Icon }, index) => (
              <Card
                key={step}
                className="border-border/50 bg-card/60 backdrop-blur-sm transition-all duration-300 hover:bg-card animate-fade-in"
                style={{ animationDelay: `${index * 120}ms` }}
              >
                <CardHeader className="pb-3">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>
                    <span className="font-mono text-xs text-muted-foreground">{step}</span>
                  </div>
                  <CardTitle className="text-base">{title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-sm leading-relaxed">{description}</CardDescription>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="mx-auto mt-24 max-w-3xl">
          <Card className="overflow-hidden border-border/50 bg-card/70 shadow-sm backdrop-blur-sm">
            <CardContent className="flex flex-col items-center gap-6 p-8 text-center sm:p-10">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
                <Stethoscope className="h-7 w-7 text-primary" weight="fill" />
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-semibold tracking-tight">Ready to diagnose your APIs?</h2>
                <p className="text-sm text-muted-foreground sm:text-base">
                  Drop a Postman collection and get security findings, request maps, and a health score —
                  all processed on your device.
                </p>
              </div>
              <Button size="lg" className="gap-2 shadow-sm" asChild>
                <Link to="/analyze">
                  Open the analyzer
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </section>

        <footer className="mx-auto mt-20 max-w-4xl border-t border-border/50 pt-8 text-center">
          <p className="text-xs text-muted-foreground">
            PostScope — local Postman collection intelligence. Your collections never leave your browser.
          </p>
        </footer>
      </main>
    </div>
  )
}
