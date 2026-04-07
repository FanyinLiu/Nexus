import type { MutableRefObject } from 'react'
import type { WakewordRuntimeController } from '../../features/hearing/wakewordRuntime.ts'
import type { SenseVoiceStreamSession } from '../../features/hearing/localSenseVoice.ts'
import type { SherpaStreamSession } from '../../features/hearing/localSherpa.ts'
import type { BrowserSpeechRecognition } from '../../lib/voice'
import { createId } from '../../lib'
import type { AppSettings, VoiceTraceEntry } from '../../types'
import { createSpeechInputFallbackSettings } from './providerFallbacks'
import {
  cleanupLocalAsrRuntime,
  preloadHiddenLocalAsrWorker,
  type LocalAsrRuntimeRefs,
} from './localAsr'
import type { SherpaConversationState } from './types'

type AppendVoiceTrace = (
  title: string,
  detail: string,
  tone?: VoiceTraceEntry['tone'],
) => void

export type SetupLocalQwenSpeechWarmupRuntimeOptions = {
  speechOutputEnabled: boolean
  speechOutputProviderId: string
  speechOutputApiBaseUrl: string
  speechOutputApiKey: string
  speechOutputModel: string
  speechOutputVoice: string
  speechOutputInstructions: string
  speechSynthesisLang: string
  speechRate: number
  speechPitch: number
  speechVolume: number
  clonedVoiceId?: string
  warmupKeyRef: MutableRefObject<string>
}

export type PreloadHiddenWhisperRuntimeOptions = {
  settings: AppSettings
  refs: LocalAsrRuntimeRefs
  appendVoiceTrace: AppendVoiceTrace
}

export type CleanupVoiceRuntimeResourcesOptions = {
  clearPendingVoiceRestart: () => void
  recognitionRef: MutableRefObject<BrowserSpeechRecognition | null>
  stopApiRecording: (cancel?: boolean) => void
  stopVadListening: (cancel?: boolean) => Promise<void>
  sherpaConversationRef: MutableRefObject<SherpaConversationState | null>
  speechLevelValueRef: MutableRefObject<number>
  setSpeechLevel: (level: number) => void
  stopActiveSpeechOutput: () => void
  localAsrRefs: LocalAsrRuntimeRefs
  sherpaSessionRef: MutableRefObject<SherpaStreamSession | null>
  sensevoiceSessionRef: MutableRefObject<SenseVoiceStreamSession | null>
  wakewordRuntimeRef: MutableRefObject<WakewordRuntimeController | null>
}

export function setupLocalQwenSpeechWarmupRuntime(
  options: SetupLocalQwenSpeechWarmupRuntimeOptions,
) {
  if (
    !options.speechOutputEnabled
    || options.speechOutputProviderId !== 'local-qwen3-tts'
    || !window.desktopPet?.ttsStreamStart
    || !window.desktopPet?.ttsStreamAbort
  ) {
    options.warmupKeyRef.current = ''
    return undefined
  }

  // Voice cloning disabled — always use the provider's configured voice.
  const effectiveVoice = options.speechOutputVoice
  const warmupKey = [
    options.speechOutputProviderId,
    options.speechOutputApiBaseUrl,
    options.speechOutputModel,
    effectiveVoice,
    options.speechSynthesisLang,
    options.speechOutputInstructions,
    String(options.speechRate),
    String(options.speechPitch),
    String(options.speechVolume),
  ].join('\x00')

  if (options.warmupKeyRef.current === warmupKey) {
    return undefined
  }

  options.warmupKeyRef.current = warmupKey
  const requestId = createId('tts-prewarm')
  let disposed = false

  void window.desktopPet.ttsStreamStart({
    requestId,
    providerId: options.speechOutputProviderId,
    baseUrl: options.speechOutputApiBaseUrl,
    apiKey: options.speechOutputApiKey,
    model: options.speechOutputModel,
    voice: effectiveVoice,
    instructions: options.speechOutputInstructions,
    language: options.speechSynthesisLang,
    rate: options.speechRate,
    pitch: options.speechPitch,
    volume: options.speechVolume,
  })
    .then(() => {
      if (disposed) {
        return undefined
      }

      return window.desktopPet!.ttsStreamAbort({ requestId }).catch(() => undefined)
    })
    .catch(() => undefined)

  return () => {
    disposed = true
    void window.desktopPet!.ttsStreamAbort({ requestId }).catch(() => undefined)
  }
}

export function preloadHiddenWhisperRuntime(
  options: PreloadHiddenWhisperRuntimeOptions,
) {
  const shouldWarmHiddenWhisper = (
    options.settings.speechInputEnabled
    && (
      options.settings.speechInputProviderId === 'local-whisper'
      || (
        options.settings.speechInputProviderId === 'local-sherpa'
        && options.settings.speechInputFailoverEnabled
      )
    )
  )

  if (!shouldWarmHiddenWhisper) {
    return
  }

  const whisperSettings = createSpeechInputFallbackSettings(options.settings, 'local-whisper')
  const model = whisperSettings.speechInputModel || 'Xenova/whisper-base'

  preloadHiddenLocalAsrWorker(
    options.refs,
    model,
    {
      appendVoiceTrace: options.appendVoiceTrace,
    },
  ).then(
    () => console.info('[Voice] Whisper model preloaded:', model),
    (error) => console.warn('[Voice] Whisper model preload failed:', error),
  )
}

export function cleanupVoiceRuntimeResources(
  options: CleanupVoiceRuntimeResourcesOptions,
) {
  options.clearPendingVoiceRestart()
  options.recognitionRef.current?.abort()
  options.stopApiRecording(true)
  void options.stopVadListening(true)

  const sherpaConversation = options.sherpaConversationRef.current
  if (sherpaConversation?.noSpeechTimer) {
    window.clearTimeout(sherpaConversation.noSpeechTimer)
  }
  if (sherpaConversation?.maxDurationTimer) {
    window.clearTimeout(sherpaConversation.maxDurationTimer)
  }
  if (sherpaConversation?.endpointFinalizeTimer) {
    window.clearTimeout(sherpaConversation.endpointFinalizeTimer)
  }

  options.sherpaConversationRef.current = null
  options.speechLevelValueRef.current = 0
  options.setSpeechLevel(0)
  options.stopActiveSpeechOutput()
  cleanupLocalAsrRuntime(options.localAsrRefs, '本地 Whisper 已停止。')
  options.sherpaSessionRef.current?.abort()
  options.sherpaSessionRef.current = null
  options.sensevoiceSessionRef.current?.abort()
  options.sensevoiceSessionRef.current = null
  options.wakewordRuntimeRef.current?.destroy()
  options.wakewordRuntimeRef.current = null
}
