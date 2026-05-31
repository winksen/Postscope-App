import { MagnifyingGlass, SignOut, FileCode, ChartPieSlice, Shield, Gauge, FolderSimple, BookmarkSimple, type Icon } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ThemeToggle } from '@/components/theme-toggle'
// cn removed - not needed
import type { NavId } from './app-sidebar'

const NAV_LABELS: Record<NavId, { label: string; icon: Icon }> = {
  overview: { label: 'Dashboard', icon: ChartPieSlice },
  requests: { label: 'Requests', icon: FolderSimple },
  security: { label: 'Security', icon: Shield },
  score: { label: 'Score', icon: Gauge },
}

interface AppHeaderProps {
  sidebarOffset: string
  collectionName: string
  search: string
  onOpenSearch: () => void
  onAnalyzeAnother: () => void
  onSaveToLibrary?: () => void
  isSavedToLibrary: boolean
  savingToLibrary: boolean
  historyEnabled: boolean
  active: NavId
}

export function AppHeader({
  sidebarOffset,
  collectionName,
  search,
  onOpenSearch,
  onAnalyzeAnother,
  onSaveToLibrary,
  isSavedToLibrary,
  savingToLibrary,
  historyEnabled,
  active,
}: AppHeaderProps) {
  const activeNav = NAV_LABELS[active]

  return (
    <header
      className="fixed right-0 top-0 z-30 flex h-14 items-center gap-4 bg-background/70 px-6 backdrop-blur-xl transition-[left] duration-200"
      style={{ left: sidebarOffset }}
    >
      {/* Breadcrumb */}
      <div className="hidden items-center gap-2 md:flex">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <activeNav.icon className="h-3.5 w-3.5" />
          <span className="font-medium text-foreground">{activeNav.label}</span>
        </div>
        <span className="text-muted-foreground/40">/</span>
        <div className="flex items-center gap-1.5">
          <FileCode className="h-3.5 w-3.5 text-muted-foreground" />
          <p className="truncate text-sm text-muted-foreground max-w-[180px] lg:max-w-xs" title={collectionName}>
            {collectionName}
          </p>
        </div>
      </div>

      <div className="relative min-w-0 flex-1 max-w-md ml-auto md:ml-0">
        <button
          type="button"
          onClick={onOpenSearch}
          className="flex h-9 w-full items-center rounded-xl bg-muted/70 pl-9 pr-9 text-left text-sm transition-colors duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/50"
        >
          <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <span className={search ? 'truncate text-foreground' : 'truncate text-muted-foreground'}>
            {search || 'Search requests…'}
          </span>
        </button>
        <div className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 items-center gap-1 text-[10px] text-muted-foreground/60 sm:flex">
          <kbd className="rounded bg-background/40 px-1 py-0.5 font-mono text-[10px]">Ctrl</kbd>
          <kbd className="rounded bg-background/40 px-1 py-0.5 font-mono text-[10px]">K</kbd>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <ThemeToggle />

        {historyEnabled && !isSavedToLibrary && onSaveToLibrary && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-foreground"
                onClick={onSaveToLibrary}
                disabled={savingToLibrary}
              >
                <BookmarkSimple className="h-4 w-4" weight={savingToLibrary ? 'regular' : 'fill'} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{savingToLibrary ? 'Saving…' : 'Save to library'}</TooltipContent>
          </Tooltip>
        )}

        <Button variant="secondary" size="sm" className="gap-2" onClick={onAnalyzeAnother}>
          <SignOut className="h-4 w-4" />
          <span className="hidden sm:inline">New collection</span>
        </Button>
      </div>
    </header>
  )
}
