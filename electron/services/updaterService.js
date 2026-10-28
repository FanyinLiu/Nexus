// Auto-update integration via electron-updater + GitHub Releases.
//
// Lifecycle:
//   - On app start (after main window is ready), call initAutoUpdater().
//     It registers event listeners and triggers a silent background check.
//   - The renderer can also explicitly trigger checkForUpdatesNow() through IPC,
//     used by the "Check for updates" button in settings.
//   - When an update is available it is downloaded automatically (in the
//     background). It is installed only when the user clicks restart.
//     Ordinary quit does not apply a downloaded update.
//   - quitAndInstallUpdate flushes durable stores and snapshots them first.
//     A flush or snapshot failure is broadcast and does not quit.
//
// Events broadcast to the renderer (channel: 'updater:event'):
//   { type: 'checking' }
//   { type: 'available', version, releaseNotes? }
//   { type: 'not-available', version }
//   { type: 'progress', percent, transferred, total, bytesPerSecond }
//   { type: 'downloaded', version, releaseNotes? }
//   { type: 'error', message, code?, messageKey?, recommendationKey? }

import electronUpdater from 'electron-updater'
import { app, BrowserWindow, session, shell } from 'electron'
import {
  compareReleaseVersions,
  GITHUB_RELEASES_API_URL,
  GITHUB_RELEASES_URL,
  normalizeGithubReleasePayload,
  resolveUpdaterMode,
} from './updatePolicy.js'
import { UPDATE_INSTALL_PREP_FAILED } from '../../shared/updateErrorCodes.js'
import { getRedactedErrorMessage } from './errorRedaction.js'
import { flushPetPrefsStore } from './petPrefsStore.js'
import {
  applyAutoUpdaterInstallPolicy,
  buildDurableFlushScript,
  checkpointLocalDataDatabase,
  createUpdateInstallPrep,
  decideUpdateInstall,
  isDurableUpdateSnapshot,
  UpdateInstallPrepError,
  writeUpdateSnapshot,
} from './updateInstallPrep.js'
import { flushWindowBoundsStore } from './windowBoundsStore.js'
import { flushRuntimeLogWriteBuffer } from '../windowManager.js'
import { markUpdateInstallQuit, clearUpdateInstallQuit } from './updateInstallQuitFlag.js'

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
      console.warn('[updater] failed to send event to renderer:', getRedactedErrorMessage(error))
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
        console.warn('[updater] initial manual check failed:', getRedactedErrorMessage(error))
      })
    }, 8_000)
    return
  }

  applyAutoUpdaterInstallPolicy(autoUpdater)

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
    // quitAndInstall can fail before the installer takes over. Leaving the
    // install marker set would make every later normal quit skip the memory
    // flush, so the error path clears it.
    clearUpdateInstallQuit()
    broadcast({
      type: 'error',
      message: getRedactedErrorMessage(error ?? 'unknown error'),
    })
  })

  // electron-updater emits this before its own quit. Marking it here keeps
  // the memory flush handshake out of the installer path.
  autoUpdater.on('before-quit-for-update', markUpdateInstallQuit)

  // Silent background check shortly after startup.
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((error) => {
      console.warn('[updater] initial check failed:', getRedactedErrorMessage(error))
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
    const reason = getRedactedErrorMessage(error)
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
      reason: getRedactedErrorMessage(error),
      currentVersion: app.getVersion(),
      updateMode,
    }
  }
}

let rendererSnapshot = null
let installChain = Promise.resolve()

