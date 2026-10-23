import { useState } from 'react'
import { AppSidebar, type NavId } from './app-sidebar'
import { AppHeader, type EnvironmentOption, type ExportFormat } from './app-header'
import { cn } from '@/lib/utils'

interface DashboardShellProps {
  issueCount: number
  hygieneCount?: number
  repairCount?: number
  active: NavId
  onNav: (id: NavId) => void
  search: string
  onOpenSearch: () => void
  onAnalyzeAnother: () => void
  onSaveToLibrary?: () => void
  isSavedToLibrary: boolean
  savingToLibrary: boolean
  historyEnabled: boolean
  showGitHubLink?: boolean
  showFeedbackLink?: boolean
  feedbackUrl?: string
  onExport?: (format: ExportFormat) => void
  onOpenRules?: () => void
  customRulesActive?: boolean
  environments?: EnvironmentOption[]
  activeEnvironment?: number
  onEnvironmentChange?: (index: number) => void
  hasEnvironmentFiles?: boolean
  children: React.ReactNode
}

export function DashboardShell({
  issueCount,
  hygieneCount = 0,
  repairCount = 0,
  active,
  onNav,
  search,
  onOpenSearch,
  onAnalyzeAnother,
  onSaveToLibrary,
  isSavedToLibrary,
  savingToLibrary,
  historyEnabled,
  showGitHubLink = true,
  showFeedbackLink = true,
  feedbackUrl,
  onExport,
  onOpenRules,
  customRulesActive,
  environments,
  activeEnvironment,
  onEnvironmentChange,
  hasEnvironmentFiles,
  children,
}: DashboardShellProps) {
  const [collapsed, setCollapsed] = useState(false)
  const sidebarW = collapsed ? 72 : 240

  return (
    <div className="min-h-screen bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-foreground focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-background"
      >
        Skip to content
      </a>
      <AppSidebar
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((c) => !c)}
        active={active}
        onNav={onNav}
        issueCount={issueCount}
        hygieneCount={hygieneCount}
        repairCount={repairCount}
        showGitHubLink={showGitHubLink}
        showFeedbackLink={showFeedbackLink}
        feedbackUrl={feedbackUrl}
      />
      <AppHeader
        sidebarOffset={`${sidebarW}px`}
        search={search}
        onOpenSearch={onOpenSearch}
        onAnalyzeAnother={onAnalyzeAnother}
        onSaveToLibrary={onSaveToLibrary}
        isSavedToLibrary={isSavedToLibrary}
        savingToLibrary={savingToLibrary}
        historyEnabled={historyEnabled}
        onExport={onExport}
        onOpenRules={onOpenRules}
        customRulesActive={customRulesActive}
        environments={environments}
        activeEnvironment={activeEnvironment}
        onEnvironmentChange={onEnvironmentChange}
        hasEnvironmentFiles={hasEnvironmentFiles}
      />
      <main
        id="main-content"
        tabIndex={-1}
        className={cn(
          'pt-14 outline-hidden transition-[padding] duration-200',
          active === 'requests' ? 'h-screen overflow-hidden' : 'min-h-screen'
        )}
        style={{ paddingLeft: sidebarW }}
      >
        <div className={cn('px-4 py-5 sm:px-5 lg:px-6 lg:py-6', active === 'requests' && 'h-full overflow-hidden')}>{children}</div>
      </main>
    </div>
  )
}
