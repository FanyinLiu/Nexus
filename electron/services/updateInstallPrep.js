// Pre-install barrier for electron-updater.
//
// prepareForUpdateInstall flushes durable state in a fixed order, then
// copies settings, the memory v2 store, and the local-data SQLite file
// into userData/update-snapshots. It runs only from the explicit install
// path. A failure throws and the caller must not quitAndInstall.
// Ordinary quit and normal app use never enter this module.

import fs from 'node:fs/promises'
import path from 'node:path'

import {
  DURABLE_STORAGE_FLUSH_EVENT,
  DURABLE_UPDATE_SNAPSHOT_GLOBAL,
} from '../../shared/durableUpdateFlush.js'
import { nowIso } from '../../shared/time.js'
import {
  UPDATE_INSTALL_PREP_FAILED,
  UPDATE_INSTALL_SNAPSHOT_FAILED,
} from '../../shared/updateErrorCodes.js'
import {
  openSqliteDatabase,
  resolveLocalDataPaths,
} from './localDataStoreCore.js'

/** How many pre-install snapshots to retain. Older directories are removed. */
export const UPDATE_SNAPSHOT_KEEP = 2

/** Directory under userData. Not read on startup, so it cannot block launch. */
export const UPDATE_SNAPSHOTS_DIRNAME = 'update-snapshots'

const PREP_MESSAGE_KEY = 'updater.error.install_prep_failed'
const PREP_RECOMMENDATION_KEY = 'updater.error.install_prep_failed_rec'
const SNAPSHOT_MESSAGE_KEY = 'updater.error.snapshot_failed'
const SNAPSHOT_RECOMMENDATION_KEY = 'updater.error.snapshot_failed_rec'

const MEMORY_V2_FIELDS = ['longTerm', 'daily', 'opLog', 'v1Backup']

/**
 * Step names recorded by prepareForUpdateInstall. Snapshot runs after these
 * and is not itself a flush step.
 */
export const UPDATE_INSTALL_FLUSH_ORDER = Object.freeze([
  'settings',
  'memory-v2',
  'memory-vector',
  'local-data',
  'pending-writes',
])

/**
 * Error that blocks quitAndInstall. `message` is the stable code, not prose.
 */
export class UpdateInstallPrepError extends Error {
  /**
   * @param {string} code
   * @param {string} messageKey
   * @param {string} recommendationKey
   * @param {unknown} [cause]
   */
  constructor(code, messageKey, recommendationKey, cause) {
    super(code, cause ? { cause } : undefined)
    this.name = 'UpdateInstallPrepError'
    this.code = code
    this.messageKey = messageKey
    this.recommendationKey = recommendationKey
  }
}

/**
 * Downloaded updates stay staged until the user clicks restart.
 * autoDownload stays on; ordinary quit must not call quitAndInstall.
 * @param {{ autoDownload?: boolean, autoInstallOnAppQuit?: boolean, allowDowngrade?: boolean }} autoUpdater
 */
export function applyAutoUpdaterInstallPolicy(autoUpdater) {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowDowngrade = false
}

/**
 * Page script that flushes debounced renderer storage and returns the snapshot.
 * Built from the shared event name so the literal is not copied here.
 */
export function buildDurableFlushScript() {
  return `(() => { window.dispatchEvent(new Event(${JSON.stringify(DURABLE_STORAGE_FLUSH_EVENT)})); return window[${JSON.stringify(DURABLE_UPDATE_SNAPSHOT_GLOBAL)}] ?? null; })()`
}

/**
 * @param {unknown} value
 * @returns {value is { settings: string | null, memoryV2: Record<string, string | null> }}
 */
export function isDurableUpdateSnapshot(value) {
  if (!value || typeof value !== 'object') return false
  if (!isTextOrNull(value.settings)) return false
  return isMemoryV2Snapshot(value.memoryV2)
}

/**
 * @param {unknown} value
 */
export function isMemoryV2Snapshot(value) {
  if (!value || typeof value !== 'object') return false
  return MEMORY_V2_FIELDS.every((key) => isTextOrNull(value[key]))
}

