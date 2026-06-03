// Filesystem roots + id-slug helper for pet models (Live2D + sprite),
// extracted from petModelService. getBundledAssetRoot must know whether assets
// are served from the dev `public/` tree or the packaged `dist/` tree, so the
// dev flags are injected via configurePetModelPaths (called from init).
import { app } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const IMPORTED_PET_MODELS_DIRECTORY = 'live2d-imports'
const IMPORTED_SPRITE_PET_MODELS_DIRECTORY = 'sprite-pet-imports'

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

export function getSpritePetAssetRoot() {
  return getBundledAssetRoot('pets')
}

export function normalizeAssetRelativePath(rootPath, assetPath) {
  return path.relative(rootPath, assetPath).split(path.sep).join('/')
}

export function getImportedPetModelsRoot() {
  return path.join(app.getPath('userData'), IMPORTED_PET_MODELS_DIRECTORY)
}

export function getImportedSpritePetModelsRoot() {
  return path.join(app.getPath('userData'), IMPORTED_SPRITE_PET_MODELS_DIRECTORY)
}

export function getSpritePetCreatorKitsRoot() {
  return path.join(app.getPath('documents'), 'Nexus Pet Creator Kits')
}

function expandHomePath(value) {
  const rawPath = String(value ?? '').trim()
  if (!rawPath) {
    return ''
  }

  if (rawPath === '~') {
    return app.getPath('home')
  }

  if (rawPath.startsWith(`~${path.sep}`) || rawPath.startsWith('~/')) {
    return path.join(app.getPath('home'), rawPath.slice(2))
  }

  return rawPath
}

function getCodexHomeRoot() {
  const configuredHome = expandHomePath(process.env.CODEX_HOME)
  return path.resolve(configuredHome || path.join(app.getPath('home'), '.codex'))
}

export function getCodexCustomSpritePetModelsRoot() {
  return path.join(getCodexHomeRoot(), 'pets')
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
