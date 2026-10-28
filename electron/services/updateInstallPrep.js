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
import {
  expandMemoryResidueNeedles,
  MEMORY_TEXT_FIELD_NAMES,
} from '../../shared/memoryResidue.js'
import { nowIso } from '../../shared/time.js'
import {
  UPDATE_INSTALL_PREP_FAILED,
  UPDATE_INSTALL_SNAPSHOT_FAILED,
} from '../../shared/updateErrorCodes.js'
import { getRedactedErrorMessage } from './errorRedaction.js'
import {
  LOCAL_DATA_MEMORY_DAILY_DOMAIN_ID,
  LOCAL_DATA_MEMORY_LONG_TERM_DOMAIN_ID,
  ensureSqliteTables,
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

const MEMORY_V2_FIELDS = ['longTerm', 'daily', 'opLog']
const MEMORY_DOMAIN_IDS = [
  LOCAL_DATA_MEMORY_LONG_TERM_DOMAIN_ID,
  LOCAL_DATA_MEMORY_DAILY_DOMAIN_ID,
]
const MEMORY_TEXT_FIELDS = new Set(MEMORY_TEXT_FIELD_NAMES)
const CLEARED_MEMORY_TEXT = '[memory cleared]'
const SQLITE_FILE_PATTERN = /\.(?:sqlite|sqlite3|db)$/iu

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
 * Delete every memory copy under userData/update-snapshots.
 *
 * Snapshots are write-only backups: nothing reads them at startup, so a
 * memory clear has to remove them explicitly or the wording survives there.
 * The local-data copy is scrubbed in place (only the memory rows are
 * deleted, so the snapshot still works as a rollback source), and any
 * memory wording in settings.json is redacted. Manifests stay untouched.
 * @param {string} userDataPath
 * @param {{ needles?: readonly string[] }} [options]
 * @returns {Promise<{ removed: string[] }>} Deleted paths relative to userData.
 */
export async function removeMemoryFromUpdateSnapshots(userDataPath, options = {}) {
  const root = path.join(userDataPath, UPDATE_SNAPSHOTS_DIRNAME)
  let entries
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return { removed: [] }
    throw error
  }
  const needles = new Set(expandMemoryResidueNeedles(options.needles ?? []))
  const removed = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const directory = path.join(root, entry.name)
    const memoryDir = path.join(directory, 'memory-v2')
    await collectMemoryV2Needles(memoryDir, needles)
    await scrubSnapshotLocalData(path.join(directory, 'local-data'), needles)
    await scrubSnapshotSettings(directory, needles)
    for (const name of ['long-term.json', 'daily.json', 'op-log.json']) {
      const filePath = path.join(memoryDir, name)
      if (!(await fileExists(filePath))) continue
      await fs.rm(filePath, { force: true })
      removed.push(path.relative(userDataPath, filePath))
    }
    // Fails with ENOTEMPTY when the snapshot kept other files; ignore that.
    await fs.rmdir(memoryDir).catch(() => {})
  }
  return { removed }
}

/**
 * Read JSON string fields that can carry memory wording. The snapshot is
 * deleted straight after, so collect the needles before removing the files.
 * @param {string} memoryDir
 * @param {Set<string>} needles
 */
async function collectMemoryV2Needles(memoryDir, needles) {
  for (const name of ['long-term.json', 'daily.json', 'op-log.json']) {
    const filePath = path.join(memoryDir, name)
    let raw
    try {
      raw = await fs.readFile(filePath, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') continue
      throw error
    }
    try {
      collectMemoryText(JSON.parse(raw), needles)
    } catch {
      // A malformed memory file carries no trustworthy field boundaries.
    }
  }
}

/**
 * @param {unknown} value
 * @param {Set<string>} needles
 */
function collectMemoryText(value, needles) {
  if (typeof value === 'string') {
    const text = value.trim()
    if (text.length >= 2) needles.add(text)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectMemoryText(item, needles)
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') {
      const text = item.trim()
      if (MEMORY_TEXT_FIELDS.has(key) && text.length >= 2) needles.add(text)
    } else {
      collectMemoryText(item, needles)
    }
  }
}

/**
 * Delete only the memory rows from every SQLite copy in the snapshot and
 * rewrite the files so the removed text is not left in free pages or WAL.
 * @param {string} localDataDir
 * @param {Set<string>} needles
 */
async function scrubSnapshotLocalData(localDataDir, needles) {
  let entries
  try {
    entries = await fs.readdir(localDataDir, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }
  for (const entry of entries) {
    if (!entry.isFile() || !SQLITE_FILE_PATTERN.test(entry.name)) continue
    await scrubSnapshotDatabase(path.join(localDataDir, entry.name), needles)
  }
}

/**
 * @param {string} databasePath
 * @param {Set<string>} needles
 */
async function scrubSnapshotDatabase(databasePath, needles) {
  let db = null
  let rewritten = false
  try {
    db = openSqliteDatabase(databasePath)
    ensureSqliteTables(db)

    const rows = db.prepare(
      'SELECT payload_json AS payloadJson FROM local_data_records WHERE domain_id IN (?, ?)',
    ).all(...MEMORY_DOMAIN_IDS)
    for (const row of rows) {
      try {
        collectMemoryText(JSON.parse(row.payloadJson), needles)
      } catch {
        // Damaged payloads are deleted below but cannot seed the scrub list.
      }
    }

    db.exec('PRAGMA secure_delete = ON;')
    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare('DELETE FROM local_data_records WHERE domain_id IN (?, ?)').run(...MEMORY_DOMAIN_IDS)
      db.exec('COMMIT')
    } catch (error) {
      try { db.exec('ROLLBACK') } catch {}
      throw error
    }

    try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);') } catch {}
    try { db.exec('VACUUM;') } catch {}
    try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);') } catch {}
    // Checkpointed data lives in the main file; dropping WAL mode removes
    // both sidecars even when a stale copy still held old pages.
    db.exec('PRAGMA journal_mode = DELETE;')
    rewritten = true
  } catch (error) {
    console.warn('[updater] snapshot local-data scrub failed:', getRedactedErrorMessage(error))
  } finally {
    if (db) db.close()
    if (rewritten) {
      for (const suffix of ['-wal', '-shm']) {
        await fs.rm(`${databasePath}${suffix}`, { force: true }).catch(() => {})
      }
    }
  }
}

/**
 * @param {string} directory
 * @param {Set<string>} needles
 */
async function scrubSnapshotSettings(directory, needles) {
  const filePath = path.join(directory, 'settings.json')
  let raw
  try {
    raw = await fs.readFile(filePath, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }
  const scrubbed = redactNeedles(raw, needles)
  if (scrubbed !== raw) await writeExact(filePath, scrubbed)
}

/**
 * @param {string} text
 * @param {Set<string>} needles
 */
function redactNeedles(text, needles) {
  let next = text
  const expanded = expandMemoryResidueNeedles([...needles])
    .sort((left, right) => right.length - left.length)
  for (const needle of expanded) {
    if (next.includes(needle)) next = next.split(needle).join(CLEARED_MEMORY_TEXT)
  }
  return next
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
 * @param {{ longTerm: string | null, daily: string | null, opLog: string | null }} memoryV2
 */
async function writeMemoryV2(partial, memoryV2) {
  const dir = path.join(partial, 'memory-v2')
  await fs.mkdir(dir, { recursive: true })
  const files = [
    ['long-term.json', memoryV2.longTerm],
    ['daily.json', memoryV2.daily],
    ['op-log.json', memoryV2.opLog],
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
