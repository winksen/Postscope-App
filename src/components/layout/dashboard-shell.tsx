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
  onSearchChange: (v: string) => void;
  onAnalyzeAnother: () => void;
  children: React.ReactNode;
}

export function DashboardShell({ collectionName, issueCount, active, onNav, search, onSearchChange, onAnalyzeAnother, children }: DashboardShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const sidebarW = collapsed ? 72 : 240;

  return (
    <div className="min-h-screen bg-neutral-200">
      <AppSidebar collapsed={collapsed} onToggleCollapse={() => setCollapsed((c) => !c)} active={active} onNav={onNav} issueCount={issueCount} />
      <AppHeader sidebarOffset={`${sidebarW}px`} collectionName={collectionName} search={search} onSearchChange={onSearchChange} onAnalyzeAnother={onAnalyzeAnother} />
      <main className={cn("min-h-screen pt-14 transition-[padding] duration-200")} style={{ paddingLeft: sidebarW }}>
        <div className="p-6 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
