/**
 * Renderer-side dispatcher for voice model setup requests.
 *
 * The installer only exists in the panel window, so a request made from the
 * pet surface is forwarded to the main process, which opens/focuses the panel
 * and replays the request there. Inventory is checked before latching so an
 * already-installed model set never produces a pointless request.
 */

import {
  requestModelSetupOnVoiceUse,
  resolveModelSetupRequestRoute,
} from '../features/setup/modelSetupRequests.ts'
import type { WindowView } from '../types'

/**
 * Delivers a request to the window that owns the installer. Returns false
 * when the bridge cannot carry a pet-side request.
 */
export async function deliverModelSetupRequest(view: WindowView): Promise<boolean> {
  if (resolveModelSetupRequestRoute(view) === 'panel') {
    const request = window.desktopPet?.requestModelSetup
    if (!request) return false
    await request()
    return true
  }

  requestModelSetupOnVoiceUse()
  return true
}

/**
 * Requests the installer after a voice action, but only while required models
 * are actually missing. An unreadable inventory stays quiet so a transient
 * bridge failure cannot cover the user's screen.
 */
export async function requestModelSetupForVoiceUse(view: WindowView): Promise<boolean> {
  let inventoryReady: boolean | undefined
  try {
    inventoryReady = (await window.desktopPet?.modelsGetInventory?.())?.ready
  } catch {
    return false
  }
  if (inventoryReady !== false) return false
  return deliverModelSetupRequest(view)
}
