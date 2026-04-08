import {
  getSpeechInputProviderPreset,
  getSpeechOutputProviderPreset,
  isBrowserSpeechInputProvider,
  isSenseVoiceSpeechInputProvider,
  normalizeSpeechOutputApiBaseUrl,
  resolveSpeechInputModel,
} from './audioProviders.ts'
import type {
  AppSettings,
  SpeechInputProviderProfile,
  SpeechOutputProviderProfile,
} from '../types'

type PartialSpeechInputProviderProfile = Partial<SpeechInputProviderProfile> | null | undefined
type PartialSpeechOutputProviderProfile = Partial<SpeechOutputProviderProfile> | null | undefined

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isLocalSpeechInputProvider(providerId: string) {
  return (
    isBrowserSpeechInputProvider(providerId)
    || isSenseVoiceSpeechInputProvider(providerId)
  )
}

function isLocalSpeechOutputProvider(providerId: string) {
  return providerId === 'cosyvoice-tts'
}

export function resolveSpeechInputProviderProfile(
  providerId: string,
  profile?: PartialSpeechInputProviderProfile,
): SpeechInputProviderProfile {
  const preset = getSpeechInputProviderPreset(providerId)
  const requestedModel = normalizeString(profile?.model) || preset.defaultModel

  return {
    apiBaseUrl: isLocalSpeechInputProvider(providerId)
      ? ''
      : (normalizeString(profile?.apiBaseUrl) || preset.baseUrl || ''),
    apiKey: isLocalSpeechInputProvider(providerId)
      ? ''
      : normalizeString(profile?.apiKey),
    model: resolveSpeechInputModel(providerId, requestedModel),
  }
}

export function resolveSpeechOutputProviderProfile(
  providerId: string,
  profile?: PartialSpeechOutputProviderProfile,
  options?: {
    clonedVoiceId?: string
  },
): SpeechOutputProviderProfile {
  const preset = getSpeechOutputProviderPreset(providerId)
  const requestedVoice = normalizeString(profile?.voice)
    || (
      providerId === 'elevenlabs-tts'
        ? normalizeString(options?.clonedVoiceId)
        : ''
    )
    || preset.defaultVoice
    || ''

  return {
    apiBaseUrl: isLocalSpeechOutputProvider(providerId)
      ? ''
      : normalizeSpeechOutputApiBaseUrl(
        providerId,
        normalizeString(profile?.apiBaseUrl) || preset.baseUrl || '',
      ),
    apiKey: isLocalSpeechOutputProvider(providerId)
      ? ''
      : normalizeString(profile?.apiKey),
    model: normalizeString(profile?.model) || preset.defaultModel || '',
    voice: requestedVoice,
    instructions: normalizeString(profile?.instructions),
  }
}

export function readStoredSpeechInputProviderProfiles(value: unknown) {
  if (!isRecord(value)) {
    return {}
  }

  return Object.entries(value).reduce<Record<string, SpeechInputProviderProfile>>((accumulator, [providerId, profile]) => {
    accumulator[providerId] = resolveSpeechInputProviderProfile(
      providerId,
      isRecord(profile) ? profile : undefined,
    )
    return accumulator
  }, {})
}

export function readStoredSpeechOutputProviderProfiles(
  value: unknown,
  options?: {
    clonedVoiceId?: string
  },
) {
  if (!isRecord(value)) {
    return {}
  }

  return Object.entries(value).reduce<Record<string, SpeechOutputProviderProfile>>((accumulator, [providerId, profile]) => {
    accumulator[providerId] = resolveSpeechOutputProviderProfile(
      providerId,
      isRecord(profile) ? profile : undefined,
      options,
    )
    return accumulator
  }, {})
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
    ...readStoredSpeechOutputProviderProfiles(settings.speechOutputProviderProfiles, {
      clonedVoiceId: settings.clonedVoiceId,
    }),
    [settings.speechOutputProviderId]: resolveSpeechOutputProviderProfile(
      settings.speechOutputProviderId,
      {
        apiBaseUrl: settings.speechOutputApiBaseUrl,
        apiKey: settings.speechOutputApiKey,
        model: settings.speechOutputModel,
        voice: settings.speechOutputVoice,
        instructions: settings.speechOutputInstructions,
      },
      {
        clonedVoiceId: settings.clonedVoiceId,
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
    {
      clonedVoiceId: syncedSettings.clonedVoiceId,
    },
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
    {
      clonedVoiceId: settings.clonedVoiceId,
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
