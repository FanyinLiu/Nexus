// @ts-check
/**
 * Read-only media-permission status for the Settings permission lines.
 *
 * The handler never prompts and only inspects the features the caller says are
 * active. Startup and user-action prompts stay in the shared lifecycle service.
 */

import { ipcMain } from 'electron'

import { requireTrustedSender } from './validate.js'

/**
 * @param {unknown} payload
 * @returns {{ microphoneEnabled: boolean, screenContextActive: boolean }}
 */
export function validateMediaPermissionStatusPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('media permission status request must be an object')
  }
  const request = /** @type {Record<string, unknown>} */ (payload)
  const microphoneEnabled = request.microphoneEnabled ?? false
  const screenContextActive = request.screenContextActive ?? false
  if (typeof microphoneEnabled !== 'boolean' || typeof screenContextActive !== 'boolean') {
    throw new Error('media permission status request must contain boolean feature flags')
  }
  return {
    microphoneEnabled,
    screenContextActive,
  }
}

/**
 * @param {{ mediaPermissionLifecycle?: {
 *   inspectReadOnly: (enabled: unknown) => Promise<unknown>,
 * } }} [options]
 */
export function register({ mediaPermissionLifecycle } = {}) {
  if (!mediaPermissionLifecycle) {
    throw new Error('mediaPermissionLifecycle is required for media permission IPC')
  }
  ipcMain.handle('media-permission:status', async (event, payload) => {
    requireTrustedSender(event)
    const enabled = validateMediaPermissionStatusPayload(payload)
    return mediaPermissionLifecycle.inspectReadOnly({
      microphone: enabled.microphoneEnabled,
      screenContextActive: enabled.screenContextActive,
    })
  })
}
