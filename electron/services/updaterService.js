// Auto-update integration via electron-updater + GitHub Releases.
//
// Lifecycle:
//   - On app start (after main window is ready), call initAutoUpdater().
//     It registers event listeners and triggers a silent background check.
//   - The renderer can also explicitly trigger checkForUpdatesNow() through IPC,
//     used by the "Check for updates" button in settings.
//   - When an update is available it is downloaded automatically (in the
//     background). Once downloaded, the renderer is notified and may invoke
//     installAndQuit() to apply the update.
//
// Events broadcast to the renderer (channel: 'updater:event'):
//   { type: 'checking' }
//   { type: 'available', version, releaseNotes? }
//   { type: 'not-available', version }
//   { type: 'progress', percent, transferred, total, bytesPerSecond }
//   { type: 'downloaded', version, releaseNotes? }
//   { type: 'error', message }

import electronUpdater from 'electron-updater'
import { app, shell } from 'electron'
import {
  compareReleaseVersions,
  GITHUB_RELEASES_API_URL,
  GITHUB_RELEASES_URL,
  normalizeGithubReleasePayload,
  resolveUpdaterMode,
} from './updatePolicy.js'

const { autoUpdater } = electronUpdater

let initialized = false
let lastStatus = { type: 'idle' }
let getBroadcastTargets = () => []
let updateMode = resolveUpdaterMode({ isPackaged: app.isPackaged })

function broadcast(payload) {
  lastStatus = payload
  for (const win of getBroadcastTargets()) {
    if (!win || win.isDestroyed?.()) continue
    try {
      win.webContents.send('updater:event', payload)
    } catch (error) {
      console.warn('[updater] failed to send event to renderer:', error?.message)
    }
  }
}

export function initAutoUpdater({ getWindows }) {
  if (initialized) return
  initialized = true
  updateMode = resolveUpdaterMode({ isPackaged: app.isPackaged })

  if (typeof getWindows === 'function') {
    getBroadcastTargets = getWindows
  }

  // In dev (unpackaged), electron-updater fails immediately because there's no
  // installer to update. Skip silently — the IPC still works and reports idle.
  if (!app.isPackaged) {
    console.info('[updater] dev mode — skipping auto-update wiring')
    return
  }

  if (updateMode === 'manual-download') {
    console.info('[updater] unsigned macOS mode — using check-only release downloads')
    setTimeout(() => {
      checkForUpdatesNow().catch((error) => {
        console.warn('[updater] initial manual check failed:', error?.message ?? error)
      })
    }, 8_000)
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowDowngrade = false

  autoUpdater.on('checking-for-update', () => {
    broadcast({ type: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    broadcast({
      type: 'available',
      version: info?.version ?? null,
      releaseNotes: typeof info?.releaseNotes === 'string' ? info.releaseNotes : null,
    })
  })

  autoUpdater.on('update-not-available', (info) => {
    broadcast({
      type: 'not-available',
      version: info?.version ?? app.getVersion(),
    })
  })

  autoUpdater.on('download-progress', (progress) => {
    broadcast({
      type: 'progress',
      percent: progress?.percent ?? 0,
      transferred: progress?.transferred ?? 0,
      total: progress?.total ?? 0,
      bytesPerSecond: progress?.bytesPerSecond ?? 0,
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    broadcast({
      type: 'downloaded',
      version: info?.version ?? null,
      releaseNotes: typeof info?.releaseNotes === 'string' ? info.releaseNotes : null,
    })
  })

  autoUpdater.on('error', (error) => {
    broadcast({
      type: 'error',
      message: error instanceof Error ? error.message : String(error ?? 'unknown error'),
    })
  })

  // Silent background check shortly after startup.
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((error) => {
      console.warn('[updater] initial check failed:', error?.message ?? error)
    })
  }, 8_000)
}

async function fetchLatestGithubRelease() {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 8_000)
  try {
    const response = await fetch(GITHUB_RELEASES_API_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `Nexus/${app.getVersion()}`,
      },
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`GitHub Releases returned ${response.status}`)
    }
    return normalizeGithubReleasePayload(await response.json())
  } finally {
    clearTimeout(timeoutId)
  }
}

async function checkForManualDownloadUpdate() {
  broadcast({ type: 'checking' })
  const currentVersion = app.getVersion()
  try {
    const release = await fetchLatestGithubRelease()
    if (!release || compareReleaseVersions(release.version, currentVersion) <= 0) {
      broadcast({ type: 'not-available', version: currentVersion })
      return {
        ok: true,
        currentVersion,
        latestVersion: release?.version ?? currentVersion,
        updateMode,
        manualDownload: false,
      }
    }

    const event = {
      type: 'manual-update',
      version: release.version,
      releaseUrl: release.releaseUrl,
      reason: 'macos-unsigned',
    }
    broadcast(event)
    return {
      ok: true,
      currentVersion,
      latestVersion: release.version,
      updateMode,
      manualDownload: true,
      releaseUrl: release.releaseUrl,
      reason: 'macos-unsigned',
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    broadcast({ type: 'error', message: reason })
    return {
      ok: false,
      reason,
      currentVersion,
      updateMode,
      manualDownload: true,
      releaseUrl: GITHUB_RELEASES_URL,
    }
  }
}

export async function checkForUpdatesNow() {
  if (!app.isPackaged) {
    return { ok: false, reason: 'dev-mode', currentVersion: app.getVersion(), updateMode }
  }
  if (updateMode === 'manual-download') {
    return checkForManualDownloadUpdate()
  }
  try {
    const result = await autoUpdater.checkForUpdates()
    return {
      ok: true,
      currentVersion: app.getVersion(),
      latestVersion: result?.updateInfo?.version ?? null,
      updateMode,
    }
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      currentVersion: app.getVersion(),
      updateMode,
    }
  }
}

export function quitAndInstallUpdate() {
  if (!app.isPackaged) return false
  if (updateMode === 'manual-download') {
    const releaseUrl = lastStatus?.type === 'manual-update' ? lastStatus.releaseUrl : GITHUB_RELEASES_URL
    setImmediate(() => {
      shell.openExternal(releaseUrl).catch((error) => {
        console.warn('[updater] failed to open release page:', error?.message ?? error)
      })
    })
    return true
  }
  setImmediate(() => {
    autoUpdater.quitAndInstall(false, true)
  })
  return true
}

export function getUpdaterStatus() {
  return {
    currentVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    updateMode,
    last: lastStatus,
  }
}
