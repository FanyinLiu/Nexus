/**
 * Live2D model library: bundled samples plus models the user imported.
 * Sprite and portrait packages are not a pet type anymore.
 */
import { app, dialog, BrowserWindow } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { assertNotPrivateCodexPetSource } from './petImportPolicy.js'
import {
  configurePetModelPaths,
  getImportedPetModelsRoot,
  getLive2dAssetRoot,
  getLocalFileDisplayPath,
  isPathInsideRoot,
  normalizeAssetRelativePath,
  slugifyPetModelId,
} from './petModelPaths.js'
import {
  buildImportedPetModelUrl,
  configurePetModelUrlBuilders,
} from './petModelUrlBuilders.js'
import { listPetModelsFromRoot } from './live2dModelDiscoveryService.js'
import { inspectLive2dModelFile } from './live2dModelCompatibility.js'
import { pathExists } from './fsUtils.js'
import { getLive2dImportMessageContract } from '../../shared/live2dModelResources.js'
import {
  PET_IPC_ERROR_CODES,
  buildPetIpcError,
} from '../../shared/petErrorCodes.js'

const IMPORTED_PET_MODEL_DESCRIPTION = '已导入到应用本地目录的 Live2D 模型，可直接切换。'
const AUTO_DISCOVERED_PET_MODEL_DESCRIPTION = '自动发现的 Live2D 模型，可继续细调动作和表情映射。'

let _getPanelWindow = () => null
let _getMainWindow = () => null

export function initPetModelService({ isDev, useDevServer, getRendererServerUrl, getPanelWindow, getMainWindow }) {
  configurePetModelPaths({ isDev, useDevServer })
  configurePetModelUrlBuilders({ getRendererServerUrl })
  _getPanelWindow = getPanelWindow
  _getMainWindow = getMainWindow
}

async function resolveUniqueChildDirectory(root, baseName) {
  let targetDirectory = path.join(root, baseName)
  let duplicateIndex = 2

  while (await pathExists(targetDirectory)) {
    targetDirectory = path.join(root, `${baseName}-${duplicateIndex}`)
    duplicateIndex += 1
  }

  return targetDirectory
}

async function listBundledPetModels() {
  return listPetModelsFromRoot({
    rootPath: getLive2dAssetRoot(),
    description: AUTO_DISCOVERED_PET_MODEL_DESCRIPTION,
    modelPathBuilder: (relativeModelPath) => `./live2d/${relativeModelPath}`,
  })
}

async function listImportedPetModels() {
  return listPetModelsFromRoot({
    rootPath: getImportedPetModelsRoot(),
    description: IMPORTED_PET_MODEL_DESCRIPTION,
    idPrefix: 'imported',
    modelPathBuilder: buildImportedPetModelUrl,
  })
}

async function listAvailablePetModels() {
  const [bundledModels, importedModels] = await Promise.all([
    listBundledPetModels(),
    listImportedPetModels(),
  ])

  return [
    ...bundledModels,
    ...importedModels,
  ]
}

