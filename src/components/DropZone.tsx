import { useCallback, useState } from 'react'
import { UploadSimple, FileCode, Sparkle, ShieldCheck, Lightning, ChartBar } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface DropZoneProps {
  onFile: (file: File) => void
  loading?: boolean
}

const SAMPLE_COLLECTIONS = [
  {
    id: 'default',
    label: 'Default sample',
    description: 'Balanced API collection with clean structure',
    path: '/samples/default.postman_collection.json',
    filename: 'sample-default.postman_collection.json',
  },
  {
    id: 'messy-large',
    label: 'Enterprise messy demo',
    description: '140+ requests, duplicates, deep nesting, uneven auth/method mix',
    path: '/samples/messy-large.postman_collection.json',
    filename: 'sample-messy-large.postman_collection.json',
  },
  {
    id: 'secrets-auth',
    label: 'Secrets + auth sample',
    description: 'Contains exposed secrets and varied auth schemes',
    path: '/samples/secrets-auth.postman_collection.json',
    filename: 'sample-secrets-auth.postman_collection.json',
  },
  {
    id: 'security-issues',
    label: 'Security issues sample',
    description: 'Intentionally vulnerable collection with many findings',
    path: '/samples/security-issues.postman_collection.json',
    filename: 'sample-security-issues.postman_collection.json',
  },
] as const

function AnimatedBlob({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'absolute rounded-full blur-3xl opacity-30 dark:opacity-20',
        className
      )}
    />
  )
}

