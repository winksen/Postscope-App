import { LayoutDashboard, Shield, Gauge, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

export type NavId = 'overview' | 'security' | 'score'

const nav: { id: NavId; label: string; icon: typeof LayoutDashboard; badge?: number }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'security', label: 'Security', icon: Shield },
  { id: 'score', label: 'Score', icon: Gauge },
]

interface AppSidebarProps {
  collapsed: boolean
  onToggleCollapse: () => void
  active: NavId
  onNav: (id: NavId) => void
  issueCount: number
}

export function AppSidebar({ collapsed, onToggleCollapse, active, onNav, issueCount }: AppSidebarProps) {
  return (
    <aside
      className={cn(
        'fixed left-0 top-0 z-40 flex h-screen flex-col border-r border-border bg-card shadow-none transition-[width] duration-200',
        collapsed ? 'w-[72px]' : 'w-60'
      )}
    >
      <div className={cn('flex h-14 items-center gap-2 border-b border-border px-4', collapsed && 'justify-center px-2')}>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Sparkles className="h-4 w-4" />
        </div>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold tracking-tight">PostScope</p>
            <p className="text-xs text-muted-foreground">Collection intelligence</p>
          </div>
        )}
      </div>

      <ScrollArea className="flex-1 px-3 py-4">
        <nav className="flex flex-col gap-1">
          {nav.map((item) => {
            const Icon = item.icon
            const isActive = active === item.id
            const badge =
              item.id === 'security' && issueCount > 0 ? (
                <Badge variant="destructive" className="h-5 min-w-5 justify-center px-1 text-[10px]">
                  {issueCount > 99 ? '99+' : issueCount}
                </Badge>
              ) : null
            const btn = (
              <Button
                key={item.id}
                variant={isActive ? 'secondary' : 'ghost'}
                size="sm"
                className={cn(
                  'h-9 w-full justify-start gap-3 font-normal transition-colors duration-200',
                  isActive && 'bg-primary/10 text-primary hover:bg-primary/15',
                  collapsed && 'justify-center px-0'
                )}
                onClick={() => onNav(item.id)}
              >
                <Icon className={cn('h-4 w-4 shrink-0', isActive && 'text-primary')} />
                {!collapsed && (
                  <>
                    <span className="flex-1 truncate text-left">{item.label}</span>
                    {badge}
                  </>
                )}
              </Button>
            )
            if (collapsed) {
              return (
                <Tooltip key={item.id} delayDuration={0}>
                  <TooltipTrigger asChild>{btn}</TooltipTrigger>
                  <TooltipContent side="right" className="flex items-center gap-2">
                    {item.label}
                    {item.id === 'security' && issueCount > 0 ? (
                      <Badge variant="destructive" className="text-[10px]">
                        {issueCount}
                      </Badge>
                    ) : null}
                  </TooltipContent>
                </Tooltip>
              )
            }
            return btn
          })}
        </nav>
      </ScrollArea>

      <Separator />
      <div className="p-2">
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn('w-full', collapsed && 'mx-auto')}
              onClick={onToggleCollapse}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{collapsed ? 'Expand' : 'Collapse'}</TooltipContent>
        </Tooltip>
      </div>
    </aside>
  )
}
