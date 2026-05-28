import { ChartPieSlice, Shield, Gauge, CaretLeft, CaretRight, Stethoscope, FolderSimple, type Icon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export type NavId = "overview" | "requests" | "security" | "score";

const nav: { id: NavId; label: string; icon: Icon; badge?: number }[] = [
  { id: "overview", label: "Dashboard", icon: ChartPieSlice },
  { id: "requests", label: "Requests", icon: FolderSimple },
  { id: "security", label: "Security", icon: Shield },
  { id: "score", label: "Score", icon: Gauge },
];

interface AppSidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  active: NavId;
  onNav: (id: NavId) => void;
  issueCount: number;
}

export function AppSidebar({ collapsed, onToggleCollapse, active, onNav, issueCount }: AppSidebarProps) {
  return (
    <aside className={cn("fixed left-0 top-0 z-40 flex h-screen flex-col bg-card/95 shadow-[12px_0_36px_hsl(var(--background)/0.6)] backdrop-blur-md transition-[width] duration-200", collapsed ? "w-[72px]" : "w-60")}>
      <div className={cn("flex h-14 items-center gap-2 px-4", collapsed && "justify-center px-2")}>
        <div className="flex h-10 w-10 items-center justify-center text-orange-400">
          <Stethoscope className="h-8 w-8" weight="fill" />
        </div>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold tracking-tight">PostScope</p>
          </div>
        )}
      </div>

      <ScrollArea className="flex-1 px-3 py-4">
        <nav className="flex flex-col gap-1">
          {nav.map((item) => {
            const Icon = item.icon;
            const isActive = active === item.id;
            const badge = item.id === "security" && issueCount > 0 ? <Badge className="h-5 min-w-5 justify-center bg-white/20 px-1 text-[10px] font-semibold text-white">{issueCount > 99 ? "99+" : issueCount}</Badge> : null;
            const btn = (
              <Button key={item.id} variant={isActive ? "secondary" : "ghost"} size="sm" className={cn("h-10 w-full justify-start gap-3.5 rounded-full text-[15px] font-medium transition-all duration-200 [&_svg]:size-6", isActive && "bg-orange-500 text-white hover:bg-orange-500", collapsed && "justify-center px-0")} onClick={() => onNav(item.id)}>
                <Icon className={cn("shrink-0 transition-colors duration-200", isActive && "text-white")} weight={isActive ? "fill" : "regular"} />
                {!collapsed && (
                  <>
                    <span className="flex-1 truncate text-left">{item.label}</span>
                    {badge}
                  </>
                )}
              </Button>
            );
            if (collapsed) {
              return (
                <Tooltip key={item.id} delayDuration={0}>
                  <TooltipTrigger asChild>{btn}</TooltipTrigger>
                  <TooltipContent side="right" className="flex items-center gap-2">
                    {item.label}
                    {item.id === "security" && issueCount > 0 ? <Badge className="bg-orange-500 text-[10px] text-white">{issueCount}</Badge> : null}
                  </TooltipContent>
                </Tooltip>
              );
            }
            return btn;
          })}
        </nav>
      </ScrollArea>

      <Separator className="bg-transparent" />
      <div className="p-2">
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className={cn("w-full", collapsed && "mx-auto")} onClick={onToggleCollapse} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
              {collapsed ? <CaretRight className="h-4 w-4" /> : <CaretLeft className="h-4 w-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{collapsed ? "Expand" : "Collapse"}</TooltipContent>
        </Tooltip>
      </div>
    </aside>
  );
}
