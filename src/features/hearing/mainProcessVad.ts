// Main-process VAD controller.
//
// Runs Silero VAD in the Electron main process via sherpa-onnx-node (see
// electron/sherpaVad.js). The renderer only provides audio — no second
// getUserMedia, no onnxruntime-web, no cloned MediaStream. Audio frames
// are piped in through `pushSamples()`, which forwards them to the main
// process `vad:feed` IPC; speech start/end events and completed segments
// come back inline in the IPC response.
//
// Wired into vadConversation.ts as the default VAD backend whenever the
// always-on wakeword listener is running, so KWS and VAD consume byte-
// identical audio taken from the same renderer ScriptProcessor.

import { t } from '../../i18n/runtime.ts'
import type { VadSensitivity } from '../../types'
import { turnEndMaxSilenceMs } from './turnEnd.ts'

type VoiceActivityCallbacks = {
  onSpeechStart?: () => void
  onSpeechRealStart?: () => void
  onSpeechEnd: (audio: Float32Array) => void | Promise<void>
  onMisfire?: () => void
  onFrameProcessed?: (speechProbability: number) => void
}

export type MainProcessVadController = {
  pushSamples: (samples: Float32Array) => void
  flush: () => Promise<boolean>
  destroy: () => Promise<void>
}

type VadPreset = {
  threshold: number
  minSilenceDuration: number
  minSpeechDuration: number
  maxSpeechDuration: number
}

// Silero thresholds are centered around 0.5. Looser ≈ catches more speech
// at the risk of more false positives. The voice-session flow already has
// the wakeword as a positive gate, so misfires here just waste a tiny bit
// of compute — we bias aggressively toward sensitivity. Users complained
// that default thresholds were cutting them off mid-sentence on short
// pauses and missing quieter speech entirely.
//
// This main-process path feeds a one-shot transcribeAudio call, so it has
// no partial transcript to reason about. The renderer still runs the Smart
// Turn probe on this same buffered audio and flushes the segment when the
// audio (or, without the model, the preset silence) says the turn is over.
// Streaming providers (Paraformer, Tencent ASR) also apply their partial-text
// rules in their own conversation runners.
const VAD_PRESETS: Record<VadSensitivity, VadPreset> = {
  low: {
    threshold: 0.45,
    minSilenceDuration: 0.7,
    minSpeechDuration: 0.12,
    maxSpeechDuration: 45,
  },
  medium: {
    threshold: 0.3,
    minSilenceDuration: 0.9,
    minSpeechDuration: 0.08,
    maxSpeechDuration: 45,
  },
  high: {
    // Wake-word has already gated the session, so being aggressive here is
    // low-risk. 0.18 picks up the first syllable on weak/desktop mics where
    // the opening energy of a short command is commonly 0.1–0.3 peak — the
    // user's report of "only the first sentence doesn't register" traces to
    // a VAD that waited for a louder onset the first command never supplied.
    threshold: 0.18,
    minSilenceDuration: 1.1,
    minSpeechDuration: 0.06,
    maxSpeechDuration: 45,
  },
}

/**
 * The preset silence window in milliseconds. Turn-end decisions use this as
 * the "ordinary text / no partial" fallback; the detector itself is opened
 * with the wider `turnEndMaxSilenceMs` ceiling so a trailing connector or a
 * Smart Turn "not finished" verdict has room to finish the thought.
 */
export function getMainProcessVadSilenceMs(sensitivity: VadSensitivity = 'medium') {
  return Math.round(VAD_PRESETS[sensitivity].minSilenceDuration * 1_000)
}

export async function createMainProcessVadController(
  callbacks: VoiceActivityCallbacks,
  sensitivity: VadSensitivity = 'medium',
): Promise<MainProcessVadController> {
  const api = window.desktopPet
  if (!api?.vadStart || !api.vadFeed || !api.vadStop || !api.vadFlush) {
    throw new Error(t('voice.vad.unavailable'))
  }

  const preset = VAD_PRESETS[sensitivity]
  const startResult = await api.vadStart({
    threshold: preset.threshold,
    // The renderer's turn-end controller flushes the segment as soon as the
    // model or the text rules say the turn is over. This wider ceiling is only
    // the backstop for a model that keeps saying "not finished".
    minSilenceDuration: turnEndMaxSilenceMs(preset.minSilenceDuration * 1_000) / 1_000,
    minSpeechDuration: preset.minSpeechDuration,
    maxSpeechDuration: preset.maxSpeechDuration,
  })
  if (!startResult?.ok) {
    throw new Error(startResult?.reason || t('voice.vad.start_failed'))
  }

  let destroyed = false
  let feedChain: Promise<void> = Promise.resolve()
  let realStartFired = false

  async function sendChunk(samples: Float32Array) {
    if (destroyed) return
    try {
      const result = await api!.vadFeed({ samples })

      if (destroyed) return

      if (result.speechDetected) {
        callbacks.onFrameProcessed?.(0.9)
      } else {
        callbacks.onFrameProcessed?.(0.1)
      }

      if (result.speechStarted) {
        callbacks.onSpeechStart?.()
        if (!realStartFired) {
          realStartFired = true
          callbacks.onSpeechRealStart?.()
        }
      }

      if (result.segments && result.segments.length > 0) {
        for (const segment of result.segments) {
          const audio = segment instanceof Float32Array
            ? segment
            : new Float32Array(segment)
          // The segment coming back from main process is the complete
          // utterance audio — pass it straight to the STT handler.
          void callbacks.onSpeechEnd(audio)
          // Only surface the first segment per session; subsequent ones
          // belong to a follow-up turn and are for the next session.
          break
        }
      } else if (result.speechEnded && !result.speechDetected) {
        // Speech edge fell but no segment queued — minSpeechDuration cut
        // it as a misfire. The caller decides whether to keep listening.
        callbacks.onMisfire?.()
      }
    } catch (error) {
      console.error('[MainVAD] vad:feed error', error)
    }
  }

  return {
    pushSamples(samples: Float32Array) {
      if (destroyed) return
      // Clone the buffer — ipcRenderer.invoke structurally clones, but we
      // don't want downstream code mutating our copy while IPC is pending.
      const copy = new Float32Array(samples)
      feedChain = feedChain.then(() => sendChunk(copy)).catch(() => undefined)
    },
    async flush() {
      if (destroyed) return false
      // Let any in-flight vad:feed land first so the buffer is complete,
      // then force the main-process VAD to emit its current segment.
      await feedChain.catch(() => undefined)
      if (destroyed) return false
      try {
        const result = await api!.vadFlush()
        const segments = result?.segments ?? []
        if (segments.length > 0) {
          const first = segments[0]
          const audio = first instanceof Float32Array ? first : new Float32Array(first)
          // Route through the normal end-of-speech path (transcribe + finish).
          void callbacks.onSpeechEnd(audio)
          return true
        }
      } catch (error) {
        console.error('[MainVAD] vad:flush error', error)
      }
      return false
    },
    async destroy() {
      if (destroyed) return
      destroyed = true
      await feedChain.catch(() => undefined)
      try {
        await api.vadStop()
      } catch (error) {
        console.warn('[MainVAD] vad:stop failed', error)
      }
    },
  }
}
