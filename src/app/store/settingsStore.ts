import {
  SETTINGS_STORAGE_KEY,
  SETTINGS_UPDATED_EVENT,
  loadSettings,
  onStorageChange,
  saveSettings,
} from '../../lib/storage.ts'
import {
  dehydrateSettingsKeys,
  hydrateSettingsKeys,
  isVaultRefString,
  migrateKeysToVault,
} from '../../lib/keyVaultBridge.ts'
import { syncExternalActionPolicyToMain } from '../../features/integrations/externalActionPolicySync.ts'
import type { AppSettings } from '../../types/index.ts'

let vaultMigrationDone = false
let cachedHydratedSettings: AppSettings | null = null
let initializationPromise: Promise<AppSettings> | null = null
let pendingHydration: { key: string; promise: Promise<AppSettings> } | null = null
let settingsEventListenersInstalled = false
let unsubscribeSettingsStorageSync: (() => void) | null = null
const settingsListeners = new Set<(settings: AppSettings) => void>()

function settingsHydrationKey(settings: AppSettings): string {
  return JSON.stringify(settings)
}

function notifySettingsListeners(settings: AppSettings) {
  for (const listener of settingsListeners) {
    try {
      listener(settings)
    } catch {
      // Settings subscribers are independent React providers/controllers.
    }
  }
}

function syncMainProcessPermissionPolicy(settings: AppSettings) {
  syncExternalActionPolicyToMain(settings).catch((err) => {
    console.error('[settingsStore] Failed to sync external action policy:', err)
  })
}

function hydrateAndCacheSettings(base: AppSettings): Promise<AppSettings> {
  const key = settingsHydrationKey(base)
  if (pendingHydration?.key === key) {
    return pendingHydration.promise
  }

  const promise = hydrateSettingsKeys(base)
    .then((hydrated) => {
      cachedHydratedSettings = hydrated
      syncMainProcessPermissionPolicy(hydrated)
      return hydrated
    })
    .finally(() => {
      if (pendingHydration?.key === key) {
        pendingHydration = null
      }
    })

  pendingHydration = { key, promise }
  return promise
}

function handleExternalSettingsSnapshot(base: AppSettings) {
  hydrateAndCacheSettings(base)
    .then(notifySettingsListeners)
    .catch((err) => {
      console.error('[settingsStore] Vault hydration failed, API keys may be unavailable:', err)
      cachedHydratedSettings = base
      notifySettingsListeners(base)
    })
}

function handleSettingsUpdated(event: Event) {
  const customEvent = event as CustomEvent<AppSettings>
  handleExternalSettingsSnapshot(customEvent.detail || loadSettings())
}

function handleStorage(event: StorageEvent) {
  if (event.key !== SETTINGS_STORAGE_KEY) {
    return
  }

  handleExternalSettingsSnapshot(loadSettings())
}

function handleSettingsStorageSync(value: unknown) {
  const base =
    value && typeof value === 'object' && !Array.isArray(value)
      ? value as AppSettings
      : loadSettings()
  handleExternalSettingsSnapshot(base)
}

function installSettingsEventListeners() {
  if (settingsEventListenersInstalled || typeof window === 'undefined') return
  window.addEventListener(SETTINGS_UPDATED_EVENT, handleSettingsUpdated as EventListener)
  window.addEventListener('storage', handleStorage)
  unsubscribeSettingsStorageSync = onStorageChange(SETTINGS_STORAGE_KEY, handleSettingsStorageSync)
  settingsEventListenersInstalled = true
}

function removeSettingsEventListenersIfIdle() {
  if (!settingsEventListenersInstalled || typeof window === 'undefined') return
  if (settingsListeners.size > 0) return
  window.removeEventListener(SETTINGS_UPDATED_EVENT, handleSettingsUpdated as EventListener)
  window.removeEventListener('storage', handleStorage)
  unsubscribeSettingsStorageSync?.()
  unsubscribeSettingsStorageSync = null
  settingsEventListenersInstalled = false
}

export function getSettingsSnapshot(): AppSettings {
  if (cachedHydratedSettings) return cachedHydratedSettings
  const settings = loadSettings()
  cachedHydratedSettings = settings
  return settings
}

export async function setSettingsSnapshot(nextSettings: AppSettings) {
  cachedHydratedSettings = nextSettings
  pendingHydration = null
  syncMainProcessPermissionPolicy(nextSettings)
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
  if (initializationPromise) return initializationPromise

  initializationPromise = (async () => {
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

    return hydrateAndCacheSettings(settings)
  })()

  try {
    return await initializationPromise
  } finally {
    initializationPromise = null
  }
}

export function subscribeToSettings(listener: (settings: AppSettings) => void) {
  if (typeof window === 'undefined') {
    return () => undefined
  }

  settingsListeners.add(listener)
  installSettingsEventListeners()

  return () => {
    settingsListeners.delete(listener)
    removeSettingsEventListenersIfIdle()
  }
}
