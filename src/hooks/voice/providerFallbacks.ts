import {
  isBrowserSpeechInputProvider,
  isQwen3TtsSpeechOutputProvider,
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

  // The local Qwen3 sidecar is optional infrastructure (Python venv + a 1.7B
  // checkpoint), so a reply must not go silent when it is missing or still
  // cold. This fallback is not tied to the cloud failover toggle: it is a
  // "this computer isn't ready" safety net, while the next reply still tries
  // Qwen3 first.
  if (isQwen3TtsSpeechOutputProvider(settings.speechOutputProviderId)) {
    providerIds.push('edge-tts')
  }

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

/**
 * Qwen3's local fallback is a safety net, not the cloud failover feature:
 * run it even when the cloud toggle is off as soon as a fallback candidate
 * exists. Everything else keeps the opt-in rule.
 *
 * @param {Pick<AppSettings, 'speechOutputProviderId' | 'speechOutputFailoverEnabled'>} settings
 * @param {number} candidateCount
 * @returns {boolean}
 */
export function shouldFailoverSpeechOutput(settings: AppSettings, candidateCount: number) {
  return settings.speechOutputFailoverEnabled
    || (isQwen3TtsSpeechOutputProvider(settings.speechOutputProviderId) && candidateCount > 1)
}

/**
 * One notice per app session when Qwen3 hands a reply to the previous voice.
 * Repeated failures must not stack toasts after every sentence.
 *
 * @returns {(notify: ShowPetStatus, ti: Translator) => boolean}
 */
export function createQwen3TtsFallbackNotice() {
  let announced = false
  return (notify: ShowPetStatus, ti: Translator) => {
    if (announced) return false
    announced = true
    notify(ti('voice.provider.qwen3-tts-local.fallback_notice'), 4_200, 6_000)
    return true
  }
}

// App-wide instance for the runtime paths (one notice per session).
const sharedQwen3TtsFallbackNotice = createQwen3TtsFallbackNotice()

/**
 * Show the "used your usual voice" notice at most once per app session.
 *
 * @param {ShowPetStatus} notify
 * @param {Translator} ti
 * @returns {boolean} whether this call actually showed the notice
 */
export function announceQwen3TtsFallback(notify: ShowPetStatus, ti: Translator) {
  return sharedQwen3TtsFallbackNotice(notify, ti)
}
