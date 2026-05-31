import { useCallback, useEffect, useState } from 'react'
import {
  Books,
  DownloadSimple,
  Trash,
  Clock,
  FileCode,
  FolderOpen,
} from '@phosphor-icons/react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import {
  downloadCollectionJson,
  formatBytes,
  formatSavedAt,
  getSavedCollection,
  listSavedCollections,
  removeFromLibrary,
  type SavedCollectionMeta,
} from '@/lib/collectionLibrary'
import { cn } from '@/lib/utils'

interface CollectionLibraryModalProps {
  open: boolean
  activeCollectionId?: string | null
  onOpenChange: (open: boolean) => void
  onLoad: (id: string) => void
  onLibraryChange?: () => void
}

export function CollectionLibraryModal({
  open,
  activeCollectionId,
  onOpenChange,
  onLoad,
  onLibraryChange,
}: CollectionLibraryModalProps) {
  const [collections, setCollections] = useState<SavedCollectionMeta[]>([])
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setCollections(await listSavedCollections())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void refresh()
  }, [open, refresh])

  const handleLoad = async (id: string) => {
    setBusyId(id)
    try {
      onLoad(id)
      onOpenChange(false)
    } finally {
      setBusyId(null)
    }
  }

  const handleExport = async (meta: SavedCollectionMeta) => {
    setBusyId(meta.id)
    try {
      const record = await getSavedCollection(meta.id)
      if (record) downloadCollectionJson(record.name, record.rawJson)
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = async (meta: SavedCollectionMeta) => {
    const confirmed = window.confirm(`Remove "${meta.name}" from saved collections?`)
    if (!confirmed) return

    setBusyId(meta.id)
    try {
      await removeFromLibrary(meta.id)
      await refresh()
      onLibraryChange?.()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-xl gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="space-y-3 border-b border-border bg-gradient-to-r from-muted/50 to-transparent p-6 pb-4 text-left">
          <DialogDescription className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            App storage
          </DialogDescription>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Books className="h-5 w-5 text-orange-400" weight="fill" />
            Team library
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Collections saved on this app — visible to everyone on your team. Export a JSON file for an
            offline copy.
          </p>
        </DialogHeader>

        <ScrollArea className="max-h-[min(52vh,420px)]">
          <div className="space-y-2 p-4">
            {loading ? (
              [...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-[72px] rounded-xl" />
              ))
            ) : collections.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-muted/20 px-6 py-10 text-center">
                <FolderOpen className="h-10 w-10 text-muted-foreground/60" />
                <div>
                  <p className="text-sm font-medium">No saved collections yet</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    No collections saved yet. Accept the upload warning on the import page to add one.
                  </p>
                </div>
              </div>
            ) : (
              collections.map((item) => {
                const isActive = item.id === activeCollectionId
                const isBusy = busyId === item.id

                return (
                  <div
                    key={item.id}
                    className={cn(
                      'flex items-start gap-3 rounded-xl border bg-card p-3 transition-colors',
                      isActive ? 'border-orange-400/40 bg-orange-500/5' : 'border-border'
                    )}
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                      <FileCode className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium" title={item.name}>
                            {item.name}
                          </p>
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                            <span>{item.requestCount} requests</span>
                            <span aria-hidden>·</span>
                            <span>{formatBytes(item.sizeBytes)}</span>
                            <span aria-hidden>·</span>
                            <span className="inline-flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {formatSavedAt(item.savedAt)}
                            </span>
                          </p>
                        </div>
                        {isActive && (
                          <span className="shrink-0 rounded-full bg-orange-500/15 px-2 py-0.5 text-[10px] font-medium text-orange-400">
                            Open
                          </span>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-7 px-2.5 text-xs"
                          disabled={isBusy || isActive}
                          onClick={() => void handleLoad(item.id)}
                        >
                          Open
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-7 gap-1 px-2.5 text-xs"
                          disabled={isBusy}
                          onClick={() => void handleExport(item)}
                        >
                          <DownloadSimple className="h-3.5 w-3.5" />
                          Export
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-1 px-2.5 text-xs text-muted-foreground hover:text-destructive"
                          disabled={isBusy}
                          onClick={() => void handleDelete(item)}
                        >
                          <Trash className="h-3.5 w-3.5" />
                          Remove
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
