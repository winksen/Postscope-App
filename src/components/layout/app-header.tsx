import { Bell, Search, LogOut, FileJson } from 'lucide-react'
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

interface AppHeaderProps {
  sidebarOffset: string
  collectionName: string
  search: string
  onSearchChange: (v: string) => void
  onAnalyzeAnother: () => void
}

export function AppHeader({
  sidebarOffset,
  collectionName,
  search,
  onSearchChange,
  onAnalyzeAnother,
}: AppHeaderProps) {
  return (
    <header
      className="fixed right-0 top-0 z-30 flex h-14 items-center gap-4 border-b border-border bg-background/80 px-6 backdrop-blur-md transition-[left] duration-200"
      style={{ left: sidebarOffset }}
    >
      <div className="relative min-w-0 flex-1 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search findings, requests…"
          className="h-9 bg-muted/40 pl-9 transition-colors duration-200 hover:bg-muted/60 focus-visible:bg-background"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
      <div className="hidden min-w-0 flex-1 items-center gap-2 md:flex lg:max-w-xl">
        <FileJson className="h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="truncate text-sm text-muted-foreground" title={collectionName}>
          {collectionName}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
              <Bell className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Notifications</TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-full">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">PS</AvatarFallback>
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
            <DropdownMenuItem onClick={onAnalyzeAnother} className="cursor-pointer gap-2">
              <LogOut className="h-4 w-4" />
              New collection
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
