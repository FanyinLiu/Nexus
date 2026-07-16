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
import { getRedactedLogErrorMessage } from '../../lib/logRedaction.ts'
import type { AppSettings } from '../../types/index.ts'
import { withSettingsMutationLock } from './settingsMutationLock.ts'

let vaultMigrationDone = false
let cachedHydratedSettings: AppSettings | null = null
let initializationPromise: Promise<AppSettings> | null = null
let pendingHydration: { key: string; promise: Promise<AppSettings> } | null = null
let settingsEventListenersInstalled = false
let unsubscribeSettingsStorageSync: (() => void) | null = null
let settingsStorageSyncMode: 'broadcast' | 'native' | null = null
const settingsListeners = new Set<(settings: AppSettings) => void>()
type SettingsUpdater = (current: AppSettings) => AppSettings
type SettingsCommitCallback = (settings: AppSettings) => void

let settingsMutationQueue: Promise<unknown> = Promise.resolve()
let settingsCommitGeneration = 0
let pendingPolicySettings: AppSettings | null = null
let policyDrainRunning = false

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

function enqueueSettingsTask<T>(task: () => Promise<T>): Promise<T> {
  const operation = settingsMutationQueue.then(task)
  settingsMutationQueue = operation.then(() => undefined, () => undefined)
  return operation
}

async function drainPermissionPolicyQueue(): Promise<void> {
  try {
    while (pendingPolicySettings) {
      const settings = pendingPolicySettings
      pendingPolicySettings = null
      try {
        await syncExternalActionPolicyToMain(settings)
      } catch (err) {
        console.error('[settingsStore] Failed to sync external action policy:', getRedactedLogErrorMessage(err))
      }
    }
  } finally {
    policyDrainRunning = false
    if (pendingPolicySettings) {
      policyDrainRunning = true
      void drainPermissionPolicyQueue()
    }
  }
}

function syncMainProcessPermissionPolicy(settings: AppSettings): void {
  pendingPolicySettings = settings
  if (policyDrainRunning) return
  policyDrainRunning = true
  void drainPermissionPolicyQueue()
}

function commitSettingsCache(settings: AppSettings): AppSettings {
  cachedHydratedSettings = settings
  pendingHydration = null
  settingsCommitGeneration += 1
  syncMainProcessPermissionPolicy(settings)
  return settings
}

function hasDesktopVault(): boolean {
  return typeof window !== 'undefined' && window.desktopPet?.vaultStore != null
}

const SETTINGS_SECRET_FIELDS = [
  'apiKey',
  'speechInputApiKey',
  'speechOutputApiKey',
  'toolWebSearchApiKey',
  'screenVlmApiKey',
  'telegramBotToken',
  'discordBotToken',
] as const

const SETTINGS_PROFILE_FIELDS = [
  'textProviderProfiles',
  'speechInputProviderProfiles',
  'speechOutputProviderProfiles',
] as const

function settingsPersistenceComparable(settings: AppSettings): string {
  const comparable = { ...settings } as Record<string, unknown>
  for (const field of SETTINGS_SECRET_FIELDS) {
    comparable[field] = ''
  }
  for (const field of SETTINGS_PROFILE_FIELDS) {
    const profiles = settings[field] as Record<string, { apiKey?: string }>
    comparable[field] = Object.fromEntries(
      Object.entries(profiles).map(([providerId, profile]) => [
        providerId,
        { ...profile, apiKey: '' },
      ]),
    )
  }
  return JSON.stringify(comparable)
}

function settingsMatchPersistedSnapshot(cached: AppSettings, persisted: AppSettings): boolean {
  return settingsPersistenceComparable(cached) === settingsPersistenceComparable(persisted)
}

