import { ipcMain } from 'electron'

import { requireTrustedSender } from './validate.js'
import { validateVoiceRuntimeSyncPayload } from './payloadSchemas.js'

/**
 * Push the selected voice engines from the renderer so the main process can
 * start/stop the optional Python sidecars on demand. The payload is only the
 * engine ids and voice switches — no keys or user text.
 *
 * @param {{ voiceSidecarSupervisor?: { applySettings: (payload: object) => unknown } }} deps
 */
export function register({ voiceSidecarSupervisor } = {}) {
  ipcMain.handle('voice-runtime:sync', (event, payload) => {
    requireTrustedSender(event)
    payload = validateVoiceRuntimeSyncPayload(payload)
    // Starting a sidecar can take minutes (model load). Never make a settings
    // commit wait on that; the supervisor serialises transitions internally.
    voiceSidecarSupervisor?.applySettings(payload)
    return { ok: Boolean(voiceSidecarSupervisor) }
  })
}
