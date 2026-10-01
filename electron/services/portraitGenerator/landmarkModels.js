/**
 * Model files for the portrait landmark gate, loaded lazily.
 *
 * The two ONNX files (anime face detector ~246 MB, landmarks ~39 MB) are NOT
 * bundled or committed. They live in `<userData>/models/portrait-landmarks/`
 * and are pinned by exact byte size + SHA-256. Until there is a vetted
 * download source (see docs/PORTRAIT_LANDMARK_MODELS.md), a missing file
 * simply reports `missing`, and the caller skips the landmark stage instead of
 * failing the image.
 *
 * The ONNX runtime is injected (`createSession(filePath)`), so this module
 * adds no dependency. Sessions are created once, on first use, and cached;
 * a failed load is not cached, so a later call can retry after the files
 * are fixed.
 */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

export const LANDMARK_MODEL_DIRECTORY_NAME = 'portrait-landmarks'

export const LANDMARK_MODEL_FILES = Object.freeze({
  detector: Object.freeze({
    fileName: 'anime_face_yolov3.onnx',
    sizeBytes: 246_035_424,
    sha256: 'f44b484f59c3aaf113c4dea57338163fef1c9e470bee7bcfd95a69ff1ed9f1a9',
  }),
  landmarks: Object.freeze({
    fileName: 'anime_face_hrnetv2_flip.onnx',
    sizeBytes: 39_046_070,
    sha256: '3c2eb13d89cde5ab5b668de710bec81d08264f8db2df5200e6dd3fb7ecdadf54',
  }),
})

/** @param {string} userDataDir */
export function resolveLandmarkModelDirectory(userDataDir) {
  return path.join(userDataDir, 'models', LANDMARK_MODEL_DIRECTORY_NAME)
}

/** Streamed SHA-256 of a file (never reads a 246 MB model into memory at once). */
export function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(filePath)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
  })
}

/**
 * Check each model file: present, exact size, and (optionally) SHA-256.
 * @param {string} directory
 * @param {{ files?: typeof LANDMARK_MODEL_FILES, verifyHash?: boolean, hashFile?: (p: string) => Promise<string> }} [options]
 * @returns {Promise<{ ready: boolean, files: Record<string, { filePath: string, status: 'ok' | 'missing' | 'size_mismatch' | 'hash_mismatch' }> }>}
 */
export async function inspectLandmarkModels(directory, options = {}) {
  const files = options.files ?? LANDMARK_MODEL_FILES
  const verifyHash = options.verifyHash ?? true
  const hashFile = options.hashFile ?? sha256File
  const report = {}
  for (const [role, spec] of Object.entries(files)) {
    const filePath = path.join(directory, spec.fileName)
    let status = 'ok'
    try {
      const stat = await fs.stat(filePath)
      if (!stat.isFile()) status = 'missing'
      else if (stat.size !== spec.sizeBytes) status = 'size_mismatch'
      else if (verifyHash && (await hashFile(filePath)) !== spec.sha256) status = 'hash_mismatch'
    } catch {
      status = 'missing'
    }
    report[role] = { filePath, status }
  }
  return { ready: Object.values(report).every((entry) => entry.status === 'ok'), files: report }
}

/**
 * Lazy, cached loader. `load()` resolves to `{ status: 'ready', sessions }`
 * or `{ status: 'missing' | 'invalid' | 'runtime_unavailable' | 'load_failed' }`
 * and never throws.
 * @param {{ directory: string, createSession?: (filePath: string) => Promise<{ run: Function }>, files?: typeof LANDMARK_MODEL_FILES, verifyHash?: boolean, hashFile?: (p: string) => Promise<string> }} options
 */
export function createLandmarkModelLoader(options) {
  let pending = null
  async function loadOnce() {
    if (typeof options.createSession !== 'function') return { status: 'runtime_unavailable' }
    const inspection = await inspectLandmarkModels(options.directory, options)
    if (!inspection.ready) {
      const statuses = Object.values(inspection.files).map((entry) => entry.status)
      return { status: statuses.includes('missing') ? 'missing' : 'invalid' }
    }
    try {
      const sessions = {}
      for (const [role, entry] of Object.entries(inspection.files)) {
        sessions[role] = await options.createSession(entry.filePath)
      }
      return { status: 'ready', sessions }
    } catch {
      return { status: 'load_failed' }
    }
  }
  return {
    load() {
      if (!pending) {
        pending = loadOnce().then((result) => {
          if (result.status !== 'ready') pending = null
          return result
        })
      }
      return pending
    },
  }
}
