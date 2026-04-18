import { useCallback, useRef } from 'react'
import {
  type RhythmProfile,
  applyWeeklyDecay,
  createDefaultRhythmProfile,
  formatRhythmSummary,
  recordInteraction,
  shouldAllowProactiveSpeech,
} from '../../features/autonomy/rhythmLearner'
import { AUTONOMY_RHYTHM_STORAGE_KEY, readJson, writeJson } from '../../lib/storage'

export function useRhythmState() {
  const rhythmRef = useRef<RhythmProfile>(
    readJson<RhythmProfile>(AUTONOMY_RHYTHM_STORAGE_KEY, createDefaultRhythmProfile()),
  )

  const decayOnTick = useCallback(() => {
    const before = rhythmRef.current
    rhythmRef.current = applyWeeklyDecay(before)
    // applyWeeklyDecay is a no-op if <1 week has passed, so it returns the
    // same reference — only persist when the decay actually fired. Without
    // this, the decay ran in memory but the disk copy kept its old
    // lastDecayDate, so the next app launch re-ran decay and double-faded
    // the user's hour-of-day profile.
    if (rhythmRef.current !== before) {
      writeJson(AUTONOMY_RHYTHM_STORAGE_KEY, rhythmRef.current)
    }
  }, [])

  const isProactiveSpeechAllowed = useCallback(
    () => shouldAllowProactiveSpeech(rhythmRef.current),
    [],
  )

  const recordInteractionInRhythm = useCallback(() => {
    rhythmRef.current = recordInteraction(rhythmRef.current)
    writeJson(AUTONOMY_RHYTHM_STORAGE_KEY, rhythmRef.current)
  }, [])

  const getRhythmPrompt = useCallback(() => formatRhythmSummary(rhythmRef.current), [])

  return {
    rhythmRef,
    decayOnTick,
    isProactiveSpeechAllowed,
    recordInteractionInRhythm,
    getRhythmPrompt,
  }
}
