import { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { fetchAppConfig, type LoggingMode } from '@/lib/deploymentConfig'
import { LandingPage } from '@/pages/LandingPage'
import { AnalyzeApp } from '@/pages/AnalyzeApp'
import { SamplesApp } from '@/pages/SamplesApp'

export default function App() {
  const [loggingMode, setLoggingMode] = useState<LoggingMode>('off')
  const [publicLandingPage, setPublicLandingPage] = useState(false)
  const [showGitHubLink, setShowGitHubLink] = useState(true)
  const [showFeedbackLink, setShowFeedbackLink] = useState(true)
  const [feedbackUrl, setFeedbackUrl] = useState('https://github.com/winksen/Postscope-App/issues/new')
  const [configLoaded, setConfigLoaded] = useState(false)

  useEffect(() => {
    void fetchAppConfig()
      .then(({ loggingMode: mode, publicLandingPage: landing, showGitHubLink: githubLink, showFeedbackLink: feedbackLink, feedbackUrl: configuredFeedbackUrl }) => {
        setLoggingMode(mode)
        setPublicLandingPage(landing)
        setShowGitHubLink(githubLink)
        setShowFeedbackLink(feedbackLink)
        setFeedbackUrl(configuredFeedbackUrl)
      })
      .catch((e) => console.error(e))
      .finally(() => setConfigLoaded(true))
  }, [])

  if (!configLoaded) {
    return <div className="min-h-screen bg-background" />
  }

  return (
    <BrowserRouter>
      <Routes>
        {publicLandingPage ? (
          <>
            <Route path="/" element={<LandingPage />} />
            <Route path="/analyze" element={<AnalyzeApp loggingMode={loggingMode} samplesPath="/samples" showGitHubLink={showGitHubLink} showFeedbackLink={showFeedbackLink} feedbackUrl={feedbackUrl} />} />
            <Route path="/samples" element={<SamplesApp analyzePath="/analyze" />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </>
        ) : (
          <>
            <Route path="/" element={<AnalyzeApp loggingMode={loggingMode} samplesPath="/samples" showGitHubLink={showGitHubLink} showFeedbackLink={showFeedbackLink} feedbackUrl={feedbackUrl} />} />
            <Route path="/analyze" element={<Navigate to="/" replace />} />
            <Route path="/samples" element={<SamplesApp analyzePath="/" />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </>
        )}
      </Routes>
    </BrowserRouter>
  )
}
