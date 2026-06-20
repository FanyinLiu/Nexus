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
import { app, BrowserWindow } from 'electron'
import { MODEL_CATALOG } from './modelDefinitions.js'
import { createAsyncLock } from './asyncLock.js'
import {
  downloadModel as downloadModelCore,
  checkModelPresence,
  canReachHuggingFace,
} from './modelDownloader.js'
import {
  getModelsRoots,
  getUserModelsRoot,
  getPrimaryModelsDir,
} from './modelPaths.js'
import { getRedactedErrorMessage } from './errorRedaction.js'

const PROGRESS_CHANNEL = 'models:download-progress'

function broadcast(channel, payload) {
  const windows = BrowserWindow.getAllWindows()
  for (const win of windows) {
    try {
      if (!win.isDestroyed()) win.webContents.send(channel, payload)
    } catch {}
  }
}

function ensureUserModelsRoot() {
  const root = getUserModelsRoot()
  try { fs.mkdirSync(root, { recursive: true }) } catch {}
  return root
}

export function getInventory() {
  const roots = getModelsRoots()
  const entries = MODEL_CATALOG.map((model) => {
    const presence = checkModelPresence(model, roots)
    return {
      id: model.id,
      label: model.label,
      sizeLabel: model.sizeLabel,
      purpose: model.purpose,
      required: model.required,
      kind: model.kind,
      present: presence.present,
      location: presence.location,
    }
  })

  const requiredEntries = entries.filter(e => e.required)
  const missingRequired = requiredEntries.filter(e => !e.present).map(e => e.id)

  return {
    models: entries,
    ready: missingRequired.length === 0,
    missingRequired,
    primaryDir: getPrimaryModelsDir(),
    searchRoots: roots,
  }
}

// Serialize downloads so two simultaneous wizard clicks don't race.
const withDownloadLock = createAsyncLock()

async function _downloadOne(modelId) {
  const model = MODEL_CATALOG.find(m => m.id === modelId)
  if (!model) throw new Error(`Unknown model id: ${modelId}`)

  if (checkModelPresence(model, getModelsRoots()).present) {
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

export async function downloadModel(modelId) {
  return withDownloadLock(() => _downloadOne(modelId))
}

export async function downloadMissingRequired() {
  const inventory = getInventory()
  const toFetch = inventory.missingRequired
  const results = []
  for (const id of toFetch) {
    try {
      await downloadModel(id)
      results.push({ id, ok: true })
    } catch (error) {
      results.push({
        id,
        ok: false,
        message: getRedactedErrorMessage(error),
      })
    }
  }
  return { results, inventory: getInventory() }
}

export async function getNetworkProbe() {
  const hf = await canReachHuggingFace()
  return { huggingFaceReachable: hf }
}

/** Ensure the models dir exists at app startup so UI can inspect it. */
export function initModelManager() {
  try { ensureUserModelsRoot() } catch {}
  // Prime the HF probe in the background — the first inventory call will
  // then return quickly without stalling the wizard on a 5s timeout.
  canReachHuggingFace().catch(() => {})
  if (app.isPackaged) {
    const inv = getInventory()
    if (!inv.ready) {
      console.info('[ModelManager] Missing required models:', inv.missingRequired)
    }
  }
}

export { PROGRESS_CHANNEL }