function FeatureCard({
  icon: Icon,
  title,
  description,
  delay,
}: {
  icon: typeof ShieldCheck
  title: string
  description: string
  delay: number
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-xl border border-border/50 bg-card/60 p-5 text-center backdrop-blur-sm',
        'animate-fade-in transition-all duration-300 hover:bg-card'
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

export function DropZone({ onFile, loading = false }: DropZoneProps) {
  const [drag, setDrag] = useState(false)
  const [sampleId, setSampleId] = useState<(typeof SAMPLE_COLLECTIONS)[number]['id']>('default')

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDrag(false)
      const file = e.dataTransfer.files[0]
      if (file?.name.endsWith('.postman_collection.json') || file?.name.endsWith('.json')) {
        onFile(file)
      }
    },
    [onFile]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDrag(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDrag(false)
  }, [])

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) onFile(file)
      e.target.value = ''
    },
    [onFile]
  )

  const handleLoadSample = useCallback(() => {
    const selected = SAMPLE_COLLECTIONS.find((s) => s.id === sampleId) ?? SAMPLE_COLLECTIONS[0]
    fetch(selected.path)
      .then((r) => r.json())
      .then((json) => {
        const blob = new Blob([JSON.stringify(json)], { type: 'application/json' })
        onFile(new File([blob], selected.filename))
      })
  }, [onFile, sampleId])

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      {/* Animated background blobs */}
      <AnimatedBlob className="-left-20 -top-20 h-96 w-96 bg-primary/40 animate-blob" />
      <AnimatedBlob className="-right-20 top-1/3 h-80 w-80 bg-chart-2/40 animate-blob animation-delay-2000" />
      <AnimatedBlob className="bottom-0 left-1/3 h-72 w-72 bg-chart-3/30 animate-blob animation-delay-4000" />

      {/* Subtle grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.015] dark:opacity-[0.03]"
        style={{
          backgroundImage: `radial-gradient(circle, hsl(var(--foreground)) 1px, transparent 1px)`,
          backgroundSize: '32px 32px',
        }}
      />

      <header className="fixed left-0 right-0 top-0 z-10 flex h-14 items-center justify-between border-b border-border/50 bg-background/80 px-6 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Sparkle className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-semibold tracking-tight">PostScope</p>
            <p className="text-xs text-muted-foreground">Local collection intelligence</p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="hidden sm:inline-flex" asChild>
          <a href="https://www.postman.com/" target="_blank" rel="noreferrer">
            Postman ecosystem
          </a>
        </Button>
      </header>

      <div className="relative flex min-h-screen flex-col items-center justify-center px-6 pb-20 pt-24">
        {/* Main drop card */}
        <Card
          className={cn(
            'w-full max-w-xl border-2 border-dashed shadow-sm transition-all duration-300',
            'animate-fade-in-scale',
            drag
              ? 'border-primary/60 bg-primary/[0.03] shadow-lg'
              : 'border-border hover:border-primary/30'
          )}

        >
          <CardHeader className="text-center">
            <div
              className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted transition-transform duration-300"
            >
              <FileCode className="h-7 w-7 text-primary" />
            </div>
            <CardTitle className="text-2xl font-semibold">
              <span>Import a collection</span>
            </CardTitle>
            <CardDescription className="text-base">
              Drop a Postman export — parsed in your browser, never uploaded.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className={cn(
                'flex flex-col items-center justify-center gap-4 rounded-xl border border-border bg-muted/30 px-8 py-12 transition-all duration-300',
                drag && 'bg-primary/[0.06] border-primary/20'
              )}
            >
              {loading ? (
                <div className="flex w-full flex-col gap-3">
                  <Skeleton className="mx-auto h-12 w-12 rounded-full" />
                  <Skeleton className="h-4 w-[75%] max-w-xs self-center" />
                  <Skeleton className="h-4 w-full max-w-sm self-center" />
                </div>
              ) : (
                <>
                  <div
                    className={cn(
                      'flex h-16 w-16 items-center justify-center rounded-2xl bg-muted transition-all duration-300',
                      drag && 'animate-pulse-glow'
                    )}
                  >
                    <UploadSimple
                      className={cn(
                        'h-8 w-8 text-muted-foreground transition-all duration-300',
                        drag && 'text-primary'
                      )}
                    />
                  </div>
                  <p className="text-center text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">Drag & drop</span> your JSON here
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <Button asChild variant="default" className="shadow-sm">
                      <label className="cursor-pointer">
                        Browse files
                        <input
                          type="file"
                          accept=".json,.postman_collection.json"
                          onChange={handleFileInput}
                          className="hidden"
                        />
                      </label>
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={handleLoadSample}
                    >
                      Preview sample
                    </Button>
                  </div>
                  <div className="w-full max-w-sm space-y-2">
                    <Select value={sampleId} onValueChange={(v) => setSampleId(v as (typeof SAMPLE_COLLECTIONS)[number]['id'])}>
                      <SelectTrigger className="h-10">
                        <SelectValue placeholder="Choose sample collection" />
                      </SelectTrigger>
                      <SelectContent>
                        {SAMPLE_COLLECTIONS.map((sample) => (
                          <SelectItem key={sample.id} value={sample.id}>
                            {sample.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-center text-xs text-muted-foreground">
                      {SAMPLE_COLLECTIONS.find((s) => s.id === sampleId)?.description}
                    </p>
                  </div>
                </>
              )}
            </div>
            <p className="text-center text-xs text-muted-foreground">
              Accepts{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                .postman_collection.json
              </code>{' '}
              and standard exports.
            </p>
          </CardContent>
        </Card>

        {/* Feature highlights */}
        <div className="mt-10 grid w-full max-w-xl grid-cols-1 gap-4 sm:grid-cols-3">
          <FeatureCard
            icon={ShieldCheck}
            title="Privacy-first"
            description="Parsed locally, never uploaded to any server."
            delay={200}
          />
          <FeatureCard
            icon={Lightning}
            title="Instant analysis"
            description="Results in milliseconds, no waiting."
            delay={400}
          />
          <FeatureCard
            icon={ChartBar}
            title="Visual insights"
            description="Charts and security scoring at a glance."
            delay={600}
          />
        </div>
      </div>
    </div>
  )
}
