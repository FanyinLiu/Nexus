import { isSherpaTtsUnavailableMessage } from '../../features/voice/runtimeSupport'
import { isBrowserSpeechOutputProvider } from '../../lib/audioProviders'
import type { AppSettings, PetMood } from '../../types'
import {
  createStreamingSpeechOutputController,
  type StreamingSpeechOutputRuntime,
} from './streamingSpeechOutput'
import type { StreamingSpeechOutputController } from './types'

type BaseSpeechReplyOptions = {
  speechGeneration: number
  shouldResumeContinuousVoice: boolean
  currentSettings: AppSettings
  setMood: (mood: PetMood) => void
  setError: (error: string | null) => void
  busEmit: (event: import('../../features/voice/busEvents').VoiceBusEvent) => void
  startSpeechInterruptMonitor: (
    speechGeneration: number,
    shouldResumeContinuousVoice: boolean,
  ) => Promise<void>
  stopSpeechInterruptMonitor: () => void
  isSpeechInterrupted: (speechGeneration: number) => boolean
  clearSpeechInterruptedFlag: (speechGeneration: number) => void
}

export type SpeakAssistantReplyRuntimeOptions = BaseSpeechReplyOptions & {
  text: string
  startSpeechOutput: (
    text: string,
    speechSettings: AppSettings,
    options?: {
      onStart?: () => void
      onEnd?: () => void
      onError?: (message: string) => void
    },
  ) => Promise<void>
}

export type BeginStreamingSpeechReplyRuntimeOptions = BaseSpeechReplyOptions & {
  streamingRuntime: StreamingSpeechOutputRuntime
  switchSpeechOutputToBrowser: (statusText?: string) => unknown
}

function shouldIgnoreInterruptedSpeech(
  speechGeneration: number,
  usesBrowserSpeechOutput: boolean,
  isSpeechInterrupted: (speechGeneration: number) => boolean,
  clearSpeechInterruptedFlag: (speechGeneration: number) => void,
) {
  if (!isSpeechInterrupted(speechGeneration)) {
    return false
  }

  if (usesBrowserSpeechOutput) {
    clearSpeechInterruptedFlag(speechGeneration)
  }

  return true
}

function createSpeechReplyCallbacks(
  options: BaseSpeechReplyOptions & {
    text: string
    usesBrowserSpeechOutput: boolean
  },
) {
  return {
    onStart: () => {
      console.log('[SpeechReply] onStart — tts:started')
      options.busEmit({
        type: 'tts:started',
        text: options.text,
        speechGeneration: options.speechGeneration,
      })
      // Bus effect handles setMood('happy') and voiceState → 'speaking'
    },
    onEnd: () => {
      console.log('[SpeechReply] onEnd fired — shouldResumeContinuousVoice:', options.shouldResumeContinuousVoice)
      options.stopSpeechInterruptMonitor()

      if (shouldIgnoreInterruptedSpeech(
        options.speechGeneration,
        options.usesBrowserSpeechOutput,
        options.isSpeechInterrupted,
        options.clearSpeechInterruptedFlag,
      )) {
        console.log('[SpeechReply] onEnd — ignored (speech interrupted)')
        return
      }

      options.busEmit({
        type: 'tts:completed',
        speechGeneration: options.speechGeneration,
        shouldResumeContinuousVoice: options.shouldResumeContinuousVoice,
      })
      // Bus effects handle: setMood('idle'), restart_voice, voiceState → 'idle'
    },
    onError: (message: string) => {
      console.log('[SpeechReply] onError:', message, 'shouldResumeContinuousVoice:', options.shouldResumeContinuousVoice)
      options.stopSpeechInterruptMonitor()

      if (shouldIgnoreInterruptedSpeech(
        options.speechGeneration,
        options.usesBrowserSpeechOutput,
        options.isSpeechInterrupted,
        options.clearSpeechInterruptedFlag,
      )) {
        return
      }

      options.busEmit({
        type: 'tts:error',
        message,
        speechGeneration: options.speechGeneration,
        shouldResumeContinuousVoice: options.shouldResumeContinuousVoice,
      })
      options.setError(message)
      // Bus effects handle: setMood('idle'), restart_voice, voiceState → 'idle'
    },
  }
}

export async function speakAssistantReplyRuntime(
  options: SpeakAssistantReplyRuntimeOptions,
) {
  const usesBrowserSpeechOutput = isBrowserSpeechOutputProvider(
    options.currentSettings.speechOutputProviderId,
  )

  if (!options.currentSettings.speechOutputEnabled || !options.text.trim()) {
    options.stopSpeechInterruptMonitor()
    options.clearSpeechInterruptedFlag(options.speechGeneration)
    // Bus drives voiceState → 'idle', setMood('idle'), and restart_voice if needed
    options.busEmit({
      type: 'tts:completed',
      speechGeneration: options.speechGeneration,
      shouldResumeContinuousVoice: options.shouldResumeContinuousVoice,
    })
    return
  }

  try {
    await options.startSpeechOutput(
      options.text,
      options.currentSettings,
      createSpeechReplyCallbacks({
        ...options,
        text: options.text,
        usesBrowserSpeechOutput,
      }),
    )
  } catch (error) {
    options.stopSpeechInterruptMonitor()

    if (options.isSpeechInterrupted(options.speechGeneration)) {
      options.clearSpeechInterruptedFlag(options.speechGeneration)
      options.busEmit({ type: 'tts:interrupted', speechGeneration: options.speechGeneration })
      return
    }

    throw error
  }
}

export function beginStreamingSpeechReplyRuntime(
  options: BeginStreamingSpeechReplyRuntimeOptions,
): StreamingSpeechOutputController | null {
  const usesBrowserSpeechOutput = isBrowserSpeechOutputProvider(
    options.currentSettings.speechOutputProviderId,
  )

  if (!options.currentSettings.speechOutputEnabled || usesBrowserSpeechOutput) {
    return null
  }

  try {
    return createStreamingSpeechOutputController(
      options.currentSettings,
      options.streamingRuntime,
      createSpeechReplyCallbacks({
        ...options,
        text: '(streaming)',
        usesBrowserSpeechOutput,
      }),
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : '流式语音播报失败。'
    if (isSherpaTtsUnavailableMessage(message)) {
      options.switchSpeechOutputToBrowser('本地 Sherpa TTS 模型缺失，已自动切换到 CosyVoice2 播报。')
      return null
    }

    throw error instanceof Error ? error : new Error(message)
  }
}
