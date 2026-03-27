import { useCallback, useState } from 'react'
import { DropZone } from './components/DropZone'
import { DashboardShell } from './components/layout/dashboard-shell'
import { OverviewPage } from './pages/OverviewPage'
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
      {active === 'overview' && <OverviewPage parsed={parsed} findings={findings} search={search} />}
      {active === 'security' && <SecurityPage findings={findings} score={score} search={search} />}
      {active === 'score' && <ScorePage score={score} findings={findings} />}
    </DashboardShell>
  )
}
