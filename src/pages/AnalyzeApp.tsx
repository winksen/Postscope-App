import { useCallback, useState, useEffect, useMemo, useRef } from 'react'
import { DropZone } from '../components/DropZone'
import { DashboardShell } from '../components/layout/dashboard-shell'
import type { ExportFormat } from '../components/layout/app-header'
import { RequestSearchModal } from '../components/RequestSearchModal'
import { CollectionLibraryModal } from '../components/CollectionLibraryModal'
import { RuleSettingsDialog } from '../components/RuleSettingsDialog'
import { useToast } from '../components/ui/toaster'
import { OverviewPage } from './OverviewPage'
import { RequestsPage } from './RequestsPage'
import { SecurityPage } from './SecurityPage'
import { HygienePage } from './HygienePage'
import { ScorePage } from './ScorePage'
import { RepairPage } from './RepairPage'
import { analyzeCollectionText, describeAnalysisError } from '../lib/analyzeCollection'
import {
  clearCollectionSession,
  loadCollectionSession,
  saveCollectionSession,
} from '../lib/collectionSession'
import {
  getSavedCollection,
  listSavedCollections,
  saveToLibrary,
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
import {
  clearAuditPreferences,
  effectiveAuditOptions,
  isCustomized,
  loadAuditPreferences,
  saveAuditPreferences,
} from '../lib/auditPreferences'
import { calculateScore } from '../lib/scorer'
import { createRepairPlan } from '../lib/repairEngine'
import { runAudit, type AuditOptions, type Finding } from '../lib/auditor'
import { buildReport, reportFileName, reportMimeType, safeFileStem } from '../lib/reportExport'
import { redactCollection } from '../lib/redaction'
import { downloadTextFile } from '../lib/download'
import type { ParsedCollection, ParsedRequest } from '../lib/parser'
import type { NavId } from '../components/layout/app-sidebar'

/** Upper bound for in-browser analysis; larger files risk exhausting tab memory. */
const MAX_IMPORT_BYTES = 50_000_000

interface AnalyzeAppProps {
  loggingMode: LoggingMode
  samplesPath?: string
  showGitHubLink?: boolean
  showFeedbackLink?: boolean
  feedbackUrl?: string
  appVersion?: string
  libraryAllowDelete?: boolean
  auditPolicy?: AuditOptions
}

const EMPTY_POLICY: AuditOptions = {}

function formatMegabytes(bytes: number): string {
  return `${Math.round((bytes / 1_000_000) * 10) / 10} MB`
}

export function AnalyzeApp({
  loggingMode,
  samplesPath = '/samples',
  showGitHubLink = true,
  showFeedbackLink = true,
  feedbackUrl = 'https://github.com/winksen/Postscope-App/issues/new',
  appVersion,
  libraryAllowDelete = true,
  auditPolicy = EMPTY_POLICY,
}: AnalyzeAppProps) {
  const { notify } = useToast()
  const [parsed, setParsed] = useState<ParsedCollection | null>(null)
  const [findings, setFindings] = useState<Finding[]>([])
  const [rawJson, setRawJson] = useState<string | null>(null)
  const [originalRawJson, setOriginalRawJson] = useState<string | null>(null)
  const [currentLibraryId, setCurrentLibraryId] = useState<string | null>(null)
  const [savedCollections, setSavedCollections] = useState<SavedCollectionMeta[]>([])
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [active, setActive] = useState<NavId>('overview')
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [focusRequestId, setFocusRequestId] = useState<string | null>(null)
  const [landingLoading, setLandingLoading] = useState(false)
  const [restoringSession, setRestoringSession] = useState(true)
  const [savingToLibrary, setSavingToLibrary] = useState(false)
  const [storageMode, setStorageModeState] = useState<StorageMode>(() => getStorageMode())
  const [uploadConsent, setUploadConsentState] = useState(() => hasUploadConsent())
  const [userAuditPrefs, setUserAuditPrefs] = useState<AuditOptions | null>(() => loadAuditPreferences())

  const auditOptions = useMemo(() => effectiveAuditOptions(auditPolicy, userAuditPrefs), [auditPolicy, userAuditPrefs])
  const auditOptionsRef = useRef(auditOptions)
  auditOptionsRef.current = auditOptions
  /** Incremented for every analysis; results from superseded analyses are discarded. */
  const analysisSeq = useRef(0)
  const restoreAttempted = useRef(false)

  useEffect(() => {
    const forced = getForcedStorageMode(loggingMode)
    if (forced) {
      setStorageMode(forced)
      setStorageModeState(forced)
      if (forced === 'incognito') clearCollectionSession()
    }
  }, [loggingMode])

  // Re-run the (cheap) audit step when rule settings change; parsing is not repeated.
  const lastAuditOptions = useRef(auditOptions)
  useEffect(() => {
    if (lastAuditOptions.current === auditOptions) return
    lastAuditOptions.current = auditOptions
    if (parsed) setFindings(runAudit(parsed, auditOptions))
  }, [auditOptions, parsed])

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
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const notifyParseWarnings = useCallback(
    (collection: ParsedCollection) => {
      const warnings = collection.parseWarnings ?? []
      if (!warnings.length) return
      notify({
        title: 'Some items could not be read',
        description: `${warnings[0]}${warnings.length > 1 ? ` (+${warnings.length - 1} more)` : ''}`,
      })
    },
    [notify]
  )

  /** Analyzes raw JSON and shows the dashboard. Returns false when a newer analysis superseded this one. */
  const applyCollectionJson = useCallback(
    async (raw: string, libraryId?: string | null): Promise<boolean> => {
      const seq = ++analysisSeq.current
      const { parsed: p, findings: f } = await analyzeCollectionText(raw, auditOptionsRef.current)
      if (seq !== analysisSeq.current) return false

      setParsed(p)
      setFindings(f)
      setRawJson(raw)
      setOriginalRawJson(raw)
      setActive('overview')
      setSearch('')
      notifyParseWarnings(p)

      if (shouldPersistSession(loggingMode, storageMode)) {
        if (!saveCollectionSession(raw, p.name)) {
          notify({ title: 'Collection not kept for refresh', description: 'It is larger than the browser session storage limit.' })
        }
      }

      if (libraryId) {
        setCurrentLibraryId(libraryId)
      } else if (canSaveToAppStorage(loggingMode, storageMode, uploadConsent)) {
        try {
          const meta = await saveToLibrary(raw, p.name, p.requests.length)
          if (seq !== analysisSeq.current) return true
          setCurrentLibraryId(meta.id)
          await refreshSavedCollections()
        } catch (e) {
          console.error(e)
          setCurrentLibraryId(null)
          notify({
            variant: 'error',
            title: 'Could not save to the team library',
            description: e instanceof Error ? e.message : 'The collection was analyzed but not stored.',
          })
        }
      } else {
        setCurrentLibraryId(null)
      }
      return true
    },
    [loggingMode, storageMode, uploadConsent, refreshSavedCollections, notify, notifyParseWarnings]
  )

  useEffect(() => {
    if (restoreAttempted.current) return
    restoreAttempted.current = true
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
    // Restore exactly once on mount; later dependency changes must not re-import the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const importBlockedByConsent = useCallback(() => {
    if (
      canChoosePrivacyMode(loggingMode) &&
      storageMode === 'history' &&
      !canSaveToAppStorage(loggingMode, storageMode, uploadConsent)
    ) {
      notify({ variant: 'error', title: 'Upload warning not accepted', description: 'Accept the upload warning before saving a collection to app history.' })
      return true
    }
    return false
  }, [loggingMode, storageMode, uploadConsent, notify])

  const runImport = useCallback(
    (raw: string) => {
      setLandingLoading(true)
      void applyCollectionJson(raw)
        .catch((e) => {
          console.error(e)
          notify({ variant: 'error', title: 'Import failed', description: describeAnalysisError(e) })
        })
        .finally(() => setLandingLoading(false))
    },
    [applyCollectionJson, notify]
  )

  const handleFile = useCallback(
    (file: File) => {
      if (importBlockedByConsent()) return
      if (file.size > MAX_IMPORT_BYTES) {
        notify({
          variant: 'error',
          title: 'File is too large',
          description: `${file.name} is ${formatMegabytes(file.size)}. The analyzer accepts files up to ${formatMegabytes(MAX_IMPORT_BYTES)}.`,
        })
        return
      }
      if (file.size === 0) {
        notify({ variant: 'error', title: 'File is empty', description: `${file.name} has no content.` })
        return
      }
      setLandingLoading(true)
      file
        .text()
        .then((text) => runImport(text))
        .catch((e) => {
          console.error(e)
          setLandingLoading(false)
          notify({ variant: 'error', title: 'Could not read the file', description: 'The browser was unable to read this file.' })
        })
    },
    [importBlockedByConsent, notify, runImport]
  )

  const handleJsonText = useCallback(
    (raw: string) => {
      if (importBlockedByConsent()) return
      if (raw.length > MAX_IMPORT_BYTES) {
        notify({ variant: 'error', title: 'Pasted JSON is too large', description: `Paste up to ${formatMegabytes(MAX_IMPORT_BYTES)} or upload the file instead.` })
        return
      }
      runImport(raw)
    },
    [importBlockedByConsent, notify, runImport]
  )

  const handleAnalyzeAnother = useCallback(() => {
    analysisSeq.current += 1
    clearCollectionSession()
    setParsed(null)
    setFindings([])
    setRawJson(null)
    setOriginalRawJson(null)
    setCurrentLibraryId(null)
    setSearch('')
    setSearchOpen(false)
    setFocusRequestId(null)
    setLandingLoading(false)
  }, [])

  const handleLoadFromLibrary = useCallback(
    async (id: string) => {
      setLandingLoading(true)
      try {
        const record = await getSavedCollection(id)
        if (!record) {
          notify({ variant: 'error', title: 'Saved collection not found', description: 'It may have been removed by a teammate.' })
          await refreshSavedCollections()
          return
        }
        await applyCollectionJson(record.rawJson, record.id)
      } catch (e) {
        console.error(e)
        notify({ variant: 'error', title: 'Failed to open saved collection', description: e instanceof Error ? e.message : undefined })
      } finally {
        setLandingLoading(false)
      }
    },
    [applyCollectionJson, refreshSavedCollections, notify]
  )

  const handleSaveCurrentToLibrary = useCallback(async () => {
    if (!rawJson || !parsed || !canSaveToAppStorage(loggingMode, storageMode, uploadConsent)) return
    setSavingToLibrary(true)
    try {
      const meta = await saveToLibrary(rawJson, parsed.name, parsed.requests.length)
      setCurrentLibraryId(meta.id)
      await refreshSavedCollections()
      notify({
        variant: 'success',
        title: meta.deduplicated ? 'Already in the team library' : 'Saved to the team library',
        description: meta.redactedCount ? `The server removed ${meta.redactedCount} credential(s) before storing it.` : undefined,
      })
    } catch (e) {
      console.error(e)
      notify({ variant: 'error', title: 'Failed to save collection', description: e instanceof Error ? e.message : undefined })
    } finally {
      setSavingToLibrary(false)
    }
  }, [parsed, rawJson, loggingMode, storageMode, uploadConsent, refreshSavedCollections, notify])

  const handleSearchSelect = useCallback((request: ParsedRequest) => {
    setActive('requests')
    setSearch('')
    setFocusRequestId(request.id)
  }, [])

  const handleApplyRepairedCollection = useCallback(
    async (raw: string) => {
      const seq = ++analysisSeq.current
      const { parsed: p, findings: f } = await analyzeCollectionText(raw, auditOptionsRef.current)
      if (seq === analysisSeq.current) {
        setParsed(p)
        setFindings(f)
        setRawJson(raw)
        setCurrentLibraryId(null)
        setActive('repair')
        setSearch('')

        if (shouldPersistSession(loggingMode, storageMode)) {
          saveCollectionSession(raw, p.name)
        }
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

  const score = useMemo(() => (parsed ? calculateScore(parsed, findings) : null), [parsed, findings])

  const repairAutoFixCount = useMemo(() => {
    if (!rawJson || !parsed) return 0
    try {
      return createRepairPlan(JSON.parse(rawJson) as unknown, parsed, findings).autoFixCount
    } catch {
      return 0
    }
  }, [rawJson, parsed, findings])

  const handleExport = useCallback(
    (format: ExportFormat) => {
      if (!parsed || !score || !rawJson) return
      try {
        if (format === 'sanitized') {
          const { json, redactedCount } = redactCollection(JSON.parse(rawJson) as unknown)
          downloadTextFile(`${safeFileStem(parsed.name)}-sanitized.postman_collection.json`, JSON.stringify(json, null, 2))
          notify({
            variant: 'success',
            title: 'Sanitized copy downloaded',
            description: redactedCount
              ? `${redactedCount} credential value(s) were replaced with {{variables}}. Review before sharing.`
              : 'No credentials were detected; the copy matches the original.',
          })
          return
        }
        const content = buildReport(format, { parsed, findings, score, appVersion })
        downloadTextFile(reportFileName(parsed.name, format), content, reportMimeType(format))
      } catch (e) {
        console.error(e)
        notify({ variant: 'error', title: 'Export failed', description: e instanceof Error ? e.message : undefined })
      }
    },
    [parsed, score, rawJson, findings, appVersion, notify]
  )

  const handleSaveRules = useCallback(
    (options: AuditOptions) => {
      saveAuditPreferences(options)
      setUserAuditPrefs(options)
      notify({ variant: 'success', title: 'Audit rules updated', description: 'Findings and score were recalculated.' })
    },
    [notify]
  )

  const handleResetRules = useCallback(() => {
    clearAuditPreferences()
    setUserAuditPrefs(null)
    notify({ title: 'Audit rules reset', description: 'Using the deployment defaults.' })
  }, [notify])

  const teamLibraryVisible = shouldShowTeamLibrary(loggingMode)
  const canSave = canSaveToAppStorage(loggingMode, storageMode, uploadConsent)

  if (!parsed || !score) {
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
            allowDelete={libraryAllowDelete}
          />
        )}
      </>
    )
  }

  const securityFindings = findings.filter((finding) => finding.category !== 'hygiene')
  const hygieneFindings = findings.filter((finding) => finding.category === 'hygiene')
  const isSavedToLibrary = currentLibraryId != null

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
        showGitHubLink={showGitHubLink}
        showFeedbackLink={showFeedbackLink}
        feedbackUrl={feedbackUrl}
        onExport={handleExport}
        onOpenRules={() => setRulesOpen(true)}
        customRulesActive={userAuditPrefs !== null && isCustomized(auditOptions)}
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

      <RuleSettingsDialog
        open={rulesOpen}
        onOpenChange={setRulesOpen}
        value={auditOptions}
        defaults={auditPolicy}
        usingDefaults={userAuditPrefs === null}
        onSave={handleSaveRules}
        onReset={handleResetRules}
      />

      {teamLibraryVisible && (
        <CollectionLibraryModal
          open={libraryOpen}
          activeCollectionId={currentLibraryId}
          onOpenChange={setLibraryOpen}
          onLoad={(id) => void handleLoadFromLibrary(id)}
          onLibraryChange={() => void refreshSavedCollections()}
          allowDelete={libraryAllowDelete}
        />
      )}
    </>
  )
}