function hydrateAndCacheSettings(base: AppSettings): Promise<AppSettings> {
  const key = settingsHydrationKey(base)
  if (pendingHydration?.key === key) {
    return pendingHydration.promise
  }

  const promise = hydrateSettingsKeys(base)
    .then((hydrated) => {
      return commitSettingsCache(hydrated)
    })
    .finally(() => {
      if (pendingHydration?.key === key) {
        pendingHydration = null
      }
    })

  pendingHydration = { key, promise }
  return promise
}

function handleExternalSettingsSnapshot(readLatest: () => AppSettings): Promise<AppSettings> {
  return enqueueSettingsTask(() => withSettingsMutationLock(async () => {
    // Read only after the renderer queue and shared lock are both acquired.
    // Event payloads can be stale while another window is committing.
    const base = readLatest()
    try {
      const hydrated = await hydrateAndCacheSettings(base)
      notifySettingsListeners(hydrated)
      return hydrated
    } catch (err) {
      console.error('[settingsStore] Vault hydration failed, API keys may be unavailable:', getRedactedLogErrorMessage(err))
      const committed = commitSettingsCache(base)
      notifySettingsListeners(committed)
      return committed
    }
  }))
}

function handleSettingsUpdated(event: Event) {
  void event
  handleExternalSettingsSnapshot(() => loadSettings())
}

function handleStorage(event: StorageEvent) {
  if (event.key !== SETTINGS_STORAGE_KEY) {
    return
  }

  handleExternalSettingsSnapshot(() => loadSettings())
}

function handleSettingsStorageSync(value: unknown) {
  // The event value can be older than a local commit by the time this
  // callback runs. Always re-read the shared persisted snapshot.
  void value
  handleExternalSettingsSnapshot(() => loadSettings())
}

function installSettingsEventListeners() {
  if (settingsEventListenersInstalled || typeof window === 'undefined') return
  window.addEventListener(SETTINGS_UPDATED_EVENT, handleSettingsUpdated as EventListener)
  if (typeof BroadcastChannel !== 'undefined') {
    settingsStorageSyncMode = 'broadcast'
    unsubscribeSettingsStorageSync = onStorageChange(SETTINGS_STORAGE_KEY, handleSettingsStorageSync)
  } else {
    settingsStorageSyncMode = 'native'
    window.addEventListener('storage', handleStorage)
  }
  settingsEventListenersInstalled = true
}

function removeSettingsEventListenersIfIdle() {
  if (!settingsEventListenersInstalled || typeof window === 'undefined') return
  if (settingsListeners.size > 0) return
  window.removeEventListener(SETTINGS_UPDATED_EVENT, handleSettingsUpdated as EventListener)
  if (settingsStorageSyncMode === 'broadcast') {
    unsubscribeSettingsStorageSync?.()
    unsubscribeSettingsStorageSync = null
  } else if (settingsStorageSyncMode === 'native') {
    window.removeEventListener('storage', handleStorage)
  }
  unsubscribeSettingsStorageSync = null
  settingsStorageSyncMode = null
  settingsEventListenersInstalled = false
}

export function getSettingsSnapshot(): AppSettings {
  if (cachedHydratedSettings) return cachedHydratedSettings
  const settings = loadSettings()
  cachedHydratedSettings = settings
  return settings
}