/**
 * Map an unknown failure onto a stable prep or snapshot code.
 * Snapshot errors keep their code so the UI can say the backup failed.
 * @param {unknown} error
 */
export function normalizeUpdateInstallFailure(error) {
  if (error instanceof UpdateInstallPrepError) return error
  if (error && typeof error === 'object' && error.code === UPDATE_INSTALL_SNAPSHOT_FAILED) {
    return new UpdateInstallPrepError(
      UPDATE_INSTALL_SNAPSHOT_FAILED,
      SNAPSHOT_MESSAGE_KEY,
      SNAPSHOT_RECOMMENDATION_KEY,
      error,
    )
  }
  return new UpdateInstallPrepError(
    UPDATE_INSTALL_PREP_FAILED,
    PREP_MESSAGE_KEY,
    PREP_RECOMMENDATION_KEY,
    error,
  )
}

/**
 * Explicit install decision. Manual macOS opens the release page and does
 * not flush or snapshot. Auto-download installs only after prep resolves.
 * @param {{
 *   isPackaged: boolean,
 *   updateMode: string,
 *   releaseUrl: string,
 *   openReleasePage: (url: string) => void,
 *   prepareForUpdateInstall: () => Promise<unknown>,
 *   quitAndInstall: () => void,
 *   onPrepFailure: (error: UpdateInstallPrepError) => void,
 * }} deps
 */
export async function decideUpdateInstall(deps) {
  if (!deps.isPackaged) {
    return { ok: false, reason: 'dev-mode' }
  }
  if (deps.updateMode === 'manual-download') {
    deps.openReleasePage(deps.releaseUrl)
    return { ok: true, reason: 'manual-download' }
  }
  try {
    await deps.prepareForUpdateInstall()
  } catch (error) {
    deps.onPrepFailure(normalizeUpdateInstallFailure(error))
    return { ok: false, reason: 'prep-failed' }
  }
  deps.quitAndInstall()
  return { ok: true, reason: 'install' }
}

/**
 * @param {{
 *   flushSettings: () => Promise<string | null>,
 *   flushMemoryV2: () => Promise<unknown>,
 *   flushMemoryVector: () => Promise<void>,
 *   closeMemoryVector: () => Promise<void>,
 *   closeLocalData: () => Promise<unknown>,
 *   flushPendingWrites: () => Promise<boolean | void>,
 *   writeSnapshot: (input: object) => Promise<unknown>,
 * }} deps
 */
export function createUpdateInstallPrep(deps) {
  return {
    /**
     * Flush settings, memory v2, the vector store, SQLite, and pending
     * writes, then snapshot. Throws on the first failure and skips the rest.
     * @param {{
     *   userDataPath?: string,
     *   fromVersion?: string | null,
     *   toVersion?: string | null,
     *   now?: Date | string | number,
     * }} [context]
     */
    async prepareForUpdateInstall(context = {}) {
      const order = []
      const step = async (name, fn) => {
        order.push(name)
        return fn()
      }

      const settings = await step('settings', () => deps.flushSettings())
      const memoryV2 = await step('memory-v2', () => deps.flushMemoryV2())
      if (!isMemoryV2Snapshot(memoryV2)) {
        throw new UpdateInstallPrepError(
          UPDATE_INSTALL_PREP_FAILED,
          PREP_MESSAGE_KEY,
          PREP_RECOMMENDATION_KEY,
        )
      }
      await step('memory-vector', async () => {
        await deps.flushMemoryVector()
        await deps.closeMemoryVector()
      })
      const localData = await step('local-data', () => deps.closeLocalData())
      const pendingOk = await step('pending-writes', () => deps.flushPendingWrites())
      if (pendingOk === false) {
        throw new UpdateInstallPrepError(
          UPDATE_INSTALL_PREP_FAILED,
          PREP_MESSAGE_KEY,
          PREP_RECOMMENDATION_KEY,
        )
      }

      const snapshot = await deps.writeSnapshot({
        userDataPath: context.userDataPath,
        fromVersion: context.fromVersion,
        toVersion: context.toVersion,
        now: context.now,
        settings: isTextOrNull(settings) ? settings : null,
        memoryV2,
        localData,
      })
      return { order, snapshot }
    },
  }
}

