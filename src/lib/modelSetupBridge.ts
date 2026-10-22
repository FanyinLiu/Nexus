/**
 * Renderer-side dispatcher for voice model setup requests.
 *
 * The installer only exists in the panel window, so a request made from the
 * pet surface is forwarded to the main process, which owns the delayed timer
 * and opens/focuses the panel when it fires. A wake-word save always goes
 * through the main process, whichever surface saved it: that surface may be
 * hidden or reloaded before the delay elapses, and only the main process can
 * raise the panel again. Inventory is checked before arming the timer so an
 * already-installed model set (or an unreadable bridge) never covers the
 * user's screen.
 */

import {
  MODEL_SETUP_WAKEWORD_REQUEST_DELAY_MS,
  requestModelSetupOnVoiceUse,
  resolveModelSetupRequestRoute,
  resolveModelSetupVoiceAction,
  type ModelSetupDeferral,
  type ModelSetupVoiceOutcome,
} from '../features/setup/modelSetupRequests.ts'
import type { WindowView } from '../types'

// Serializes the async inventory check with later saves. A wake-word off that
// lands while the check is in flight must win instead of letting the old save
// schedule a timer after the answer arrives.
let wakewordRequestGeneration = 0

async function hasMissingModels(): Promise<boolean> {
  try {
    const ready = (await window.desktopPet?.modelsGetInventory?.())?.ready
    return ready === false
  } catch {
    return false
  }
}

/**
 * Delivers a request to the window that owns the installer. Returns false
 * when the bridge cannot carry a pet-side request.
 */
async function deliverModelSetupRequest(view: WindowView): Promise<boolean> {
  if (resolveModelSetupRequestRoute(view) === 'local') {
    requestModelSetupOnVoiceUse()
    return true
  }

  const request = window.desktopPet?.requestModelSetup
  if (!request) return false
  await request()
  return true
}

/**
 * Requests the installer after a voice action, but only while required models
 * are actually missing. An unreadable inventory stays quiet so a transient
 * bridge failure cannot cover the user's screen.
 */
export async function requestModelSetupForVoiceUse(view: WindowView): Promise<ModelSetupVoiceOutcome> {
  if (!(await hasMissingModels())) return { delivered: false, remind: false }

  const deferral = await readModelSetupDeferral()
  const action = resolveModelSetupVoiceAction(deferral)
  if (action === 'remind') return { delivered: false, remind: true }
  if (action === 'quiet') return { delivered: false, remind: false }

  return { delivered: await deliverModelSetupRequest(view), remind: false }
}

/**
 * Reads the installer's deferral state from the main process. The refusal and
 * the one reminder it owes live there, so every window answers the same way.
 */
async function readModelSetupDeferral(): Promise<ModelSetupDeferral> {
  const claim = window.desktopPet?.claimModelSetupReminder
  if (!claim) return { declined: false, remind: false }
  try {
    const state = await claim()
    return {
      declined: state?.declined === true,
      remind: state?.remind === true,
    }
  } catch {
    // A bridge that cannot answer leaves the installer alone: the offer stays
    // allowed and the reminder is simply not spent.
    return { declined: false, remind: false }
  }
}

/**
 * Arms the delayed request after a wake-word save. The main process owns the
 * timer, so the request still reaches the user when the saving surface is
 * hidden or reloaded in the meantime.
 */
export async function scheduleModelSetupAfterWakeword(): Promise<boolean> {
  const generation = ++wakewordRequestGeneration
  if (!(await hasMissingModels())) return false
  if (generation !== wakewordRequestGeneration) return false

  const request = window.desktopPet?.requestModelSetup
  if (!request) return false
  await request({ delayMs: MODEL_SETUP_WAKEWORD_REQUEST_DELAY_MS })
  return true
}

/** Retracts a delayed wake-word request from either window. */
export function cancelModelSetupAfterWakeword(): void {
  wakewordRequestGeneration += 1
  const request = window.desktopPet?.requestModelSetup
  if (!request) return
  void request({ cancel: true }).catch(() => undefined)
}

/**
 * Tells the main process that the user answered "maybe later" in the
 * installer. The refusal lives in the main process, so a later voice action
 * cannot raise the chat panel for the installer again — the surface that
 * dismissed the box may be a different window than the one that asks.
 */
export function declineModelSetup(): void {
  // A wake-word save that is still in flight must not re-arm the request
  // after the refusal reached the main process.
  wakewordRequestGeneration += 1
  const decline = window.desktopPet?.declineModelSetup
  if (!decline) return
  void decline().catch(() => undefined)
}

/**
 * The settings-save actions for a wake-word transition. Kept here so the
 * save path and its behavior tests share exactly the same wiring.
 */
export function createModelSetupWakewordActions(): {
  request: () => void
  cancel: () => void
} {
  return {
    request: () => { void scheduleModelSetupAfterWakeword() },
    cancel: () => cancelModelSetupAfterWakeword(),
  }
}