async function importLive2dPetModelFromPath(selectedModelPath) {
  assertNotPrivateCodexPetSource(selectedModelPath)
  const inspection = await inspectLive2dModelFile(selectedModelPath)
  if (inspection.compatibility.status === 'blocked') {
    const messageContract = getLive2dImportMessageContract(
      'blocked',
      inspection.compatibility.errors,
    )
    return {
      model: null,
      message: messageContract.messageKey,
      ...messageContract,
      compatibility: inspection.compatibility,
    }
  }

  const importedRoot = getImportedPetModelsRoot()
  if (isPathInsideRoot(importedRoot, selectedModelPath)) {
    throw buildPetIpcError(PET_IPC_ERROR_CODES.ALREADY_IMPORTED)
  }

  const sourceDirectory = path.dirname(selectedModelPath)
  const sourceDirectoryName = path.basename(sourceDirectory) || path.basename(selectedModelPath, '.model3.json')
  const importDirectoryBaseName = `${slugifyPetModelId(sourceDirectoryName)}-${Date.now()}`

  await fs.mkdir(importedRoot, { recursive: true })
  const targetDirectory = await resolveUniqueChildDirectory(importedRoot, importDirectoryBaseName)

  try {
    await fs.cp(sourceDirectory, targetDirectory, { recursive: true, dereference: true })

    const importedModelPath = path.join(targetDirectory, path.basename(selectedModelPath))
    if (!await pathExists(importedModelPath)) {
      throw buildPetIpcError(PET_IPC_ERROR_CODES.IMPORT_INCOMPLETE)
    }

    const importedModels = await listImportedPetModels()
    const importedModelUrl = buildImportedPetModelUrl(
      normalizeAssetRelativePath(importedRoot, importedModelPath),
    )
    const importedModel = importedModels.find((model) => model.modelPath === importedModelUrl)

    if (!importedModel) {
      throw buildPetIpcError(PET_IPC_ERROR_CODES.IMPORT_INCOMPLETE)
    }

    const compatibility = importedModel.compatibility ?? inspection.compatibility
    const messageContract = getLive2dImportMessageContract(
      compatibility.status,
      compatibility.errors,
    )
    return {
      model: importedModel,
      message: messageContract.messageKey,
      ...messageContract,
      compatibility,
    }
  } catch (error) {
    await fs.rm(targetDirectory, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

async function importPetModelFromDialog() {
  const panelWindow = _getPanelWindow()
  const mainWindow = _getMainWindow()
  const sourceWindow = BrowserWindow.getFocusedWindow() ?? panelWindow ?? mainWindow ?? undefined
  const dialogOptions = {
    title: '选择 Live2D 模型',
    buttonLabel: '导入',
    properties: ['openFile'],
    filters: [
      {
        name: 'Live2D',
        extensions: ['json'],
      },
    ],
  }
  const selection = sourceWindow
    ? await dialog.showOpenDialog(sourceWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions)

  if (selection.canceled || !selection.filePaths.length) {
    return null
  }

  const selectedPath = path.resolve(selection.filePaths[0])
  if (!/\.model3\.json$/i.test(path.basename(selectedPath))) {
    throw buildPetIpcError(PET_IPC_ERROR_CODES.UNSUPPORTED_FILE)
  }

  return importLive2dPetModelFromPath(selectedPath)
}

async function saveTextFileFromDialog(sourceWindow, payload = {}) {
  const defaultFileName = String(payload.defaultFileName ?? '').trim() || `desktop-pet-${Date.now()}.json`
  const content = String(payload.content ?? '')
  const filters = Array.isArray(payload.filters) && payload.filters.length
    ? payload.filters
    : [
        {
          name: 'JSON',
          extensions: ['json'],
        },
      ]

  const dialogOptions = {
    title: String(payload.title ?? '保存文件'),
    buttonLabel: '保存',
    defaultPath: path.join(app.getPath('documents'), defaultFileName),
    filters,
  }

  const result = sourceWindow
    ? await dialog.showSaveDialog(sourceWindow, dialogOptions)
    : await dialog.showSaveDialog(dialogOptions)

  if (result.canceled || !result.filePath) {
    return {
      canceled: true,
      message: '已取消保存。',
    }
  }

  await fs.writeFile(result.filePath, content, 'utf8')
  const filePathDisplay = getLocalFileDisplayPath(result.filePath)

  return {
    canceled: false,
    filePath: result.filePath,
    filePathDisplay,
    message: `已保存到 ${filePathDisplay}`,
  }
}

async function openTextFileFromDialog(sourceWindow, payload = {}) {
  const filters = Array.isArray(payload.filters) && payload.filters.length
    ? payload.filters
    : [
        {
          name: 'JSON',
          extensions: ['json'],
        },
      ]

  const dialogOptions = {
    title: String(payload.title ?? '选择文件'),
    buttonLabel: '打开',
    properties: ['openFile'],
    filters,
  }

  const result = sourceWindow
    ? await dialog.showOpenDialog(sourceWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions)

  if (result.canceled || !result.filePaths.length) {
    return {
      canceled: true,
      message: '已取消打开。',
    }
  }

  const filePath = path.resolve(result.filePaths[0])
  const content = await fs.readFile(filePath, 'utf8')
  const filePathDisplay = getLocalFileDisplayPath(filePath)

  return {
    canceled: false,
    filePath,
    filePathDisplay,
    content: content.replace(/^\uFEFF/, ''),
    message: `已读取 ${filePathDisplay}`,
  }
}

export {
  listAvailablePetModels,
  importPetModelFromDialog,
  saveTextFileFromDialog,
  openTextFileFromDialog,
}
