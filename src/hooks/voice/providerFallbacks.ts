import {
  choosePreferredVoiceTranscript,
  normalizeRecognizedVoiceTranscript,
  shouldAttemptLocalWhisperRescore,
} from '../../features/hearing/core.ts'
import { encodeVadAudioToWavBlob } from '../../features/hearing/browserVad.ts'
import { executeWithFailover, type FailoverCandidate } from '../../features/failover/orchestrator.ts'
import { isFailoverEligibleError } from '../../features/failover/runtime.ts'
import {
  isBrowserSpeechInputProvider,
  resolveSpeechInputModel,
} from '../../lib/audioProviders'
import { shorten } from '../../lib/common'
import {
  switchSpeechInputProvider,
  switchSpeechOutputProvider,
  syncSpeechProviderProfiles,
} from '../../lib/speechProviderProfiles'
import type { AppSettings, VoicePipelineState, VoiceTraceEntry } from '../../types'
import type { VoiceConversationOptions } from './types'

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

export type StartHiddenLocalWhisperFallbackRuntimeOptions = {
  currentSettings: AppSettings
  options?: VoiceConversationOptions
  statusText?: string
  showPetStatus: ShowPetStatus
  startLocalWhisperConversation: (
    options?: VoiceConversationOptions,
    runtimeSettings?: AppSettings,
  ) => Promise<void>
}

export type ApplySpeechInputProviderFallbackRuntimeOptions = {
  providerId: string
  statusText?: string
  settingsRef: SettingsRef
  showPetStatus: ShowPetStatus
}

export type SwitchSpeechInputToLocalWhisperRuntimeOptions = {
  statusText?: string
  settingsRef: SettingsRef
  activeVoiceConversationOptions: VoiceConversationOptions | undefined
  showPetStatus: ShowPetStatus
  startLocalWhisperConversation: (
    options?: VoiceConversationOptions,
    runtimeSettings?: AppSettings,
  ) => Promise<void>
}

export type MaybeRescoreSherpaTranscriptRuntimeOptions = {
  transcript: string
  audioSamples: Float32Array | null
  sampleRate: number
  currentSettings: AppSettings
  partialCount: number
  endpointCount: number
  traceLabel: string
  transcribeWithLocalWhisper: (
    blob: Blob,
    currentSettings: AppSettings,
  ) => Promise<string>
  appendVoiceTrace: (
    title: string,
    detail: string,
    tone?: VoiceTraceEntry['tone'],
  ) => void
  updateVoicePipeline: (
    step: VoicePipelineState['step'],
    detail: string,
    transcript?: string,
  ) => void
}

export type TryTranscribeWithSpeechInputFailoverRuntimeOptions = {
  audioBlob: Blob
  currentSettings: AppSettings
  error: unknown
  transcribeWithLocalWhisper: (
    blob: Blob,
    currentSettings: AppSettings,
  ) => Promise<string>
  applySpeechInputProviderFallback: (providerId: string, statusText?: string) => AppSettings
  appendVoiceTrace: (
    title: string,
    detail: string,
    tone?: VoiceTraceEntry['tone'],
  ) => void
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
    ? 'local-sherpa'
    : currentSettings.speechInputProviderId
  const nextSpeechInputModel = resolveSpeechInputModel(
    nextProviderId,
    shouldNormalizeLegacyLocalProvider ? undefined : currentSettings.speechInputModel,
  )
  const nextSpeechInputApiBaseUrl = nextProviderId === 'local-sherpa'
    ? ''
    : currentSettings.speechInputApiBaseUrl
  const shouldFallbackToLocalWhisper = shouldNormalizeLegacyLocalProvider

  if (
    nextProviderId === currentSettings.speechInputProviderId
    && nextSpeechInputModel === currentSettings.speechInputModel
    && nextSpeechInputApiBaseUrl === currentSettings.speechInputApiBaseUrl
  ) {
    return syncSpeechProviderProfiles(currentSettings)
  }

  const nextSettings = switchSpeechInputProvider(currentSettings, nextProviderId)
  // Only update runtime ref — never persist automatic provider changes to storage.
  options.settingsRef.current = nextSettings

  if (options.announce && shouldFallbackToLocalWhisper) {
    options.showPetStatus('当前环境不支持浏览器原生语音识别，已切换到本地 Whisper。', 3_600, 4_500)
  }

  return nextSettings
}

