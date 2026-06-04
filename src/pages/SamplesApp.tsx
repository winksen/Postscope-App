import { useCallback, useState, useEffect } from 'react'
import { SampleDropZone } from '../components/SampleDropZone'
import { DashboardShell } from '../components/layout/dashboard-shell'
import { RequestSearchModal } from '../components/RequestSearchModal'
import { OverviewPage } from './OverviewPage'
import { RequestsPage } from './RequestsPage'
import { SecurityPage } from './SecurityPage'
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
  const [focusRequestId, setFocusRequestId] = useState<string | null>(null)
  const [landingLoading, setLandingLoading] = useState(false)

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
    setFocusRequestId(null)
  }, [])

  const handleSearchSelect = useCallback((request: ParsedRequest) => {
    setActive('requests')
    setSearch('')
    setFocusRequestId(request.id)
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
    return (
      <SampleDropZone
        onSelectSample={handleSelectSample}
        loading={landingLoading}
        analyzePath={analyzePath}
      />
    )
  }

  const score = calculateScore(parsed, findings)
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
        collectionName={parsed.name}
        issueCount={findings.length}
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
        {active === 'overview' && <OverviewPage parsed={parsed} findings={findings} search={search} />}
        {active === 'requests' && (
          <RequestsPage
            parsed={parsed}
            search={search}
            focusRequestId={focusRequestId}
            onFocusRequestHandled={() => setFocusRequestId(null)}
          />
        )}
        {active === 'security' && (
          <SecurityPage parsed={parsed} findings={findings} score={score} search={search} />
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
