import {
  isBrowserSpeechInputProvider,
  resolveSpeechInputModel,
} from '../../lib/audioProviders.ts'
import {
  switchSpeechInputProvider,
  switchSpeechOutputProvider,
  syncSpeechProviderProfiles,
} from '../../lib/speechProviderProfiles.ts'
import type { AppSettings, TranslationKey, TranslationParams } from '../../types'

type ShowPetStatus = (
  message: string,
  duration?: number,
  dedupeWindowMs?: number,
) => void

type Translator = (key: TranslationKey, params?: TranslationParams) => string

type SettingsRef = {
  current: AppSettings
}

export type EnsureSupportedSpeechInputSettingsRuntimeOptions = {
  announce?: boolean
  settingsRef: SettingsRef
  showPetStatus: ShowPetStatus
  ti: Translator
}

export type ApplySpeechOutputProviderFallbackRuntimeOptions = {
  providerId: string
  statusText?: string
  settingsRef: SettingsRef
  showPetStatus: ShowPetStatus
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
    options.showPetStatus(options.ti('voice.provider.browser.fallback_to_sensevoice'), 3_600, 4_500)
  }

  return nextSettings
}

function createSpeechOutputFallbackSettings(
  currentSettings: AppSettings,
  providerId: string,
) {
  return switchSpeechOutputProvider(currentSettings, providerId)
}

/**
 * Input-side counterpart: `ensureSupportedSpeechInputSettingsRuntime`.
 * Like it, a fallback only updates the runtime ref — never persisted
 * storage — so the next turn still starts from the user's configured
 * provider when the primary recovers.
 */
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