/**
 * Checkpoint WAL into the main database file and close the connection
 * so the snapshot copy is not a half-written SQLite file.
 * @param {{ userDataPath?: string }} [options]
 */
export async function checkpointLocalDataDatabase(options = {}) {
  const paths = await resolveLocalDataPaths(options)
  if (!(await fileExists(paths.databasePath))) {
    return { present: false, ...paths }
  }
  const db = openSqliteDatabase(paths.databasePath)
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);')
  } finally {
    db.close()
  }
  return { present: true, ...paths }
}

/**
 * Copy settings, memory v2, and the local-data DB. Keeps the newest
 * UPDATE_SNAPSHOT_KEEP directories. A failed copy leaves older snapshots
 * in place and throws UPDATE_INSTALL_SNAPSHOT_FAILED.
 * @param {{
 *   userDataPath?: string,
 *   fromVersion?: string | null,
 *   toVersion?: string | null,
 *   now?: Date | string | number,
 *   settings?: string | null,
 *   memoryV2?: unknown,
 *   localData?: { present?: boolean, databasePath?: string, manifestPath?: string } | null,
 *   keep?: number,
 * }} input
 */
export async function writeUpdateSnapshot(input) {
  const userDataPath = typeof input.userDataPath === 'string' ? input.userDataPath.trim() : ''
  if (!userDataPath) {
    throw new UpdateInstallPrepError(
      UPDATE_INSTALL_SNAPSHOT_FAILED,
      SNAPSHOT_MESSAGE_KEY,
      SNAPSHOT_RECOMMENDATION_KEY,
    )
  }
  if (!isMemoryV2Snapshot(input.memoryV2)) {
    throw new UpdateInstallPrepError(
      UPDATE_INSTALL_SNAPSHOT_FAILED,
      SNAPSHOT_MESSAGE_KEY,
      SNAPSHOT_RECOMMENDATION_KEY,
    )
  }
  if (!isTextOrNull(input.settings ?? null)) {
    throw new UpdateInstallPrepError(
      UPDATE_INSTALL_SNAPSHOT_FAILED,
      SNAPSHOT_MESSAGE_KEY,
      SNAPSHOT_RECOMMENDATION_KEY,
    )
  }

  const root = path.join(userDataPath, UPDATE_SNAPSHOTS_DIRNAME)
  const finalName = snapshotDirName(input.now, input.fromVersion, input.toVersion)
  const partial = path.join(root, `.partial-${process.pid}-${Date.now()}`)
  await fs.mkdir(root, { recursive: true })
  await clearPartialSnapshots(root)
  await fs.mkdir(partial, { recursive: true })

  try {
    const settings = input.settings ?? null
    if (settings !== null) {
      await writeExact(path.join(partial, 'settings.json'), settings)
    }
    await writeMemoryV2(partial, input.memoryV2)
    const localDataPresent = await copyLocalData(partial, input.localData)
    await writeExact(path.join(partial, 'manifest.json'), `${JSON.stringify({
      format: 'nexus-update-snapshot',
      fromVersion: input.fromVersion ?? null,
      toVersion: input.toVersion ?? null,
      createdAt: nowIso(input.now),
      settingsPresent: settings !== null,
      memoryV2: {
        longTerm: input.memoryV2.longTerm !== null,
        daily: input.memoryV2.daily !== null,
        opLog: input.memoryV2.opLog !== null,
        v1Backup: input.memoryV2.v1Backup !== null,
      },
      localDataPresent,
    }, null, 2)}\n`)
    const directory = path.join(root, finalName)
    await fs.rename(partial, directory)
    await rotateSnapshots(root, input.keep ?? UPDATE_SNAPSHOT_KEEP)
    return { directory, name: finalName }
  } catch (error) {
    await fs.rm(partial, { recursive: true, force: true }).catch(() => {})
    if (error instanceof UpdateInstallPrepError) throw error
    throw new UpdateInstallPrepError(
      UPDATE_INSTALL_SNAPSHOT_FAILED,
      SNAPSHOT_MESSAGE_KEY,
      SNAPSHOT_RECOMMENDATION_KEY,
      error,
    )
  }
}

