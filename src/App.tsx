import { lazy, Suspense, useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { DEFAULT_APP_CONFIG, fetchAppConfig, type AppConfig } from '@/lib/deploymentConfig'
import { setActiveScoreWeights } from '@/lib/scorer'
import { LandingPage } from '@/pages/LandingPage'

// The analyzer and the samples are loaded on demand: the landing page does not download the parser, the audit
// engine or the dashboard.
const AnalyzeApp = lazy(() => import('@/pages/AnalyzeApp').then((module) => ({ default: module.AnalyzeApp })))
const SamplesApp = lazy(() => import('@/pages/SamplesApp').then((module) => ({ default: module.SamplesApp })))

function RouteFallback() {
  return (
    <div className="min-h-screen bg-background" role="status" aria-live="polite">
      <span className="sr-only">Loading...</span>
    </div>
  )
}

export default function App() {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_APP_CONFIG)
  const [configLoaded, setConfigLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    void fetchAppConfig()
      .then((loaded) => {
        if (cancelled) return
        setActiveScoreWeights(loaded.scoreWeights)
        setConfig(loaded)
      })
      // Falls back to privacy-first defaults (incognito, no landing page) when the server is unreachable.
      .catch((e) => console.error(e))
      .finally(() => {
        if (!cancelled) setConfigLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!configLoaded) {
    return <div className="min-h-screen bg-background" />
  }

  // The analyzer lives under /analyze when the landing page is public, otherwise at the root. Its own pages
  // (/security, /requests/<id>, ...) are routes below that base, so links and the back button work.
  const analyzerBase = config.publicLandingPage ? '/analyze' : ''
  const analyzer = (
    <AnalyzeApp
      basePath={analyzerBase}
      loggingMode={config.loggingMode}
      samplesPath="/samples"
      showGitHubLink={config.showGitHubLink}
      showFeedbackLink={config.showFeedbackLink}
      feedbackUrl={config.feedbackUrl}
      appVersion={config.appVersion}
      libraryAllowDelete={config.libraryAllowDelete}
      libraryEncrypted={config.libraryEncrypted}
      auditPolicy={config.auditPolicy}
    />
  )

  return (
    <BrowserRouter>
      <Suspense fallback={<RouteFallback />}>
      <Routes>
        {config.publicLandingPage ? (
          <>
            <Route path="/" element={<LandingPage />} />
            <Route path="/analyze/*" element={analyzer} />
            <Route path="/samples" element={<SamplesApp analyzePath="/analyze" />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </>
        ) : (
          <>
            <Route path="/analyze/*" element={<Navigate to="/" replace />} />
            <Route path="/samples" element={<SamplesApp analyzePath="/" />} />
            <Route path="/*" element={analyzer} />
          </>
        )}
      </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
