import { useCallback, useState, useEffect } from 'react'
import { DropZone } from '../components/DropZone'
import { DashboardShell } from '../components/layout/dashboard-shell'
import { RequestSearchModal } from '../components/RequestSearchModal'
import { CollectionLibraryModal } from '../components/CollectionLibraryModal'
import { OverviewPage } from './OverviewPage'
import { RequestsPage } from './RequestsPage'
import { SecurityPage } from './SecurityPage'
import { HygienePage } from './HygienePage'
import { ScorePage } from './ScorePage'
import { RepairPage } from './RepairPage'
import { analyzeCollection } from '../lib/analyzeCollection'
import {
  clearCollectionSession,
  loadCollectionSession,
  saveCollectionSession,
} from '../lib/collectionSession'
import {
  getSavedCollection,
  listSavedCollections,
  saveToLibrary,
  findLibraryIdForContent,
  type SavedCollectionMeta,
} from '../lib/collectionLibrary'
import {
  getStorageMode,
  setStorageMode,
  hasUploadConsent,
  setUploadConsent,
  type StorageMode,
} from '../lib/storagePreferences'
import {
  canChoosePrivacyMode,
  canSaveToAppStorage,
  getForcedStorageMode,
  shouldPersistSession,
  shouldShowTeamLibrary,
  type LoggingMode,
} from '../lib/deploymentConfig'
import { calculateScore } from '../lib/scorer'
import { createRepairPlan } from '../lib/repairEngine'
import type { ParsedCollection, ParsedRequest } from '../lib/parser'
import type { Finding } from '../lib/auditor'
import type { NavId } from '../components/layout/app-sidebar'

interface AnalyzeAppProps {
  loggingMode: LoggingMode
  samplesPath?: string
}

