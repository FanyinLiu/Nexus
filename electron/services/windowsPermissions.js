// @ts-nocheck
/**
 * Windows media-permission inspection and guidance.
 *
 * Only the microphone is checked: no current feature uses the camera (it is
 * planned for a later release), so a camera probe would be noise. Startup
 * stays silent because voice settings live in renderer storage; the
 * interactive path runs when the user turns voice input on.
 */

import { dialog, shell, systemPreferences } from 'electron'

import { getRedactedErrorMessage } from './errorRedaction.js'
import { mainT } from '../mainMessages.js'

const SETTINGS_URLS = {
  microphone: 'ms-settings:privacy-microphone',
}

async function promptOpenSettings({ title, message, detail, settingsUrl }, deps) {
  const dialogApi = deps?.dialog ?? dialog
  const shellApi = deps?.shell ?? shell
  const { response } = await dialogApi.showMessageBox({
    type: 'warning',
    title,
    message,
    detail,
    buttons: [mainT('permission.openSettings'), mainT('permission.later')],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  })
  if (response === 0) {
    shellApi.openExternal(settingsUrl).catch((err) => {
      console.warn('[windows-perm] failed to open settings:', getRedactedErrorMessage(err))
    })
  }
}

async function ensureWindowsMediaPermission(kind, { interactive = true, deps } = {}) {
  const prefs = deps?.systemPreferences ?? systemPreferences
  try {
    const status = prefs.getMediaAccessStatus(kind)

    if (status === 'granted' || status === 'not-determined') {
      return status
    }

    if (status === 'denied' || status === 'restricted') {
      if (interactive && kind === 'microphone') {
        await promptOpenSettings({
          title: mainT('permission.microphoneTitle'),
          message: mainT('permission.windows.microphoneMessage'),
          detail: mainT('permission.windows.microphoneDetail'),
          settingsUrl: SETTINGS_URLS.microphone,
        }, deps)
      }
      return status
    }

    return status
  } catch (err) {
    console.warn(`[windows-perm] ${kind} check failed:`, getRedactedErrorMessage(err))
    return 'unknown'
  }
}

/** Inspect the microphone; interactive=true shows the one-shot guidance. */
export function ensureWindowsMicrophonePermission({ interactive = true, deps } = {}) {
  return ensureWindowsMediaPermission('microphone', { interactive, deps })
}

/**
 * Inspect only the microphone when the caller explicitly asks for it.
 * Startup passes microphone=false because there is no durable main-process
 * copy of the voice setting, and the camera is never checked.
 */
export async function runWindowsPermissionChecks({
  delayMs = 600,
  microphone = false,
  interactive = false,
  logStatus = true,
  deps,
} = {}) {
  const platform = deps?.platform ?? process.platform
  if (platform !== 'win32' || !microphone) return {}

  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }

  const status = await ensureWindowsMicrophonePermission({ interactive, deps })
  if (logStatus) console.info('[windows-perm] summary', { microphone: status })
  return { microphone: status }
}
