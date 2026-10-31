// @ts-check
// Typed IPC for adaptive desktop presence. Payloads are booleans in and
// aggregate signals out. requireTrustedSender keeps the channels on the
// same renderer boundary as the rest of the bridge.

import { ipcMain } from 'electron'
import { requireTrustedSender } from './validate.js'
import {
  applyDesktopPresencePreferences,
  getTypingStatus,
  openTypingPermissionSettings,
  startDesktopPresence,
  stopDesktopPresence,
} from '../services/desktopPresence.js'

/**
 * @param {unknown} payload
 * @returns {{ gazeFollowEnabled: boolean, typingAwarenessEnabled: boolean }}
 */
export function validateDesktopPresencePreferencesPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('desktop presence preferences must be an object')
  }
  const preferences = /** @type {Record<string, unknown>} */ (payload)
  return {
    gazeFollowEnabled: preferences.gazeFollowEnabled !== false,
    typingAwarenessEnabled: preferences.typingAwarenessEnabled === true,
  }
}

/** Register presence handlers and start the sampler. A missing hook cannot throw out of here. */
export function register() {
  startDesktopPresence()

  ipcMain.handle('desktop-presence:set-preferences', (event, payload) => {
    requireTrustedSender(event)
    const preferences = validateDesktopPresencePreferencesPayload(payload)
    return applyDesktopPresencePreferences(preferences)
  })

  ipcMain.handle('desktop-presence:get-typing-status', (event) => {
    requireTrustedSender(event)
    return getTypingStatus()
  })

  ipcMain.handle('desktop-presence:open-typing-permission', async (event) => {
    requireTrustedSender(event)
    return openTypingPermissionSettings()
  })
}

/** Quit hook: stop the sampler and the native keyboard hook. */
export function stop() {
  stopDesktopPresence()
}
