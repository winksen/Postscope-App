import { MagnifyingGlass, SignOut, FileCode, SunDim, Moon, ChartPieSlice, Shield, Gauge, FolderSimple, type Icon } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTheme } from '@/hooks/use-theme'
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
  onSearchChange: (v: string) => void
  onAnalyzeAnother: () => void
  active: NavId
}

export function AppHeader({
  sidebarOffset,
  collectionName,
  search,
  onSearchChange,
  onAnalyzeAnother,
  active,
}: AppHeaderProps) {
  const { resolvedTheme, toggleTheme } = useTheme()
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
        <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search findings, requests…"
          className="h-9 bg-muted/70 pl-9 pr-9 transition-colors duration-200 hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-orange-400/50"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        <div className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 items-center gap-1 text-[10px] text-muted-foreground/60 sm:flex">
          <kbd className="rounded bg-background/40 px-1 py-0.5 font-mono text-[10px]">Ctrl</kbd>
          <kbd className="rounded bg-background/40 px-1 py-0.5 font-mono text-[10px]">K</kbd>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-foreground"
              onClick={toggleTheme}
            >
              {resolvedTheme === 'dark' ? <SunDim className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Toggle theme</TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-full">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-muted text-xs font-medium text-foreground">
                  PS
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium">Workspace</p>
                <p className="text-xs text-muted-foreground">Local analysis only</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={toggleTheme} className="cursor-pointer gap-2">
              {resolvedTheme === 'dark' ? <SunDim className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              {resolvedTheme === 'dark' ? 'Light mode' : 'Dark mode'}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onAnalyzeAnother} className="cursor-pointer gap-2">
              <SignOut className="h-4 w-4" />
              New collection
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
