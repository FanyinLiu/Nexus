// @ts-nocheck
/**
 * macOS media-permission inspection and guidance.
 *
 * TCC does not let the app grant itself access; only the user can. The startup
 * path therefore only inspects features that are already enabled and never
 * opens a guidance dialog. The interactive path runs when the user turns a
 * feature on: that is the only place we ask the OS or deep-link Settings, so a
 * previous denial can never turn into a prompt on every launch.
 */

import { systemPreferences, dialog, shell } from 'electron'

import { getRedactedErrorMessage } from './errorRedaction.js'
import { mainT } from '../mainMessages.js'

// macOS 13+ supports "x-apple.systempreferences:" deeplinks to Privacy panes.
// These anchors are stable on macOS 13 / 14 / 15.
const SETTINGS_URLS = {
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  automation: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation',
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
    shellApi.openExternal(settingsUrl).catch(() => {
      console.warn('[mac-perm] failed to open settings')
    })
  }
}

/**
 * Microphone: askForMediaAccess can trigger the native OS dialog.
 * - not-determined + interactive → ask the OS once
 * - not-determined + startup → leave it alone; the first real capture asks
 * - denied / restricted + interactive → show the one-shot Settings guidance
 * - denied / restricted + startup → stay silent, never re-nag
 */
export async function ensureMacMicrophonePermission({ interactive = true, deps } = {}) {
  const prefs = deps?.systemPreferences ?? systemPreferences
  try {
    const status = prefs.getMediaAccessStatus('microphone')

    if (status === 'granted') return 'granted'

    if (status === 'not-determined') {
      if (!interactive) return status
      const ok = await prefs.askForMediaAccess('microphone')
      return ok ? 'granted' : 'denied'
    }

    if (status === 'denied' || status === 'restricted') {
      if (interactive) {
        await promptOpenSettings({
          title: mainT('permission.microphoneTitle'),
          message: mainT('permission.mac.microphoneMessage'),
          detail: mainT('permission.mac.microphoneDetail'),
          settingsUrl: SETTINGS_URLS.microphone,
        }, deps)
      }
      return status
    }

    return status
  } catch (err) {
    console.warn('[mac-perm] microphone check failed:', getRedactedErrorMessage(err))
    return 'unknown'
  }
}

/**
 * Screen recording: there is no askForMediaAccess equivalent.
 * - not-determined → never probe at startup; the first desktopCapturer call
 *   lets the OS ask after a real user action
 * - denied / restricted + interactive → show the one-shot Settings guidance
 * - denied / restricted + startup → stay silent, never re-nag
 */
export async function ensureMacScreenPermission({ interactive = true, deps } = {}) {
  const prefs = deps?.systemPreferences ?? systemPreferences
  try {
    const status = prefs.getMediaAccessStatus('screen')

    if (status === 'granted' || status === 'not-determined') {
      return status
    }

    if (status === 'denied' || status === 'restricted') {
      if (interactive) {
        await promptOpenSettings({
          title: mainT('permission.screenTitle'),
          message: mainT('permission.mac.screenMessage'),
          detail: mainT('permission.mac.screenDetail'),
          settingsUrl: SETTINGS_URLS.screen,
        }, deps)
      }
      return status
    }

    return status
  } catch (err) {
    console.warn('[mac-perm] screen check failed:', getRedactedErrorMessage(err))
    return 'unknown'
  }
}

/**
 * Inspect only the features the caller says are enabled. Startup passes
 * interactive=false, so a denied permission is logged but never re-prompts.
 * The microphone is not inspected at startup because its setting lives in
 * renderer storage; the user-action path asks when voice input is turned on.
 */
export async function runMacPermissionChecks({
  delayMs = 600,
  microphone = false,
  screen = false,
  interactive = false,
  logStatus = true,
  deps,
} = {}) {
  const platform = deps?.platform ?? process.platform
  if (platform !== 'darwin' || (!microphone && !screen)) return {}

  // Let the window settle before asking the OS, so the pet's show/focus does
  // not fight the system dialog for focus.
  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }

  const summary = {}
  if (microphone) {
    summary.microphone = await ensureMacMicrophonePermission({ interactive, deps })
  }
  if (screen) {
    summary.screen = await ensureMacScreenPermission({ interactive, deps })
  }

  if (logStatus) console.info('[mac-perm] summary', summary)
  return summary
}
