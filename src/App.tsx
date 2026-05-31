import { useCallback, useState, useEffect } from 'react'
import { DropZone } from './components/DropZone'
import { DashboardShell } from './components/layout/dashboard-shell'
import { RequestSearchModal } from './components/RequestSearchModal'
import { OverviewPage } from './pages/OverviewPage'
import { RequestsPage } from './pages/RequestsPage'
import { SecurityPage } from './pages/SecurityPage'
import { ScorePage } from './pages/ScorePage'
import { analyzeCollection } from './lib/analyzeCollection'
import {
  clearCollectionSession,
  loadCollectionSession,
  saveCollectionSession,
} from './lib/collectionSession'
import { calculateScore } from './lib/scorer'
import type { ParsedCollection, ParsedRequest } from './lib/parser'
import type { Finding } from './lib/auditor'
import type { NavId } from './components/layout/app-sidebar'

export default function App() {
  const [parsed, setParsed] = useState<ParsedCollection | null>(null)
  const [findings, setFindings] = useState<Finding[]>([])
  const [active, setActive] = useState<NavId>('overview')
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [focusRequestId, setFocusRequestId] = useState<string | null>(null)
  const [landingLoading, setLandingLoading] = useState(false)
  const [restoringSession, setRestoringSession] = useState(true)
  const [pageLoading, setPageLoading] = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const applyCollectionJson = useCallback(async (raw: string) => {
    const json = JSON.parse(raw) as unknown
    const { parsed: p, findings: f } = await analyzeCollection(json)
    setParsed(p)
    setFindings(f)
    setActive('overview')
    setSearch('')
    saveCollectionSession(raw, p.name)
  }, [])

  useEffect(() => {
    const session = loadCollectionSession()
    if (!session) {
      setRestoringSession(false)
      return
    }
    void applyCollectionJson(session.rawJson)
      .catch((e) => {
        console.error(e)
        clearCollectionSession()
      })
      .finally(() => setRestoringSession(false))
  }, [applyCollectionJson])

  const handleFile = useCallback(
    (file: File) => {
      setLandingLoading(true)
      const reader = new FileReader()
      reader.onload = () => {
        void (async () => {
          try {
            await applyCollectionJson(reader.result as string)
          } catch (e) {
            console.error(e)
            alert('Failed to parse collection. Ensure it is a valid Postman collection JSON.')
          } finally {
            setLandingLoading(false)
          }
        })()
      }
      reader.onerror = () => setLandingLoading(false)
      reader.readAsText(file)
    },
    [applyCollectionJson]
  )

  const handleAnalyzeAnother = useCallback(() => {
    clearCollectionSession()
    setParsed(null)
    setFindings([])
    setSearch('')
    setSearchOpen(false)
    setFocusRequestId(null)
  }, [])

  const handleSearchSelect = useCallback((request: ParsedRequest) => {
    setActive('requests')
    setSearch('')
    setFocusRequestId(request.id)
  }, [])

  useEffect(() => {
    if (!parsed) return
    setPageLoading(true)
    const timer = window.setTimeout(() => setPageLoading(false), 260)
    return () => window.clearTimeout(timer)
  }, [active, parsed])

  if (!parsed) {
    return <DropZone onFile={handleFile} loading={landingLoading || restoringSession} />
  }

  const score = calculateScore(parsed, findings)

  return (
    <>
      <DashboardShell
        collectionName={parsed.name}
        issueCount={findings.length}
        active={active}
        onNav={setActive}
        search={search}
        onOpenSearch={() => setSearchOpen(true)}
        onAnalyzeAnother={handleAnalyzeAnother}
      >
        {active === 'overview' && <OverviewPage parsed={parsed} findings={findings} search={search} isLoading={pageLoading} />}
        {active === 'requests' && (
          <RequestsPage
            parsed={parsed}
            search={search}
            focusRequestId={focusRequestId}
            onFocusRequestHandled={() => setFocusRequestId(null)}
            isLoading={pageLoading}
          />
        )}
        {active === 'security' && (
          <SecurityPage parsed={parsed} findings={findings} score={score} search={search} isLoading={pageLoading} />
        )}
        {active === 'score' && <ScorePage score={score} findings={findings} isLoading={pageLoading} />}
      </DashboardShell>

      <RequestSearchModal
        open={searchOpen}
        requests={parsed.requests}
        initialQuery={search}
        onOpenChange={setSearchOpen}
        onSelect={handleSearchSelect}
      />
    </>
  )
}
