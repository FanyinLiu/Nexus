/**
 * In-app model manager.
 *
 * Surfaces model inventory to the renderer, downloads missing models into
 * userData/sherpa-models on demand, and broadcasts progress events so the
 * first-launch setup wizard can render progress bars.
 *
 * Always writes to userData — not into the read-only packaged .app bundle.
 */

import fs from 'node:fs'
import { loadElectron } from './loadElectron.js'

// Same load path as modelPaths.js: a named `electron` import cannot be
// evaluated under node:test, and the download test has to call this module.
const electronApi = loadElectron()
const app = electronApi?.app
const BrowserWindow = electronApi?.BrowserWindow
import { MODEL_CATALOG } from './modelDefinitions.js'
import { createAsyncLock } from './asyncLock.js'
import {
  downloadModel as downloadModelCore,
  checkModelPresence,
  canReachHuggingFace,
  evaluateModelDiskSpace,
  modelDownloadBytesNeeded,
  modelDownloadCanResume,
  readModelDownloadFreeBytes,
} from './modelDownloader.js'
import {
  getModelsRoots,
  getUserModelsRoot,
  getPrimaryModelsDir,
} from './modelPaths.js'
import { migrateLegacySenseVoice } from './senseVoiceMigration.js'
import { getRedactedErrorMessage } from './errorRedaction.js'
import { selectMissingVoiceModelIds } from '../../shared/voiceModelDownloads.js'

const PROGRESS_CHANNEL = 'models:download-progress'

function broadcast(channel, payload) {
  if (!BrowserWindow) return
  const windows = BrowserWindow.getAllWindows()
  for (const win of windows) {
    try {
      if (!win.isDestroyed()) win.webContents.send(channel, payload)
    } catch {
      // silent-catch-ok: a window can be destroyed between the check and the send
    }
  }
}

function ensureUserModelsRoot() {
  const root = getUserModelsRoot()
  try {
    fs.mkdirSync(root, { recursive: true })
  } catch (error) {
    console.warn('[ModelManager] failed to create models directory:', getRedactedErrorMessage(error))
  }
  return root
}

export function getInventory() {
  const roots = getModelsRoots()
  const userRoot = getUserModelsRoot()
  const entries = MODEL_CATALOG.map((model) => {
    const presence = checkModelPresence(model, roots)
    const present = presence.present && presence.verified
    return {
      id: model.id,
      label: model.label,
      sizeLabel: model.sizeLabel,
      purpose: model.purpose,
      required: model.required,
      kind: model.kind,
      present,
      verified: presence.verified,
      location: presence.location,
      resumable: !present && modelDownloadCanResume(model, userRoot),
    }
  })

  const requiredEntries = entries.filter(e => e.required)
  const missingRequired = requiredEntries.filter(e => !e.present).map(e => e.id)
  const missingCatalog = MODEL_CATALOG.filter((model) => missingRequired.includes(model.id))
  const neededBytes = missingCatalog.reduce((sum, model) => sum + modelDownloadBytesNeeded(model), 0)
  const diskSpace = evaluateModelDiskSpace(readModelDownloadFreeBytes(userRoot), neededBytes)

  return {
    models: entries,
    ready: missingRequired.length === 0,
    missingRequired,
    primaryDir: getPrimaryModelsDir(),
    searchRoots: roots,
    // Ids already being fetched. A settings page opened mid-download has
    // missed the progress events, so the inventory itself has to say so.
    downloading: activeModelDownloadIds(),
    disk: {
      ...diskSpace,
      resumable: entries.some((entry) => entry.resumable),
    },
  }
}

// Serialize downloads so two simultaneous wizard clicks don't race.
const withDownloadLock = createAsyncLock()
const activeDownloadIds = new Set()
const inFlightById = new Map()
let inFlightMissing = null

/**
 * Catalog ids whose files are being fetched right now.
 * @returns {string[]}
 */
export function activeModelDownloadIds() {
  return [...activeDownloadIds]
}

