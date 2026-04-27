import { useCallback, useRef } from 'react'
import {
  type EmotionSignal,
  type EmotionState,
  applyEmotionSignal as applySignal,
  createDefaultEmotionState,
  decayEmotion,
  emotionToPetMood,
  formatEmotionForPrompt,
} from '../../features/autonomy/emotionModel'
import { captureEmotionSample } from '../../features/autonomy/stateTimeline.ts'
import {
  captureUserAffectSample,
  textSignalToVAD,
  voiceEmotionToVAD,
} from '../../features/autonomy/userAffectTimeline.ts'
import { AUTONOMY_EMOTION_STORAGE_KEY, readJson, writeJson } from '../../lib/storage'

/**
 * Map an emotion-model signal to a user-affect sample, or `null` if the
 * signal describes Nexus's own state rather than the user's.
 * Voice prosody signals are higher-confidence than text-classified ones
 * because SenseVoice's emotion tag is the model's own forced choice
 * over the audio; the text signals are surface-level regex hits.
 */
function projectSignalToUserAffect(
  signal: EmotionSignal,
): { valence: number; arousal: number; source: 'voice_prosody' | 'text_signal'; confidence: number } | null {
  switch (signal) {
    case 'voice_emotion_happy':
    case 'voice_emotion_sad':
    case 'voice_emotion_angry':
    case 'voice_emotion_fearful':
    case 'voice_emotion_disgusted':
    case 'voice_emotion_surprised': {
      const label = signal.replace('voice_emotion_', '') as
        | 'happy' | 'sad' | 'angry' | 'fearful' | 'disgusted' | 'surprised'
      return { ...voiceEmotionToVAD(label), source: 'voice_prosody', confidence: 0.6 }
    }
    case 'user_praise':
      return { ...textSignalToVAD('praise'), source: 'text_signal', confidence: 0.7 }
    case 'user_frustration':
      return { ...textSignalToVAD('frustration'), source: 'text_signal', confidence: 0.7 }
    case 'user_greeting':
      return { ...textSignalToVAD('greeting'), source: 'text_signal', confidence: 0.5 }
    case 'user_farewell':
      return { ...textSignalToVAD('farewell'), source: 'text_signal', confidence: 0.5 }
    case 'user_question':
      return { ...textSignalToVAD('question'), source: 'text_signal', confidence: 0.4 }
    default:
      return null
  }
}

// Persist after every mutation. Emotion state was previously memory-only — an
// app restart reset the companion to neutral defaults, which the user could
// feel as "伙伴感假 / 跨 session 不连贯" (it forgets how it felt about yesterday).
// Reads/writes are localStorage-cheap; no need to debounce because mutations
// happen at tick cadence, not in hot loops.
export function useEmotionState() {
  const emotionStateRef = useRef<EmotionState>(
    readJson<EmotionState>(AUTONOMY_EMOTION_STORAGE_KEY, createDefaultEmotionState()),
  )
  const lastTimeSignalHourRef = useRef<number>(-1)

  const persist = () => {
    writeJson(AUTONOMY_EMOTION_STORAGE_KEY, emotionStateRef.current)
    // Sample the emotion history for the diagnostics timeline. The helper
    // enforces its own dedup / heartbeat policy — calling on every persist
    // is fine, it writes a new sample only when the shape has moved.
    captureEmotionSample(emotionStateRef.current)
  }

  const decayOnTick = useCallback((idleSeconds: number) => {
    const before = emotionStateRef.current
    emotionStateRef.current = decayEmotion(before)

    const hour = new Date().getHours()
    if (hour !== lastTimeSignalHourRef.current) {
      lastTimeSignalHourRef.current = hour
      if (hour >= 6 && hour <= 9) {
        emotionStateRef.current = applySignal(emotionStateRef.current, 'morning')
      } else if (hour >= 23 || hour < 4) {
        emotionStateRef.current = applySignal(emotionStateRef.current, 'late_night')
      }
    }

    if (idleSeconds > 600) {
      emotionStateRef.current = applySignal(emotionStateRef.current, 'long_idle')
    }

    if (emotionStateRef.current !== before) persist()
  }, [])

  const applyEmotionSignal = useCallback((signal: EmotionSignal) => {
    const before = emotionStateRef.current
    emotionStateRef.current = applySignal(before, signal)
    if (emotionStateRef.current !== before) persist()
    // Mirror eligible signals into the user-affect timeline. Voice prosody
    // (high-confidence inference of the user's mood) and text-classified
    // signals (lower-confidence regex hits on the user's words) both go
    // here; companion-internal signals (long_idle, morning, late_night,
    // task_completed, error_occurred, user_returned) describe Nexus's own
    // state and don't belong in the user series.
    const projection = projectSignalToUserAffect(signal)
    if (projection) {
      captureUserAffectSample({
        valence: projection.valence,
        arousal: projection.arousal,
        source: projection.source,
        confidence: projection.confidence,
        note: signal,
      })
    }
  }, [])

  const getEmotionMood = useCallback(() => emotionToPetMood(emotionStateRef.current), [])
  const getEmotionPrompt = useCallback(() => formatEmotionForPrompt(emotionStateRef.current), [])

  return {
    emotionStateRef,
    decayOnTick,
    applyEmotionSignal,
    getEmotionMood,
    getEmotionPrompt,
  }
}
