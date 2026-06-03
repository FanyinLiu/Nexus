import { track } from '../../features/analytics'
import { ensureLocaleLoaded, normalizeLocale, setLocale } from '../../i18n/runtime.ts'
import { getSettingsSnapshot } from '../store/settingsStore.ts'

let initPromise: Promise<void> | null = null

export async function initApp() {
  if (!initPromise) {
    initPromise = Promise.resolve().then(async () => {
      const startupLocale = normalizeLocale(getSettingsSnapshot().uiLanguage)
      await ensureLocaleLoaded(startupLocale)
      setLocale(startupLocale)

      await track('app.bootstrap', {
        source: 'initApp',
      })
    })
  }

  return initPromise
}
