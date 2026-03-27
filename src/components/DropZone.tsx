import { useCallback, useState } from 'react'
import { Upload, FileJson, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

interface DropZoneProps {
  onFile: (file: File) => void
  loading?: boolean
}

export function DropZone({ onFile, loading = false }: DropZoneProps) {
  const [drag, setDrag] = useState(false)

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

  return (
    <div className="relative min-h-screen bg-background">
      <header className="fixed left-0 right-0 top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-background/80 px-6 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Sparkles className="h-4 w-4" />
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

      <div className="flex min-h-screen flex-col items-center justify-center px-6 pb-20 pt-24">
        <Card
          className={cn(
            'w-full max-w-xl border-2 border-dashed shadow-sm transition-all duration-200',
            drag ? 'border-primary/60 bg-primary/[0.03] shadow-md' : 'border-border hover:border-primary/30 hover:shadow-md'
          )}
        >
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
              <FileJson className="h-6 w-6 text-primary" />
            </div>
            <CardTitle className="text-2xl font-semibold">Import a collection</CardTitle>
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
                'flex flex-col items-center justify-center gap-4 rounded-xl border border-border bg-muted/30 px-8 py-12 transition-colors duration-200',
                drag && 'bg-primary/[0.06]'
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
                  <Upload className="h-10 w-10 text-muted-foreground" />
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
                      onClick={() =>
                        fetch('/sample.postman_collection.json')
                          .then((r) => r.json())
                          .then((json) => {
                            const blob = new Blob([JSON.stringify(json)], { type: 'application/json' })
                            onFile(new File([blob], 'sample.postman_collection.json'))
                          })
                      }
                    >
                      Try sample
                    </Button>
                  </div>
                </>
              )}
            </div>
            <p className="text-center text-xs text-muted-foreground">
              Accepts <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">.postman_collection.json</code>{' '}
              and standard exports.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
