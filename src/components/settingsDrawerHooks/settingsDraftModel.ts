import type { PetModelDefinition } from '../../features/pet/index.ts'
import { clampPresenceIntervalMinutes } from '../../lib/settings.ts'
import type { AppSettings } from '../../types/index.ts'

type SettingsSecretField =
  | 'apiKey'
  | 'speechInputApiKey'
  | 'speechOutputApiKey'
  | 'toolWebSearchApiKey'
  | 'screenVlmApiKey'
  | 'telegramBotToken'
  | 'discordBotToken'

const SETTINGS_SECRET_FIELDS: readonly SettingsSecretField[] = [
  'apiKey',
  'speechInputApiKey',
  'speechOutputApiKey',
  'toolWebSearchApiKey',
  'screenVlmApiKey',
  'telegramBotToken',
  'discordBotToken',
]

export function buildSettingsSavePayload(draft: AppSettings): AppSettings {
  return {
    ...draft,
    proactivePresenceIntervalMinutes: clampPresenceIntervalMinutes(
      draft.proactivePresenceIntervalMinutes,
    ),
  }
}

export function mergeHydratedSettingsSecrets(
  current: AppSettings,
  incoming: AppSettings,
): AppSettings {
  let changed = false
  const patch = { ...current }

  for (const field of SETTINGS_SECRET_FIELDS) {
    if (!current[field] && incoming[field]) {
      ;(patch as Record<string, unknown>)[field] = incoming[field]
      changed = true
    }
  }

  return changed ? patch : current
}

export function ensureDraftPetModelPreset(
  current: AppSettings,
  petModelPresets: readonly Pick<PetModelDefinition, 'id'>[],
): AppSettings {
  if (!petModelPresets.length) return current
  if (petModelPresets.some((preset) => preset.id === current.petModelId)) return current

  return {
    ...current,
    petModelId: petModelPresets[0].id,
  }
}
