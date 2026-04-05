import { app, dialog, BrowserWindow } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const IMPORTED_PET_MODEL_DESCRIPTION = '已导入到应用本地目录的 Live2D 模型，可直接切换。'
const IMPORTED_PET_MODELS_ROUTE = '/__imported_live2d__'
const IMPORTED_PET_MODELS_DIRECTORY = 'live2d-imports'
const AUTO_DISCOVERED_PET_MODEL_DESCRIPTION = '自动发现的 Live2D 模型，可继续细调动作和表情映射。'
const DEFAULT_PET_MODEL_FALLBACK_IMAGE_PATH = ''

let _isDev = false
let _useDevServer = false
let _getRendererServerUrl = () => null
let _getPanelWindow = () => null
let _getMainWindow = () => null

export function initPetModelService({ isDev, useDevServer, getRendererServerUrl, getPanelWindow, getMainWindow }) {
  _isDev = isDev
  _useDevServer = useDevServer
  _getRendererServerUrl = getRendererServerUrl
  _getPanelWindow = getPanelWindow
  _getMainWindow = getMainWindow
}

function getLive2dAssetRoot() {
  if (_isDev && _useDevServer) {
    return path.join(__dirname, '..', 'public', 'live2d')
  }

  return path.join(__dirname, '..', 'dist', 'live2d')
}

function normalizeAssetRelativePath(rootPath, assetPath) {
  return path.relative(rootPath, assetPath).split(path.sep).join('/')
}

function getImportedPetModelsRoot() {
  return path.join(app.getPath('userData'), IMPORTED_PET_MODELS_DIRECTORY)
}

function isPathInsideRoot(rootPath, candidatePath) {
  const relativePath = path.relative(rootPath, candidatePath)
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

function slugifyPetModelId(value) {
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

function formatDiscoveredModelLabel(name) {
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

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function readAndValidateJsonFile(filePath) {
  const rawFile = await fs.readFile(filePath, 'utf8')
  return JSON.parse(rawFile.replace(/^\uFEFF/, ''))
}

function buildImportedPetModelUrl(relativeModelPath) {
  const normalizedRelativePath = relativeModelPath.split(path.sep).join('/')
  const rendererServerUrl = _getRendererServerUrl()

  if (!rendererServerUrl) {
    return `${IMPORTED_PET_MODELS_ROUTE}/${normalizedRelativePath}`
  }

  return new URL(`${IMPORTED_PET_MODELS_ROUTE}/${normalizedRelativePath}`, rendererServerUrl).toString()
}

async function listPetModelsFromRoot({
  rootPath,
  description,
  idPrefix = '',
  modelPathBuilder,
}) {
  let modelFiles = []

  try {
    modelFiles = await collectLive2dModelFiles(rootPath)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return []
    }

    console.error(`Failed to scan Live2D models in ${rootPath}:`, error)
    return []
  }

  const discoveredModels = []
  const usedIds = new Set()

  for (const modelFilePath of modelFiles.sort()) {
    const relativeModelPath = normalizeAssetRelativePath(rootPath, modelFilePath)

    try {
      await readAndValidateJsonFile(modelFilePath)
    } catch (error) {
      console.warn(`Skipping invalid Live2D model definition: ${relativeModelPath}`, error)
      continue
    }

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
    })
  }

  return discoveredModels.sort((left, right) => (
    left.label.localeCompare(right.label, 'zh-Hans-CN', {
      sensitivity: 'base',
    })
  ))
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

  return [...bundledModels, ...importedModels]
}

async function importPetModelFromDialog() {
  const panelWindow = _getPanelWindow()
  const mainWindow = _getMainWindow()
  const sourceWindow = BrowserWindow.getFocusedWindow() ?? panelWindow ?? mainWindow ?? undefined
  const dialogOptions = {
    title: '选择 Live2D 模型文件 (.model3.json)',
    buttonLabel: '导入模型',
    properties: ['openFile'],
    filters: [
      {
        name: 'JSON',
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

  const selectedModelPath = path.resolve(selection.filePaths[0])

  if (!/\.model3\.json$/i.test(path.basename(selectedModelPath))) {
    throw new Error('请选择 Live2D 的 .model3.json 文件。')
  }

  await readAndValidateJsonFile(selectedModelPath)

  const importedRoot = getImportedPetModelsRoot()
  if (isPathInsideRoot(importedRoot, selectedModelPath)) {
    throw new Error('这个模型已经在本地模型库里，可以直接在人物模型下拉框里选择。')
  }

  const sourceDirectory = path.dirname(selectedModelPath)
  const sourceDirectoryName = path.basename(sourceDirectory) || path.basename(selectedModelPath, '.model3.json')
  const importDirectoryBaseName = `${slugifyPetModelId(sourceDirectoryName)}-${Date.now()}`

  await fs.mkdir(importedRoot, { recursive: true })

  let targetDirectory = path.join(importedRoot, importDirectoryBaseName)
  let duplicateIndex = 2
  while (await pathExists(targetDirectory)) {
    targetDirectory = path.join(importedRoot, `${importDirectoryBaseName}-${duplicateIndex}`)
    duplicateIndex += 1
  }

  await fs.cp(sourceDirectory, targetDirectory, { recursive: true })

  const importedModelPath = path.join(targetDirectory, path.basename(selectedModelPath))
  if (!await pathExists(importedModelPath)) {
    throw new Error('模型文件已复制到本地，但没有找到导入后的模型定义文件。')
  }

  const importedModels = await listImportedPetModels()
  const importedModelUrl = buildImportedPetModelUrl(
    normalizeAssetRelativePath(importedRoot, importedModelPath),
  )
  const importedModel = importedModels.find((model) => model.modelPath === importedModelUrl)

  if (!importedModel) {
    throw new Error('模型已导入，但未能在应用内完成注册。')
  }

  return {
    model: importedModel,
    message: `已导入 ${importedModel.label}，现在可以直接切换。`,
  }
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

  return {
    canceled: false,
    filePath: result.filePath,
    message: `已保存到 ${result.filePath}`,
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

  return {
    canceled: false,
    filePath,
    content: content.replace(/^\uFEFF/, ''),
    message: `已读取 ${filePath}`,
  }
}

export {
  isPathInsideRoot,
  getImportedPetModelsRoot,
  IMPORTED_PET_MODELS_ROUTE,
  listAvailablePetModels,
  importPetModelFromDialog,
  saveTextFileFromDialog,
  openTextFileFromDialog,
}
