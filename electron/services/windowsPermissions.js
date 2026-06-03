import { dialog, shell, systemPreferences } from 'electron'

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
    buttons: ['打开系统设置', '稍后'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  })
  if (response === 0) {
    shell.openExternal(settingsUrl).catch((err) => {
      console.warn('[windows-perm] failed to open settings:', err?.message)
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
          title: 'Nexus 需要麦克风权限',
          message: 'Windows 的麦克风访问当前被禁用。',
          detail: '请在 Windows 设置 → 隐私和安全性 → 麦克风 中允许桌面应用访问麦克风，然后重启 Nexus。',
          settingsUrl: SETTINGS_URLS.microphone,
        })
      } else if (kind === 'camera') {
        await promptOpenSettings({
          title: 'Nexus 需要摄像头权限',
          message: 'Windows 的摄像头访问当前被禁用。',
          detail: '请在 Windows 设置 → 隐私和安全性 → 摄像头 中允许桌面应用访问摄像头，然后重启 Nexus。',
          settingsUrl: SETTINGS_URLS.camera,
        })
      }
      return status
    }

    return status
  } catch (err) {
    console.warn(`[windows-perm] ${kind} check failed:`, err?.message)
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