export function AnalyzeApp({ loggingMode, samplesPath = '/samples' }: AnalyzeAppProps) {
  const [parsed, setParsed] = useState<ParsedCollection | null>(null)
  const [findings, setFindings] = useState<Finding[]>([])
  const [rawJson, setRawJson] = useState<string | null>(null)
  const [originalRawJson, setOriginalRawJson] = useState<string | null>(null)
  const [currentLibraryId, setCurrentLibraryId] = useState<string | null>(null)
  const [savedCollections, setSavedCollections] = useState<SavedCollectionMeta[]>([])
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [active, setActive] = useState<NavId>('overview')
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [focusRequestId, setFocusRequestId] = useState<string | null>(null)
  const [landingLoading, setLandingLoading] = useState(false)
  const [restoringSession, setRestoringSession] = useState(true)
  const [savingToLibrary, setSavingToLibrary] = useState(false)
  const [storageMode, setStorageModeState] = useState<StorageMode>(() => getStorageMode())
  const [uploadConsent, setUploadConsentState] = useState(() => hasUploadConsent())

  useEffect(() => {
    const forced = getForcedStorageMode(loggingMode)
    if (forced) {
      setStorageMode(forced)
      setStorageModeState(forced)
      if (forced === 'incognito') clearCollectionSession()
    }
  }, [loggingMode])

  const handleStorageModeChange = useCallback(
    (mode: StorageMode) => {
      if (!canChoosePrivacyMode(loggingMode)) return
      setStorageMode(mode)
      setStorageModeState(mode)
      if (mode === 'incognito') clearCollectionSession()
    },
    [loggingMode]
  )

  const handleUploadConsentChange = useCallback((accepted: boolean) => {
    setUploadConsent(accepted)
    setUploadConsentState(accepted)
  }, [])

  const refreshSavedCollections = useCallback(async () => {
    if (!shouldShowTeamLibrary(loggingMode)) {
      setSavedCollections([])
      return
    }
    try {
      setSavedCollections(await listSavedCollections())
    } catch (e) {
      console.error(e)
    }
  }, [loggingMode])

  useEffect(() => {
    void refreshSavedCollections()
  }, [loggingMode, refreshSavedCollections])

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

  const applyCollectionJson = useCallback(
    async (raw: string, libraryId?: string | null) => {
      const json = JSON.parse(raw) as unknown
      const { parsed: p, findings: f } = await analyzeCollection(json)
      setParsed(p)
      setFindings(f)
      setRawJson(raw)
      setOriginalRawJson(raw)
      setActive('overview')
      setSearch('')

      if (shouldPersistSession(loggingMode, storageMode)) {
        saveCollectionSession(raw, p.name)
      }

      if (libraryId) {
        setCurrentLibraryId(libraryId)
      } else if (canSaveToAppStorage(loggingMode, storageMode, uploadConsent)) {
        try {
          const meta = await saveToLibrary(raw, p.name, p.requests.length)
          setCurrentLibraryId(meta.id)
          await refreshSavedCollections()
        } catch (e) {
          console.error(e)
          setCurrentLibraryId(await findLibraryIdForContent(raw))
        }
      } else if (shouldShowTeamLibrary(loggingMode)) {
        setCurrentLibraryId(await findLibraryIdForContent(raw))
      } else {
        setCurrentLibraryId(null)
      }
    },
    [loggingMode, storageMode, uploadConsent, refreshSavedCollections]
  )

  useEffect(() => {
    if (!shouldPersistSession(loggingMode, storageMode)) {
      setRestoringSession(false)
      return
    }
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
  }, [applyCollectionJson, loggingMode, storageMode])

  const handleFile = useCallback(
    (file: File) => {
      if (
        canChoosePrivacyMode(loggingMode) &&
        storageMode === 'history' &&
        !canSaveToAppStorage(loggingMode, storageMode, uploadConsent)
      ) {
        alert('Accept the upload warning before saving a collection to app history.')
        return
      }
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
    [applyCollectionJson, loggingMode, storageMode, uploadConsent]
  )

  const handleJsonText = useCallback(
    (raw: string) => {
      if (
        canChoosePrivacyMode(loggingMode) &&
        storageMode === 'history' &&
        !canSaveToAppStorage(loggingMode, storageMode, uploadConsent)
      ) {
        alert('Accept the upload warning before saving a collection to app history.')
        return
      }
      setLandingLoading(true)
      void applyCollectionJson(raw)
        .catch((e) => {
          console.error(e)
          alert('Failed to parse collection. Ensure it is a valid Postman collection JSON.')
        })
        .finally(() => setLandingLoading(false))
    },
    [applyCollectionJson, loggingMode, storageMode, uploadConsent]
  )

  const handleAnalyzeAnother = useCallback(() => {
    clearCollectionSession()
    setParsed(null)
    setFindings([])
    setRawJson(null)
    setOriginalRawJson(null)
    setCurrentLibraryId(null)
    setSearch('')
    setSearchOpen(false)
    setFocusRequestId(null)
  }, [])

  const handleLoadFromLibrary = useCallback(
    async (id: string) => {
      try {
        const record = await getSavedCollection(id)
        if (!record) {
          alert('This saved collection could not be found.')
          await refreshSavedCollections()
          return
        }
        await applyCollectionJson(record.rawJson, record.id)
      } catch (e) {
        console.error(e)
        alert('Failed to open saved collection.')
      }
    },
    [applyCollectionJson, refreshSavedCollections]
  )

  const handleSaveCurrentToLibrary = useCallback(async () => {
    if (!rawJson || !parsed || !canSaveToAppStorage(loggingMode, storageMode, uploadConsent)) return
    setSavingToLibrary(true)
    try {
      const meta = await saveToLibrary(rawJson, parsed.name, parsed.requests.length)
      setCurrentLibraryId(meta.id)
      await refreshSavedCollections()
    } catch (e) {
      console.error(e)
      alert(e instanceof Error ? e.message : 'Failed to save collection.')
    } finally {
      setSavingToLibrary(false)
    }
  }, [parsed, rawJson, loggingMode, storageMode, uploadConsent, refreshSavedCollections])

  const handleSearchSelect = useCallback((request: ParsedRequest) => {
    setActive('requests')
    setSearch('')
    setFocusRequestId(request.id)
  }, [])

  const handleApplyRepairedCollection = useCallback(
    async (raw: string) => {
      const json = JSON.parse(raw) as unknown
      const { parsed: p, findings: f } = await analyzeCollection(json)
      setParsed(p)
      setFindings(f)
      setRawJson(raw)
      setCurrentLibraryId(null)
      setActive('repair')
      setSearch('')

      if (shouldPersistSession(loggingMode, storageMode)) {
        saveCollectionSession(raw, p.name)
      }

      return {
        findings: f,
        score: calculateScore(p, f),
      }
    },
    [loggingMode, storageMode]
  )

  const handleResetRepairs = useCallback(async () => {
    if (!originalRawJson) return
    await handleApplyRepairedCollection(originalRawJson)
  }, [handleApplyRepairedCollection, originalRawJson])

  const teamLibraryVisible = shouldShowTeamLibrary(loggingMode)
  const canSave = canSaveToAppStorage(loggingMode, storageMode, uploadConsent)

  if (!parsed) {
    return (
      <>
        <DropZone
          onFile={handleFile}
          onJsonText={handleJsonText}
          loading={landingLoading || restoringSession}
          loggingMode={loggingMode}
          storageMode={storageMode}
          onStorageModeChange={handleStorageModeChange}
          uploadConsent={uploadConsent}
          onUploadConsentChange={handleUploadConsentChange}
          savedCollections={teamLibraryVisible ? savedCollections : []}
          onOpenLibrary={teamLibraryVisible ? () => setLibraryOpen(true) : undefined}
          onLoadSaved={teamLibraryVisible ? (id) => void handleLoadFromLibrary(id) : undefined}
          samplesPath={samplesPath}
        />
        {teamLibraryVisible && (
          <CollectionLibraryModal
            open={libraryOpen}
            onOpenChange={setLibraryOpen}
            onLoad={(id) => void handleLoadFromLibrary(id)}
            onLibraryChange={() => void refreshSavedCollections()}
          />
        )}
      </>
    )
  }

  const score = calculateScore(parsed, findings)
  const securityFindings = findings.filter((finding) => finding.category !== 'hygiene')
  const hygieneFindings = findings.filter((finding) => finding.category === 'hygiene')
  const isSavedToLibrary = currentLibraryId != null
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
        onAnalyzeAnother={handleAnalyzeAnother}
        onSaveToLibrary={canSave ? () => void handleSaveCurrentToLibrary() : undefined}
        isSavedToLibrary={teamLibraryVisible && isSavedToLibrary}
        savingToLibrary={savingToLibrary}
        historyEnabled={teamLibraryVisible}
      >
        {active === 'overview' && <OverviewPage parsed={parsed} findings={findings} />}
        {active === 'requests' && (
          <RequestsPage
            parsed={parsed}
            findings={findings}
            search={search}
            focusRequestId={focusRequestId}
            onFocusRequestHandled={() => setFocusRequestId(null)}
          />
        )}
        {active === 'security' && (
          <SecurityPage parsed={parsed} findings={securityFindings} score={score} search={search} />
        )}
        {active === 'hygiene' && (
          <HygienePage parsed={parsed} findings={hygieneFindings} search={search} />
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

      {teamLibraryVisible && (
        <CollectionLibraryModal
          open={libraryOpen}
          activeCollectionId={currentLibraryId}
          onOpenChange={setLibraryOpen}
          onLoad={(id) => void handleLoadFromLibrary(id)}
          onLibraryChange={() => void refreshSavedCollections()}
        />
      )}
    </>
  )
}
