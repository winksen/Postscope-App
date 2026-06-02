import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { UploadSimple, FileCode, ShieldCheck, Clock, ClockCounterClockwise, EyeSlash, Warning, CloudArrowUp, ArrowRight } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { formatSavedAt, type SavedCollectionMeta } from '@/lib/collectionLibrary'
import { MarketingBackground, MarketingHeader } from '@/components/marketing/marketing-shell'
import {
  canChoosePrivacyMode,
  getPrivacyModeDescription,
  isPublicDeployment,
  isTeamLoggingRequired,
  requiresUploadConsent,
  type LoggingMode,
} from '@/lib/deploymentConfig'
import type { StorageMode } from '@/lib/storagePreferences'

const fadeTransition = { duration: 0.3, ease: [0.22, 1, 0.36, 1] as const }

interface DropZoneProps {
  onFile: (file: File) => void
  loading?: boolean
  loggingMode: LoggingMode
  storageMode: StorageMode
  onStorageModeChange: (mode: StorageMode) => void
  uploadConsent: boolean
  onUploadConsentChange: (accepted: boolean) => void
  savedCollections?: SavedCollectionMeta[]
  onOpenLibrary?: () => void
  onLoadSaved?: (id: string) => void
  samplesPath?: string
}

export function DropZone({
  onFile,
  loading = false,
  loggingMode,
  storageMode,
  onStorageModeChange,
  uploadConsent,
  onUploadConsentChange,
  savedCollections = [],
  onOpenLibrary,
  onLoadSaved,
  samplesPath = '/samples',
}: DropZoneProps) {
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

  const importBlocked =
    canChoosePrivacyMode(loggingMode) &&
    requiresUploadConsent(loggingMode, storageMode) &&
    !uploadConsent

  const privacyDescription = getPrivacyModeDescription(loggingMode, storageMode)

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <MarketingBackground />

      <MarketingHeader />

      <div className="relative flex min-h-screen flex-col items-center justify-center px-6 pb-20 pt-24">
        <div className="mb-6 w-full max-w-xl animate-fade-in">
          <p className="mb-3 text-center text-sm font-medium text-foreground">
            {canChoosePrivacyMode(loggingMode) ? 'Privacy mode' : 'Deployment mode'}
          </p>

          {canChoosePrivacyMode(loggingMode) ? (
            <div className="flex gap-2 rounded-full bg-muted/50 p-1">
              <button
                type="button"
                onClick={() => onStorageModeChange('history')}
                className={cn(
                  'flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium transition-all duration-300',
                  storageMode === 'history'
                    ? 'bg-secondary text-secondary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <ClockCounterClockwise className="h-4 w-4" />
                Save to history
              </button>
              <button
                type="button"
                onClick={() => onStorageModeChange('incognito')}
                className={cn(
                  'flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium transition-all duration-300',
                  storageMode === 'incognito'
                    ? 'bg-secondary text-secondary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <EyeSlash className="h-4 w-4" />
                Incognito
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2 rounded-full bg-muted/50 px-4 py-2.5 text-sm font-medium text-secondary-foreground">
              {isTeamLoggingRequired(loggingMode) ? (
                <>
                  <CloudArrowUp className="h-4 w-4" />
                  Team logging enabled
                </>
              ) : (
                <>
                  <ShieldCheck className="h-4 w-4" />
                  Public mode — incognito only
                </>
              )}
            </div>
          )}

          <div className="relative mt-2.5 min-h-[2.5rem]">
            <AnimatePresence mode="wait">
              <motion.p
                key={`${loggingMode}-${storageMode}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={fadeTransition}
                className="text-center text-xs text-muted-foreground"
              >
                {privacyDescription}
              </motion.p>
            </AnimatePresence>
          </div>

          <AnimatePresence initial={false}>
            {isTeamLoggingRequired(loggingMode) && (
              <motion.div
                key="logging-on-notice"
                initial={{ opacity: 0, height: 0, marginTop: 0 }}
                animate={{ opacity: 1, height: 'auto', marginTop: 12 }}
                exit={{ opacity: 0, height: 0, marginTop: 0 }}
                transition={fadeTransition}
                className="overflow-hidden"
              >
                <div className="flex w-full items-center gap-4 rounded-xl bg-muted/50 px-4 py-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted">
                    <CloudArrowUp className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <p className="text-xs leading-snug text-foreground">
                    <span className="font-medium">Mandatory logging.</span> Imported collections are
                    automatically saved to the app storage for your team.
                  </p>
                </div>
              </motion.div>
            )}

            {requiresUploadConsent(loggingMode, storageMode) && (
              <motion.div
                key="upload-warning"
                initial={{ opacity: 0, height: 0, marginTop: 0 }}
                animate={{ opacity: 1, height: 'auto', marginTop: 12 }}
                exit={{ opacity: 0, height: 0, marginTop: 0 }}
                transition={fadeTransition}
                className="overflow-hidden"
              >
                <div className="flex w-full items-center gap-4 rounded-xl bg-muted/50 px-4 py-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted">
                    <Warning className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    <p className="text-xs leading-snug text-foreground">
                      <span className="font-medium">Upload warning.</span> Files are saved to this
                      app&apos;s storage — visible to your team, including URLs, headers, and tokens.
                    </p>
                    <div className="flex items-center gap-2.5">
                      <Checkbox
                        id="upload-consent"
                        checked={uploadConsent}
                        onCheckedChange={(checked) => onUploadConsentChange(checked === true)}
                      />
                      <Label
                        htmlFor="upload-consent"
                        className="cursor-pointer text-xs font-normal leading-snug text-muted-foreground"
                      >
                        I accept — my collection will be stored on the app and may be viewed by my team.
                      </Label>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {isPublicDeployment(loggingMode) && (
              <motion.div
                key="public-notice"
                initial={{ opacity: 0, height: 0, marginTop: 0 }}
                animate={{ opacity: 1, height: 'auto', marginTop: 12 }}
                exit={{ opacity: 0, height: 0, marginTop: 0 }}
                transition={fadeTransition}
                className="overflow-hidden"
              >
                <div className="flex w-full items-center gap-4 rounded-xl bg-muted/50 px-4 py-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted">
                    <ShieldCheck className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <p className="text-xs leading-snug text-foreground">
                    <span className="font-medium">Nothing stored.</span> Incognito mode — your data is
                    never written to the app&apos;s storage.
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

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
              onDrop={importBlocked ? undefined : handleDrop}
              onDragOver={importBlocked ? undefined : handleDragOver}
              onDragLeave={importBlocked ? undefined : handleDragLeave}
              className={cn(
                'flex flex-col items-center justify-center gap-4 rounded-xl border border-border bg-muted/30 px-8 py-12 transition-all duration-300',
                drag && !importBlocked && 'bg-primary/[0.06] border-primary/20',
                importBlocked && 'opacity-60'
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
                    {importBlocked ? (
                      <>Accept the upload warning above to import a collection.</>
                    ) : (
                      <>
                        <span className="font-medium text-foreground">Drag & drop</span> your JSON here
                      </>
                    )}
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <Button asChild variant="default" className="shadow-sm" disabled={importBlocked}>
                      <label className={cn('cursor-pointer', importBlocked && 'pointer-events-none opacity-50')}>
                        Browse files
                        <input
                          type="file"
                          accept=".json,.postman_collection.json"
                          onChange={handleFileInput}
                          className="hidden"
                          disabled={importBlocked}
                        />
                      </label>
                    </Button>
                    <Button variant="secondary" asChild>
                      <Link to={samplesPath}>
                        Try sample collections
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Link>
                    </Button>
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

        {savedCollections.length > 0 && onLoadSaved && (
          <div className="mt-6 w-full max-w-xl animate-fade-in">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-muted-foreground">Recently saved</p>
              {onOpenLibrary && (
                <Button variant="secondary" size="sm" className="h-7 text-xs" onClick={onOpenLibrary}>
                  View all
                </Button>
              )}
            </div>
            <div className="space-y-2">
              {savedCollections.slice(0, 4).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onLoadSaved(item.id)}
                  disabled={loading}
                  className="flex w-full items-center gap-3 rounded-xl bg-muted/40 px-4 py-3 text-left transition-colors hover:bg-muted/70 disabled:opacity-60"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <FileCode className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.name}</p>
                    <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{item.requestCount} requests</span>
                      <span aria-hidden>·</span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatSavedAt(item.savedAt)}
                      </span>
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