async function runLocalSettingsMutation(
  updater: SettingsUpdater,
  onCommit?: SettingsCommitCallback,
): Promise<AppSettings> {
  return withSettingsMutationLock(async () => {
    const previousCached = cachedHydratedSettings
    const previousGeneration = settingsCommitGeneration
    const latestPersisted = loadSettings()
    const previous = previousCached ?? latestPersisted

    try {
      // This preflight is intentionally identity-only. If the persisted
      // non-secret snapshot still matches the local cache, a true identity
      // no-op can return without touching vault/localStorage or policy. Any
      // real mutation is re-evaluated against the authoritative hydrated
      // snapshot below because updater functions are pure.
      if (settingsMatchPersistedSnapshot(previous, latestPersisted)) {
        const preflightNext = updater(previous)
        if (Object.is(preflightNext, previous)) {
          onCommit?.(previous)
          return previous
        }
      }

      let authoritative = latestPersisted
      if (hasDesktopVault()) {
        try {
          authoritative = await hydrateSettingsKeys(latestPersisted)
        } catch (err) {
          console.error(
            '[settingsStore] Latest settings hydration failed; settings mutation aborted:',
            getRedactedLogErrorMessage(err),
          )
          throw err
        }
      }

      const nextSettings = updater(authoritative)
      if (Object.is(nextSettings, authoritative)) {
        if (previousCached && !Object.is(previousCached, authoritative)) {
          const committed = commitSettingsCache(authoritative)
          notifySettingsListeners(committed)
          onCommit?.(committed)
          return committed
        }
        onCommit?.(authoritative)
        return authoritative
      }

      pendingHydration = null
      // Dehydrate keys to vault first, then write stripped settings to localStorage.
      // Only one write — never persists plaintext keys.
      const stripped = hasDesktopVault()
        ? await dehydrateSettingsKeys(nextSettings)
        : nextSettings
      // The local renderer hydrates the persisted result explicitly below. The
      // silent write keeps this window's CustomEvent path from processing the same
      // save a second time while writeJson still broadcasts to peer windows.
      saveSettings(stripped, { silent: true })

      let committed: AppSettings
      try {
        committed = hasDesktopVault()
          ? await hydrateSettingsKeys(loadSettings())
          : loadSettings()
      } catch (err) {
        console.error(
          '[settingsStore] Persisted settings hydration failed; using in-memory settings:',
          getRedactedLogErrorMessage(err),
        )
        committed = nextSettings
      }

      commitSettingsCache(committed)
      notifySettingsListeners(committed)
      onCommit?.(committed)
      return committed
    } catch (err) {
      if (settingsCommitGeneration === previousGeneration) {
        cachedHydratedSettings = previousCached
        pendingHydration = null
      }
      throw err
    }
  })
}

export function updateSettingsSnapshot(
  updater: SettingsUpdater,
  onCommit?: SettingsCommitCallback,
): Promise<AppSettings> {
  return enqueueSettingsTask(() => runLocalSettingsMutation(updater, onCommit))
}

function applyDraftChanges(
  current: AppSettings,
  baseline: AppSettings,
  draft: AppSettings,
): AppSettings {
  let next: AppSettings | null = null
  for (const key of Object.keys(draft) as (keyof AppSettings)[]) {
    if (Object.is(baseline[key], draft[key]) || Object.is(current[key], draft[key])) continue
    next ??= { ...current }
    ;(next as unknown as Record<string, unknown>)[key] = draft[key]
  }
  return next ?? current
}

export function updateSettingsFromDraft(
  baseline: AppSettings,
  draft: AppSettings,
  onCommit?: SettingsCommitCallback,
): Promise<AppSettings> {
  return updateSettingsSnapshot(
    (current) => applyDraftChanges(current, baseline, draft),
    onCommit,
  )
}

export function setSettingsSnapshot(nextSettings: AppSettings): Promise<AppSettings> {
  return updateSettingsSnapshot(() => nextSettings)
}

/**
 * Async initialization: migrate plaintext keys to vault on first run,
 * then hydrate the settings object with decrypted keys from vault.
 */
export async function initializeSettingsWithVault(): Promise<AppSettings> {
  if (initializationPromise) return initializationPromise

  initializationPromise = enqueueSettingsTask(() => withSettingsMutationLock(async () => {
    // Initialization participates in the same cross-window authority as a
    // normal mutation. Never start from this renderer's cached snapshot.
    let settings = loadSettings()

    if (!vaultMigrationDone) {
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

      // Set this only after migration (if any) has succeeded. A failed vault
      // write must leave the next initialization attempt eligible to retry.
      vaultMigrationDone = true
    }

    return hydrateAndCacheSettings(settings)
  }))

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
