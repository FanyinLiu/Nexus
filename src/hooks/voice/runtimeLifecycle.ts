import type { MutableRefObject } from 'react'
import type { WakewordRuntimeController } from '../../features/hearing/wakewordRuntime.ts'
import type { SenseVoiceStreamSession } from '../../features/hearing/localSenseVoice.ts'
import type { BrowserSpeechRecognition } from '../../lib/voice'
import type { AppSettings, VoiceTraceEntry } from '../../types'
import {
  cleanupLocalAsrRuntime,
  type LocalAsrRuntimeRefs,
} from './localAsr'

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
  speechLevelValueRef: MutableRefObject<number>
  setSpeechLevel: (level: number) => void
  stopActiveSpeechOutput: () => void
  localAsrRefs: LocalAsrRuntimeRefs
  sensevoiceSessionRef: MutableRefObject<SenseVoiceStreamSession | null>
  wakewordRuntimeRef: MutableRefObject<WakewordRuntimeController | null>
}

export function setupLocalQwenSpeechWarmupRuntime(
  _options: SetupLocalQwenSpeechWarmupRuntimeOptions,
) {
  // local-qwen3-tts has been removed; this is now a no-op kept for call-site
  // compatibility.  The warmup key ref is cleared so no stale state lingers.
  _options.warmupKeyRef.current = ''
  return undefined
}

export function preloadHiddenWhisperRuntime(
  _options: PreloadHiddenWhisperRuntimeOptions,
) {
  // local-whisper and local-sherpa have been removed; this is now a no-op.
}

export function cleanupVoiceRuntimeResources(
  options: CleanupVoiceRuntimeResourcesOptions,
) {
  options.clearPendingVoiceRestart()
  options.recognitionRef.current?.abort()
  options.stopApiRecording(true)
  void options.stopVadListening(true)

  options.speechLevelValueRef.current = 0
  options.setSpeechLevel(0)
  options.stopActiveSpeechOutput()
  cleanupLocalAsrRuntime(options.localAsrRefs, '本地 ASR 已停止。')
  options.sensevoiceSessionRef.current?.abort()
  options.sensevoiceSessionRef.current = null
  options.wakewordRuntimeRef.current?.destroy()
  options.wakewordRuntimeRef.current = null
}
