import { getApiProviderPreset } from '../features/models/index.ts'
import { isHttpHeaderSafeCredential } from '../core/routing/AuthProfileStore.ts'
import type { AppSettings, TextProviderProfile } from '../types'

type PartialTextProviderProfile = Partial<TextProviderProfile> | null | undefined

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export function normalizeTextProviderApiKey(value: unknown) {
  const apiKey = normalizeString(value)
  return apiKey && isHttpHeaderSafeCredential(apiKey) ? apiKey : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function resolveTextProviderProfile(
  providerId: string,
  profile?: PartialTextProviderProfile,
): TextProviderProfile {
  const preset = getApiProviderPreset(providerId)

  return {
    apiBaseUrl: normalizeString(profile?.apiBaseUrl) || preset.baseUrl || '',
    apiKey: normalizeTextProviderApiKey(profile?.apiKey),
    model: normalizeString(profile?.model) || preset.defaultModel || '',
  }
}

export function readStoredTextProviderProfiles(value: unknown) {
  if (!isRecord(value)) {
    return {} as Record<string, TextProviderProfile>
  }

  return Object.entries(value).reduce<Record<string, TextProviderProfile>>(
    (accumulator, [providerId, profile]) => {
      accumulator[providerId] = resolveTextProviderProfile(
        providerId,
        profile as PartialTextProviderProfile,
      )
      return accumulator
    },
    {},
  )
}

export function syncTextProviderProfiles(settings: AppSettings): AppSettings {
  const textProviderProfiles = {
    ...readStoredTextProviderProfiles(settings.textProviderProfiles),
    [settings.apiProviderId]: resolveTextProviderProfile(settings.apiProviderId, {
      apiBaseUrl: settings.apiBaseUrl,
      apiKey: settings.apiKey,
      model: settings.model,
    }),
  }

  return {
    ...settings,
    textProviderProfiles,
  }
}

export function switchTextProvider(settings: AppSettings, providerId: string): AppSettings {
  const syncedSettings = syncTextProviderProfiles(settings)
  const nextProfile = resolveTextProviderProfile(
    providerId,
    syncedSettings.textProviderProfiles[providerId],
  )

  return {
    ...syncedSettings,
    apiProviderId: providerId,
    apiBaseUrl: nextProfile.apiBaseUrl,
    apiKey: nextProfile.apiKey,
    model: nextProfile.model,
  }
}
