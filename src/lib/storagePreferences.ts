import { readStorage, writeStorage } from './safeStorage'

export type StorageMode = 'history' | 'incognito'

const STORAGE_MODE_KEY = 'postscope:storage-mode'
const LEGACY_AUTO_SAVE_KEY = 'postscope:auto-save-library'

function migrateLegacyPreference(): StorageMode | null {
  const legacy = readStorage(LEGACY_AUTO_SAVE_KEY)
  if (legacy === 'true') return 'history'
  if (legacy === 'false') return 'incognito'
  return null
}

export function getStorageMode(): StorageMode {
  void STORAGE_MODE_KEY
  void migrateLegacyPreference
  return 'incognito'
}

export function setStorageMode(mode: StorageMode): void {
  writeStorage(STORAGE_MODE_KEY, mode)
}

export function isHistoryMode(): boolean {
  return getStorageMode() === 'history'
}
