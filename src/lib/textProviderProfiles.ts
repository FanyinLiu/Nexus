import { getApiProviderPreset, type ApiProviderPreset } from '../features/models/index.ts'
import { isHttpHeaderSafeCredential } from '../core/routing/AuthProfileStore.ts'
import type { AppSettings, TextProviderProfile } from '../types'
import { normalizeString } from './normalize.ts'
import {
  readStoredProviderProfiles,
  resolveProviderProfile,
  type ResolveProviderProfileOptions,
} from './providerProfileResolve.ts'

type PartialTextProviderProfile = Partial<TextProviderProfile> | null | undefined

export function normalizeTextProviderApiKey(value: unknown) {
  const apiKey = normalizeString(value)
  return apiKey && isHttpHeaderSafeCredential(apiKey) ? apiKey : ''
}

const textProviderProfileResolveOptions: ResolveProviderProfileOptions<
  Partial<TextProviderProfile>,
  ApiProviderPreset
> = {
  getPreset: getApiProviderPreset,
  normalizeApiKey: normalizeTextProviderApiKey,
}

function resolveTextProviderProfile(
  providerId: string,
  profile?: PartialTextProviderProfile,
): TextProviderProfile {
  return resolveProviderProfile(providerId, profile, textProviderProfileResolveOptions)
}

export function readStoredTextProviderProfiles(value: unknown) {
  return readStoredProviderProfiles(value, resolveTextProviderProfile)
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
