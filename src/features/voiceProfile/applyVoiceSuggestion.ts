/**
 * Turns a voice plan into settings, only when the user asks.
 *
 * Accepting a plan may switch the active STT/TTS provider. It does not
 * flip failover flags, so cloud speech is never enabled as a side effect.
 * Providers this build cannot run are refused and the settings object
 * comes back unchanged.
 */

import type { AppSettings } from '../../types/app.ts'
import {
  switchSpeechInputProvider,
  switchSpeechOutputProvider,
  updateCurrentSpeechInputProviderProfile,
  updateCurrentSpeechOutputProviderProfile,
} from '../../lib/speechProviderProfiles.ts'
import type { LanguageVoicePlan } from './selectVoiceProfile.ts'
import {
  EDGE_VOICE_BY_LANGUAGE,
  migrateVoiceLanguageValue,
  type VoiceLanguage,
} from './voiceLanguages.ts'

const APPLYABLE_STT = new Set(['local-sensevoice'])
const APPLYABLE_TTS = new Set(['edge-tts', 'local-tts'])

export type ApplyVoiceSuggestionOptions = {
  useOfflineAlternative?: boolean
}

function appliedTts(plan: LanguageVoicePlan, options?: ApplyVoiceSuggestionOptions) {
  if (options?.useOfflineAlternative && plan.offlineAlternative) {
    return {
      providerId: plan.offlineAlternative.providerId,
      model: plan.offlineAlternative.model,
      voice: plan.offlineAlternative.voice,
    }
  }
  return {
    providerId: plan.applied.ttsProviderId,
    model: plan.applied.ttsModel,
    voice: plan.applied.ttsVoice,
  }
}

/**
 * Write the plan into settings. Returns the same object when the plan
 * names a provider this build does not ship.
 */
export function applyVoiceSuggestion(
  settings: AppSettings,
  plan: LanguageVoicePlan,
  options?: ApplyVoiceSuggestionOptions,
): AppSettings {
  const tts = appliedTts(plan, options)
  if (!APPLYABLE_STT.has(plan.applied.sttProviderId) || !APPLYABLE_TTS.has(tts.providerId)) {
    return settings
  }

  let next = switchSpeechInputProvider(settings, plan.applied.sttProviderId)
  next = updateCurrentSpeechInputProviderProfile(next, { model: plan.applied.sttModel })
  next = switchSpeechOutputProvider(next, tts.providerId)
  next = updateCurrentSpeechOutputProviderProfile(next, {
    model: tts.model,
    voice: tts.voice,
  })
  return {
    ...next,
    speechRecognitionLang: plan.language,
    speechSynthesisLang: plan.language,
    speechInputFailoverEnabled: settings.speechInputFailoverEnabled,
    speechOutputFailoverEnabled: settings.speechOutputFailoverEnabled,
  }
}

export function voiceSuggestionChangesSettings(
  settings: Pick<AppSettings,
    'speechRecognitionLang' | 'speechSynthesisLang' | 'speechInputProviderId' |
    'speechInputModel' | 'speechOutputProviderId' | 'speechOutputModel' | 'speechOutputVoice'>,
  plan: LanguageVoicePlan,
  options?: ApplyVoiceSuggestionOptions,
): boolean {
  const tts = appliedTts(plan, options)
  return settings.speechRecognitionLang !== plan.language
    || settings.speechSynthesisLang !== plan.language
    || settings.speechInputProviderId !== plan.applied.sttProviderId
    || settings.speechInputModel !== plan.applied.sttModel
    || settings.speechOutputProviderId !== tts.providerId
    || settings.speechOutputModel !== tts.model
    || settings.speechOutputVoice !== tts.voice
}

const STOCK_EDGE_VOICES = new Set(Object.values(EDGE_VOICE_BY_LANGUAGE))

type StockVoiceDraft = {
  uiLanguage: string
  speechRecognitionLang: string
  speechSynthesisLang: string
  speechInputProviderId: string
  speechInputModel: string
  speechOutputProviderId: string
  speechOutputVoice: string
}

/**
 * True only for an untouched stock voice setup whose language still
 * says zh-CN while the UI language is something else. A custom provider,
 * voice, or language tag is left alone.
 */
export function shouldAlignStockVoiceLanguage(draft: StockVoiceDraft): boolean {
  if (draft.speechInputProviderId !== 'local-sensevoice') return false
  if (draft.speechOutputProviderId !== 'edge-tts') return false
  if (draft.speechInputModel && draft.speechInputModel !== 'sensevoice-zh-en') return false
  if (draft.speechOutputVoice && !STOCK_EDGE_VOICES.has(draft.speechOutputVoice)) return false
  const ui = migrateVoiceLanguageValue(draft.uiLanguage).canonical
  if (!ui) return false
  const recognition = migrateVoiceLanguageValue(draft.speechRecognitionLang)
  const synthesis = migrateVoiceLanguageValue(draft.speechSynthesisLang)
  const untouched = (field: { value: string, canonical: VoiceLanguage | null }) => (
    !field.value || field.canonical === 'zh-CN'
  )
  if (ui === 'zh-CN') return false
  if (!untouched(recognition) || !untouched(synthesis)) return false
  // Jenny or another stock Edge voice means the user already picked one.
  if (draft.speechOutputVoice && draft.speechOutputVoice !== EDGE_VOICE_BY_LANGUAGE['zh-CN']) return false
  return true
}
