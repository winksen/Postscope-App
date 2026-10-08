import { useState } from 'react'
import { Eye, EyeSlash } from '@phosphor-icons/react'
import { containsSecretPattern, isLikelySecretValue, isSensitiveHeader, isSensitiveKey, maskSecret, redactSecretsInText } from '@/lib/secretPatterns'
import { cn } from '@/lib/utils'

function RevealToggle({ revealed, onToggle }: { revealed: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        onToggle()
      }}
      className="inline-flex shrink-0 items-center rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={revealed ? 'Hide value' : 'Reveal value'}
      title={revealed ? 'Hide value' : 'Reveal value'}
    >
      {revealed ? <EyeSlash className="h-3.5 w-3.5" weight="fill" /> : <Eye className="h-3.5 w-3.5" weight="fill" />}
    </button>
  )
}

/** True when a key/value pair should be masked on screen (credentials, tokens, session cookies). */
export function shouldMaskValue(name: string, value: string): boolean {
  if (!isLikelySecretValue(value)) return false
  return isSensitiveHeader(name) || containsSecretPattern(value)
}

/**
 * Displays a header / query value, masking likely credentials until the user explicitly reveals them,
 * so collections can be reviewed on shared screens and in screenshots.
 */
export function SecretValue({ name, value, className }: { name: string; value: string; className?: string }) {
  const [revealed, setRevealed] = useState(false)
  if (!shouldMaskValue(name, value)) return <span className={className}>{value}</span>
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1', className)}>
      <span className={cn('min-w-0 truncate', !revealed && 'font-mono tracking-tight')}>{revealed ? value : maskSecret(value)}</span>
      <RevealToggle revealed={revealed} onToggle={() => setRevealed((current) => !current)} />
    </span>
  )
}

const JSON_STRING_FIELD = /("([^"\\]{1,100})"\s*:\s*")([^"\\]*)(")/g
const FORM_FIELD = /(^|&)([^=&\s]{1,100})=([^&]*)/g

/** Masks provider tokens plus JSON / form fields with credential-like names (password, client_secret, …). */
export function maskSensitiveText(text: string): string {
  let masked = redactSecretsInText(text)
  masked = masked.replace(JSON_STRING_FIELD, (match, prefix: string, key: string, value: string, suffix: string) =>
    isSensitiveKey(key) && isLikelySecretValue(value) ? `${prefix}${maskSecret(value)}${suffix}` : match
  )
  if (!/[\s{}[\]]/.test(masked) && masked.includes('=')) {
    masked = masked.replace(FORM_FIELD, (match, sep: string, key: string, value: string) =>
      isSensitiveKey(key) && isLikelySecretValue(value) ? `${sep}${key}=${maskSecret(value)}` : match
    )
  }
  return masked
}

/** Request body text with credentials masked until revealed. */
export function MaskedText({ text, className }: { text: string; className?: string }) {
  const [revealed, setRevealed] = useState(false)
  const masked = maskSensitiveText(text)
  const hasSecrets = masked !== text
  return (
    <div className="relative">
      {hasSecrets && (
        <div className="absolute right-2 top-2 z-10 rounded bg-card/90 px-1">
          <RevealToggle revealed={revealed} onToggle={() => setRevealed((current) => !current)} />
        </div>
      )}
      <pre className={className}>{hasSecrets && !revealed ? masked : text}</pre>
    </div>
  )
}
