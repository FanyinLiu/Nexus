import {
  SETTINGS_STORAGE_KEY,
  SETTINGS_UPDATED_EVENT,
  loadSettings,
  saveSettings,
} from '../../lib/storage.ts'
import {
  dehydrateSettingsKeys,
  hydrateSettingsKeys,
  isVaultRefString,
  migrateKeysToVault,
} from '../../lib/keyVaultBridge.ts'
import type { AppSettings } from '../../types/index.ts'

let vaultMigrationDone = false
let cachedHydratedSettings: AppSettings | null = null

export function getSettingsSnapshot(): AppSettings {
  if (cachedHydratedSettings) return cachedHydratedSettings
  const settings = loadSettings()
  cachedHydratedSettings = settings
  return settings
}

export async function setSettingsSnapshot(nextSettings: AppSettings) {
  cachedHydratedSettings = nextSettings
  // Dehydrate keys to vault first, then write stripped settings to localStorage.
  // Only one write — never persists plaintext keys.
  const stripped = await dehydrateSettingsKeys(nextSettings)
  saveSettings(stripped)
}

/**
 * Async initialization: migrate plaintext keys to vault on first run,
 * then hydrate the settings object with decrypted keys from vault.
 */
export async function initializeSettingsWithVault(): Promise<AppSettings> {
  let settings = cachedHydratedSettings ?? loadSettings()

  if (!vaultMigrationDone) {
    vaultMigrationDone = true

    const hasPlaintextKeys = [
      settings.apiKey,
      settings.speechInputApiKey,
      settings.speechOutputApiKey,
      settings.toolWebSearchApiKey,
      settings.screenVlmApiKey,
      settings.telegramBotToken,
      settings.discordBotToken,
    ].some((value) => {
      if (typeof value !== 'string') return false
      const normalized = value.trim()
      return normalized !== '' && !isVaultRefString(normalized)
    })

    if (hasPlaintextKeys) {
      settings = await migrateKeysToVault(settings)
      saveSettings(settings)
    }
  }

  const hydrated = await hydrateSettingsKeys(settings)
  cachedHydratedSettings = hydrated
  return hydrated
}

export function subscribeToSettings(listener: (settings: AppSettings) => void) {
  if (typeof window === 'undefined') {
    return () => undefined
  }

  const handleSettingsUpdated = (event: Event) => {
    const customEvent = event as CustomEvent<AppSettings>
    const base = customEvent.detail || loadSettings()
    hydrateSettingsKeys(base).then((hydrated) => {
      cachedHydratedSettings = hydrated
      listener(hydrated)
    }).catch((err) => {
      console.error('[settingsStore] Vault hydration failed, API keys may be unavailable:', err)
      cachedHydratedSettings = base
      listener(base)
    })
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== SETTINGS_STORAGE_KEY) {
      return
    }

    const base = loadSettings()
    hydrateSettingsKeys(base).then((hydrated) => {
      cachedHydratedSettings = hydrated
      listener(hydrated)
    }).catch((err) => {
      console.error('[settingsStore] Vault hydration failed, API keys may be unavailable:', err)
      cachedHydratedSettings = base
      listener(base)
    })
  }

  window.addEventListener(SETTINGS_UPDATED_EVENT, handleSettingsUpdated as EventListener)
  window.addEventListener('storage', handleStorage)

  return () => {
    window.removeEventListener(SETTINGS_UPDATED_EVENT, handleSettingsUpdated as EventListener)
    window.removeEventListener('storage', handleStorage)
  }
}
