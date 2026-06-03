import fs from 'node:fs/promises'
import path from 'node:path'
import {
  SPRITE_PET_CELL_HEIGHT,
  SPRITE_PET_CELL_WIDTH,
  SPRITE_PET_COLUMNS,
  SPRITE_PET_ROWS,
  readSpritePetPackage,
} from './spritePetPackage.js'

const DEFAULT_PET_MODEL_FALLBACK_IMAGE_PATH = ''

export function normalizeSpritePetAssetRelativePath(rootPath, assetPath) {
  return path.relative(rootPath, assetPath).split(path.sep).join('/')
}

export function slugifySpritePetModelId(value) {
  const normalized = String(value ?? '')
    .trim()
    .replace(/[\\/]+/g, '-')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()

  return normalized || 'sprite-pet'
}

async function collectSpritePetManifestFiles(directoryPath) {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true })
  const manifestFiles = []

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name)

    if (entry.isDirectory()) {
      manifestFiles.push(...await collectSpritePetManifestFiles(entryPath))
      continue
    }

    if (entry.name === 'pet.json') {
      manifestFiles.push(entryPath)
    }
  }

  return manifestFiles
}

export async function listSpritePetModelsFromRoot({
  rootPath,
  description,
  idPrefix = '',
  imagePathBuilder,
}) {
  let manifestFiles = []

  try {
    manifestFiles = await collectSpritePetManifestFiles(rootPath)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return []
    }

    console.error(`Failed to scan Sprite pet models in ${rootPath}:`, error)
    return []
  }

  const discoveredModels = []
  const usedIds = new Set()

  for (const manifestPath of manifestFiles.sort()) {
    const relativeManifestPath = normalizeSpritePetAssetRelativePath(rootPath, manifestPath)

    try {
      const manifest = await readSpritePetPackage(manifestPath)
      const relativeSpritePath = normalizeSpritePetAssetRelativePath(rootPath, manifest.sourceSpritePath)
      const slugSource = manifest.id || manifest.displayName || path.basename(path.dirname(manifestPath))
      const slug = slugifySpritePetModelId(slugSource)
      const baseId = idPrefix ? `${idPrefix}-${slug}` : slug
      let modelId = baseId
      let collisionIndex = 2

      while (usedIds.has(modelId)) {
        modelId = `${baseId}-${collisionIndex}`
        collisionIndex += 1
      }

      usedIds.add(modelId)
      discoveredModels.push({
        id: modelId,
        label: manifest.displayName,
        description: manifest.description || description,
        modelPath: '',
        fallbackImagePath: DEFAULT_PET_MODEL_FALLBACK_IMAGE_PATH,
        spriteAtlas: {
          imagePath: imagePathBuilder(relativeSpritePath),
          columns: SPRITE_PET_COLUMNS,
          rows: SPRITE_PET_ROWS,
          cellWidth: SPRITE_PET_CELL_WIDTH,
          cellHeight: SPRITE_PET_CELL_HEIGHT,
        },
        motionGroups: {},
        expressionMap: {},
        mouthParams: {},
      })
    } catch (error) {
      console.warn(`Skipping invalid Sprite pet package: ${relativeManifestPath}`, error)
    }
  }

  return discoveredModels.sort((left, right) => (
    left.label.localeCompare(right.label, 'zh-Hans-CN', {
      sensitivity: 'base',
    })
  ))
}
