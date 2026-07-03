import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, nativeImage } from 'electron'

import { getRedactedErrorMessage } from './services/errorRedaction.js'

const WINDOWS_APP_USER_MODEL_ID = 'ai.factory.desktoppet'
const WINDOWS_APP_ICON_FILE = 'nexus.ico'
const DEFAULT_APP_ICON_FILE = 'nexus-256.png'
const __dirname = path.dirname(fileURLToPath(import.meta.url))

function getAppIconFilename(platform = process.platform) {
  return platform === 'win32' ? WINDOWS_APP_ICON_FILE : DEFAULT_APP_ICON_FILE
}

function getAppIconPathCandidates(platform = process.platform, baseDir = __dirname) {
  const filename = getAppIconFilename(platform)
  const candidates = []

  if (app.isPackaged && process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, filename))
    candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', filename))
  }

  candidates.push(path.join(baseDir, '..', 'dist', filename))
  candidates.push(path.join(baseDir, '..', 'public', filename))

  // On Windows, an executable path can be used as icon source by some shell
  // surfaces (taskbar relaunch metadata). Keep it as a last-resort fallback.
  if (platform === 'win32') {
    candidates.push(process.execPath)
  }

  const uniqueCandidates = new Set()
  for (const candidate of candidates) {
    const normalized = String(candidate ?? '').trim()
    if (!normalized || uniqueCandidates.has(normalized)) continue
    uniqueCandidates.add(normalized)
  }
  return [...uniqueCandidates]
}

function pickExistingIconPath(candidates) {
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate
    } catch {
      // Ignore invalid candidates.
    }
  }
  return null
}

export function getPetIconPath(platform = process.platform) {
  const candidates = getAppIconPathCandidates(platform)
  const existing = pickExistingIconPath(candidates)
  return existing ?? candidates[0] ?? path.join(
    __dirname,
    '..',
    'public',
    getAppIconFilename(platform),
  )
}

export function getPetIconCandidates(platform = process.platform) {
  return getAppIconPathCandidates(platform)
}

export function createNativeImageFromCandidates(candidates) {
  for (const candidate of candidates) {
    const image = nativeImage.createFromPath(candidate)
    if (!image.isEmpty()) {
      return image
    }
  }
  return null
}

export function applyWindowIcon(win) {
  if (!win || win.isDestroyed()) return
  if (process.platform !== 'win32' && process.platform !== 'linux') return
  try {
    win.setIcon(getPetIconPath(process.platform))
  } catch (err) {
    console.warn('[window] Failed to set window icon:', getRedactedErrorMessage(err))
  }
}

export function applyWindowsAppDetails(win) {
  if (process.platform !== 'win32' || !win || win.isDestroyed()) return
  try {
    win.setAppDetails({
      appId: WINDOWS_APP_USER_MODEL_ID,
      appIconPath: getPetIconPath(),
      appIconIndex: 0,
      relaunchCommand: process.execPath,
      relaunchDisplayName: app.name || 'Nexus',
    })
  } catch (err) {
    console.warn('[windows] Failed to set window app details:', getRedactedErrorMessage(err))
  }
}