const updateInstallPrep = createUpdateInstallPrep({
  flushSettings: async () => {
    rendererSnapshot = await readRendererDurableSnapshot()
    return rendererSnapshot.settings
  },
  flushMemoryV2: async () => {
    if (!isDurableUpdateSnapshot(rendererSnapshot)) {
      throw new UpdateInstallPrepError(
        UPDATE_INSTALL_PREP_FAILED,
        'updater.error.install_prep_failed',
        'updater.error.install_prep_failed_rec',
      )
    }
    return rendererSnapshot.memoryV2
  },
  flushMemoryVector: async () => {
    const memoryVectorStore = await import('./memoryVectorStore.js')
    await memoryVectorStore.flush()
  },
  closeMemoryVector: async () => {
    const memoryVectorStore = await import('./memoryVectorStore.js')
    await memoryVectorStore.terminate()
  },
  closeLocalData: () => checkpointLocalDataDatabase(),
  flushPendingWrites: flushPendingDurableWrites,
  writeSnapshot: (input) => writeUpdateSnapshot({
    ...input,
    userDataPath: input.userDataPath || app.getPath('userData'),
    fromVersion: input.fromVersion ?? app.getVersion(),
    toVersion: input.toVersion ?? (lastStatus?.type === 'downloaded' ? lastStatus.version : null),
  }),
})

async function readRendererDurableSnapshot() {
  const script = buildDurableFlushScript()
  const windows = BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed())
  let snapshot = null
  for (const win of windows) {
    if (win.webContents.isLoading()) continue
    try {
      const result = await win.webContents.executeJavaScript(script, false)
      if (isDurableUpdateSnapshot(result)) snapshot = result
    } catch (error) {
      console.warn('[updater] renderer durable flush failed:', getRedactedErrorMessage(error))
    }
  }
  if (!snapshot) {
    throw new UpdateInstallPrepError(
      UPDATE_INSTALL_PREP_FAILED,
      'updater.error.install_prep_failed',
      'updater.error.install_prep_failed_rec',
    )
  }
  return snapshot
}

async function flushPendingDurableWrites() {
  const boundsOk = await flushWindowBoundsStore()
  const prefsOk = await flushPetPrefsStore()
  await flushRuntimeLogWriteBuffer()
  const flushStorage = session.defaultSession?.flushStorageData
  if (typeof flushStorage === 'function') {
    await Promise.resolve(flushStorage.call(session.defaultSession))
  }
  return boundsOk && prefsOk
}

function broadcastPrepFailure(error) {
  console.warn('[updater] install prep failed:', getRedactedErrorMessage(error))
  broadcast({
    type: 'error',
    code: error.code,
    messageKey: error.messageKey,
    recommendationKey: error.recommendationKey,
    message: error.code,
  })
}

/**
 * Apply a downloaded update, or open the macOS release page.
 * Win/Linux flushes and snapshots first. Failure returns false and does
 * not call quitAndInstall. Unsigned macOS stays on the manual page.
 */
export function quitAndInstallUpdate() {
  const run = installChain.then(() => decideUpdateInstall({
    isPackaged: app.isPackaged,
    updateMode,
    releaseUrl: lastStatus?.type === 'manual-update' && lastStatus.releaseUrl
      ? lastStatus.releaseUrl
      : GITHUB_RELEASES_URL,
    openReleasePage: (releaseUrl) => {
      setImmediate(() => {
        shell.openExternal(releaseUrl).catch((error) => {
          console.warn('[updater] failed to open release page:', getRedactedErrorMessage(error))
        })
      })
    },
    prepareForUpdateInstall: () => updateInstallPrep.prepareForUpdateInstall({
      userDataPath: app.getPath('userData'),
      fromVersion: app.getVersion(),
      toVersion: lastStatus?.type === 'downloaded' ? lastStatus.version : null,
    }),
    quitAndInstall: () => {
      markUpdateInstallQuit()
      setImmediate(() => {
        try {
          autoUpdater.quitAndInstall(false, true)
        } catch (error) {
          clearUpdateInstallQuit()
          broadcast({
            type: 'error',
            message: getRedactedErrorMessage(error),
          })
        }
      })
    },
    onPrepFailure: broadcastPrepFailure,
  }))
  installChain = run.then(() => undefined, () => undefined)
  return run.then((result) => {
    // No quit belongs to the updater when prep failed, the app is in dev
    // mode, or the manual release page was opened instead.
    if (result.reason !== 'install') clearUpdateInstallQuit()
    return result.ok
  })
}

export function getUpdaterStatus() {
  return {
    currentVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    updateMode,
    last: lastStatus,
  }
}