/**
 * @param {unknown} value
 */
function isTextOrNull(value) {
  return value === null || typeof value === 'string'
}

/**
 * @param {string} filePath
 */
async function fileExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * @param {Date | string | number | undefined} now
 * @param {string | null | undefined} fromVersion
 * @param {string | null | undefined} toVersion
 */
function snapshotDirName(now, fromVersion, toVersion) {
  const stamp = nowIso(now).replace(/:/g, '-')
  return `${stamp}__${safeToken(fromVersion)}-to-${safeToken(toVersion)}`
}

/**
 * @param {string | null | undefined} value
 */
function safeToken(value) {
  const text = typeof value === 'string' && value.trim() ? value.trim() : 'unknown'
  return text.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80)
}

/**
 * @param {string} filePath
 * @param {string} text
 */
async function writeExact(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, text, 'utf8')
}

/**
 * @param {string} partial
 * @param {{ longTerm: string | null, daily: string | null, opLog: string | null, v1Backup: string | null }} memoryV2
 */
async function writeMemoryV2(partial, memoryV2) {
  const dir = path.join(partial, 'memory-v2')
  await fs.mkdir(dir, { recursive: true })
  const files = [
    ['long-term.json', memoryV2.longTerm],
    ['daily.json', memoryV2.daily],
    ['op-log.json', memoryV2.opLog],
    ['v1-backup.txt', memoryV2.v1Backup],
  ]
  for (const [name, contents] of files) {
    if (contents === null) continue
    await writeExact(path.join(dir, name), contents)
  }
}

/**
 * @param {string} partial
 * @param {{ present?: boolean, databasePath?: string, manifestPath?: string } | null | undefined} localData
 */
async function copyLocalData(partial, localData) {
  if (!localData || localData.present !== true) return false
  const databasePath = typeof localData.databasePath === 'string' ? localData.databasePath : ''
  if (!databasePath || !(await fileExists(databasePath))) {
    throw new UpdateInstallPrepError(
      UPDATE_INSTALL_SNAPSHOT_FAILED,
      SNAPSHOT_MESSAGE_KEY,
      SNAPSHOT_RECOMMENDATION_KEY,
    )
  }
  const targetDir = path.join(partial, 'local-data')
  await fs.mkdir(targetDir, { recursive: true })
  const baseName = path.basename(databasePath)
  await fs.copyFile(databasePath, path.join(targetDir, baseName))
  if (typeof localData.manifestPath === 'string' && await fileExists(localData.manifestPath)) {
    await fs.copyFile(localData.manifestPath, path.join(targetDir, path.basename(localData.manifestPath)))
  }
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = `${databasePath}${suffix}`
    if (await fileExists(sidecar)) {
      await fs.copyFile(sidecar, path.join(targetDir, `${baseName}${suffix}`))
    }
  }
  return true
}

/**
 * @param {string} root
 */
async function clearPartialSnapshots(root) {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch((error) => {
    if (error?.code === 'ENOENT') return []
    throw error
  })
  await Promise.all(entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('.partial-'))
    .map((entry) => fs.rm(path.join(root, entry.name), { recursive: true, force: true })))
}

/**
 * @param {string} root
 * @param {number} keep
 */
async function rotateSnapshots(root, keep) {
  const limit = Number.isInteger(keep) && keep > 0 ? keep : UPDATE_SNAPSHOT_KEEP
  const entries = await fs.readdir(root, { withFileTypes: true })
  const names = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort()
  const stale = names.slice(0, Math.max(0, names.length - limit))
  await Promise.all(stale.map((name) => fs.rm(path.join(root, name), { recursive: true, force: true })))
}
