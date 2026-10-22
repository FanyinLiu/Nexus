/**
 * Voice-triggered requests for the local model installer.
 *
 * The overlay must stay quiet at launch and after onboarding, but open when
 * the user first does something that needs the local voice models. Voice
 * hooks publish that intent here; the overlay subscribes without either side
 * owning the other's React state.
 *
 * Two intents exist. Pressing the mic button is an explicit "talk to me now",
 * so it latches at once. Switching a wake-word control on only says "later",
 * and it can land in the same click as the onboarding Finish button (the
 * guide's draft reaches settings only on save), so the request waits a beat
 * before the installer may cover the pet view.
 *
 * This module owns the latch the installer reads. The delay itself belongs to
 * the main process (the model setup request gate), because the surface that
 * armed the request may be hidden or reloaded before it elapses.
 */

import type { WindowView } from '../../types'
import type { VoiceTriggerMode } from '../../types/voice.ts'

type WakewordSetupFlags = {
  wakewordAlwaysOn: boolean
  voiceTriggerMode: VoiceTriggerMode
}

/** How long an enable-wake-word request waits before it may cover the pet. */
export const MODEL_SETUP_WAKEWORD_REQUEST_DELAY_MS = 3_000

export type ModelSetupRequestStore = {
  /** Latches the request now. */
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

  const request = () => {
    if (requested) return
    requested = true
    for (const listener of [...listeners]) listener()
  }

  return {
    request,
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

/**
 * The panel window owns the installer. An immediate voice request made in the
 * panel latches there directly; a pet-side request is forwarded to the main
 * process, which opens/focuses the panel before replaying it there.
 */
export function resolveModelSetupRequestRoute(view: WindowView): 'local' | 'panel' {
  return view === 'panel' ? 'local' : 'panel'
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

/** True when a wake-word control is switched back off. */
export function shouldCancelModelSetupForWakewordChange(
  previous: WakewordSetupFlags,
  next: WakewordSetupFlags,
): boolean {
  return (
    (previous.wakewordAlwaysOn && !next.wakewordAlwaysOn)
    || (previous.voiceTriggerMode === 'wake_word' && next.voiceTriggerMode !== 'wake_word')
  )
}

/**
 * Applies a settings-save transition to the delayed request. Keeping the
 * decision here means the save path only wires the request, while the on/off
 * semantics stay testable without React or the Electron bridge.
 */
export function applyModelSetupWakewordChange(
  previous: WakewordSetupFlags,
  next: WakewordSetupFlags,
  actions: { request: () => void; cancel: () => void },
): 'request' | 'cancel' | 'none' {
  if (shouldRequestModelSetupForWakewordChange(previous, next)) {
    actions.request()
    return 'request'
  }
  if (shouldCancelModelSetupForWakewordChange(previous, next)) {
    actions.cancel()
    return 'cancel'
  }
  return 'none'
}
