/**
 * Listening and speaking ship turned off. Once the models for the selected
 * listener are on disk, that stock pair is what gets in the way of starting
 * voice. A user who already turned one of them on, or who has chosen the
 * switches themselves, is left alone.
 */

export const VOICE_SWITCHES_CHOSEN_KEY = 'nexus.voice.switches-chosen'

type VoiceSwitchDraft = {
  speechInputEnabled: boolean
  speechOutputEnabled: boolean
}

function voiceSwitchStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    const storage = globalThis.localStorage
    if (!storage || typeof storage.getItem !== 'function') return null
    return storage
  } catch {
    return null
  }
}

/** True after the user has moved either voice switch. */
export function readVoiceSwitchesChosen(): boolean {
  return voiceSwitchStorage()?.getItem(VOICE_SWITCHES_CHOSEN_KEY) === '1'
}

/** Remember that the switches are the user's, not the stock off pair. */
export function markVoiceSwitchesChosen(): void {
  voiceSwitchStorage()?.setItem(VOICE_SWITCHES_CHOSEN_KEY, '1')
}

/**
 * Turn listening and speaking on when the voice models are ready and both
 * switches are still the stock off pair. Any other combination is returned
 * unchanged.
 */
export function enableStockVoiceWhenModelsReady<T extends VoiceSwitchDraft>(
  draft: T,
  modelsReady: boolean,
): T {
  if (!modelsReady || draft.speechInputEnabled || draft.speechOutputEnabled) return draft
  return { ...draft, speechInputEnabled: true, speechOutputEnabled: true }
}
