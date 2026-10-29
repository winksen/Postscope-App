import { Suspense, useCallback, useState, useEffect, useMemo, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { DropZone } from '../components/DropZone'
import { DashboardShell } from '../components/layout/dashboard-shell'
import type { EnvironmentOption, ExportFormat } from '../components/layout/app-header'
import { RequestSearchModal } from '../components/RequestSearchModal'
import { CollectionLibraryModal } from '../components/CollectionLibraryModal'
import { RuleSettingsDialog } from '../components/RuleSettingsDialog'
import { useToast } from '../components/ui/toaster'
import { PageFallback, lazyPage } from '../components/lazyPage'

// Pages are separate chunks: Recharts only loads with the Dashboard, and a page nobody opens is never downloaded.
const OverviewPage = lazyPage(() => import('./OverviewPage'), 'OverviewPage')
const RequestsPage = lazyPage(() => import('./RequestsPage'), 'RequestsPage')
const SecurityPage = lazyPage(() => import('./SecurityPage'), 'SecurityPage')
const HygienePage = lazyPage(() => import('./HygienePage'), 'HygienePage')
const ScorePage = lazyPage(() => import('./ScorePage'), 'ScorePage')
const RepairPage = lazyPage(() => import('./RepairPage'), 'RepairPage')
const ComparePage = lazyPage(() => import('./ComparePage'), 'ComparePage')
const IdentityPage = lazyPage(() => import('./IdentityPage'), 'IdentityPage')
import { analyzeCollectionText, auditAgain, describeAnalysisError } from '../lib/analyzeCollection'
import { detectEnvironmentKind, isCollectionJson, parseEnvironment } from '../lib/environment'
import {
  clearCollectionSession,
  isSessionRetentionEnabled,
  loadCollectionSession,
  saveCollectionSession,
  setSessionRetention,
} from '../lib/collectionSession'
import { getSavedCollection, listSavedCollections, saveToLibrary, type SavedCollectionMeta } from '../lib/collectionLibrary'
import { getStorageMode, setStorageMode, type StorageMode } from '../lib/storagePreferences'
import {
  getUploadConsentState,
  recordUploadConsent,
  revokeUploadConsent,
  uploadPolicyDigest,
  type ConsentState,
} from '../lib/uploadConsent'
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
import type { AuditOptions, Finding } from '../lib/auditor'
import type { SuppressedFinding } from '../lib/suppressions'
import { buildReport, reportFileName, reportMimeType, safeFileStem, type ReportFormat } from '../lib/reportExport'
import type { ReportPrivacy } from '../lib/reportPrivacy'
import { redactCollection, redactEnvironment } from '../lib/redaction'
import { isEmptyProfile } from '../lib/iam/types'
import { attachEvidencePointers } from '../lib/evidencePointers'
import { downloadTextFile } from '../lib/download'
import type { CompareInput } from '../lib/compare'
import type { ParsedCollection, ParsedRequest } from '../lib/parser'
import type { NavId } from '../components/layout/app-sidebar'
import { isSearchShortcut } from '../lib/keyboard'
import { buildAppPath, parseAppLocation, type AppLocation } from '../lib/appRoutes'

/** Upper bound for in-browser analysis; larger files risk exhausting tab memory. */
const MAX_IMPORT_BYTES = 50_000_000

interface AnalyzeAppProps {
  loggingMode: LoggingMode
  /** Path the analyzer is mounted at (`/analyze`, or empty at the root); its pages are routes below it. */
  basePath?: string
  samplesPath?: string
  showGitHubLink?: boolean
  showFeedbackLink?: boolean
  feedbackUrl?: string
  appVersion?: string
  libraryAllowDelete?: boolean
  libraryEncrypted?: boolean
  libraryRedactSecrets?: boolean
  libraryRetentionDays?: number
  internalIdentifiers?: string[]
  auditPolicy?: AuditOptions
}

const EMPTY_POLICY: AuditOptions = {}
const NO_IDENTIFIERS: string[] = []

function formatMegabytes(bytes: number): string {
  return `${Math.round((bytes / 1_000_000) * 10) / 10} MB`
}

export function AnalyzeApp({
  loggingMode,
  basePath = '',
  samplesPath = '/samples',
  showGitHubLink = true,
  showFeedbackLink = true,
  feedbackUrl = 'https://github.com/winksen/Postscope-App/issues/new',
  appVersion,
  libraryAllowDelete = true,
  libraryEncrypted = false,
  libraryRedactSecrets = false,
  libraryRetentionDays = 0,
  internalIdentifiers = NO_IDENTIFIERS,
  auditPolicy = EMPTY_POLICY,
}: AnalyzeAppProps) {
  const { notify } = useToast()
  const navigate = useNavigate()
  const routerLocation = useLocation()
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate
  const route = useMemo(
    () => parseAppLocation(routerLocation.pathname, routerLocation.search, basePath),
    [routerLocation.pathname, routerLocation.search, basePath]
  )
  const location: AppLocation = route ?? { page: 'overview' }
  const active: NavId = location.page
  /** Moves to another page, request or filter set. Filters replace the entry so back and forward step through pages. */
  const goTo = useCallback(
    (next: AppLocation, replace = false) => navigateRef.current(buildAppPath(basePath, next), { replace }),
    [basePath]
  )
  const setActive = useCallback((id: NavId) => goTo({ page: id }), [goTo])
  // An address that is not a page of the analyzer goes to the dashboard.
  useEffect(() => {
    if (!route) navigateRef.current(buildAppPath(basePath, { page: 'overview' }), { replace: true })
  }, [route, basePath])
  const [parsed, setParsed] = useState<ParsedCollection | null>(null)
  const [findings, setFindings] = useState<Finding[]>([])
  const [suppressed, setSuppressed] = useState<SuppressedFinding[]>([])
  const [rawJson, setRawJson] = useState<string | null>(null)
  const [originalRawJson, setOriginalRawJson] = useState<string | null>(null)
  /** Raw environment and globals exports loaded with the collection (kept for re-analysis and sanitized export). */
  const [environmentTexts, setEnvironmentTexts] = useState<string[]>([])
  const [currentLibraryId, setCurrentLibraryId] = useState<string | null>(null)
  const [savedCollections, setSavedCollections] = useState<SavedCollectionMeta[]>([])
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [landingLoading, setLandingLoading] = useState(false)
  const [restoringSession, setRestoringSession] = useState(true)
  const [savingToLibrary, setSavingToLibrary] = useState(false)
  /** Older version used by the Compare page. It is analyzed with the current rule settings and never saved. */
  const [referenceRaw, setReferenceRaw] = useState<string | null>(null)
  const [reference, setReference] = useState<CompareInput | null>(null)
  const [referenceLoading, setReferenceLoading] = useState(false)
  const [storageMode, setStorageModeState] = useState<StorageMode>(() => getStorageMode())
  // Consent covers one origin and one upload policy; a change to either asks again.
  const consentOrigin = typeof window === 'undefined' ? '' : window.location.origin
  const policyDigest = useMemo(
    () =>
      uploadPolicyDigest({
        loggingMode,
        redactsSecrets: libraryRedactSecrets,
        encrypted: libraryEncrypted,
        retentionDays: libraryRetentionDays,
      }),
    [loggingMode, libraryRedactSecrets, libraryEncrypted, libraryRetentionDays]
  )
  const [consentState, setConsentState] = useState<ConsentState>(() => getUploadConsentState(consentOrigin, policyDigest))
  useEffect(() => {
    setConsentState(getUploadConsentState(consentOrigin, policyDigest))
  }, [consentOrigin, policyDigest])
  const uploadConsent = consentState === 'accepted'
  const [userAuditPrefs, setUserAuditPrefs] = useState<AuditOptions | null>(() => loadAuditPreferences())

  const auditOptions = useMemo(() => effectiveAuditOptions(auditPolicy, userAuditPrefs), [auditPolicy, userAuditPrefs])
  const auditOptionsRef = useRef(auditOptions)
  auditOptionsRef.current = auditOptions
  const environmentTextsRef = useRef<string[]>([])
  environmentTextsRef.current = environmentTexts
  const parsedRef = useRef<ParsedCollection | null>(null)
  parsedRef.current = parsed
  const rawJsonRef = useRef<string | null>(null)
  rawJsonRef.current = rawJson
  /** Incremented for every analysis; results from superseded analyses are discarded. */
  const analysisSeq = useRef(0)
  const restoreAttempted = useRef(false)
  /** Reports for readers outside the organization replace names, hosts, paths and credentials. */
  const [externalProfile, setExternalProfile] = useState(false)
  /** The person chose to keep a copy for refresh; off until they turn it on. */
  const [keepSession, setKeepSession] = useState(() => isSessionRetentionEnabled())
  const keepSessionRef = useRef(keepSession)
  keepSessionRef.current = keepSession
  /** When the stored session copy expires, shown in the header so it is never a surprise. */
  const [sessionExpiresAt, setSessionExpiresAt] = useState<number | null>(null)

  useEffect(() => {
    if (sessionExpiresAt === null) return
    const timer = setTimeout(
      () => {
        clearCollectionSession()
        setSessionExpiresAt(null)
      },
      Math.max(0, sessionExpiresAt - Date.now())
    )
    return () => clearTimeout(timer)
  }, [sessionExpiresAt])

  const handleKeepSessionChange = useCallback((enabled: boolean) => {
    setSessionRetention(enabled)
    setKeepSession(enabled)
    if (!enabled) setSessionExpiresAt(null)
  }, [])

  useEffect(() => {
    const forced = getForcedStorageMode(loggingMode)
    if (forced) {
      setStorageMode(forced)
      setStorageModeState(forced)
      if (forced === 'incognito') clearCollectionSession()
    }
  }, [loggingMode])

  /**
   * Audits the collection on screen again in the analysis worker (rule settings or the selected environment changed).
   * The worker keeps the full parsed collection, so nothing is parsed again; if it was restarted the text is analyzed again.
   */
  const reaudit = useCallback(async (options: AuditOptions, activeEnvironment?: number) => {
    const result = await auditAgain(options, { activeEnvironment })
    if (result) return result
    const raw = rawJsonRef.current
    if (raw === null) return null
    return analyzeCollectionText(raw, options, { environments: environmentTextsRef.current, activeEnvironment })
  }, [])

  const lastAuditOptions = useRef(auditOptions)
  useEffect(() => {
    if (lastAuditOptions.current === auditOptions) return
    lastAuditOptions.current = auditOptions
    const current = parsedRef.current
    if (!current) return
    const seq = analysisSeq.current
    reaudit(auditOptions, current.activeEnvironment)
      .then((result) => {
        // A newer import or repair replaced the collection while the audit ran.
        if (!result || seq !== analysisSeq.current) return
        setParsed(result.parsed)
        setFindings(result.findings)
        setSuppressed(result.suppressed)
      })
      .catch((e) => console.error(e))
  }, [auditOptions, reaudit])

  useEffect(() => {
    if (referenceRaw === null) {
      setReference(null)
      return
    }
    let cancelled = false
    setReferenceLoading(true)
    analyzeCollectionText(referenceRaw, auditOptions, { slot: 'reference' })
      .then((result) => {
        if (!cancelled) setReference({ parsed: result.parsed, findings: result.findings })
      })
      .catch((e) => {
        if (cancelled) return
        console.error(e)
        setReferenceRaw(null)
        notify({ variant: 'error', title: 'Could not analyze the older version', description: describeAnalysisError(e) })
      })
      .finally(() => {
        if (!cancelled) setReferenceLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [referenceRaw, auditOptions, notify])

  const handleStorageModeChange = useCallback(
    (mode: StorageMode) => {
      if (!canChoosePrivacyMode(loggingMode)) return
      setStorageMode(mode)
      setStorageModeState(mode)
      if (mode === 'incognito') clearCollectionSession()
    },
    [loggingMode]
  )

  const handleUploadConsentChange = useCallback(
    (accepted: boolean) => {
      if (accepted) recordUploadConsent(consentOrigin, policyDigest)
      else revokeUploadConsent()
      setConsentState(accepted ? 'accepted' : 'none')
    },
    [consentOrigin, policyDigest]
  )

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
      if (isSearchShortcut(e, document.querySelector('[role="dialog"]') !== null)) {
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
    async (
      raw: string,
      libraryId?: string | null,
      environments: string[] = [],
      activeEnvironment?: number,
      restoring = false
    ): Promise<boolean> => {
      const seq = ++analysisSeq.current
      const analysis = await analyzeCollectionText(raw, auditOptionsRef.current, { environments, activeEnvironment })
      if (seq !== analysisSeq.current) return false
      const p = analysis.parsed
      const f = analysis.findings
      const s = analysis.suppressed

      setParsed(p)
      setFindings(f)
      setSuppressed(s)
      setRawJson(raw)
      setOriginalRawJson(raw)
      setEnvironmentTexts(environments)
      // A restored session keeps the page in the address; a new import starts on the dashboard.
      if (!restoring) goTo({ page: 'overview' })
      setSearch('')
      notifyParseWarnings(p)

      if (shouldPersistSession(loggingMode, storageMode, keepSessionRef.current)) {
        const expiresAt = saveCollectionSession(raw, p.name, environments, p.activeEnvironment)
        if (expiresAt === null) {
          notify({ title: 'Collection not kept for refresh', description: 'It is larger than the browser session storage limit.' })
        } else setSessionExpiresAt(expiresAt)
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
    [loggingMode, storageMode, uploadConsent, refreshSavedCollections, notify, notifyParseWarnings, goTo]
  )

  useEffect(() => {
    if (restoreAttempted.current) return
    restoreAttempted.current = true
    // The storage choice in hybrid mode is not remembered across a refresh, so a kept copy is restored whenever the
    // person opted in and the deployment allows copies; anything else is removed rather than left behind.
    if (!keepSessionRef.current || loggingMode === 'off') {
      clearCollectionSession()
      setRestoringSession(false)
      return
    }
    const session = loadCollectionSession()
    if (!session) {
      setRestoringSession(false)
      return
    }
    setSessionExpiresAt(session.expiresAt ?? null)
    void applyCollectionJson(session.rawJson, null, session.environments ?? [], session.activeEnvironment, true)
      .catch((e) => {
        console.error(e)
        clearCollectionSession()
      })
      .finally(() => setRestoringSession(false))
    // Restore exactly once on mount; later dependency changes must not re-import the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const importBlockedByConsent = useCallback(() => {
    if (canChoosePrivacyMode(loggingMode) && storageMode === 'history' && !canSaveToAppStorage(loggingMode, storageMode, uploadConsent)) {
      notify({
        variant: 'error',
        title: 'Upload warning not accepted',
        description: 'Accept the upload warning before saving a collection to app history.',
      })
      return true
    }
    return false
  }, [loggingMode, storageMode, uploadConsent, notify])

  const runImport = useCallback(
    (raw: string, environments: string[] = [], olderRaw?: string) => {
      setLandingLoading(true)
      void applyCollectionJson(raw, null, environments)
        .then((applied) => {
          // Two collections were dropped: the first is the older version, the second opens as the current one.
          if (applied && olderRaw !== undefined) {
            setReferenceRaw(olderRaw)
            setActive('compare')
          }
        })
        .catch((e) => {
          console.error(e)
          notify({ variant: 'error', title: 'Import failed', description: describeAnalysisError(e) })
        })
        .finally(() => setLandingLoading(false))
    },
    [applyCollectionJson, notify, setActive]
  )

  const handleFiles = useCallback(
    (files: File[]) => {
      if (importBlockedByConsent()) return
      const oversized = files.find((file) => file.size > MAX_IMPORT_BYTES)
      if (oversized) {
        notify({
          variant: 'error',
          title: 'File is too large',
          description: `${oversized.name} is ${formatMegabytes(oversized.size)}. The analyzer accepts files up to ${formatMegabytes(MAX_IMPORT_BYTES)}.`,
        })
        return
      }
      const empty = files.find((file) => file.size === 0)
      if (empty) {
        notify({ variant: 'error', title: 'File is empty', description: `${empty.name} has no content.` })
        return
      }
      setLandingLoading(true)
      Promise.all(files.map(async (file) => ({ name: file.name, text: await file.text() })))
        .then((loaded) => {
          const collections: string[] = []
          const environments: string[] = []
          let unknown: string | null = null
          for (const { name, text } of loaded) {
            let json: unknown = null
            try {
              json = JSON.parse(text) as unknown
            } catch {
              // Not JSON: a single file is analyzed so the usual "not valid JSON" message appears.
            }
            if (json !== null && detectEnvironmentKind(json, name)) environments.push(text)
            else if (json === null || isCollectionJson(json)) collections.push(text)
            else unknown = unknown ?? name
          }
          if (collections.length === 0 && !unknown) {
            setLandingLoading(false)
            notify({
              variant: 'error',
              title: 'Add a collection',
              description: 'Environment and globals files are analyzed together with a Postman collection.',
            })
            return
          }
          if (collections.length > 2) {
            setLandingLoading(false)
            notify({
              variant: 'error',
              title: 'Add at most two collections',
              description: 'Drop one collection, or two to compare them (older first), together with any environment or globals files.',
            })
            return
          }
          if (collections.length === 0) {
            setLandingLoading(false)
            notify({
              variant: 'error',
              title: 'Not a Postman file',
              description: `${unknown} is neither a collection nor an environment export.`,
            })
            return
          }
          if (collections.length === 2) {
            notify({ title: 'Comparing two collections', description: 'The first file is the older version, the second one is opened.' })
            runImport(collections[1], environments, collections[0])
            return
          }
          runImport(collections[0], environments)
        })
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
        notify({
          variant: 'error',
          title: 'Pasted JSON is too large',
          description: `Paste up to ${formatMegabytes(MAX_IMPORT_BYTES)} or upload the file instead.`,
        })
        return
      }
      runImport(raw)
    },
    [importBlockedByConsent, notify, runImport]
  )

  const handleAnalyzeAnother = useCallback(() => {
    analysisSeq.current += 1
    clearCollectionSession()
    setSessionExpiresAt(null)
    setParsed(null)
    setFindings([])
    setSuppressed([])
    setRawJson(null)
    setOriginalRawJson(null)
    setEnvironmentTexts([])
    setCurrentLibraryId(null)
    setReferenceRaw(null)
    setSearch('')
    setSearchOpen(false)
    setLandingLoading(false)
    goTo({ page: 'overview' }, true)
  }, [goTo])

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

  const handleCompareWithLibrary = useCallback(
    async (id: string) => {
      try {
        const record = await getSavedCollection(id)
        if (!record) {
          notify({ variant: 'error', title: 'Saved collection not found', description: 'It may have been removed by a teammate.' })
          await refreshSavedCollections()
          return
        }
        setReferenceRaw(record.rawJson)
        setActive('compare')
      } catch (e) {
        console.error(e)
        notify({ variant: 'error', title: 'Failed to open saved collection', description: e instanceof Error ? e.message : undefined })
      }
    },
    [notify, refreshSavedCollections, setActive]
  )

  const handleChooseReferenceFile = useCallback(
    async (file: File) => {
      if (file.size === 0 || file.size > MAX_IMPORT_BYTES) {
        notify({ variant: 'error', title: file.size === 0 ? 'File is empty' : 'File is too large', description: file.name })
        return
      }
      try {
        const text = await file.text()
        const json = JSON.parse(text) as unknown
        if (!isCollectionJson(json)) {
          notify({ variant: 'error', title: 'Not a Postman collection', description: `${file.name} needs an item array.` })
          return
        }
        setReferenceRaw(text)
      } catch {
        notify({ variant: 'error', title: 'Could not read the file', description: `${file.name} is not valid JSON.` })
      }
    },
    [notify]
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

  const handleSearchSelect = useCallback(
    (request: ParsedRequest) => {
      setSearch('')
      goTo({ page: 'requests', requestId: request.id })
    },
    [goTo]
  )

  const handleApplyRepairedCollection = useCallback(
    async (raw: string) => {
      const seq = ++analysisSeq.current
      const environments = environmentTextsRef.current
      // The environment the user selected stays selected after a repair.
      const analysis = await analyzeCollectionText(raw, auditOptionsRef.current, {
        environments,
        activeEnvironment: parsedRef.current?.activeEnvironment,
      })
      const p = analysis.parsed
      const f = analysis.findings
      const s = analysis.suppressed
      if (seq === analysisSeq.current) {
        setParsed(p)
        setFindings(f)
        setSuppressed(s)
        setRawJson(raw)
        setCurrentLibraryId(null)
        goTo({ page: 'repair' }, true)
        setSearch('')

        if (shouldPersistSession(loggingMode, storageMode, keepSessionRef.current)) {
          setSessionExpiresAt(saveCollectionSession(raw, p.name, environments, p.activeEnvironment))
        }
      }

      return {
        findings: f,
        score: calculateScore(p, f),
      }
    },
    [loggingMode, storageMode, goTo]
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
        if (format === 'sanitized' || format === 'sanitized-pii') {
          const scrubPii = format === 'sanitized-pii'
          const { json, redactedCount } = redactCollection(JSON.parse(rawJson) as unknown, { scrubPii })
          downloadTextFile(`${safeFileStem(parsed.name)}-sanitized.postman_collection.json`, JSON.stringify(json, null, 2))
          notify({
            variant: 'success',
            title: 'Sanitized copy downloaded',
            description: redactedCount
              ? `${redactedCount} value(s) were replaced${scrubPii ? ' (credentials and personal data)' : ' with {{variables}}'}. Review before sharing.`
              : `No ${scrubPii ? 'credentials or personal data were' : 'credentials were'} detected; the copy matches the original.`,
          })
          return
        }
        if (format === 'sanitized-environments') {
          let total = 0
          environmentTexts.forEach((text, index) => {
            const source = JSON.parse(text) as unknown
            const { json, redactedCount } = redactEnvironment(source)
            total += redactedCount
            const { name, kind } = parseEnvironment(source)
            downloadTextFile(
              `${safeFileStem(name || `environment-${index + 1}`)}-sanitized.postman_${kind}.json`,
              JSON.stringify(json, null, 2)
            )
          })
          notify({
            variant: 'success',
            title: 'Sanitized environments downloaded',
            description: total
              ? `${total} secret value(s) were emptied. Names and keys are unchanged.`
              : 'No secret values were detected; the copies match the originals.',
          })
          return
        }
        const reportFormat: ReportFormat = format
        const privacy: ReportPrivacy = { profile: externalProfile ? 'external' : 'internal', internalIdentifiers }
        const source = JSON.parse(rawJson) as unknown
        const content = buildReport(reportFormat, {
          parsed,
          findings: attachEvidencePointers(source, parsed, findings),
          suppressed: attachEvidencePointers(source, parsed, suppressed),
          score,
          appVersion,
          sourceText: rawJson,
          privacy,
        })
        downloadTextFile(reportFileName(externalProfile ? 'collection' : parsed.name, reportFormat), content, reportMimeType(reportFormat))
      } catch (e) {
        console.error(e)
        notify({ variant: 'error', title: 'Export failed', description: e instanceof Error ? e.message : undefined })
      }
    },
    [parsed, score, rawJson, findings, suppressed, appVersion, environmentTexts, externalProfile, internalIdentifiers, notify]
  )

  const handleSelectEnvironment = useCallback(
    (index: number) => {
      const current = parsedRef.current
      if (!current || current.environments?.[index]?.kind !== 'environment' || current.activeEnvironment === index) return
      const seq = analysisSeq.current
      reaudit(auditOptionsRef.current, index)
        .then((result) => {
          if (!result || seq !== analysisSeq.current) return
          setParsed(result.parsed)
          setFindings(result.findings)
          setSuppressed(result.suppressed)
          const raw = rawJsonRef.current
          if (raw && shouldPersistSession(loggingMode, storageMode, keepSessionRef.current))
            setSessionExpiresAt(saveCollectionSession(raw, result.parsed.name, environmentTextsRef.current, index))
        })
        .catch((e) => {
          console.error(e)
          notify({ variant: 'error', title: 'Could not switch environment', description: describeAnalysisError(e) })
        })
    },
    [reaudit, loggingMode, storageMode, notify]
  )

  const environmentOptions = useMemo<EnvironmentOption[]>(
    () =>
      (parsed?.environments ?? [])
        .map((environment, index) => ({ index, name: environment.name, kind: environment.kind }))
        .filter((environment) => environment.kind === 'environment')
        .map(({ index, name }) => ({ index, name })),
    [parsed]
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
          onFiles={handleFiles}
          onJsonText={handleJsonText}
          loading={landingLoading || restoringSession}
          loggingMode={loggingMode}
          storageMode={storageMode}
          onStorageModeChange={handleStorageModeChange}
          uploadConsent={uploadConsent}
          onUploadConsentChange={handleUploadConsentChange}
          serverRedactsSecrets={libraryRedactSecrets}
          serverEncrypts={libraryEncrypted}
          retentionDays={libraryRetentionDays}
          consentStale={consentState === 'stale'}
          keepSession={keepSession}
          onKeepSessionChange={handleKeepSessionChange}
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
            encrypted={libraryEncrypted}
          />
        )}
      </>
    )
  }

  const securityFindings = findings.filter((finding) => finding.category !== 'hygiene')
  const hygieneFindings = findings.filter((finding) => finding.category === 'hygiene')
  const isSavedToLibrary = currentLibraryId != null
  const identityCount = findings.filter((finding) => finding.category === 'identity').length
  const showIdentity = !isEmptyProfile(parsed.identity) || (auditOptions.rulePacks?.enabled?.length ?? 0) > 0

  return (
    <>
      <DashboardShell
        issueCount={securityFindings.length}
        hygieneCount={hygieneFindings.length}
        repairCount={repairAutoFixCount}
        showIdentity={showIdentity}
        identityCount={identityCount}
        active={active}
        onNav={setActive}
        search={search}
        onOpenSearch={() => setSearchOpen(true)}
        onAnalyzeAnother={handleAnalyzeAnother}
        externalProfile={externalProfile}
        onExternalProfileChange={setExternalProfile}
        sessionExpiresAt={sessionExpiresAt}
        onForget={handleAnalyzeAnother}
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
        environments={environmentOptions}
        activeEnvironment={parsed.activeEnvironment}
        onEnvironmentChange={handleSelectEnvironment}
        hasEnvironmentFiles={environmentTexts.length > 0}
        hasIdentity={showIdentity}
      >
        <Suspense fallback={<PageFallback />}>
          {active === 'overview' && <OverviewPage parsed={parsed} findings={findings} />}
          {active === 'requests' && (
            <RequestsPage
              parsed={parsed}
              findings={findings}
              search={search}
              selectedId={location.requestId ?? null}
              onSelectId={(id) => goTo({ page: 'requests', requestId: id ?? undefined })}
            />
          )}
          {active === 'security' && (
            <SecurityPage
              parsed={parsed}
              findings={securityFindings}
              suppressed={suppressed}
              score={score}
              search={search}
              location={location}
              onLocationChange={goTo}
            />
          )}
          {active === 'hygiene' && (
            <HygienePage parsed={parsed} findings={hygieneFindings} search={search} location={location} onLocationChange={goTo} />
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
          {active === 'identity' && <IdentityPage parsed={parsed} findings={findings} onLocationChange={goTo} />}
          {active === 'compare' && (
            <ComparePage
              current={{ parsed, findings, score }}
              reference={reference}
              loading={referenceLoading}
              library={teamLibraryVisible ? savedCollections : []}
              currentLibraryId={currentLibraryId}
              onChooseFile={(file) => void handleChooseReferenceFile(file)}
              onChooseLibrary={(id) => void handleCompareWithLibrary(id)}
              onClear={() => setReferenceRaw(null)}
            />
          )}
        </Suspense>
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
          encrypted={libraryEncrypted}
          onCompare={(id) => void handleCompareWithLibrary(id)}
        />
      )}
    </>
  )
}
