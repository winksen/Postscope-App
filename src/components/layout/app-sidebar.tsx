import type { ElementType } from "react";
import {
  CaretLeft,
  CaretRight,
  ChatCircleText,
  Gauge,
  GearSix,
  GithubLogo,
  LockKey,
  PresentationChart,
  Sparkle,
  Stethoscope,
  TreeStructure,
} from "@phosphor-icons/react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { GITHUB_REPO_URL } from "@/components/marketing/marketing-shell";

export type NavId = "overview" | "requests" | "security" | "hygiene" | "repair" | "score";

type SidebarIcon = ElementType;

const nav: { id: NavId; label: string; icon: SidebarIcon; activeIcon: SidebarIcon }[] = [
  { id: "overview", label: "Dashboard", icon: PresentationChart, activeIcon: PresentationChart },
  { id: "requests", label: "Requests", icon: TreeStructure, activeIcon: TreeStructure },
  { id: "security", label: "Security", icon: LockKey, activeIcon: LockKey },
  { id: "hygiene", label: "Hygiene", icon: Sparkle, activeIcon: Sparkle },
  { id: "repair", label: "Repair", icon: GearSix, activeIcon: GearSix },
  { id: "score", label: "Score", icon: Gauge, activeIcon: Gauge },
];

interface AppSidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  active: NavId;
  onNav: (id: NavId) => void;
  issueCount: number;
  hygieneCount?: number;
  repairCount?: number;
  showGitHubLink?: boolean;
  showFeedbackLink?: boolean;
  feedbackUrl?: string;
}

const footerLinkClass = "h-9 w-full justify-start gap-3 rounded-full text-sm font-medium transition-all duration-200 [&_svg]:size-5";

export function AppSidebar({
  collapsed,
  onToggleCollapse,
  active,
  onNav,
  issueCount,
  hygieneCount = 0,
  repairCount = 0,
  showGitHubLink = true,
  showFeedbackLink = true,
  feedbackUrl = "https://github.com/winksen/Postscope-App/issues/new",
}: AppSidebarProps) {
  return (
    <aside className={cn("fixed left-0 top-0 z-40 flex h-screen flex-col bg-card/95 shadow-[12px_0_36px_hsl(var(--background)/0.6)] backdrop-blur-md transition-[width] duration-200", collapsed ? "w-[72px]" : "w-60")}>
      <div className={cn("flex h-14 items-center px-4", collapsed && "justify-center px-2")}>
        <Link
          to="/"
          className={cn(
            "flex min-w-0 items-center gap-2 rounded-md transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            collapsed && "justify-center"
          )}
          aria-label="PostScope home"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center text-muted-foreground">
            <Stethoscope className="h-8 w-8" weight="fill" />
          </div>
          {!collapsed && (
            <p className="truncate text-sm font-semibold tracking-tight">PostScope</p>
          )}
        </Link>
      </div>

      <ScrollArea className="flex-1 px-3 py-4">
        <nav className="flex flex-col gap-1">
          {nav.map((item) => {
            const isActive = active === item.id;
            const Icon = isActive ? item.activeIcon : item.icon;
            const count = item.id === "security" ? issueCount : item.id === "hygiene" ? hygieneCount : item.id === "repair" ? repairCount : 0;
            const badge = count > 0 ? (
              <Badge
                className={cn(
                  "h-4 min-w-4 justify-center px-1 text-[9px] font-semibold",
                  isActive
                    ? "bg-background/20 text-background"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {count > 99 ? "99+" : count}
              </Badge>
            ) : null;
            const btn = (
              <Button key={item.id} variant={isActive ? "secondary" : "ghost"} size="sm" className={cn("h-9 w-full justify-start gap-3 rounded-full text-sm font-medium transition-all duration-200 [&_svg]:size-5", isActive && "bg-foreground text-background hover:bg-foreground/90 hover:text-background", collapsed && "justify-center px-0")} onClick={() => onNav(item.id)}>
                <Icon className={cn("shrink-0 transition-colors duration-200", isActive && "text-background")} weight="fill" />
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
                    {count > 0 ? <Badge className="bg-foreground text-[10px] text-background">{count > 99 ? "99+" : count}</Badge> : null}
                  </TooltipContent>
                </Tooltip>
              );
            }
            return btn;
          })}
        </nav>
      </ScrollArea>

      <Separator className="bg-transparent" />
      <div className="space-y-1 px-3 pb-2">
        {showGitHubLink && (
          <Button
            variant="ghost"
            size="sm"
            className={cn(footerLinkClass, collapsed && "justify-center px-0")}
            asChild
          >
            <a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer" aria-label="Star us on GitHub">
              <GithubLogo className="shrink-0" weight="fill" />
              {!collapsed && <span className="flex-1 truncate text-left">Star us on GitHub</span>}
            </a>
          </Button>
        )}
        {showFeedbackLink && (
          <Button
            variant="ghost"
            size="sm"
            className={cn(footerLinkClass, collapsed && "justify-center px-0")}
            asChild
          >
            <a href={feedbackUrl} target="_blank" rel="noreferrer" aria-label="Give feedback">
              <ChatCircleText className="shrink-0" weight="fill" />
              {!collapsed && <span className="flex-1 truncate text-left">Give feedback</span>}
            </a>
          </Button>
        )}
      </div>
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
