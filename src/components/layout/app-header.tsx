import {
  BookmarkSimple,
  DownloadSimple,
  FileCode,
  FileHtml,
  FileText,
  MagnifyingGlass,
  ShieldCheck,
  SignOut,
  SlidersHorizontal,
  TreeStructure,
} from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ThemeToggle } from '@/components/theme-toggle'
import { cn } from '@/lib/utils'

export type ExportFormat = 'json' | 'sarif' | 'markdown' | 'html' | 'sanitized' | 'sanitized-environments'

export interface EnvironmentOption {
  /** Index into the loaded environment files. */
  index: number
  name: string
}

interface AppHeaderProps {
  sidebarOffset: string
  search: string
  onOpenSearch: () => void
  onAnalyzeAnother: () => void
  onSaveToLibrary?: () => void
  isSavedToLibrary: boolean
  savingToLibrary: boolean
  historyEnabled: boolean
  onExport?: (format: ExportFormat) => void
  onOpenRules?: () => void
  customRulesActive?: boolean
  /** Environments (not globals) loaded with the collection. */
  environments?: EnvironmentOption[]
  activeEnvironment?: number
  onEnvironmentChange?: (index: number) => void
  /** True when any environment or globals file is loaded, which enables the sanitized environment export. */
  hasEnvironmentFiles?: boolean
}

export function AppHeader({
  sidebarOffset,
  search,
  onOpenSearch,
  onAnalyzeAnother,
  onSaveToLibrary,
  isSavedToLibrary,
  savingToLibrary,
  historyEnabled,
  onExport,
  onOpenRules,
  customRulesActive = false,
  environments = [],
  activeEnvironment,
  onEnvironmentChange,
  hasEnvironmentFiles = false,
}: AppHeaderProps) {
  return (
    <header
      className="fixed right-0 top-0 z-30 flex h-14 items-center gap-4 bg-background/70 px-6 backdrop-blur-xl transition-[left] duration-200"
      style={{ left: sidebarOffset }}
    >
      <div className="relative mx-auto min-w-0 flex-1 max-w-xl">
        <button
          type="button"
          onClick={onOpenSearch}
          aria-label="Search requests"
          aria-keyshortcuts="/ Control+K Meta+K"
          className="flex h-9 w-full items-center rounded-xl bg-card pl-9 pr-9 text-left text-sm shadow-[0_8px_22px_hsl(var(--background)/0.28)] transition-colors duration-200 hover:bg-card/90 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-orange-400/50 dark:bg-muted/70 dark:hover:bg-muted"
        >
          <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <span className={search ? 'truncate text-foreground' : 'truncate text-muted-foreground'}>{search || 'Search requests…'}</span>
        </button>
        <div
          className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 items-center gap-1 text-[10px] text-muted-foreground sm:flex"
          aria-hidden
        >
          <kbd className="rounded bg-background/40 px-1 py-0.5 text-[10px]">/</kbd>
          <span>or</span>
          <kbd className="rounded bg-background/40 px-1 py-0.5 text-[10px]">Ctrl</kbd>
          <kbd className="rounded bg-background/40 px-1 py-0.5 text-[10px]">K</kbd>
        </div>
      </div>

      <div className="flex items-center gap-1">
        {environments.length === 1 && (
          <span
            className="hidden max-w-40 truncate rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground lg:inline"
            title={`Environment: ${environments[0].name}`}
          >
            Environment: {environments[0].name}
          </span>
        )}
        {environments.length > 1 && onEnvironmentChange && (
          <Select value={String(activeEnvironment ?? environments[0].index)} onValueChange={(value) => onEnvironmentChange(Number(value))}>
            <SelectTrigger className="hidden h-8 w-44 text-xs lg:flex" aria-label="Active environment">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {environments.map((environment) => (
                <SelectItem key={environment.index} value={String(environment.index)}>
                  {environment.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <ThemeToggle />

        {onOpenRules && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn('relative text-muted-foreground hover:text-foreground', customRulesActive && 'text-foreground')}
                onClick={onOpenRules}
                aria-label="Audit rules"
              >
                <SlidersHorizontal className="h-4 w-4" weight="fill" />
                {customRulesActive && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-orange-400" aria-hidden />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{customRulesActive ? 'Audit rules (customized)' : 'Audit rules'}</TooltipContent>
          </Tooltip>
        )}

        {onExport && (
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground" aria-label="Export">
                    <DownloadSimple className="h-4 w-4" weight="fill" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Export</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel className="text-xs text-muted-foreground">Findings report</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => onExport('markdown')}>
                <FileText weight="fill" /> Markdown (.md)
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onExport('html')}>
                <FileHtml weight="fill" /> HTML (.html)
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onExport('json')}>
                <FileCode weight="fill" /> JSON (.json)
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onExport('sarif')}>
                <TreeStructure weight="fill" /> SARIF for CI (.sarif)
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs text-muted-foreground">Collection</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => onExport('sanitized')}>
                <ShieldCheck weight="fill" /> Sanitized copy (secrets removed)
              </DropdownMenuItem>
              {hasEnvironmentFiles && (
                <DropdownMenuItem onSelect={() => onExport('sanitized-environments')}>
                  <ShieldCheck weight="fill" /> Sanitized environments
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

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

        <Button
          variant="secondary"
          size="sm"
          className="gap-2 bg-foreground text-background shadow-xs hover:bg-foreground/90 hover:text-background dark:bg-foreground dark:text-background dark:hover:bg-foreground/90"
          onClick={onAnalyzeAnother}
        >
          <SignOut className="h-4 w-4" />
          <span className="hidden sm:inline">New collection</span>
        </Button>
      </div>
    </header>
  )
}
