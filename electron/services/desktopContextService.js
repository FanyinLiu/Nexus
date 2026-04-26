import { clipboard, desktopCapturer, screen } from 'electron'
import { execFile } from 'node:child_process'

const ACTIVE_WINDOW_CONTEXT_TIMEOUT_MS = 1_400
const ACTIVE_WINDOW_CONTEXT_CACHE_TTL_MS = 4_000

const ACTIVE_WINDOW_CAPTURE_SCRIPT = `
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class Win32ForegroundWindow {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@

$windowHandle = [Win32ForegroundWindow]::GetForegroundWindow()
if ($windowHandle -eq [IntPtr]::Zero) {
  [pscustomobject]@{
    title = ''
    appName = ''
    processPath = ''
  } | ConvertTo-Json -Compress
  exit 0
}

$titleBuilder = New-Object System.Text.StringBuilder 1024
[void][Win32ForegroundWindow]::GetWindowText($windowHandle, $titleBuilder, $titleBuilder.Capacity)
$processId = [uint32]0
[void][Win32ForegroundWindow]::GetWindowThreadProcessId($windowHandle, [ref]$processId)
$process = Get-Process -Id $processId -ErrorAction SilentlyContinue

[pscustomobject]@{
  title = $titleBuilder.ToString()
  appName = if ($process) { $process.ProcessName } else { '' }
  processPath = if ($process -and $process.Path) { $process.Path } else { '' }
} | ConvertTo-Json -Compress
`.trim()

let activeWindowContextCache = {
  capturedAt: 0,
  value: null,
  pending: null,
}

// Permission-denied dedup for macOS osascript -1743 ("not authorized to send
// Apple events to System Events"). Once we hit it, the context capture has
// no chance of succeeding until the user grants Automation permission via
// System Settings → Privacy & Security → Automation. Polling every few
// seconds and logging each failure floods both stdout and the renderer
// console; instead we log once, suppress further attempts for a long
// re-check window, and try again after that to detect if permission was
// granted in the meantime.
const ACTIVE_WINDOW_PERMISSION_RECHECK_MS = 10 * 60 * 1000
let activeWindowPermissionDeniedAt = 0

