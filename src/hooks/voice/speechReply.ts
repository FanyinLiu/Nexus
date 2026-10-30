import type { AppSettings, PetMood, VoiceEmotionCue } from '../../types'
import type { SegmentStyleResolver } from '../../features/voice/voiceEmotion.ts'
import { voiceDebug } from '../../features/voice/voiceDebugLog.ts'
import { voiceResumeStore } from '../../features/voice/voiceResumeStore.ts'
import { isInterruptedError } from '../../features/voice/interruptedError.ts'
import type { InterruptMicTurnSource } from '../../features/voice/autoRestartPolicy.ts'
import { isQwen3TtsSpeechOutputProvider } from '../../lib/audioProviders.ts'
import {
  buildSpeechOutputFailoverCandidatesRuntime,
} from './providerFallbacks.ts'
import {
  createStreamingSpeechOutputController,
  type StreamingSpeechOutputRuntime,
} from './streamingSpeechOutput.ts'
import { createStreamingSpeechOutputWithFallback } from './streamingSpeechOutputFallback.ts'
import type { StreamingSpeechOutputController } from './types.ts'

type BaseSpeechReplyOptions = {
  speechGeneration: number
  shouldResumeContinuousVoice: boolean
  /** Origin of this turn — typed replies must not open the interrupt mic. */
  source?: InterruptMicTurnSource
  currentSettings: AppSettings
  setMood: (mood: PetMood) => void
  setError: (error: string | null) => void
  busEmit: (event: import('../../features/voice/busEvents').VoiceBusEvent) => void
  startSpeechInterruptMonitor: (
    speechGeneration: number,
    source?: InterruptMicTurnSource,
  ) => Promise<void>
  stopSpeechInterruptMonitor: () => void
  isSpeechInterrupted: (speechGeneration: number) => boolean
  clearSpeechInterruptedFlag: (speechGeneration: number) => void
  resetSpeechLevel: () => void
  /** One-time "used your usual voice" notice when the local voice hands over. */
  notifySpeechFallback?: () => void
  /** Resolve each sentence's emotion style from the live snapshot. */
  resolveSegmentVoiceStyle?: SegmentStyleResolver
  /** Reply-level `[tts:…]` cue for direct-speech playback. */
  initialCue?: VoiceEmotionCue | null
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
      resolveSegmentVoiceStyle?: SegmentStyleResolver
      initialCue?: VoiceEmotionCue | null
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
    /** Streaming variant resolves the text accumulated so far at onStart. */
    getText?: () => string
  },
) {
  return {
    onStart: () => {
      voiceDebug('SpeechReply', 'onStart — tts:started')
      // Track the real spoken text so an interrupt can compute the unplayed
      // remainder (and so streaming no longer records a placeholder).
      const activeText = options.getText ? options.getText() : options.text
      voiceResumeStore.setActiveText(activeText)
      options.busEmit({
        type: 'tts:started',
        text: activeText,
        speechGeneration: options.speechGeneration,
      })
      // Bus effect handles setMood('happy') and voiceState → 'speaking'.
      // Start the interrupt monitor so the user can speak over the TTS to
      // cancel it. The monitor self-checks settings.voiceInterruptionEnabled
      // — if it's off it just no-ops.
      void options.startSpeechInterruptMonitor(
        options.speechGeneration,
        options.source,
      )
    },
    onEnd: () => {
      options.resetSpeechLevel()
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
      options.resetSpeechLevel()
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
    options.resetSpeechLevel()
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
      {
        ...createSpeechReplyCallbacks({
          ...options,
          text: options.text,
        }),
        resolveSegmentVoiceStyle: options.resolveSegmentVoiceStyle,
        initialCue: options.initialCue,
      },
    )
  } catch (error) {
    options.resetSpeechLevel()
    options.stopSpeechInterruptMonitor()

    if (options.isSpeechInterrupted(options.speechGeneration)) {
      options.clearSpeechInterruptedFlag(options.speechGeneration)
      voiceResumeStore.markInterrupted()
      options.busEmit({ type: 'tts:interrupted', speechGeneration: options.speechGeneration })
      return
    }

    if (isInterruptedError(error)) {
      // A typed-turn barge-in stops playback without the monitor's generation
      // flag. It is still a clean stop, never a playback failure.
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
    options.resetSpeechLevel()
    return null
  }

  try {
    let controller: StreamingSpeechOutputController | null = null
    let resumeStarted = false
    const baseCallbacks = createSpeechReplyCallbacks({
      ...options,
      text: '',
      // The controller is created below; by the time the first chunk calls
      // onStart it holds every sentence queued so far.
      getText: () => controller?.getSpokenText?.() ?? '',
    })
    const callbacks = {
      ...baseCallbacks,
      onStart: () => {
        baseCallbacks.onStart()
        resumeStarted = true
      },
      // A sentence queued after playback began extends the resumable text.
      onSegmentQueued: (segment: { segmentIndex: number; text: string }) => {
        if (resumeStarted) voiceResumeStore.appendActiveText(segment.text)
      },
      // This is the event that actually feeds resume accounting: only text
      // that reached the speaker counts as heard.
      onSegmentPlayed: (segment: { segmentIndex: number; text: string }) => {
        voiceResumeStore.recordChunkPlayed(segment.text)
      },
      busEmit: options.busEmit,
      speechGeneration: options.speechGeneration,
      resolveSegmentVoiceStyle: options.resolveSegmentVoiceStyle,
    }

    // The pipecat-style pipeline (SentenceAggregator → TTSStreamService →
    // AudioPlayerSink) was removed in this cleanup pass: it was gated behind
    // the nexus:useTtsPipeline flag (default off) because it stalled
    // waitForCompletion without emitting audio, and the legacy controller
    // below has been reliable since v0.2.x. The pipeline code lives on in
    // git history if the architecture is ever revisited.
    if (isQwen3TtsSpeechOutputProvider(options.currentSettings.speechOutputProviderId)) {
      const fallbackSettings = buildSpeechOutputFailoverCandidatesRuntime(options.currentSettings)
        .find((candidate) => candidate.speechOutputProviderId !== options.currentSettings.speechOutputProviderId)
      if (fallbackSettings) {
        controller = createStreamingSpeechOutputWithFallback({
          primarySettings: options.currentSettings,
          fallbackSettings,
          runtime: options.streamingRuntime,
          options: callbacks,
          onFallback: options.notifySpeechFallback,
        })
        return controller
      }
    }

    controller = createStreamingSpeechOutputController(
      options.currentSettings,
      options.streamingRuntime,
      callbacks,
    )
    return controller
  } catch (error) {
    options.resetSpeechLevel()
    throw error instanceof Error ? error : new Error('Streaming speech playback failed.')
  }
}
