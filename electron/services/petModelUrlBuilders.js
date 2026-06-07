import path from 'node:path'

export const IMPORTED_PET_MODELS_ROUTE = '/__imported_live2d__'
export const IMPORTED_SPRITE_PET_MODELS_ROUTE = '/__imported_sprite_pets__'
export const CODEX_CUSTOM_SPRITE_PET_MODELS_ROUTE = '/__codex_sprite_pets__'

let getRendererServerUrl = () => null

export function configurePetModelUrlBuilders({ getRendererServerUrl: nextGetRendererServerUrl } = {}) {
  if (typeof nextGetRendererServerUrl === 'function') {
    getRendererServerUrl = nextGetRendererServerUrl
  }
}

function normalizeRelativeAssetUrlPath(relativeAssetPath) {
  return String(relativeAssetPath ?? '').split(path.sep).join('/')
}

function buildAssetUrl(route, relativeAssetPath) {
  const normalizedRelativePath = normalizeRelativeAssetUrlPath(relativeAssetPath)
  const rendererServerUrl = getRendererServerUrl()

  if (!rendererServerUrl) {
    return `${route}/${normalizedRelativePath}`
  }

  return new URL(`${route}/${normalizedRelativePath}`, rendererServerUrl).toString()
}

export function buildImportedPetModelUrl(relativeModelPath) {
  return buildAssetUrl(IMPORTED_PET_MODELS_ROUTE, relativeModelPath)
}

export function buildImportedSpritePetAssetUrl(relativeAssetPath) {
  return buildAssetUrl(IMPORTED_SPRITE_PET_MODELS_ROUTE, relativeAssetPath)
}

export function buildCodexCustomSpritePetAssetUrl(relativeAssetPath) {
  return buildAssetUrl(CODEX_CUSTOM_SPRITE_PET_MODELS_ROUTE, relativeAssetPath)
}