async function _downloadOne(modelId) {
  const model = MODEL_CATALOG.find(m => m.id === modelId)
  if (!model) throw new Error(`Unknown model id: ${modelId}`)

  const presence = checkModelPresence(model, getModelsRoots())
  if (presence.present && presence.verified) {
    broadcast(PROGRESS_CHANNEL, { modelId, phase: 'installed' })
    return
  }

  const modelsRoot = ensureUserModelsRoot()

  broadcast(PROGRESS_CHANNEL, { modelId, phase: 'start' })

  try {
    await downloadModelCore(model, {
      modelsRoot,
      standaloneRoot: modelsRoot,
      onProgress: (payload) => broadcast(PROGRESS_CHANNEL, payload),
    })
    broadcast(PROGRESS_CHANNEL, { modelId, phase: 'installed' })
  } catch (error) {
    broadcast(PROGRESS_CHANNEL, {
      modelId,
      phase: 'error',
      message: getRedactedErrorMessage(error),
    })
    throw error
  }
}

export function downloadModel(modelId) {
  const existing = inFlightById.get(modelId)
  if (existing) return existing
  activeDownloadIds.add(modelId)
  const run = withDownloadLock(() => _downloadOne(modelId)).finally(() => {
    activeDownloadIds.delete(modelId)
    if (inFlightById.get(modelId) === run) inFlightById.delete(modelId)
  })
  inFlightById.set(modelId, run)
  return run
}

/**
 * Download every required model plus the selected local listener.
 *
 * An omitted provider id, or a cloud id, keeps the required-only set.
 * A second call while one batch is still fetching does nothing: it waits
 * on the same work instead of starting another copy of the files.
 * `deps` is a test seam so the fetched ids can be asserted without disk
 * or network. Production IPC calls this with one argument.
 * @param {string | undefined} speechInputProviderId
 * @param {{ inventory?: { models?: unknown }, downloadOne?: (id: string) => Promise<void> }} [deps]
 */
export function downloadMissingRequired(speechInputProviderId, deps = {}) {
  if (inFlightMissing) return inFlightMissing
  const run = (async () => {
    const inventory = deps.inventory ?? getInventory()
    const downloadOne = deps.downloadOne ?? downloadModel
    // Required models alone skip the listener the user selected.
    const toFetch = selectMissingVoiceModelIds(inventory.models, speechInputProviderId)
    const results = []
    for (const id of toFetch) {
      // The seam bypasses downloadModel, so the batch itself has to publish
      // the id. downloadModel adds the same id; a Set keeps that to one entry.
      activeDownloadIds.add(id)
      try {
        await downloadOne(id)
        results.push({ id, ok: true })
      } catch (error) {
        results.push({
          id,
          ok: false,
          message: getRedactedErrorMessage(error),
        })
      } finally {
        activeDownloadIds.delete(id)
      }
    }
    return {
      results,
      inventory: deps.inventory ?? getInventory(),
    }
  })()
  const tracked = run.finally(() => {
    if (inFlightMissing === tracked) inFlightMissing = null
  })
  inFlightMissing = tracked
  return tracked
}

export async function getNetworkProbe() {
  const hf = await canReachHuggingFace()
  return { huggingFaceReachable: hf }
}

/** Ensure the models dir exists at app startup so UI can inspect it. */
export function initModelManager() {
  try {
    ensureUserModelsRoot()
  } catch (error) {
    console.warn('[ModelManager] failed to initialize models directory:', getRedactedErrorMessage(error))
  }
  // Prime the HF probe in the background — the first inventory call will
  // then return quickly without stalling the wizard on a 5s timeout.
  canReachHuggingFace().catch(() => {}) // silent-catch-ok: background network probe; failure is the fallback signal
  // Upgrade copies are best-effort and must not delay the first window.
  // A failed copy leaves the legacy bundled files in place.
  const userRoot = getUserModelsRoot()
  const legacyRoots = getModelsRoots().filter((root) => root !== userRoot)
  void migrateLegacySenseVoice({ userRoot, legacyRoots }).catch((error) => {
    console.warn('[ModelManager] SenseVoice migration skipped:', getRedactedErrorMessage(error))
  })
  if (app.isPackaged) {
    const inv = getInventory()
    if (!inv.ready) {
      console.info('[ModelManager] Missing required models:', inv.missingRequired)
    }
  }
}
