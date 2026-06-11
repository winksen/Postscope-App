import { useState } from "react";
import { AppSidebar, type NavId } from "./app-sidebar";
import { AppHeader } from "./app-header";
import { cn } from "@/lib/utils";

interface DashboardShellProps {
  issueCount: number;
  hygieneCount?: number;
  repairCount?: number;
  active: NavId;
  onNav: (id: NavId) => void;
  search: string;
  onOpenSearch: () => void;
  onAnalyzeAnother: () => void;
  onSaveToLibrary?: () => void;
  isSavedToLibrary: boolean;
  savingToLibrary: boolean;
  historyEnabled: boolean;
  children: React.ReactNode;
}

export function DashboardShell({ issueCount, hygieneCount = 0, repairCount = 0, active, onNav, search, onOpenSearch, onAnalyzeAnother, onSaveToLibrary, isSavedToLibrary, savingToLibrary, historyEnabled, children }: DashboardShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const sidebarW = collapsed ? 72 : 240;

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar collapsed={collapsed} onToggleCollapse={() => setCollapsed((c) => !c)} active={active} onNav={onNav} issueCount={issueCount} hygieneCount={hygieneCount} repairCount={repairCount} />
      <AppHeader sidebarOffset={`${sidebarW}px`} search={search} onOpenSearch={onOpenSearch} onAnalyzeAnother={onAnalyzeAnother} onSaveToLibrary={onSaveToLibrary} isSavedToLibrary={isSavedToLibrary} savingToLibrary={savingToLibrary} historyEnabled={historyEnabled} />
      <main className={cn("pt-14 transition-[padding] duration-200", active === "requests" ? "h-screen overflow-hidden" : "min-h-screen")} style={{ paddingLeft: sidebarW }}>
        <div className={cn("px-4 py-5 sm:px-5 lg:px-6 lg:py-6", active === "requests" && "h-full overflow-hidden")}>
          {children}
        </div>
      </main>
    </div>
  );
}
