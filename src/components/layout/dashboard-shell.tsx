import { useState } from "react";
import { AppSidebar, type NavId } from "./app-sidebar";
import { AppHeader } from "./app-header";
import { cn } from "@/lib/utils";

interface DashboardShellProps {
  collectionName: string;
  issueCount: number;
  active: NavId;
  onNav: (id: NavId) => void;
  search: string;
  onOpenSearch: () => void;
  onAnalyzeAnother: () => void;
  children: React.ReactNode;
}

export function DashboardShell({ collectionName, issueCount, active, onNav, search, onOpenSearch, onAnalyzeAnother, children }: DashboardShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const sidebarW = collapsed ? 72 : 240;

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar collapsed={collapsed} onToggleCollapse={() => setCollapsed((c) => !c)} active={active} onNav={onNav} issueCount={issueCount} />
      <AppHeader sidebarOffset={`${sidebarW}px`} collectionName={collectionName} search={search} onOpenSearch={onOpenSearch} onAnalyzeAnother={onAnalyzeAnother} active={active} />
      <main className={cn("min-h-screen pt-14 transition-[padding] duration-200")} style={{ paddingLeft: sidebarW }}>
        <div className="p-6 lg:p-8">
          <div className="animate-fade-in">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
