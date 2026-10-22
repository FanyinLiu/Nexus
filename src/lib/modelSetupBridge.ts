/**
 * Renderer-side dispatcher for voice model setup requests.
 *
 * The installer only exists in the panel window, so a request made from the
 * pet surface is forwarded to the main process, which owns the delayed timer
 * and opens/focuses the panel when it fires. Panel-side requests can keep the
 * timer locally because dismissing the box there is the same store. Inventory
 * is checked before arming either timer so an already-installed model set (or
 * an unreadable bridge) never covers the user's screen.
 */

import {
  MODEL_SETUP_WAKEWORD_REQUEST_DELAY_MS,
  cancelModelSetupWakewordRequest,
  requestModelSetupOnVoiceUse,
  requestModelSetupOnWakewordEnabled,
  resolveModelSetupRequestRoute,
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
export async function requestModelSetupForVoiceUse(view: WindowView): Promise<boolean> {
  if (!(await hasMissingModels())) return false
  return deliverModelSetupRequest(view)
}

/**
 * Arms the delayed request after a wake-word save. Panel-side saves keep the
 * timer with the installer owner, where dismissal and unmount can clear it.
 * A pet-side save delegates to the main process so the panel's consume call
 * cancels the same timer even though it lives in another window.
 */
export async function scheduleModelSetupAfterWakeword(view: WindowView): Promise<boolean> {
  const generation = ++wakewordRequestGeneration
  if (!(await hasMissingModels())) return false
  if (generation !== wakewordRequestGeneration) return false

  if (resolveModelSetupRequestRoute(view) === 'local') {
    requestModelSetupOnWakewordEnabled()
    return true
  }

  const request = window.desktopPet?.requestModelSetup
  if (!request) return false
  await request({ delayMs: MODEL_SETUP_WAKEWORD_REQUEST_DELAY_MS })
  return true
}

/** Retracts a delayed wake-word request from either window. */
export function cancelModelSetupAfterWakeword(view: WindowView): void {
  wakewordRequestGeneration += 1
  if (resolveModelSetupRequestRoute(view) === 'local') {
    cancelModelSetupWakewordRequest()
    return
  }
  const request = window.desktopPet?.requestModelSetup
  if (!request) return
  void request({ cancel: true }).catch(() => undefined)
}

/**
 * The settings-save actions for a wake-word transition. Kept here so the
 * save path and its behavior tests share exactly the same wiring.
 */
export function createModelSetupWakewordActions(view: WindowView): {
  request: () => void
  cancel: () => void
} {
  return {
    request: () => { void scheduleModelSetupAfterWakeword(view) },
    cancel: () => cancelModelSetupAfterWakeword(view),
  }
}
