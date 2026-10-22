/**
 * Voice-triggered requests for the local model installer.
 *
 * The overlay must stay quiet at launch and after onboarding, but open when
 * the user first does something that needs the local voice models. Voice
 * hooks publish that intent here; the overlay subscribes without either side
 * owning the other's React state.
 */

import type { VoiceTriggerMode } from '../../types/voice.ts'

type WakewordSetupFlags = {
  wakewordAlwaysOn: boolean
  voiceTriggerMode: VoiceTriggerMode
}

export type ModelSetupRequestStore = {
  request: () => void
  hasRequest: () => boolean
  subscribe: (listener: () => void) => () => void
}

/**
 * Creates a per-launch request latch. A request survives view remounts but
 * deliberately not an app restart, so later launches stay quiet until the
 * user reaches for voice again.
 */
export function createModelSetupRequestStore(): ModelSetupRequestStore {
  let requested = false
  const listeners = new Set<() => void>()

  return {
    request() {
      if (requested) return
      requested = true
      for (const listener of [...listeners]) listener()
    },
    hasRequest: () => requested,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

const sharedStore = createModelSetupRequestStore()

/** Marks that the user just tried to use voice and may need the installer. */
export function requestModelSetupOnVoiceUse(): void {
  sharedStore.request()
}

/** Whether this launch has already seen a voice-triggered request. */
export function hasModelSetupRequest(): boolean {
  return sharedStore.hasRequest()
}

/** Subscribes the installer to voice-triggered requests. */
export function subscribeModelSetupRequests(listener: () => void): () => void {
  return sharedStore.subscribe(listener)
}

/**
 * True only when a wake-word control was switched on. Comparing snapshots
 * keeps an already-enabled wake word from reopening the installer on launch.
 */
export function shouldRequestModelSetupForWakewordChange(
  previous: WakewordSetupFlags,
  next: WakewordSetupFlags,
): boolean {
  return (
    (!previous.wakewordAlwaysOn && next.wakewordAlwaysOn)
    || (previous.voiceTriggerMode !== 'wake_word' && next.voiceTriggerMode === 'wake_word')
  )
}
