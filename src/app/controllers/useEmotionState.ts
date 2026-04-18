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
import { AUTONOMY_EMOTION_STORAGE_KEY, readJson, writeJson } from '../../lib/storage'

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
