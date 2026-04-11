import {
  isBrowserSpeechInputProvider,
  resolveSpeechInputModel,
} from '../../lib/audioProviders'
import {
  switchSpeechInputProvider,
  switchSpeechOutputProvider,
  syncSpeechProviderProfiles,
} from '../../lib/speechProviderProfiles'
import type { AppSettings } from '../../types'

type ShowPetStatus = (
  message: string,
  duration?: number,
  dedupeWindowMs?: number,
) => void

type SettingsRef = {
  current: AppSettings
}

export type EnsureSupportedSpeechInputSettingsRuntimeOptions = {
  announce?: boolean
  settingsRef: SettingsRef
  showPetStatus: ShowPetStatus
}

export type ApplySpeechInputProviderFallbackRuntimeOptions = {
  providerId: string
  statusText?: string
  settingsRef: SettingsRef
  showPetStatus: ShowPetStatus
}

export type ApplySpeechOutputProviderFallbackRuntimeOptions = {
  providerId: string
  statusText?: string
  settingsRef: SettingsRef
  showPetStatus: ShowPetStatus
}

export function createSpeechInputFallbackSettings(
  currentSettings: AppSettings,
  providerId: string,
) {
  return switchSpeechInputProvider(currentSettings, providerId)
}

export function ensureSupportedSpeechInputSettingsRuntime(
  options: EnsureSupportedSpeechInputSettingsRuntimeOptions,
) {
  const currentSettings = options.settingsRef.current
  const shouldNormalizeLegacyLocalProvider = isBrowserSpeechInputProvider(
    currentSettings.speechInputProviderId,
  )
  const nextProviderId = shouldNormalizeLegacyLocalProvider
    ? 'local-sensevoice'
    : currentSettings.speechInputProviderId
  const nextSpeechInputModel = resolveSpeechInputModel(
    nextProviderId,
    shouldNormalizeLegacyLocalProvider ? undefined : currentSettings.speechInputModel,
  )

  if (
    nextProviderId === currentSettings.speechInputProviderId
    && nextSpeechInputModel === currentSettings.speechInputModel
  ) {
    return syncSpeechProviderProfiles(currentSettings)
  }

  const nextSettings = switchSpeechInputProvider(currentSettings, nextProviderId)
  // Only update runtime ref — never persist automatic provider changes to storage.
  options.settingsRef.current = nextSettings

  if (options.announce && shouldNormalizeLegacyLocalProvider) {
    options.showPetStatus('当前环境不支持浏览器原生语音识别，已切换到 SenseVoice。', 3_600, 4_500)
  }

  return nextSettings
}

export function applySpeechInputProviderFallbackRuntime(
  options: ApplySpeechInputProviderFallbackRuntimeOptions,
) {
  const currentSettings = options.settingsRef.current
  const nextSettings = createSpeechInputFallbackSettings(currentSettings, options.providerId)

  // Only update the runtime ref, never persist fallback changes to storage.
  // The user's saved settings must remain untouched.
  options.settingsRef.current = nextSettings

  if (options.statusText) {
    options.showPetStatus(options.statusText, 3_600, 4_500)
  }

  return nextSettings
}

export function createSpeechOutputFallbackSettings(
  currentSettings: AppSettings,
  providerId: string,
) {
  return switchSpeechOutputProvider(currentSettings, providerId)
}

export function applySpeechOutputProviderFallbackRuntime(
  options: ApplySpeechOutputProviderFallbackRuntimeOptions,
) {
  const currentSettings = options.settingsRef.current
  const nextSettings = createSpeechOutputFallbackSettings(currentSettings, options.providerId)

  // Only update the runtime ref, never persist fallback changes to storage.
  options.settingsRef.current = nextSettings

  if (options.statusText) {
    options.showPetStatus(options.statusText, 3_600, 4_500)
  }

  return nextSettings
}

export function buildSpeechOutputFailoverCandidatesRuntime(settings: AppSettings) {
  const providerIds = [settings.speechOutputProviderId]

  if (settings.speechOutputFailoverEnabled) {
    if (settings.speechOutputProviderId !== 'omnivoice-tts') {
      providerIds.push('omnivoice-tts')
    }
  }

  const seen = new Set<string>()

  return providerIds
    .filter((providerId) => {
      if (seen.has(providerId)) {
        return false
      }
      seen.add(providerId)
      return true
    })
    .map((providerId) => createSpeechOutputFallbackSettings(settings, providerId))
}
