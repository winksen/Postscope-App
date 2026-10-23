import { useCallback, useState, useEffect } from 'react'
import { SampleDropZone } from '../components/SampleDropZone'
import { DashboardShell } from '../components/layout/dashboard-shell'
import { RequestSearchModal } from '../components/RequestSearchModal'
import { OverviewPage } from './OverviewPage'
import { RequestsPage } from './RequestsPage'
import { isSearchShortcut } from '../lib/keyboard'
import type { AppLocation } from '../lib/appRoutes'
import { SecurityPage } from './SecurityPage'
import { HygienePage } from './HygienePage'
import { ScorePage } from './ScorePage'
import { RepairPage } from './RepairPage'
import { analyzeCollection } from '../lib/analyzeCollection'
import { loadSampleCollection, type SampleCollectionId } from '../lib/sampleCollections'
import { calculateScore } from '../lib/scorer'
import { createRepairPlan } from '../lib/repairEngine'
import type { ParsedCollection, ParsedRequest } from '../lib/parser'
import type { Finding } from '../lib/auditor'
import type { NavId } from '../components/layout/app-sidebar'

interface SamplesAppProps {
  analyzePath?: string
}

export function SamplesApp({ analyzePath = '/analyze' }: SamplesAppProps) {
  const [parsed, setParsed] = useState<ParsedCollection | null>(null)
  const [findings, setFindings] = useState<Finding[]>([])
  const [rawJson, setRawJson] = useState<string | null>(null)
  const [originalRawJson, setOriginalRawJson] = useState<string | null>(null)
  const [active, setActive] = useState<NavId>('overview')
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  /** The samples page keeps its state in the component: it has no addresses of its own. */
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null)
  const [securityView, setSecurityView] = useState<AppLocation>({ page: 'security' })
  const [hygieneView, setHygieneView] = useState<AppLocation>({ page: 'hygiene' })
  const [landingLoading, setLandingLoading] = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isSearchShortcut(e, document.querySelector('[role="dialog"]') !== null)) {
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
    setRawJson(raw)
    setOriginalRawJson(raw)
    setActive('overview')
    setSearch('')
  }, [])

  const handleSelectSample = useCallback(
    (id: SampleCollectionId) => {
      setLandingLoading(true)
      void loadSampleCollection(id)
        .then((raw) => applyCollectionJson(raw))
        .catch((e) => {
          console.error(e)
          alert('Failed to load sample collection. Please try again.')
        })
        .finally(() => setLandingLoading(false))
    },
    [applyCollectionJson]
  )

  const handleTryAnotherSample = useCallback(() => {
    setParsed(null)
    setFindings([])
    setRawJson(null)
    setOriginalRawJson(null)
    setSearch('')
    setSearchOpen(false)
    setSelectedRequestId(null)
  }, [])

  const handleSearchSelect = useCallback((request: ParsedRequest) => {
    setActive('requests')
    setSearch('')
    setSelectedRequestId(request.id)
  }, [])

  const handleApplyRepairedCollection = useCallback(async (raw: string) => {
    const json = JSON.parse(raw) as unknown
    const { parsed: p, findings: f } = await analyzeCollection(json)
    setParsed(p)
    setFindings(f)
    setRawJson(raw)
    setActive('repair')
    setSearch('')
    return {
      findings: f,
      score: calculateScore(p, f),
    }
  }, [])

  const handleResetRepairs = useCallback(async () => {
    if (!originalRawJson) return
    await handleApplyRepairedCollection(originalRawJson)
  }, [handleApplyRepairedCollection, originalRawJson])

  if (!parsed) {
    return <SampleDropZone onSelectSample={handleSelectSample} loading={landingLoading} analyzePath={analyzePath} />
  }

  const score = calculateScore(parsed, findings)
  const securityFindings = findings.filter((finding) => finding.category !== 'hygiene')
  const hygieneFindings = findings.filter((finding) => finding.category === 'hygiene')
  let repairAutoFixCount = 0
  if (rawJson) {
    try {
      repairAutoFixCount = createRepairPlan(JSON.parse(rawJson) as unknown, parsed, findings).autoFixCount
    } catch {
      repairAutoFixCount = 0
    }
  }

  return (
    <>
      <DashboardShell
        issueCount={securityFindings.length}
        hygieneCount={hygieneFindings.length}
        repairCount={repairAutoFixCount}
        active={active}
        onNav={setActive}
        search={search}
        onOpenSearch={() => setSearchOpen(true)}
        onAnalyzeAnother={handleTryAnotherSample}
        isSavedToLibrary={false}
        savingToLibrary={false}
        historyEnabled={false}
      >
        {active === 'overview' && <OverviewPage parsed={parsed} findings={findings} />}
        {active === 'requests' && (
          <RequestsPage
            parsed={parsed}
            findings={findings}
            search={search}
            selectedId={selectedRequestId}
            onSelectId={setSelectedRequestId}
          />
        )}
        {active === 'security' && (
          <SecurityPage
            parsed={parsed}
            findings={securityFindings}
            score={score}
            search={search}
            location={securityView}
            onLocationChange={setSecurityView}
          />
        )}
        {active === 'hygiene' && (
          <HygienePage
            parsed={parsed}
            findings={hygieneFindings}
            search={search}
            location={hygieneView}
            onLocationChange={setHygieneView}
          />
        )}
        {active === 'repair' && rawJson && (
          <RepairPage
            parsed={parsed}
            findings={findings}
            score={score}
            rawJson={rawJson}
            originalRawJson={originalRawJson || rawJson}
            onApplyRepairedCollection={handleApplyRepairedCollection}
            onResetRepairs={handleResetRepairs}
          />
        )}
        {active === 'score' && <ScorePage score={score} findings={findings} />}
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
