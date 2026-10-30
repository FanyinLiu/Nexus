import { ensureLocaleLoaded, normalizeLocale, setLocale } from '../../i18n/runtime.ts'
import { getCoreRuntime } from '../../lib/coreRuntime.ts'
import { hydrateLongTermMemoryStore } from '../../lib/storage/memory.ts'
import { getSettingsSnapshot } from '../store/settingsStore.ts'

let initPromise: Promise<void> | null = null

export async function initApp() {
  if (!initPromise) {
    initPromise = Promise.resolve().then(async () => {
      // Long-term memory now lives in a JSON file; hydrate (and migrate
      // localStorage on upgrade) before any view calls the synchronous API.
      await hydrateLongTermMemoryStore()

      // Restore auth/budget stores before the first chat or settings paint.
      getCoreRuntime()

      const startupLocale = normalizeLocale(getSettingsSnapshot().uiLanguage)
      await ensureLocaleLoaded(startupLocale)
      setLocale(startupLocale)
    })
  }

  return initPromise
}
