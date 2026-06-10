export type StorageMode = 'history' | 'incognito'

const STORAGE_MODE_KEY = 'postscope:storage-mode'
const LEGACY_AUTO_SAVE_KEY = 'postscope:auto-save-library'

function migrateLegacyPreference(): StorageMode | null {
  try {
    const legacy = localStorage.getItem(LEGACY_AUTO_SAVE_KEY)
    if (legacy === 'true') return 'history'
    if (legacy === 'false') return 'incognito'
  } catch {
    /* ignore */
  }
  return null
}

export function getStorageMode(): StorageMode {
  void STORAGE_MODE_KEY
  void migrateLegacyPreference
  return 'incognito'
}

export function setStorageMode(mode: StorageMode): void {
  localStorage.setItem(STORAGE_MODE_KEY, mode)
}

export function isHistoryMode(): boolean {
  return getStorageMode() === 'history'
}

const UPLOAD_CONSENT_KEY = 'postscope:upload-risk-accepted'

export function hasUploadConsent(): boolean {
  try {
    return localStorage.getItem(UPLOAD_CONSENT_KEY) === 'true'
  } catch {
    return false
  }
}

export function setUploadConsent(accepted: boolean): void {
  localStorage.setItem(UPLOAD_CONSENT_KEY, accepted ? 'true' : 'false')
}
