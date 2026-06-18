import {
  ANALYTICS_CONSENT_STORAGE_KEY,
  readStorageString,
  removeStorageItem,
  writeStorageString,
} from '../../lib/storage/core.ts'

export function getAnalyticsConsent() {
  if (typeof window === 'undefined') {
    return false
  }

  return readStorageString(ANALYTICS_CONSENT_STORAGE_KEY) === 'granted'
}

export function setAnalyticsConsent(granted: boolean) {
  if (typeof window === 'undefined') {
    return
  }

  if (granted) {
    writeStorageString(ANALYTICS_CONSENT_STORAGE_KEY, 'granted')
    return
  }

  removeStorageItem(ANALYTICS_CONSENT_STORAGE_KEY)
}
