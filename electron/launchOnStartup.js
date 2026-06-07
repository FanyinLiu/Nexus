import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { getPetIconPath } from './windowAssets.js'

const WINDOWS_LOGIN_ITEM_ARGS = ['--launch-at-login']
const LINUX_AUTOSTART_FILENAME = 'nexus-autostart.desktop'
const LINUX_AUTOSTART_ARG = '--launch-at-login'

function escapeDesktopExecToken(token) {
  return String(token ?? '')
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('`', '\\`')
    .replaceAll('$', '\\$')
}

function quoteDesktopExecToken(token) {
  return `"${escapeDesktopExecToken(token)}"`
}

function getWindowsLoginItemOptions() {
  if (process.platform !== 'win32') return {}
  return {
    path: process.execPath,
    args: WINDOWS_LOGIN_ITEM_ARGS,
  }
}

function getLinuxAutostartDesktopPath() {
  const xdgConfigHome = String(process.env.XDG_CONFIG_HOME ?? '').trim()
  const configHome = xdgConfigHome || path.join(app.getPath('home'), '.config')
  return path.join(configHome, 'autostart', LINUX_AUTOSTART_FILENAME)
}

function buildLinuxAutostartDesktopEntry() {
  const appName = String(app.name || 'Nexus').trim() || 'Nexus'
  const execPath = process.execPath
  const execLine = `${quoteDesktopExecToken(execPath)} ${quoteDesktopExecToken(LINUX_AUTOSTART_ARG)}`
  const iconPath = getPetIconPath('linux')
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Version=1.0',
    `Name=${appName}`,
    'Comment=Nexus desktop companion',
    `Exec=${execLine}`,
    `Icon=${iconPath}`,
    'Terminal=false',
    'StartupNotify=true',
    'StartupWMClass=Nexus',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n')
}

function getLinuxLaunchOnStartupState() {
  const autostartFile = getLinuxAutostartDesktopPath()
  try {
    const content = fs.readFileSync(autostartFile, 'utf8')
    if (!content || !content.includes('[Desktop Entry]')) return false
    if (/^\s*Hidden\s*=\s*true\s*$/im.test(content)) return false
    return true
  } catch {
    return false
  }
}

function setLinuxLaunchOnStartupState(value) {
  const autostartFile = getLinuxAutostartDesktopPath()
  if (value) {
    try {
      fs.mkdirSync(path.dirname(autostartFile), { recursive: true, mode: 0o700 })
      fs.writeFileSync(autostartFile, buildLinuxAutostartDesktopEntry(), { encoding: 'utf8', mode: 0o644 })
    } catch {
      return false
    }
    return getLinuxLaunchOnStartupState()
  }

  try {
    fs.unlinkSync(autostartFile)
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      return false
    }
  }
  return false
}

export function getLaunchOnStartupState() {
  if (!app.isPackaged) {
    return false
  }

  if (process.platform === 'linux') {
    return getLinuxLaunchOnStartupState()
  }

  try {
    const exact = app.getLoginItemSettings(getWindowsLoginItemOptions())
    if (exact?.openAtLogin === true) return true
    if (process.platform === 'win32') {
      const fallback = app.getLoginItemSettings()
      return Boolean(fallback?.openAtLogin || fallback?.executableWillLaunchAtLogin)
    }
    return false
  } catch {
    return false
  }
}

export function setLaunchOnStartupState(value) {
  if (!app.isPackaged) {
    return false
  }

  if (process.platform === 'linux') {
    return setLinuxLaunchOnStartupState(Boolean(value))
  }

  try {
    app.setLoginItemSettings({
      openAtLogin: Boolean(value),
      ...getWindowsLoginItemOptions(),
    })
  } catch {
    return false
  }

  return getLaunchOnStartupState()
}