function shortenContextValue(value, maxLength) {
  const normalized = String(value ?? '').trim()
  if (!normalized) return ''
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`
}

function normalizeActiveWindowSnapshot(rawSnapshot) {
  if (!rawSnapshot || typeof rawSnapshot !== 'object') {
    return null
  }

  const activeWindowTitle = shortenContextValue(rawSnapshot.title, 180)
  const activeWindowAppName = shortenContextValue(rawSnapshot.appName, 80)
  const activeWindowProcessPath = shortenContextValue(rawSnapshot.processPath, 240)

  if (!activeWindowTitle && !activeWindowAppName && !activeWindowProcessPath) {
    return null
  }

  return {
    activeWindowTitle,
    activeWindowAppName,
    activeWindowProcessPath,
  }
}

const MACOS_ACTIVE_WINDOW_SCRIPT = [
  'tell application "System Events"',
  '  set frontApp to first application process whose frontmost is true',
  '  set appName to name of frontApp',
  '  set windowTitle to ""',
  '  try',
  '    set windowTitle to name of front window of frontApp',
  '  end try',
  '  return "{" & quoted form of ("\"appName\":" & quoted form of appName & ",\"title\":" & quoted form of windowTitle) & "}"',
  'end tell',
].join('\n')

function captureActiveWindowContextMac() {
  const now = Date.now()
  if (
    activeWindowContextCache.value
    && now - activeWindowContextCache.capturedAt < ACTIVE_WINDOW_CONTEXT_CACHE_TTL_MS
  ) {
    return Promise.resolve(activeWindowContextCache.value)
  }

  // Permission denied earlier — don't even try until the recheck window
  // elapses. Avoids the every-poll log spam that would otherwise drown
  // dev / production logs while the user has the permission off.
  if (
    activeWindowPermissionDeniedAt
    && now - activeWindowPermissionDeniedAt < ACTIVE_WINDOW_PERMISSION_RECHECK_MS
  ) {
    return Promise.resolve(null)
  }

  if (activeWindowContextCache.pending) {
    return activeWindowContextCache.pending
  }

  activeWindowContextCache.pending = new Promise((resolve) => {
    execFile(
      'osascript',
      ['-e', 'tell application "System Events" to set frontApp to first application process whose frontmost is true\nset appName to name of frontApp\ntell application "System Events" to set windowTitle to ""\ntry\ntell application "System Events" to set windowTitle to name of front window of frontApp\nend try\nreturn appName & "\\n" & windowTitle'],
      {
        timeout: ACTIVE_WINDOW_CONTEXT_TIMEOUT_MS,
        maxBuffer: 256 * 1024,
      },
      (error, stdout) => {
        if (error) {
          const message = error?.message || ''
          // -1743 = "not authorized to send Apple events". Latch the
          // permission-denied state so we stop polling for the recheck window
          // and only log once instead of every cache miss.
          if (message.includes('-1743') || message.includes('not authorized')) {
            const wasFirstHit = activeWindowPermissionDeniedAt === 0
            activeWindowPermissionDeniedAt = Date.now()
            if (wasFirstHit) {
              console.warn(
                '[desktop-context:mac] AppleScript permission denied (-1743). '
                + 'Grant Nexus access in System Settings → Privacy & Security → Automation. '
                + `Will silently retry in ${Math.round(ACTIVE_WINDOW_PERMISSION_RECHECK_MS / 60_000)} min.`,
              )
            }
            resolve(null)
            return
          }
          console.warn('[desktop-context:mac] active window capture failed', message)
          resolve(null)
          return
        }

        // Success — clear permission-denied latch (user must have granted it).
        if (activeWindowPermissionDeniedAt) {
          console.info('[desktop-context:mac] AppleScript permission restored')
          activeWindowPermissionDeniedAt = 0
        }

        try {
          const lines = String(stdout ?? '').split('\n')
          const appName = (lines[0] ?? '').trim()
          const title = (lines[1] ?? '').trim()
          const snapshot = normalizeActiveWindowSnapshot({
            title,
            appName,
            processPath: '',
          })
          resolve(snapshot)
        } catch (parseError) {
          console.warn('[desktop-context:mac] parse failed', parseError)
          resolve(null)
        }
      },
    )
  }).then((snapshot) => {
    activeWindowContextCache = {
      capturedAt: snapshot ? Date.now() : 0,
      value: snapshot,
      pending: null,
    }
    return snapshot
  })

  return activeWindowContextCache.pending
}

export function captureActiveWindowContext() {
  if (process.platform === 'darwin') {
    return captureActiveWindowContextMac()
  }

  if (process.platform !== 'win32') {
    return Promise.resolve(null)
  }

  const now = Date.now()
  if (
    activeWindowContextCache.value
    && now - activeWindowContextCache.capturedAt < ACTIVE_WINDOW_CONTEXT_CACHE_TTL_MS
  ) {
    return Promise.resolve(activeWindowContextCache.value)
  }

  if (activeWindowContextCache.pending) {
    return activeWindowContextCache.pending
  }

  activeWindowContextCache.pending = new Promise((resolve) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        ACTIVE_WINDOW_CAPTURE_SCRIPT,
      ],
      {
        timeout: ACTIVE_WINDOW_CONTEXT_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 256 * 1024,
      },
      (error, stdout) => {
        if (error) {
          console.warn('[desktop-context:get] active window capture failed', error)
          resolve(null)
          return
        }

        try {
          const normalizedSnapshot = normalizeActiveWindowSnapshot(
            JSON.parse(String(stdout ?? '').trim() || '{}'),
          )
          resolve(normalizedSnapshot)
        } catch (parseError) {
          console.warn('[desktop-context:get] active window parse failed', parseError)
          resolve(null)
        }
      },
    )
  }).then((snapshot) => {
    activeWindowContextCache = {
      capturedAt: snapshot ? Date.now() : 0,
      value: snapshot,
      pending: null,
    }
    return snapshot
  })

  return activeWindowContextCache.pending
}

export async function captureScreenshotContext() {
  try {
    const primaryDisplay = screen.getPrimaryDisplay()
    const thumbnailSize = {
      width: Math.max(640, Math.min(1_600, Math.round(primaryDisplay.size.width * 0.6))),
      height: Math.max(360, Math.min(900, Math.round(primaryDisplay.size.height * 0.6))),
    }
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize,
    })

    const source = sources[0]
    if (!source?.thumbnail || source.thumbnail.isEmpty()) {
      return null
    }

    return {
      displayName: source.name,
      screenshotDataUrl: source.thumbnail.toDataURL(),
    }
  } catch (error) {
    console.warn('[desktop-context:get] screenshot capture failed', error)
    return null
  }
}

export function normalizeDesktopContextPolicy(policy) {
  if (!policy || typeof policy !== 'object') {
    return {
      activeWindow: true,
      clipboard: true,
      screenshot: true,
    }
  }

  return {
    activeWindow: policy.activeWindow !== false,
    clipboard: policy.clipboard !== false,
    screenshot: policy.screenshot !== false,
  }
}

export { clipboard }
