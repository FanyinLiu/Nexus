/**
 * Model files for the portrait pipeline.
 *
 * The ONNX files (anime face detector ~246 MB, landmarks ~39 MB, isnet-anime
 * cutout ~176 MB) are NOT bundled or committed. `portraitModelDownloader.js`
 * fetches them on first use into `<userData>/models/portrait-landmarks/`
 * (directory name kept from the landmark-only first cut); all are pinned by exact
 * byte size + SHA-256 in `shared/portraitModels.js`. A missing or modified
 * file reports `missing` / `invalid`, and the caller skips the landmark
 * stage instead of failing the image.
 *
 * Hashing 285 MB takes about a second (461 MB with the cutout model), so a successful verification is
 * remembered for the life of the process, keyed by path + size + mtime.
 */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

import { PORTRAIT_MODEL_CATALOG } from '../../../shared/portraitModels.js'

export const LANDMARK_MODEL_DIRECTORY_NAME = 'portrait-landmarks'

const catalogFile = (role) => {
  const model = PORTRAIT_MODEL_CATALOG.find((entry) => entry.role === role)
  return Object.freeze({ fileName: model.fileName, sizeBytes: model.sizeBytes, sha256: model.sha256 })
}

/** The files the landmark gate needs, by role. */
export const LANDMARK_MODEL_FILES = Object.freeze({
  detector: catalogFile('detector'),
  landmarks: catalogFile('landmarks'),
})

/** The isnet-anime cutout model (portrait drafts only). */
export const CUTOUT_MODEL_FILES = Object.freeze({
  cutout: catalogFile('cutout'),
})

const verifiedFiles = new Map()

/**
 * Remember that `filePath` (at this size and mtime) matched `sha256`, e.g.
 * right after the downloader verified it.
 * @param {string} filePath
 * @param {{ size: number, mtimeMs: number }} stat
 * @param {string} sha256
 */
export function rememberVerifiedModelFile(filePath, stat, sha256) {
  verifiedFiles.set(filePath, `${stat.size}:${stat.mtimeMs}:${sha256}`)
}

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
      else if (verifyHash && verifiedFiles.get(filePath) !== `${stat.size}:${stat.mtimeMs}:${spec.sha256}`) {
        if ((await hashFile(filePath)) === spec.sha256) rememberVerifiedModelFile(filePath, stat, spec.sha256)
        else status = 'hash_mismatch'
      }
    } catch {
      status = 'missing'
    }
    report[role] = { filePath, status }
  }
  return { ready: Object.values(report).every((entry) => entry.status === 'ok'), files: report }
}
