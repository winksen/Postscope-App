import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, FileCode, Flask, Lightning, ShieldCheck } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  FeatureCard,
  MarketingBackground,
  MarketingCtaButton,
  MarketingHeader,
} from '@/components/marketing/marketing-shell'
import { SAMPLE_COLLECTIONS, type SampleCollectionId } from '@/lib/sampleCollections'

interface SampleDropZoneProps {
  onSelectSample: (id: SampleCollectionId) => void
  loading?: boolean
  analyzePath?: string
}

export function SampleDropZone({
  onSelectSample,
  loading = false,
  analyzePath = '/analyze',
}: SampleDropZoneProps) {
  const [loadingId, setLoadingId] = useState<SampleCollectionId | null>(null)

  const handleSelect = useCallback(
    (id: SampleCollectionId) => {
      setLoadingId(id)
      onSelectSample(id)
    },
    [onSelectSample]
  )

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <MarketingBackground />

      <MarketingHeader
        actions={
          <MarketingCtaButton to={analyzePath} variant="secondary">
            Your collections
          </MarketingCtaButton>
        }
      />

      <div className="relative flex min-h-screen flex-col items-center justify-center px-6 pb-20 pt-24">
        <Card className="w-full max-w-3xl border-border shadow-sm animate-fade-in-scale">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
              <Flask className="h-7 w-7 text-primary" />
            </div>
            <CardTitle className="text-2xl font-semibold">Try sample collections</CardTitle>
            <CardDescription className="text-base">
              Explore PostScope with curated demos — parsed locally, never saved to your library.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {SAMPLE_COLLECTIONS.map((sample) => {
                const isLoading = loading && loadingId === sample.id
                return (
                  <button
                    key={sample.id}
                    type="button"
                    disabled={loading}
                    onClick={() => handleSelect(sample.id)}
                    className={cn(
                      'flex flex-col gap-3 rounded-xl border border-border bg-muted/30 p-4 text-left transition-all duration-200',
                      'hover:border-primary/30 hover:bg-muted/50 disabled:opacity-60'
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                        <FileCode className="h-5 w-5 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold">{sample.label}</p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          {sample.description}
                        </p>
                      </div>
                    </div>
                    {isLoading ? (
                      <Skeleton className="h-9 w-full rounded-md" />
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                        Open sample
                        <ArrowRight className="h-3.5 w-3.5" />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
            <p className="text-center text-xs text-muted-foreground">
              Demo collections ship with the app — no upload or team storage involved.
            </p>
          </CardContent>
        </Card>

        <div className="mt-6 animate-fade-in">
          <Button variant="secondary" asChild>
            <Link to={analyzePath}>
              Analyze your own collection
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>

        <div className="mt-10 grid w-full max-w-3xl grid-cols-1 gap-4 sm:grid-cols-3">
          <FeatureCard
            icon={ShieldCheck}
            title="Safe to explore"
            description="Samples never touch your saved library or session."
            delay={200}
          />
          <FeatureCard
            icon={Lightning}
            title="Instant analysis"
            description="Results in milliseconds, no waiting."
            delay={400}
          />
          <FeatureCard
            icon={Flask}
            title="Realistic scenarios"
            description="From clean APIs to messy enterprise exports."
            delay={600}
          />
        </div>
      </div>
    </div>
  )
}
