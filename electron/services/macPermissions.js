import { systemPreferences, dialog, shell } from 'electron'

import { getRedactedErrorMessage } from './errorRedaction.js'

/**
 * macOS 隐私权限自检 + 引导。
 *
 * macOS 的 TCC 不允许应用绕过用户授权 —— 首次"允许"必须用户自己点。
 * 不过我们可以做到:
 *   1. 第一次启动时主动触发系统弹窗(而不是等业务代码跑到受保护 API)
 *   2. 用户已拒绝时弹 Electron 对话框,一键跳转到对应的系统设置页
 *   3. 已允许时静默通过
 *
 * dev 模式下(`npm run electron:dev`)OS 看到的请求方是 Terminal / VS Code,
 * 而不是 Nexus.app —— 这是 Electron dev 模式的固有行为,打包后没这个问题。
 */

// macOS 13+ 支持 "x-apple.systempreferences:" URL scheme 深链到 Privacy 面板。
// 这几个 anchor 在 macOS 13 / 14 / 15 上都稳定。
const SETTINGS_URLS = {
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  automation: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation',
}

function logStatus(kind, status) {
  console.info(`[mac-perm] ${kind}: ${status}`)
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
      console.warn('[mac-perm] failed to open settings:', getRedactedErrorMessage(err))
    })
  }
}

/**
 * 麦克风:有 askForMediaAccess 可以主动触发 OS 弹窗。
 * - not-determined → 调 askForMediaAccess(会弹系统对话框)
 * - denied → 弹 Electron 引导对话框,跳系统设置
 * - granted → 静默通过
 */
async function ensureMicrophonePermission() {
  try {
    const status = systemPreferences.getMediaAccessStatus('microphone')
    logStatus('microphone', status)

    if (status === 'granted') return 'granted'

    if (status === 'not-determined') {
      // 这一步会弹 OS 原生权限对话框。返回值是用户的选择。
      const ok = await systemPreferences.askForMediaAccess('microphone')
      logStatus('microphone (after prompt)', ok ? 'granted' : 'denied')
      return ok ? 'granted' : 'denied'
    }

    if (status === 'denied' || status === 'restricted') {
      await promptOpenSettings({
        title: 'Nexus 需要麦克风权限',
        message: '麦克风权限当前被拒绝。',
        detail: 'Nexus 需要麦克风才能进行语音对话、唤醒词检测和语音识别。\n\n请在系统设置 → 隐私与安全性 → 麦克风 中勾选 Nexus,然后重启应用。\n\n开发模式下 macOS 识别到的请求方是你的终端 / IDE,打包后才会以 Nexus.app 身份申请权限。',
        settingsUrl: SETTINGS_URLS.microphone,
      })
      return status
    }

    return status
  } catch (err) {
    console.warn('[mac-perm] microphone check failed:', getRedactedErrorMessage(err))
    return 'unknown'
  }
}

/**
 * 屏幕录制:没有 askForMediaAccess 对应项。
 * - not-determined → 不主动弹,首次真正 desktopCapturer 调用时 OS 自会弹窗
 * - denied → 弹 Electron 引导对话框,跳系统设置
 * - granted → 静默通过
 */
async function ensureScreenPermission() {
  try {
    const status = systemPreferences.getMediaAccessStatus('screen')
    logStatus('screen', status)

    if (status === 'granted' || status === 'not-determined') {
      return status
    }

    if (status === 'denied' || status === 'restricted') {
      await promptOpenSettings({
        title: 'Nexus 需要屏幕录制权限',
        message: '屏幕录制权限当前被拒绝。',
        detail: 'Nexus 使用屏幕录制来感知你在做什么(OCR / 桌面上下文),让 AI 伙伴能根据画面内容做出反应。\n\n请在系统设置 → 隐私与安全性 → 屏幕录制与系统音频 中勾选 Nexus,然后重启应用。\n\n如果暂时不需要这个功能,可以关掉设置里的"桌面上下文",Nexus 不会再请求。',
        settingsUrl: SETTINGS_URLS.screen,
      })
      return status
    }

    return status
  } catch (err) {
    console.warn('[mac-perm] screen check failed:', getRedactedErrorMessage(err))
    return 'unknown'
  }
}

/**
 * AppleEvents / 自动化(Music / Spotify / System Events):
 * 没有直接的 getMediaAccessStatus('apple-events') API。第一次 osascript
 * 调用时 OS 会自动弹窗询问。我们在 mediaSessionRuntime.js 里已经做了
 * 权限被拒时返回空 session 的 fallback,所以这里不主动检查。
 * 只在启动日志里打一条提示,方便调试。
 */
function noteAutomationCaveat() {
  console.info('[mac-perm] automation: 首次访问 Music/Spotify/System Events 时 OS 会自动询问权限')
}

/**
 * 启动时跑一次,非阻塞。结果只记日志 + 需要时弹引导框。
 */
export async function runMacPermissionChecks({ delayMs = 600 } = {}) {
  if (process.platform !== 'darwin') return

  // 等窗口先稳下来再弹对话框,避免和桌宠 show/focus 抢焦点。
  await new Promise((resolve) => setTimeout(resolve, delayMs))

  const microphone = await ensureMicrophonePermission()
  const screen = await ensureScreenPermission()
  noteAutomationCaveat()

  console.info('[mac-perm] summary', { microphone, screen })
}
