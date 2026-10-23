import type { AppSettings } from '../types'
import { isVaultRef } from '../../shared/vaultRefs.js'
import { canUsePanelOnlyBridge } from './windowCapability.ts'

/**
 * Maps settings field names to vault slot names for API key encryption.
 * Only top-level string fields that hold secrets are listed here.
 * Provider profile keys are handled separately via dynamic slot names.
 */
const SETTINGS_KEY_FIELDS: readonly (keyof AppSettings)[] = [
  'apiKey',
  'speechInputApiKey',
  'speechOutputApiKey',
  'toolWebSearchApiKey',
  'screenVlmApiKey',
  'telegramBotToken',
  'discordBotToken',
] as const

const VAULT_SLOT_PREFIX = 'settings:'
const PROFILE_SLOT_PREFIX = 'profile:'
// Single-sourced in shared/vaultRefs.js (mirrored by electron/services/vaultRefs.js).
/** @public kept exported for the vault security audit contract (scripts/vault-security-audit.mjs). */
export { VAULT_REF_PREFIX } from '../../shared/vaultRefs.js'

function settingsSlot(field: string) {
  return `${VAULT_SLOT_PREFIX}${field}`
}

function profileSlot(category: string, providerId: string) {
  return `${PROFILE_SLOT_PREFIX}${category}:${providerId}:apiKey`
}

export function isVaultRefString(value: unknown): boolean {
  return isVaultRef(value)
}

/**
 * Secret input fields should keep the underlying vault ref in state, but
 * never render the opaque token string back to users.
 */
export function displaySecretInputValue(value: unknown): string {
  if (isVaultRefString(value)) return ''
  return typeof value === 'string' ? value : ''
}

function isDesktopEnvironment(): boolean {
  return typeof window !== 'undefined' && window.desktopPet?.vaultStore != null
}

/**
 * Vault IPC is panel-only. Reading it from the pet window is always rejected,
 * so its settings hydration must fall back to the stripped local snapshot.
 */
async function canUseDesktopVault(): Promise<boolean> {
  if (!isDesktopEnvironment()) return false
  return canUsePanelOnlyBridge()
}

/**
 * Migrate plaintext keys from a loaded settings object into the vault,
 * then return a copy with key fields cleared.
 *
 * Call once on first load when vault is empty but localStorage has keys.
 */
export async function migrateKeysToVault(settings: AppSettings): Promise<AppSettings> {
  if (!(await canUseDesktopVault())) return settings

  const entries: Record<string, string> = {}

  for (const field of SETTINGS_KEY_FIELDS) {
    const value = settings[field]
    if (typeof value === 'string' && value && value !== '' && !isVaultRefString(value)) {
      entries[settingsSlot(field)] = value
    }
  }

  collectProfileKeys(entries, 'text', settings.textProviderProfiles)
  collectProfileKeys(entries, 'speechInput', settings.speechInputProviderProfiles)
  collectProfileKeys(entries, 'speechOutput', settings.speechOutputProviderProfiles)

  if (Object.keys(entries).length > 0) {
    await window.desktopPet!.vaultStoreMany(entries)
  }

  return stripKeys(settings)
}

/**
 * Fill in API key fields by reading from the vault.
 * Used after loadSettings() to hydrate the in-memory settings object.
 */
export async function hydrateSettingsKeys(settings: AppSettings): Promise<AppSettings> {
  if (!(await canUseDesktopVault())) return settings

  const slots = SETTINGS_KEY_FIELDS.map((f) => settingsSlot(f))
  const profileSlots = collectProfileSlots(settings)
  const allSlots = [...slots, ...profileSlots.map((s) => s.slot)]

  if (allSlots.length === 0) return settings

  const values = await window.desktopPet!.vaultRetrieveMany(allSlots)
  const hydrated = { ...settings }

  for (const field of SETTINGS_KEY_FIELDS) {
    const val = values[settingsSlot(field)]
    if (val) {
      ;(hydrated as Record<string, unknown>)[field] = val
    }
  }

  hydrateProfileKeys(hydrated.textProviderProfiles, 'text', values)
  hydrateProfileKeys(hydrated.speechInputProviderProfiles, 'speechInput', values)
  hydrateProfileKeys(hydrated.speechOutputProviderProfiles, 'speechOutput', values)

  return hydrated
}

/**
 * Store API key fields in the vault and return a copy with key fields cleared.
 * Used before saveSettings() to strip secrets from localStorage.
 */
