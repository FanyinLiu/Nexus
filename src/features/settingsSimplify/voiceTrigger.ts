/**
 * Voice trigger mode for the simplified settings surface.
 *
 * The mode decides what happens after the microphone hears a sentence:
 * send it right away, wait for the wake word, or only fill the composer
 * and let the person send it. The plain voice page and the advanced
 * section must write the same fields, so the write lives here.
 */

import { getDirectSendFallbackWakeWord } from '../hearing/companionWakeWordSync.ts'
import type { VoiceTriggerMode } from '../../types/voice.ts'

/** Every mode a person can pick, in the order the select lists them. */
export const VOICE_TRIGGER_MODES: readonly VoiceTriggerMode[] = [
  'direct_send',
  'wake_word',
  'manual_confirm',
]

export type VoiceTriggerFields = {
  voiceTriggerMode: VoiceTriggerMode
  wakeWord: string
  wakeWordEnabled: boolean
  companionName?: string
}

export type VoiceTriggerPatch = {
  voiceTriggerMode: VoiceTriggerMode
  wakeWordEnabled: boolean
  wakeWord: string
}

/**
 * Write the trigger mode. The wake word itself is kept as it is; it is
 * only filled in when the mode needs one and the field is still empty.
 */
export function voiceTriggerPatch(
  mode: VoiceTriggerMode,
  current: VoiceTriggerFields,
): VoiceTriggerPatch {
  const needsWakeWord = mode === 'wake_word' && !current.wakeWord.trim()
  return {
    voiceTriggerMode: mode,
    wakeWordEnabled: mode === 'wake_word',
    wakeWord: needsWakeWord
      ? getDirectSendFallbackWakeWord({
        wakeWord: current.wakeWord,
        companionName: current.companionName ?? '',
      })
      : current.wakeWord,
  }
}

/**
 * Where the wake word is edited. The plain voice page owns that field,
 * so the advanced section only offers the mode itself.
 */
export function showsVoiceWakeWord(surface: 'full' | 'rest', mode: VoiceTriggerMode): boolean {
  return surface === 'full' && mode === 'wake_word'
}
