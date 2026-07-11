import {
  getSpeechInputModelOptions,
  getSpeechInputProviderPreset,
  getSpeechOutputAdjustmentSupport,
  getSpeechOutputModelOptions,
  getSpeechOutputProviderPreset,
  getSpeechOutputStyleOptions,
  isEdgeTtsSpeechOutputProvider,
  isMiniMaxSpeechOutputProvider,
  isSenseVoiceSpeechInputProvider,
  isSpeechInputLocal,
  isSpeechOutputKeyless,
  isVolcengineSpeechInputProvider,
  isVolcengineSpeechOutputProvider,
  supportsCustomSpeechOutputVoiceId,
  type SpeechInputProviderPreset,
  type SpeechOutputProviderPreset,
} from '../../lib/audioProviders.ts'
import {
  SPEECH_INPUT_PROVIDERS,
  SPEECH_OUTPUT_PROVIDERS,
  type SpeechModelOption,
  type SpeechOutputAdjustmentSupport,
  type SpeechStyleOption,
} from '../../lib/speechProviderCatalog.ts'
import type {
  AppSettings,
  ServiceConnectionRequest,
  TranslationKey,
} from '../../types'

const CJK_CHAR_REGEX = /[\u3400-\u9fff]/
const ASCII_LETTER_REGEX = /[A-Za-z]/

export type SpeechProviderSelectOption = {
  id: string
  label: TranslationKey
}

export type SpeechInputSettingsView = {
  provider: SpeechInputProviderPreset
  providerOptions: SpeechProviderSelectOption[]
  modelOptions: SpeechModelOption[]
  isSenseVoice: boolean
  isLocal: boolean
  isVolcengine: boolean
  showBaseUrl: boolean
  showCredentials: boolean
  modelLabelKey: TranslationKey
  modelHintKey: TranslationKey | null
}

export type SpeechOutputSettingsView = {
  provider: SpeechOutputProviderPreset
  providerOptions: SpeechProviderSelectOption[]
  adjustmentSupport: SpeechOutputAdjustmentSupport
  modelOptions: SpeechModelOption[]
  styleOptions: SpeechStyleOption[]
  isMiniMax: boolean
  isVolcengine: boolean
  isEdgeTts: boolean
  hideCredentials: boolean
  showEndpoint: boolean
  showCustomVoiceInput: boolean
  modelLabelKey: TranslationKey
  voiceLabelKey: TranslationKey
}

export function getSpeechInputProviderOptions(): SpeechProviderSelectOption[] {
  return SPEECH_INPUT_PROVIDERS
    .filter((provider) => !provider.hidden)
    .map((provider) => ({ id: provider.id, label: provider.label }))
}

export function getSpeechOutputProviderOptions(): SpeechProviderSelectOption[] {
  return SPEECH_OUTPUT_PROVIDERS
    .filter((provider) => !provider.hidden)
    .map((provider) => ({ id: provider.id, label: provider.label }))
}

export function isWakeWordSupported(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return true
  // Chinese: handled by pinyin-based keyword generation in main process.
  // English: handled by runtime BPE encoding via sherpa-onnx's bpeVocab path.
  return CJK_CHAR_REGEX.test(trimmed) || ASCII_LETTER_REGEX.test(trimmed)
}

export function resolveSpeechInputSettingsView(settings: Pick<AppSettings, 'speechInputProviderId'>): SpeechInputSettingsView {
  const provider = getSpeechInputProviderPreset(settings.speechInputProviderId)
  const isSenseVoice = isSenseVoiceSpeechInputProvider(settings.speechInputProviderId)
  const isLocal = isSpeechInputLocal(settings.speechInputProviderId)

  return {
    provider,
    providerOptions: getSpeechInputProviderOptions(),
    modelOptions: getSpeechInputModelOptions(settings.speechInputProviderId),
    isSenseVoice,
    isLocal,
    isVolcengine: isVolcengineSpeechInputProvider(settings.speechInputProviderId),
    showBaseUrl: !isLocal || !!provider.baseUrl,
    showCredentials: !isLocal,
    modelLabelKey: isSenseVoice
      ? 'settings.speech_input.sense_voice_model'
      : 'settings.speech_input.model',
    modelHintKey: isSenseVoice
      ? 'settings.speech_input.sense_voice_hint'
      : null,
  }
}

export function resolveSpeechOutputSettingsView(settings: Pick<AppSettings, 'speechOutputProviderId'>): SpeechOutputSettingsView {
  const provider = getSpeechOutputProviderPreset(settings.speechOutputProviderId)
  const isVolcengine = isVolcengineSpeechOutputProvider(settings.speechOutputProviderId)
  const isEdgeTts = isEdgeTtsSpeechOutputProvider(settings.speechOutputProviderId)

  return {
    provider,
    providerOptions: getSpeechOutputProviderOptions(),
    adjustmentSupport: getSpeechOutputAdjustmentSupport(settings.speechOutputProviderId),
    modelOptions: getSpeechOutputModelOptions(settings.speechOutputProviderId),
    styleOptions: getSpeechOutputStyleOptions(settings.speechOutputProviderId),
    isMiniMax: isMiniMaxSpeechOutputProvider(settings.speechOutputProviderId),
    isVolcengine,
    isEdgeTts,
    hideCredentials: isSpeechOutputKeyless(settings.speechOutputProviderId),
    showEndpoint: !isEdgeTts,
    showCustomVoiceInput: supportsCustomSpeechOutputVoiceId(settings.speechOutputProviderId),
    modelLabelKey: isVolcengine
      ? 'settings.speech_output.cluster'
      : 'settings.speech_output.model',
    voiceLabelKey: isVolcengine
      ? 'settings.speech_output.voice_type'
      : 'settings.speech_output.voice',
  }
}

export function buildSpeechInputServiceConnectionRequest(
  settings: Pick<
    AppSettings,
    'speechInputProviderId' | 'speechInputApiBaseUrl' | 'speechInputApiKey' | 'speechInputModel'
  >,
): ServiceConnectionRequest {
  return {
    capability: 'speech-input',
    providerId: settings.speechInputProviderId,
    baseUrl: settings.speechInputApiBaseUrl,
    apiKey: settings.speechInputApiKey,
    model: settings.speechInputModel,
  }
}

export function buildSpeechOutputServiceConnectionRequest(
  settings: Pick<
    AppSettings,
    | 'speechOutputProviderId'
    | 'speechOutputApiBaseUrl'
    | 'speechOutputApiKey'
    | 'speechOutputModel'
    | 'speechOutputVoice'
  >,
): ServiceConnectionRequest {
  return {
    capability: 'speech-output',
    providerId: settings.speechOutputProviderId,
    baseUrl: settings.speechOutputApiBaseUrl,
    apiKey: settings.speechOutputApiKey,
    model: settings.speechOutputModel,
    voice: settings.speechOutputVoice,
  }
}
