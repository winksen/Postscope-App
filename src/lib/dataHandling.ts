import type { StorageMode } from './storagePreferences'
import { canSaveToAppStorage, shouldPersistSession, type LoggingMode } from './deploymentConfig'

export interface DataHandlingOptions {
  /** The server removes credentials from a collection before storing it (LIBRARY_REDACT_SECRETS). */
  serverRedactsSecrets?: boolean
  /** The server encrypts stored collections at rest (LIBRARY_ENCRYPTION_KEY). */
  serverEncrypts?: boolean
  /** The person turned on "keep for refresh". */
  keepSession?: boolean
  /** When the stored copy expires (milliseconds since the epoch), if one is stored. */
  sessionExpiresAt?: number | null
}

export interface DataHandlingSummary {
  /** The collection is sent to the app server when it is imported (once consent, where needed, is given). */
  uploadsCollection: boolean
  /** The collection and environment files are kept in this tab's session storage so a refresh restores them. */
  keepsSessionCopy: boolean
  /** The mode would allow a session copy if the person opts in. */
  canKeepSession: boolean
  /** Environment and globals files never leave the browser, whatever the mode. */
  uploadsEnvironments: false
  /** One short line per question a person asks before importing. */
  rows: { id: 'analysis' | 'collection' | 'environments' | 'refresh'; label: string; value: string }[]
}

/**
 * What happens to an imported collection in the current deployment mode. It reads the same predicates the app uses
 * to decide whether to upload and whether to keep a session copy, so the text cannot drift from the behavior.
 */
export function describeDataHandling(
  loggingMode: LoggingMode,
  storageMode: StorageMode,
  options: DataHandlingOptions = {}
): DataHandlingSummary {
  // Consent is a separate gate (see requiresUploadConsent); here the question is where the data goes once allowed.
  const uploadsCollection = canSaveToAppStorage(loggingMode, storageMode, true)
  const canKeepSession = shouldPersistSession(loggingMode, storageMode, true)
  const keepsSessionCopy = shouldPersistSession(loggingMode, storageMode, options.keepSession === true)

  let collection: string
  if (!uploadsCollection) collection = 'Stays in this browser. It is not sent to the app server.'
  else {
    const server = [
      options.serverRedactsSecrets
        ? 'credentials are removed before it is stored'
        : 'stored as imported, including URLs, headers and tokens',
      options.serverEncrypts ? 'encrypted at rest' : 'not encrypted at rest',
    ].join(', ')
    collection = `Sent to the app server and shared with your team (${server}).`
  }

  return {
    uploadsCollection,
    keepsSessionCopy,
    canKeepSession,
    uploadsEnvironments: false,
    rows: [
      { id: 'analysis', label: 'Analysis', value: 'Runs in this browser.' },
      { id: 'collection', label: 'Collection', value: collection },
      { id: 'environments', label: 'Environment files', value: 'Used in this browser only. They are never sent to the server.' },
      {
        id: 'refresh',
        label: 'After a refresh',
        value: keepsSessionCopy
          ? `The collection and environment files are kept in session storage for this tab${
              options.sessionExpiresAt
                ? ` until ${new Date(options.sessionExpiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                : ' for 60 minutes'
            } and restored after a refresh. Forget removes them.`
          : canKeepSession
            ? 'Nothing is kept. Turn on keep for refresh to hold the collection and environment files in this tab for 60 minutes.'
            : 'Nothing is kept. You import the collection again.',
      },
    ],
  }
}
