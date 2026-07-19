import { ensureAppEnv } from './loadEnv'

const DEFAULT_FEEDBACK_URL = 'https://github.com/winksen/Postscope-App/issues/new'

function parseEnabledFlag(value: string | undefined): boolean {
  if (value === undefined) return true
  const normalized = value.trim().toLowerCase()
  return !(normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off')
}

export function getExternalLinksConfig() {
  ensureAppEnv()
  return {
    showGitHubLink: parseEnabledFlag(process.env.SHOW_GITHUB_LINK),
    showFeedbackLink: parseEnabledFlag(process.env.SHOW_FEEDBACK_LINK),
    feedbackUrl: process.env.FEEDBACK_URL?.trim() || DEFAULT_FEEDBACK_URL,
  }
}
