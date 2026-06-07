const ANALYTICS_CONSENT_STORAGE_KEY = 'nexus:analytics:consent'

export function getAnalyticsConsent() {
  if (typeof window === 'undefined') {
    return false
  }

  try {
    return window.localStorage.getItem(ANALYTICS_CONSENT_STORAGE_KEY) === 'granted'
  } catch {
    return false
  }
}

export function setAnalyticsConsent(granted: boolean) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    if (granted) {
      window.localStorage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, 'granted')
      return
    }

    window.localStorage.removeItem(ANALYTICS_CONSENT_STORAGE_KEY)
  } catch {
    // Analytics consent is best-effort; private-mode storage failures must not break the app.
  }
}