export async function dehydrateSettingsKeys(settings: AppSettings): Promise<AppSettings> {
  if (!(await canUseDesktopVault())) return settings

  const entries: Record<string, string> = {}

  for (const field of SETTINGS_KEY_FIELDS) {
    const value = settings[field]
    // Only write non-empty keys to vault.
    // If a key field is empty (already stripped), skip it to avoid
    // deleting the existing vault slot on restart.
    if (typeof value === 'string' && value !== '' && !isVaultRefString(value)) {
      entries[settingsSlot(field)] = value
    }
  }

  collectProfileKeys(entries, 'text', settings.textProviderProfiles)
  collectProfileKeys(entries, 'speechInput', settings.speechInputProviderProfiles)
  collectProfileKeys(entries, 'speechOutput', settings.speechOutputProviderProfiles)

  if (Object.keys(entries).length > 0) {
    await window.desktopPet!.vaultStoreMany(entries)
  }

  return stripKeys(settings)
}

/**
 * Overlay the secrets already decrypted in this window onto a persisted
 * snapshot that was written without touching the vault. The persisted copy is
 * stripped, so this is what keeps the committed in-memory settings usable
 * after a non-secret write that deliberately skipped vault hydration.
 */
export function carryHydratedSettingsSecrets(
  persisted: AppSettings,
  hydrated: AppSettings | null | undefined,
): AppSettings {
  if (!hydrated) return persisted

  const merged = { ...persisted }

  for (const field of SETTINGS_KEY_FIELDS) {
    const secret = hydrated[field]
    if (typeof secret === 'string' && secret !== '' && !isVaultRefString(secret)) {
      ;(merged as Record<string, unknown>)[field] = secret
    }
  }

  merged.textProviderProfiles = carryProfileApiKeys(persisted.textProviderProfiles, hydrated.textProviderProfiles)
  merged.speechInputProviderProfiles = carryProfileApiKeys(
    persisted.speechInputProviderProfiles,
    hydrated.speechInputProviderProfiles,
  )
  merged.speechOutputProviderProfiles = carryProfileApiKeys(
    persisted.speechOutputProviderProfiles,
    hydrated.speechOutputProviderProfiles,
  )

  return merged
}

function carryProfileApiKeys<T extends Record<string, { apiKey?: string }>>(
  persisted: T,
  hydrated: T,
): T {
  const result: Record<string, { apiKey?: string }> = {}

  for (const [providerId, profile] of Object.entries(persisted)) {
    const secret = hydrated[providerId]?.apiKey
    result[providerId] = typeof secret === 'string' && secret !== '' && !isVaultRefString(secret)
      ? { ...profile, apiKey: secret }
      : profile
  }

  return result as T
}

function stripKeys(settings: AppSettings): AppSettings {
  const stripped = { ...settings }

  for (const field of SETTINGS_KEY_FIELDS) {
    ;(stripped as Record<string, unknown>)[field] = ''
  }

  stripped.textProviderProfiles = stripProfileApiKeys(settings.textProviderProfiles)
  stripped.speechInputProviderProfiles = stripProfileApiKeys(settings.speechInputProviderProfiles)
  stripped.speechOutputProviderProfiles = stripProfileApiKeys(settings.speechOutputProviderProfiles)

  return stripped
}

function collectProfileKeys(
  entries: Record<string, string>,
  category: string,
  profiles: Record<string, { apiKey?: string }>,
) {
  for (const [providerId, profile] of Object.entries(profiles)) {
    if (profile.apiKey && !isVaultRefString(profile.apiKey)) {
      entries[profileSlot(category, providerId)] = profile.apiKey
    }
  }
}

function collectProfileSlots(settings: AppSettings) {
  const slots: { slot: string; category: string; providerId: string }[] = []

  for (const providerId of Object.keys(settings.textProviderProfiles)) {
    slots.push({ slot: profileSlot('text', providerId), category: 'text', providerId })
  }

  for (const providerId of Object.keys(settings.speechInputProviderProfiles)) {
    slots.push({ slot: profileSlot('speechInput', providerId), category: 'speechInput', providerId })
  }

  for (const providerId of Object.keys(settings.speechOutputProviderProfiles)) {
    slots.push({ slot: profileSlot('speechOutput', providerId), category: 'speechOutput', providerId })
  }

  return slots
}

function hydrateProfileKeys(
  profiles: Record<string, { apiKey?: string }>,
  category: string,
  values: Record<string, string>,
) {
  for (const providerId of Object.keys(profiles)) {
    const val = values[profileSlot(category, providerId)]
    if (val) {
      profiles[providerId] = { ...profiles[providerId], apiKey: val }
    }
  }
}

function stripProfileApiKeys<T extends Record<string, { apiKey?: string }>>(profiles: T): T {
  const result = {} as Record<string, unknown>

  for (const [providerId, profile] of Object.entries(profiles)) {
    result[providerId] = { ...profile, apiKey: '' }
  }

  return result as T
}
