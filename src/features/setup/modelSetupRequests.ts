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
 * guide's draft reaches settings only on save), so it waits a beat for the
 * pet view to appear before the installer may cover it.
 */

import type { VoiceTriggerMode } from '../../types/voice.ts'

type WakewordSetupFlags = {
  wakewordAlwaysOn: boolean
  voiceTriggerMode: VoiceTriggerMode
}

/** How long an enable-wake-word request waits before it may cover the pet. */
export const MODEL_SETUP_WAKEWORD_REQUEST_DELAY_MS = 3_000

/** Schedules `task` and returns a cancel function. Injectable for tests. */
export type ModelSetupRequestSchedule = (task: () => void, delayMs: number) => () => void

export type ModelSetupRequestStore = {
  /** Latches the request now. */
  request: () => void
  /**
   * Latches the request after `delayMs`. The returned function cancels a
   * pending latch, so reverting the action within the delay stays quiet.
   */
  requestAfter: (delayMs: number) => () => void
  hasRequest: () => boolean
  subscribe: (listener: () => void) => () => void
}

const defaultSchedule: ModelSetupRequestSchedule = (task, delayMs) => {
  const handle = globalThis.setTimeout(task, delayMs)
  return () => { globalThis.clearTimeout(handle) }
}

/**
 * Creates a per-launch request latch. A request survives view remounts but
 * deliberately not an app restart, so later launches stay quiet until the
 * user reaches for voice again.
 */
export function createModelSetupRequestStore(
  schedule: ModelSetupRequestSchedule = defaultSchedule,
): ModelSetupRequestStore {
  let requested = false
  const listeners = new Set<() => void>()

  const request = () => {
    if (requested) return
    requested = true
    for (const listener of [...listeners]) listener()
  }

  return {
    request,
    requestAfter: (delayMs) => schedule(request, delayMs),
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
 * Marks that the user switched a wake word on. Deferred so the pet view wins
 * the first moments after finishing onboarding.
 */
export function requestModelSetupOnWakewordEnabled(): void {
  sharedStore.requestAfter(MODEL_SETUP_WAKEWORD_REQUEST_DELAY_MS)
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
