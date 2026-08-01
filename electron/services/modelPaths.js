/**
 * Runtime model path resolution.
 *
 * Nexus sherpa services look for models in three places, in order:
 *   1. userData/sherpa-models   — user-downloaded via in-app setup wizard
 *                                 (writable, per-user)
 *   2. resourcesPath/sherpa-models — bundled with packaged app
 *                                 (read-only, shipped in .dmg / .exe)
 *   3. appPath/sherpa-models    — dev checkout
 *
 * The setup wizard writes to #1 so first-launch downloads survive app
 * upgrades and don't require touching the .app bundle.
 */

import path from 'node:path'
import fs from 'node:fs'
import { app } from 'electron'

export function getUserModelsRoot() {
  return path.join(app.getPath('userData'), 'sherpa-models')
}

function getBundledModelsRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'sherpa-models')
    : path.join(app.getAppPath(), 'sherpa-models')
}

export function getModelsRoots() {
  return [getUserModelsRoot(), getBundledModelsRoot()]
}

/**
 * Find an existing model subdirectory by name across all roots.
 * Returns absolute path of the first root that contains the directory, or null.
 */
export function findModelDir(dirName) {
  for (const root of getModelsRoots()) {
    const candidate = path.join(root, dirName)
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

/**
 * Resolve a standalone file (e.g. silero_vad_v5.onnx).
 * Checks: userData/sherpa-models/<name> → resourcesPath/<name> (legacy bundled
 * location — electron-builder copies into Contents/Resources/ root, not into
 * sherpa-models subdir) → dev fallback path.
 */
export function findStandaloneFile(fileName, devRelativePath) {
  const userCandidate = path.join(getUserModelsRoot(), fileName)
  if (fs.existsSync(userCandidate)) return userCandidate

  if (app.isPackaged) {
    const packagedCandidate = path.join(process.resourcesPath, fileName)
    if (fs.existsSync(packagedCandidate)) return packagedCandidate
  } else if (devRelativePath) {
    const devCandidate = path.join(app.getAppPath(), devRelativePath)
    if (fs.existsSync(devCandidate)) return devCandidate
  }

  return null
}

/**
 * Primary user-visible directory for status reporting ("models installed here").
 * The wizard writes here so reporting userData gives accurate guidance.
 */
export function getPrimaryModelsDir() {
  return getUserModelsRoot()
}
