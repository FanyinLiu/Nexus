import fs from 'node:fs/promises'
import path from 'node:path'
import { inspectLive2dModelFile } from './live2dModelCompatibility.js'
import {
  normalizeAssetRelativePath,
  slugifyPetModelId,
} from './petModelPaths.js'

const DEFAULT_PET_MODEL_FALLBACK_IMAGE_PATH = ''

function getPathSegment(segments, indexFromEnd) {
  return segments[segments.length - indexFromEnd] ?? ''
}

function pickDiscoveredModelName(relativeModelPath) {
  const withoutExtension = relativeModelPath.replace(/\.model3\.json$/i, '')
  const segments = withoutExtension.split('/').filter(Boolean)
  const fileName = getPathSegment(segments, 1) || 'Live2D'
  const folderName = getPathSegment(segments, 2) || fileName

  if (/^model\d*$/i.test(fileName)) {
    return folderName
  }

  if (fileName.toLowerCase() === folderName.toLowerCase()) {
    return folderName
  }

  return fileName
}

export function formatDiscoveredModelLabel(name) {
  const rawName = String(name ?? '').trim()

  if (!rawName) {
    return 'Live2D Model'
  }

  if (/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(rawName)) {
    return rawName
  }

  return rawName
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

async function collectLive2dModelFiles(directoryPath) {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true })
  const modelFiles = []

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name)

    if (entry.isDirectory()) {
      modelFiles.push(...await collectLive2dModelFiles(entryPath))
      continue
    }

    if (/\.model3\.json$/i.test(entry.name)) {
      modelFiles.push(entryPath)
    }
  }

  return modelFiles
}

export async function listPetModelsFromRoot({
  rootPath,
  description,
  idPrefix = '',
  modelPathBuilder,
}) {
  let modelFiles

  try {
    modelFiles = await collectLive2dModelFiles(rootPath)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return []
    }

    console.error('Failed to scan Live2D model root.', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorCode: typeof error?.code === 'string' ? error.code : undefined,
    })
    return []
  }

  const discoveredModels = []
  const usedIds = new Set()

  for (const modelFilePath of modelFiles.sort()) {
    const relativeModelPath = normalizeAssetRelativePath(rootPath, modelFilePath)

    try {
      const inspection = await inspectLive2dModelFile(modelFilePath)
      if (inspection.compatibility.status === 'blocked') {
        console.warn('Skipping incompatible Live2D model definition.')
        continue
      }

      const { compatibility } = inspection

      const modelName = pickDiscoveredModelName(relativeModelPath)
      const label = formatDiscoveredModelLabel(modelName)
      const baseId = idPrefix
        ? `${idPrefix}-${slugifyPetModelId(relativeModelPath)}`
        : slugifyPetModelId(modelName)
      let modelId = baseId
      let collisionIndex = 2

      while (usedIds.has(modelId)) {
        modelId = `${baseId}-${collisionIndex}`
        collisionIndex += 1
      }

      usedIds.add(modelId)
      discoveredModels.push({
        id: modelId,
        label,
        description,
        modelPath: modelPathBuilder(relativeModelPath),
        fallbackImagePath: DEFAULT_PET_MODEL_FALLBACK_IMAGE_PATH,
        motionGroups: {},
        expressionMap: {},
        mouthParams: {},
        compatibility,
      })
    } catch (error) {
      console.warn('Skipping invalid Live2D model definition.', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
        errorCode: typeof error?.code === 'string' ? error.code : undefined,
      })
      continue
    }
  }

  return discoveredModels.sort((left, right) => (
    left.label.localeCompare(right.label, 'zh-Hans-CN', {
      sensitivity: 'base',
    })
  ))
}