export function startHiddenLocalWhisperFallbackRuntime(
  options: StartHiddenLocalWhisperFallbackRuntimeOptions,
) {
  const fallbackSettings = createSpeechInputFallbackSettings(
    options.currentSettings,
    'local-whisper',
  )

  if (options.statusText) {
    options.showPetStatus(options.statusText, 3_600, 4_500)
  }

  window.setTimeout(() => {
    void options.startLocalWhisperConversation(options.options, fallbackSettings)
  }, 0)

  return fallbackSettings
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

export function switchSpeechInputToLocalWhisperRuntime(
  options: SwitchSpeechInputToLocalWhisperRuntimeOptions,
) {
  return startHiddenLocalWhisperFallbackRuntime({
    currentSettings: options.settingsRef.current,
    options: options.activeVoiceConversationOptions,
    statusText: options.statusText,
    showPetStatus: options.showPetStatus,
    startLocalWhisperConversation: options.startLocalWhisperConversation,
  })
}

export async function maybeRescoreSherpaTranscriptRuntime(
  options: MaybeRescoreSherpaTranscriptRuntimeOptions,
) {
  const normalizedTranscript = normalizeRecognizedVoiceTranscript(options.transcript)
  if (
    !normalizedTranscript
    || !options.audioSamples
    || options.currentSettings.speechInputProviderId !== 'local-sherpa'
    || !options.currentSettings.speechInputFailoverEnabled
    || !shouldAttemptLocalWhisperRescore(normalizedTranscript, {
      partialCount: options.partialCount,
      endpointCount: options.endpointCount,
    })
  ) {
    return normalizedTranscript
  }

  const fallbackSettings = createSpeechInputFallbackSettings(
    options.currentSettings,
    'local-whisper',
  )
  const audioBlob = encodeVadAudioToWavBlob(options.audioSamples, options.sampleRate)

  options.appendVoiceTrace(
    '本地识别二次校正',
    `#${options.traceLabel} Sherpa 结果较短或不稳定，正在用 Whisper 复核`,
    'info',
  )
  options.updateVoicePipeline(
    'transcribing',
    '正在做本地二次校正，尽量把识别结果修正得更准',
    normalizedTranscript,
  )

  try {
    const whisperTranscript = await options.transcribeWithLocalWhisper(audioBlob, fallbackSettings)
    const preferredTranscript = choosePreferredVoiceTranscript(
      normalizedTranscript,
      whisperTranscript,
    )

    if (preferredTranscript && preferredTranscript !== normalizedTranscript) {
      options.appendVoiceTrace(
        '本地识别已校正',
        `#${options.traceLabel} 已采用 Whisper 终稿替换流式结果`,
        'success',
      )
      return preferredTranscript
    }

    options.appendVoiceTrace(
      '本地识别校正完成',
      `#${options.traceLabel} 已复核，保留当前流式结果`,
      'success',
    )
  } catch (correctionError) {
    options.appendVoiceTrace(
      '本地识别校正失败',
      `#${options.traceLabel} ${shorten(correctionError instanceof Error ? correctionError.message : 'Whisper 复核失败', 72)}`,
      'error',
    )
  }

  return normalizedTranscript
}

export async function tryTranscribeWithSpeechInputFailoverRuntime(
  options: TryTranscribeWithSpeechInputFailoverRuntimeOptions,
) {
  const primaryError = options.error instanceof Error
    ? options.error
    : new Error('语音识别失败。')

  if (
    !options.currentSettings.speechInputFailoverEnabled
    || options.currentSettings.speechInputProviderId === 'local-whisper'
    || !isFailoverEligibleError(primaryError)
  ) {
    return null
  }

  const fallbackSettings = createSpeechInputFallbackSettings(
    options.currentSettings,
    'local-whisper',
  )

  const candidates: FailoverCandidate<AppSettings>[] = [
    {
      id: fallbackSettings.speechInputProviderId,
      identity: [
        fallbackSettings.speechInputProviderId,
        fallbackSettings.speechInputModel,
      ].join('|'),
      payload: fallbackSettings,
    },
  ]

  options.appendVoiceTrace(
    '语音识别主链路异常',
    `${options.currentSettings.speechInputProviderId}：${shorten(primaryError.message, 80)}`,
    'error',
  )

  try {
    const result = await executeWithFailover<AppSettings, string>({
      domain: 'speech-input',
      candidates,
      failoverEnabled: true,
      execute: async (candidate) =>
        (await options.transcribeWithLocalWhisper(options.audioBlob, candidate.payload)).trim(),
    })

    // Only log — do NOT mutate settingsRef.  Previous behavior permanently
    // switched the runtime settings to local-whisper, meaning all subsequent
    // recognition would bypass the user's chosen cloud STT provider even if
    // it recovered on the very next request.
    options.appendVoiceTrace(
      '语音识别本次回退',
      `${options.currentSettings.speechInputProviderId} -> ${fallbackSettings.speechInputProviderId}（仅本次，不改变设置）`,
      'success',
    )
    return result.result
  } catch {
    return null
  }
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
    if (settings.speechOutputProviderId !== 'cosyvoice-tts') {
      providerIds.push('cosyvoice-tts')
    }
    if (settings.speechOutputProviderId !== 'local-qwen3-tts') {
      providerIds.push('local-qwen3-tts')
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
