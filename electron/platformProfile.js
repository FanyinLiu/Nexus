import fs from 'node:fs'
import path from 'node:path'

export const DESKTOP_PLATFORMS = new Set(['darwin', 'win32', 'linux'])

function splitSearchPath(rawPath, platform) {
  const delimiter = platform === 'win32' ? ';' : ':'
  return String(rawPath ?? '').split(delimiter).filter(Boolean)
}

function getWindowsExecutableCandidates(command, env) {
  if (path.extname(command)) return [command]
  const extensions = String(env.PATHEXT || '.EXE;.CMD;.BAT;.COM')
    .split(';')
    .map((extension) => extension.trim())
    .filter(Boolean)
  return extensions.map((extension) => `${command}${extension}`)
}

export function isExecutableOnPath(
  command,
  {
    env = process.env,
    platform = process.platform,
  } = {},
) {
  const executableName = String(command ?? '').trim()
  if (!executableName) return false

  const searchPaths = splitSearchPath(env.PATH, platform)
  const candidates = platform === 'win32'
    ? getWindowsExecutableCandidates(executableName, env)
    : [executableName]

  for (const directory of searchPaths) {
    for (const candidate of candidates) {
      const candidatePath = path.join(directory, candidate)
      try {
        if (platform === 'win32') {
          if (fs.existsSync(candidatePath)) return true
        } else {
          fs.accessSync(candidatePath, fs.constants.X_OK)
          return true
        }
      } catch {
        // Keep scanning PATH entries.
      }
    }
  }

  return false
}

export function isAnyExecutableOnPath(commands, options = {}) {
  return commands.some((command) => isExecutableOnPath(command, options))
}

export function getStartupMechanism(platform = process.platform) {
  if (platform === 'linux') return 'xdg_autostart'
  if (platform === 'darwin' || platform === 'win32') return 'login_item'
  return 'unsupported'
}

export function getMediaSessionBackend(platform = process.platform) {
  if (platform === 'linux') return 'playerctl'
  if (platform === 'darwin') return 'osascript'
  if (platform === 'win32') return 'windows_media_session'
  return 'unsupported'
}

function resolveLinuxActiveWindowAvailability(env, hasExecutable) {
  const hasDisplay = Boolean(String(env.DISPLAY ?? '').trim())
  const hasTool = hasExecutable('xdotool') || hasExecutable('xprop')

  return {
    available: hasDisplay && hasTool,
    dependencyHint: 'xdotool/xprop + X11/XWayland DISPLAY',
  }
}

function hasDesktopDisplay(platform, env) {
  if (platform !== 'linux') return true
  return Boolean(
    String(env.DISPLAY ?? '').trim()
    || String(env.WAYLAND_DISPLAY ?? '').trim(),
  )
}

export function buildPlatformProfile({
  platform = process.platform,
  packaged = false,
  launchOnStartupEnabled = false,
  trayActive = false,
  env = process.env,
  hasExecutable = (command) => isExecutableOnPath(command, { env, platform }),
} = {}) {
  const isDesktopPlatform = DESKTOP_PLATFORMS.has(platform)
  const startupSupported = packaged && isDesktopPlatform
  const linuxActiveWindow = platform === 'linux'
    ? resolveLinuxActiveWindowAvailability(env, hasExecutable)
    : null
  const displayAvailable = isDesktopPlatform && hasDesktopDisplay(platform, env)
  const mediaSessionAvailable = platform === 'linux'
    ? hasExecutable('playerctl')
    : isDesktopPlatform

  return {
    platform,
    packaged,
    startup: {
      supported: startupSupported,
      enabled: startupSupported ? launchOnStartupEnabled : false,
      requiresPackagedBuild: true,
      mechanism: getStartupMechanism(platform),
    },
    tray: {
      active: trayActive,
      hideToBackgroundOnClose: platform === 'darwin' || trayActive,
    },
    window: {
      supportsVisibleOnAllWorkspaces: platform === 'darwin' || platform === 'linux',
      usesTaskbarIcon: platform === 'win32' || platform === 'linux',
      supportsTransparentOverlay: isDesktopPlatform,
    },
    mediaSession: {
      supported: isDesktopPlatform,
      available: mediaSessionAvailable,
      backend: getMediaSessionBackend(platform),
      dependencyHint: platform === 'linux' ? 'playerctl' : null,
    },
    desktopContext: {
      activeWindowSupported: isDesktopPlatform,
      activeWindowAvailable: platform === 'linux'
        ? linuxActiveWindow.available
        : isDesktopPlatform,
      activeWindowDependencyHint: platform === 'linux'
        ? linuxActiveWindow.dependencyHint
        : platform === 'darwin'
          ? 'macOS Automation permission'
          : null,
      screenshotSupported: isDesktopPlatform,
      screenshotAvailable: displayAvailable,
      screenshotDependencyHint: platform === 'linux' ? 'X11/Wayland display session' : null,
      clipboardSupported: isDesktopPlatform,
      clipboardAvailable: displayAvailable,
    },
    voice: {
      speechInputSupported: isDesktopPlatform,
      speechInputAvailable: isDesktopPlatform,
      speechOutputSupported: isDesktopPlatform,
      speechOutputAvailable: isDesktopPlatform,
      continuousVoiceSupported: isDesktopPlatform,
      vadSupported: isDesktopPlatform,
      wakewordSupported: isDesktopPlatform,
      dependencyHint: platform === 'linux' ? 'PulseAudio/PipeWire microphone access' : null,
    },
  }
}
