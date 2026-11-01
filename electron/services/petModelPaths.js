// @ts-nocheck
// Filesystem roots + id-slug helper for Live2D models.
// getBundledAssetRoot must know whether assets are served from the dev
// `public/` tree or the packaged `dist/` tree, so the dev flags are injected
// via configurePetModelPaths (called from init).
import { app } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const IMPORTED_PET_MODELS_DIRECTORY = 'live2d-imports'
const USER_DATA_DISPLAY_ROOT = 'app-user-data'
const DOCUMENTS_DISPLAY_ROOT = 'Documents'

let _isDev = false
let _useDevServer = false

export function configurePetModelPaths({ isDev, useDevServer }) {
  _isDev = isDev
  _useDevServer = useDevServer
}

function getBundledAssetRoot(directoryName) {
  if (_isDev && _useDevServer) {
    return path.join(__dirname, '..', '..', 'public', directoryName)
  }

  return path.join(__dirname, '..', '..', 'dist', directoryName)
}

export function getLive2dAssetRoot() {
  return getBundledAssetRoot('live2d')
}

export function normalizeAssetRelativePath(rootPath, assetPath) {
  return path.relative(rootPath, assetPath).split(path.sep).join('/')
}

export function getImportedPetModelsRoot() {
  return path.join(app.getPath('userData'), IMPORTED_PET_MODELS_DIRECTORY)
}

/** True when candidatePath is rootPath or a descendant. */
export function isPathInsideRoot(rootPath, candidatePath) {
  const relativePath = path.relative(rootPath, candidatePath)
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

function joinDisplayPath(rootLabel, relativePath) {
  const normalized = relativePath.split(path.sep).filter(Boolean).join('/')
  return normalized ? `${rootLabel}/${normalized}` : rootLabel
}

function displayPathUnderRoot(rootPath, rootLabel, targetPath) {
  const resolvedRoot = path.resolve(rootPath)
  const resolvedTarget = path.resolve(targetPath)
  if (!isPathInsideRoot(resolvedRoot, resolvedTarget)) return ''
  return joinDisplayPath(rootLabel, path.relative(resolvedRoot, resolvedTarget))
}

export function getLocalFileDisplayPath(targetPath) {
  const rawPath = String(targetPath ?? '').trim()
  if (!rawPath) return ''

  const resolvedTarget = path.resolve(rawPath)
  const knownRootDisplays = [
    [app.getPath('userData'), USER_DATA_DISPLAY_ROOT],
    [app.getPath('documents'), DOCUMENTS_DISPLAY_ROOT],
    [app.getPath('home'), '~'],
  ]

  for (const [rootPath, rootLabel] of knownRootDisplays) {
    const displayPath = displayPathUnderRoot(rootPath, rootLabel, resolvedTarget)
    if (displayPath) return displayPath
  }

  return `.../${path.basename(resolvedTarget) || 'path'}`
}

export function getPetArtifactDisplayPath(targetPath) {
  return getLocalFileDisplayPath(targetPath)
}

export function slugifyPetModelId(value) {
  const normalized = String(value ?? '')
    .trim()
    .replace(/\.model3\.json$/i, '')
    .replace(/[\\/]+/g, '-')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()

  return normalized || 'live2d-model'
}
