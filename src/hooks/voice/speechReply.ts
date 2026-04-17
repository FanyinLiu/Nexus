import type { AppSettings, PetMood } from '../../types'
import { voiceDebug } from '../../features/voice/voiceDebugLog'
import { voiceResumeStore } from '../../features/voice/voiceResumeStore'
import {
  createStreamingSpeechOutputController,
  type StreamingSpeechOutputRuntime,
} from './streamingSpeechOutput'
import {
  createPipelineStreamingSpeechController,
  isPipelineTtsEnabled,
} from './pipelineStreamingSpeechOutput.ts'
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
}

function shouldIgnoreInterruptedSpeech(
  speechGeneration: number,
  isSpeechInterrupted: (speechGeneration: number) => boolean,
) {
  return isSpeechInterrupted(speechGeneration)
}

function createSpeechReplyCallbacks(
  options: BaseSpeechReplyOptions & {
    text: string
  },
) {
  return {
    onStart: () => {
      voiceDebug('SpeechReply', 'onStart — tts:started')
      // Track full text so an interrupt can compute the unplayed remainder.
      // Streaming case passes the placeholder '(streaming)' — that's fine,
      // the remainder simply won't be useful for streaming, but interrupts
      // on completed-text speech (the common case) get a usable resume payload.
      voiceResumeStore.setActiveText(options.text)
      options.busEmit({
        type: 'tts:started',
        text: options.text,
        speechGeneration: options.speechGeneration,
      })
      // Bus effect handles setMood('happy') and voiceState → 'speaking'.
      // Start the interrupt monitor so the user can speak over the TTS to
      // cancel it. The monitor self-checks settings.voiceInterruptionEnabled
      // and shouldResumeContinuousVoice — if either is off it just no-ops.
      void options.startSpeechInterruptMonitor(
        options.speechGeneration,
        options.shouldResumeContinuousVoice,
      )
    },
    onEnd: () => {
      voiceDebug('SpeechReply', 'onEnd fired — shouldResumeContinuousVoice:', options.shouldResumeContinuousVoice)
      options.stopSpeechInterruptMonitor()

      if (shouldIgnoreInterruptedSpeech(
        options.speechGeneration,
        options.isSpeechInterrupted,
      )) {
        voiceDebug('SpeechReply', 'onEnd — ignored (speech interrupted)')
        voiceResumeStore.markInterrupted()
        return
      }

      voiceResumeStore.markCompleted()
      options.busEmit({
        type: 'tts:completed',
        speechGeneration: options.speechGeneration,
        shouldResumeContinuousVoice: options.shouldResumeContinuousVoice,
      })
      // Bus effects handle: setMood('idle'), restart_voice, voiceState → 'idle'
    },
    onError: (message: string) => {
      voiceDebug('SpeechReply', 'onError:', message, 'shouldResumeContinuousVoice:', options.shouldResumeContinuousVoice)
      options.stopSpeechInterruptMonitor()

      if (shouldIgnoreInterruptedSpeech(
        options.speechGeneration,
        options.isSpeechInterrupted,
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
      }),
    )
  } catch (error) {
    options.stopSpeechInterruptMonitor()

    if (options.isSpeechInterrupted(options.speechGeneration)) {
      options.clearSpeechInterruptedFlag(options.speechGeneration)
      voiceResumeStore.markInterrupted()
      options.busEmit({ type: 'tts:interrupted', speechGeneration: options.speechGeneration })
      return
    }

    throw error
  }
}

export function beginStreamingSpeechReplyRuntime(
  options: BeginStreamingSpeechReplyRuntimeOptions,
): StreamingSpeechOutputController | null {
  if (!options.currentSettings.speechOutputEnabled) {
    return null
  }

  try {
    const callbacks = {
      ...createSpeechReplyCallbacks({
        ...options,
        text: '(streaming)',
      }),
      busEmit: options.busEmit,
      speechGeneration: options.speechGeneration,
    }

    // Feature-flag gate for the new pipecat-style pipeline. Flip via
    //   localStorage.setItem('nexus:useTtsPipeline', 'true')
    // then reload. Default false keeps the legacy controller active
    // until the migration lands for everyone.
    if (isPipelineTtsEnabled()) {
      voiceDebug('SpeechReply', 'using pipeline TTS controller (flag: nexus:useTtsPipeline)')
      return createPipelineStreamingSpeechController(
        options.currentSettings,
        options.streamingRuntime,
        callbacks,
      )
    }

    return createStreamingSpeechOutputController(
      options.currentSettings,
      options.streamingRuntime,
      callbacks,
    )
  } catch (error) {
    throw error instanceof Error ? error : new Error(
      error instanceof Error ? error.message : 'Streaming speech playback failed.',
    )
  }
}
