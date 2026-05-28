import { useCallback, useState, useEffect } from 'react'
import { DropZone } from './components/DropZone'
import { DashboardShell } from './components/layout/dashboard-shell'
import { OverviewPage } from './pages/OverviewPage'
import { RequestsPage } from './pages/RequestsPage'
import { SecurityPage } from './pages/SecurityPage'
import { ScorePage } from './pages/ScorePage'
import { parseCollection } from './lib/parser'
import { runAudit } from './lib/auditor'
import { calculateScore } from './lib/scorer'
import type { ParsedCollection } from './lib/parser'
import type { Finding } from './lib/auditor'
import type { NavId } from './components/layout/app-sidebar'

export default function App() {
  const [parsed, setParsed] = useState<ParsedCollection | null>(null)
  const [findings, setFindings] = useState<Finding[]>([])
  const [active, setActive] = useState<NavId>('overview')
  const [search, setSearch] = useState('')
  const [landingLoading, setLandingLoading] = useState(false)
  const [pageLoading, setPageLoading] = useState(false)

  // Keyboard shortcut: Ctrl+K to focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        const searchInput = document.querySelector('input[type="text"]') as HTMLInputElement
        searchInput?.focus()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [parsed])

  const handleFile = useCallback((file: File) => {
    setLandingLoading(true)
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const json = JSON.parse(reader.result as string)
        const p = parseCollection(json)
        const f = runAudit(p)
        setParsed(p)
        setFindings(f)
        setActive('overview')
        setSearch('')
      } catch (e) {
        console.error(e)
        alert('Failed to parse collection. Ensure it is a valid Postman collection JSON.')
      } finally {
        setLandingLoading(false)
      }
    }
    reader.onerror = () => setLandingLoading(false)
    reader.readAsText(file)
  }, [])

  const handleAnalyzeAnother = useCallback(() => {
    setParsed(null)
    setFindings([])
    setSearch('')
  }, [])

  useEffect(() => {
    if (!parsed) return
    setPageLoading(true)
    const timer = window.setTimeout(() => setPageLoading(false), 260)
    return () => window.clearTimeout(timer)
  }, [active, parsed])

  if (!parsed) {
    return <DropZone onFile={handleFile} loading={landingLoading} />
  }

  const score = calculateScore(parsed, findings)

  return (
    <DashboardShell
      collectionName={parsed.name}
      issueCount={findings.length}
      active={active}
      onNav={setActive}
      search={search}
      onSearchChange={setSearch}
      onAnalyzeAnother={handleAnalyzeAnother}
    >
      {active === 'overview' && <OverviewPage parsed={parsed} findings={findings} search={search} isLoading={pageLoading} />}
      {active === 'requests' && <RequestsPage parsed={parsed} search={search} isLoading={pageLoading} />}
      {active === 'security' && <SecurityPage findings={findings} score={score} search={search} isLoading={pageLoading} />}
      {active === 'score' && <ScorePage score={score} findings={findings} isLoading={pageLoading} />}
    </DashboardShell>
  )
}
