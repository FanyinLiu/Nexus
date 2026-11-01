import { dialog, shell, systemPreferences } from 'electron'

import { getRedactedErrorMessage } from './errorRedaction.js'
import { mainT } from '../mainMessages.js'

const SETTINGS_URLS = {
  microphone: 'ms-settings:privacy-microphone',
  camera: 'ms-settings:privacy-webcam',
}

function logStatus(kind, status) {
  console.info(`[windows-perm] ${kind}: ${status}`)
}

async function promptOpenSettings({ title, message, detail, settingsUrl }) {
  const { response } = await dialog.showMessageBox({
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
    shell.openExternal(settingsUrl).catch((err) => {
      console.warn('[windows-perm] failed to open settings:', getRedactedErrorMessage(err))
    })
  }
}

async function ensureWindowsMediaPermission(kind) {
  try {
    const status = systemPreferences.getMediaAccessStatus(kind)
    logStatus(kind, status)

    if (status === 'granted' || status === 'not-determined') {
      return status
    }

    if (status === 'denied' || status === 'restricted') {
      if (kind === 'microphone') {
        await promptOpenSettings({
          title: mainT('permission.microphoneTitle'),
          message: mainT('permission.windows.microphoneMessage'),
          detail: mainT('permission.windows.microphoneDetail'),
          settingsUrl: SETTINGS_URLS.microphone,
        })
      } else if (kind === 'camera') {
        await promptOpenSettings({
          title: mainT('permission.cameraTitle'),
          message: mainT('permission.windows.cameraMessage'),
          detail: mainT('permission.windows.cameraDetail'),
          settingsUrl: SETTINGS_URLS.camera,
        })
      }
      return status
    }

    return status
  } catch (err) {
    console.warn(`[windows-perm] ${kind} check failed:`, getRedactedErrorMessage(err))
    return 'unknown'
  }
}

export async function runWindowsPermissionChecks({ delayMs = 600 } = {}) {
  if (process.platform !== 'win32') return

  await new Promise((resolve) => setTimeout(resolve, delayMs))

  const microphone = await ensureWindowsMediaPermission('microphone')
  const camera = await ensureWindowsMediaPermission('camera')
  console.info('[windows-perm] summary', { microphone, camera })
}
