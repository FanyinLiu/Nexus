import {
  getSpeechInputProviderPreset,
  getSpeechOutputProviderPreset,
  isBrowserSpeechInputProvider,
  isParaformerSpeechInputProvider,
  isSenseVoiceSpeechInputProvider,
  normalizeSpeechOutputApiBaseUrl,
  resolveSpeechInputModel,
  type SpeechInputProviderPreset,
  type SpeechOutputProviderPreset,
} from './audioProviders.ts'
import type {
  AppSettings,
  SpeechInputProviderProfile,
  SpeechOutputProviderProfile,
} from '../types'
import { normalizeString } from './normalize.ts'
import {
  readStoredProviderProfiles,
  resolveProviderProfile,
  type ResolveProviderProfileOptions,
} from './providerProfileResolve.ts'

type PartialSpeechInputProviderProfile = Partial<SpeechInputProviderProfile> | null | undefined
type PartialSpeechOutputProviderProfile = Partial<SpeechOutputProviderProfile> | null | undefined

function isLocalSpeechInputProvider(providerId: string) {
  return (
    isBrowserSpeechInputProvider(providerId)
    || isSenseVoiceSpeechInputProvider(providerId)
    || isParaformerSpeechInputProvider(providerId)
  )
}

function isLocalSpeechOutputProvider(providerId: string) {
  return providerId === 'omnivoice-tts'
}

const speechInputProfileResolveOptions: ResolveProviderProfileOptions<
  Partial<SpeechInputProviderProfile>,
  SpeechInputProviderPreset
> = {
  getPreset: getSpeechInputProviderPreset,
  isLocal: isLocalSpeechInputProvider,
  resolveModel: resolveSpeechInputModel,
}

const speechOutputProfileResolveOptions: ResolveProviderProfileOptions<
  Partial<SpeechOutputProviderProfile>,
  SpeechOutputProviderPreset,
  { voice: string, instructions: string }
> = {
  getPreset: getSpeechOutputProviderPreset,
  isLocal: isLocalSpeechOutputProvider,
  normalizeApiBaseUrl: normalizeSpeechOutputApiBaseUrl,
  resolveExtra: (stored, preset) => ({
    voice: normalizeString(stored?.voice) || preset.defaultVoice || '',
    instructions: normalizeString(stored?.instructions),
  }),
}

function resolveSpeechInputProviderProfile(
  providerId: string,
  profile?: PartialSpeechInputProviderProfile,
): SpeechInputProviderProfile {
  return resolveProviderProfile(providerId, profile, speechInputProfileResolveOptions)
}

function resolveSpeechOutputProviderProfile(
  providerId: string,
  profile?: PartialSpeechOutputProviderProfile,
): SpeechOutputProviderProfile {
  return resolveProviderProfile(providerId, profile, speechOutputProfileResolveOptions)
}

export function readStoredSpeechInputProviderProfiles(value: unknown) {
  return readStoredProviderProfiles(value, resolveSpeechInputProviderProfile)
}

export function readStoredSpeechOutputProviderProfiles(value: unknown) {
  return readStoredProviderProfiles(value, resolveSpeechOutputProviderProfile)
}

export function syncSpeechProviderProfiles(settings: AppSettings): AppSettings {
  const speechInputProviderProfiles = {
    ...readStoredSpeechInputProviderProfiles(settings.speechInputProviderProfiles),
    [settings.speechInputProviderId]: resolveSpeechInputProviderProfile(
      settings.speechInputProviderId,
      {
        apiBaseUrl: settings.speechInputApiBaseUrl,
        apiKey: settings.speechInputApiKey,
        model: settings.speechInputModel,
      },
    ),
  }
  const speechOutputProviderProfiles = {
    ...readStoredSpeechOutputProviderProfiles(settings.speechOutputProviderProfiles),
    [settings.speechOutputProviderId]: resolveSpeechOutputProviderProfile(
      settings.speechOutputProviderId,
      {
        apiBaseUrl: settings.speechOutputApiBaseUrl,
        apiKey: settings.speechOutputApiKey,
        model: settings.speechOutputModel,
        voice: settings.speechOutputVoice,
        instructions: settings.speechOutputInstructions,
      },
    ),
  }

  return {
    ...settings,
    speechInputProviderProfiles,
    speechOutputProviderProfiles,
  }
}

export function switchSpeechInputProvider(settings: AppSettings, providerId: string): AppSettings {
  const syncedSettings = syncSpeechProviderProfiles(settings)
  const nextProfile = resolveSpeechInputProviderProfile(
    providerId,
    syncedSettings.speechInputProviderProfiles[providerId],
  )

  return {
    ...syncedSettings,
    speechInputProviderId: providerId,
    speechInputApiBaseUrl: nextProfile.apiBaseUrl,
    speechInputApiKey: nextProfile.apiKey,
    speechInputModel: nextProfile.model,
  }
}

export function switchSpeechOutputProvider(settings: AppSettings, providerId: string): AppSettings {
  const syncedSettings = syncSpeechProviderProfiles(settings)
  const nextProfile = resolveSpeechOutputProviderProfile(
    providerId,
    syncedSettings.speechOutputProviderProfiles[providerId],
  )

  return {
    ...syncedSettings,
    speechOutputProviderId: providerId,
    speechOutputApiBaseUrl: nextProfile.apiBaseUrl,
    speechOutputApiKey: nextProfile.apiKey,
    speechOutputModel: nextProfile.model,
    speechOutputVoice: nextProfile.voice,
    speechOutputInstructions: nextProfile.instructions,
  }
}

export function updateCurrentSpeechInputProviderProfile(
  settings: AppSettings,
  updates: PartialSpeechInputProviderProfile,
): AppSettings {
  const providerId = settings.speechInputProviderId
  const nextProfile = resolveSpeechInputProviderProfile(
    providerId,
    {
      ...settings.speechInputProviderProfiles?.[providerId],
      apiBaseUrl: settings.speechInputApiBaseUrl,
      apiKey: settings.speechInputApiKey,
      model: settings.speechInputModel,
      ...updates,
    },
  )

  return {
    ...settings,
    speechInputApiBaseUrl: nextProfile.apiBaseUrl,
    speechInputApiKey: nextProfile.apiKey,
    speechInputModel: nextProfile.model,
    speechInputProviderProfiles: {
      ...settings.speechInputProviderProfiles,
      [providerId]: nextProfile,
    },
  }
}

export function updateCurrentSpeechOutputProviderProfile(
  settings: AppSettings,
  updates: PartialSpeechOutputProviderProfile,
): AppSettings {
  const providerId = settings.speechOutputProviderId
  const nextProfile = resolveSpeechOutputProviderProfile(
    providerId,
    {
      ...settings.speechOutputProviderProfiles?.[providerId],
      apiBaseUrl: settings.speechOutputApiBaseUrl,
      apiKey: settings.speechOutputApiKey,
      model: settings.speechOutputModel,
      voice: settings.speechOutputVoice,
      instructions: settings.speechOutputInstructions,
      ...updates,
    },
  )

  return {
    ...settings,
    speechOutputApiBaseUrl: nextProfile.apiBaseUrl,
    speechOutputApiKey: nextProfile.apiKey,
    speechOutputModel: nextProfile.model,
    speechOutputVoice: nextProfile.voice,
    speechOutputInstructions: nextProfile.instructions,
    speechOutputProviderProfiles: {
      ...settings.speechOutputProviderProfiles,
      [providerId]: nextProfile,
    },
  }
}
