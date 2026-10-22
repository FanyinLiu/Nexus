/**
 * Listening and speaking stay as stored until the user clicks start voice.
 * Models finishing must not write those switches: the stock off pair and a
 * switch the user turned off are the same saved state.
 *
 * The click is the only writer. It saves before the microphone opens, and
 * only when listening is still off. A speaking switch left off while
 * listening is already on is not rewritten.
 */

type VoiceSwitchDraft = {
  speechInputEnabled: boolean
  speechOutputEnabled: boolean
}

export type VoiceStartClick = {
  enabled: boolean
  patch?: {
    speechInputEnabled: true
    speechOutputEnabled: true
  }
}

/**
 * Whether start voice can run, and the switch change that click must save
 * first. The draft argument is not modified.
 */
export function voiceStartClick(draft: VoiceSwitchDraft, modelsReady: boolean): VoiceStartClick {
  if (draft.speechInputEnabled) return { enabled: true }
  if (!modelsReady) return { enabled: false }
  return {
    enabled: true,
    patch: { speechInputEnabled: true, speechOutputEnabled: true },
  }
}
