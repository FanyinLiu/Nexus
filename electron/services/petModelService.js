import { app, dialog, BrowserWindow } from 'electron'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  performNetworkRequest,
  readResponseBufferWithLimit,
} from '../net.js'
import {
  SPRITE_PET_ARCHIVE_MAX_BYTES,
  SPRITE_PET_MAX_BYTES,
  assertNotPrivateCodexPetSource,
  extractSpritePetZipArchive,
  isPathInsideRoot,
  isSpritePetManifest,
  readSpritePetPackage,
} from './spritePetPackage.js'
import {
  listSpritePetModelsFromRoot,
} from './spritePetModelDiscovery.js'
import {
  fetchCodexPetGalleryCatalog,
  isHttpUrl,
  parseCodexPetOrgPage,
  parseCodingPetsPage,
  resolveCodexPetsNetDownloadUrl,
} from './codexPetGallery.js'
import {
  isCodingPetsDetailUrl,
  isCodexPetGalleryDetailUrl,
  isCodexPetOrgDetailUrl,
  isCodexPetsNetDetailUrl,
  isKnownPetGalleryHost,
  isKnownPetGalleryZipUrl,
  parseCodexPetGalleryPageByHost,
  uniqueCodexPetGalleryCandidates,
} from './petGalleryUrls.js'
import {
  configurePetModelPaths,
  getCodexCustomSpritePetModelsRoot,
  getImportedPetModelsRoot,
  getImportedSpritePetModelsRoot,
  getLive2dAssetRoot,
  getLocalFileDisplayPath,
  getSpritePetAssetRoot,
  normalizeAssetRelativePath,
  slugifyPetModelId,
} from './petModelPaths.js'
import {
  buildCodexCustomSpritePetAssetUrl,
  buildImportedPetModelUrl,
  buildImportedSpritePetAssetUrl,
  configurePetModelUrlBuilders,
  CODEX_CUSTOM_SPRITE_PET_MODELS_ROUTE,
  IMPORTED_PET_MODELS_ROUTE,
  IMPORTED_SPRITE_PET_MODELS_ROUTE,
} from './petModelUrlBuilders.js'
import {
  listPetModelsFromRoot,
} from './live2dModelDiscoveryService.js'
import { inspectLive2dModelFile } from './live2dModelCompatibility.js'
import { pathExists, readJsonFile } from './fsUtils.js'
import { getLive2dImportMessageContract } from '../../shared/live2dModelResources.js'
import {
  PET_IMPORT_MESSAGE_KEYS,
  PET_IPC_ERROR_CODES,
  buildPetIpcError,
} from '../../shared/petErrorCodes.js'

const IMPORTED_PET_MODEL_DESCRIPTION = '已导入到应用本地目录的 Live2D 模型，可直接切换。'
const BUNDLED_SPRITE_PET_MODEL_DESCRIPTION = '内置 Sprite 宠物包，可直接切换。'
const CODEX_CUSTOM_SPRITE_PET_MODEL_DESCRIPTION = 'Codex 自定义 Sprite 宠物包，来自本机 Codex pets 目录。'
const IMPORTED_SPRITE_PET_MODEL_DESCRIPTION = '已导入到应用本地目录的 Sprite 宠物包，可直接切换。'
const AUTO_DISCOVERED_PET_MODEL_DESCRIPTION = '自动发现的 Live2D 模型，可继续细调动作和表情映射。'
const PET_GALLERY_REQUEST_TIMEOUT_MS = 20_000

let _getPanelWindow = () => null
let _getMainWindow = () => null

export function initPetModelService({ isDev, useDevServer, getRendererServerUrl, getPanelWindow, getMainWindow }) {
  configurePetModelPaths({ isDev, useDevServer })
  configurePetModelUrlBuilders({ getRendererServerUrl })
  _getPanelWindow = getPanelWindow
  _getMainWindow = getMainWindow
}

async function fetchText(url) {
  const response = await performNetworkRequest(url, {
    timeoutMs: PET_GALLERY_REQUEST_TIMEOUT_MS,
    timeoutMessage: PET_IPC_ERROR_CODES.NETWORK,
    followRedirectsSafely: true,
  })
  if (!response.ok) {
    throw buildPetIpcError(PET_IPC_ERROR_CODES.NETWORK)
  }

  return response.text()
}

async function fetchBytes(url, options = {}) {
  const maxBytes = Number.parseInt(String(options.maxBytes ?? SPRITE_PET_MAX_BYTES), 10) || SPRITE_PET_MAX_BYTES
  const label = String(options.label ?? 'spritesheet')
  const response = await performNetworkRequest(url, {
    timeoutMs: PET_GALLERY_REQUEST_TIMEOUT_MS,
    timeoutMessage: PET_IPC_ERROR_CODES.NETWORK,
    followRedirectsSafely: true,
  })
  if (!response.ok) {
    throw buildPetIpcError(PET_IPC_ERROR_CODES.NETWORK)
  }

  return readResponseBufferWithLimit(response, { maxBytes, label })
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

/** Create a unique import folder and delete it if `work` throws. */
async function withFreshImportDirectory(importedRoot, importDirectoryBaseName, work) {
  const targetDirectory = await resolveUniqueChildDirectory(importedRoot, importDirectoryBaseName)
  try {
    return await work(targetDirectory)
  } catch (error) {
    await fs.rm(targetDirectory, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

function petUserMessage(messageKey, messageParams) {
  return {
    message: messageKey,
    messageKey,
    ...(messageParams ? { messageParams } : {}),
  }
}

async function readAndValidateJsonFile(filePath) {
  return readJsonFile(filePath)
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

async function listBundledSpritePetModels() {
  return listSpritePetModelsFromRoot({
    rootPath: getSpritePetAssetRoot(),
    description: BUNDLED_SPRITE_PET_MODEL_DESCRIPTION,
    idPrefix: '',
    imagePathBuilder: (relativeSpritePath) => `./pets/${relativeSpritePath}`,
  })
}

async function listImportedSpritePetModels() {
  return listSpritePetModelsFromRoot({
    rootPath: getImportedSpritePetModelsRoot(),
    description: IMPORTED_SPRITE_PET_MODEL_DESCRIPTION,
    idPrefix: 'sprite',
    imagePathBuilder: buildImportedSpritePetAssetUrl,
  })
}

async function listCodexCustomSpritePetModels() {
  return listSpritePetModelsFromRoot({
    rootPath: getCodexCustomSpritePetModelsRoot(),
    description: CODEX_CUSTOM_SPRITE_PET_MODEL_DESCRIPTION,
    idPrefix: 'codex',
    imagePathBuilder: buildCodexCustomSpritePetAssetUrl,
  })
}

async function listAvailablePetModels() {
  const [
    bundledModels,
    bundledSpritePetModels,
    codexCustomSpritePetModels,
    importedModels,
    importedSpritePetModels,
  ] = await Promise.all([
    listBundledPetModels(),
    listBundledSpritePetModels(),
    listCodexCustomSpritePetModels(),
    listImportedPetModels(),
    listImportedSpritePetModels(),
  ])

  return [
    ...bundledModels,
    ...bundledSpritePetModels,
    ...codexCustomSpritePetModels,
    ...importedModels,
    ...importedSpritePetModels,
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

async function importSpritePetModelFromPath(selectedManifestPath) {
  assertNotPrivateCodexPetSource(selectedManifestPath)
  const manifest = await readSpritePetPackage(selectedManifestPath)
  const sourceAssetPath = manifest.sourceSpritePath
  assertNotPrivateCodexPetSource(sourceAssetPath)
  const importedRoot = getImportedSpritePetModelsRoot()

  if (isPathInsideRoot(importedRoot, selectedManifestPath)) {
    throw buildPetIpcError(PET_IPC_ERROR_CODES.ALREADY_IMPORTED)
  }

  const sourceDirectory = path.dirname(selectedManifestPath)
  const importDirectoryBaseName = `${slugifyPetModelId(manifest.id || manifest.displayName || path.basename(sourceDirectory))}-${Date.now()}`

  await fs.mkdir(importedRoot, { recursive: true })
  return withFreshImportDirectory(importedRoot, importDirectoryBaseName, async (targetDirectory) => {
    await fs.mkdir(targetDirectory, { recursive: true })

    const assetExtension = path.extname(sourceAssetPath).toLowerCase()
    const targetAssetName = `spritesheet${assetExtension}`
    const targetAssetPath = path.join(targetDirectory, targetAssetName)
    const targetManifest = {
      id: slugifyPetModelId(manifest.id || manifest.displayName || path.basename(sourceDirectory)),
      displayName: manifest.displayName,
      description: manifest.description || IMPORTED_SPRITE_PET_MODEL_DESCRIPTION,
      spritesheetPath: targetAssetName,
    }

    await fs.copyFile(sourceAssetPath, targetAssetPath)
    await fs.writeFile(
      path.join(targetDirectory, 'pet.json'),
      `${JSON.stringify(targetManifest, null, 2)}\n`,
      'utf8',
    )

    const importedModels = await listImportedSpritePetModels()
    const importedAssetUrl = buildImportedSpritePetAssetUrl(
      normalizeAssetRelativePath(importedRoot, targetAssetPath),
    )
    const importedModel = importedModels.find((model) => (
      model.spriteAtlas?.imagePath === importedAssetUrl
    ))

    if (!importedModel) {
      throw buildPetIpcError(PET_IPC_ERROR_CODES.IMPORT_INCOMPLETE)
    }

    return {
      model: importedModel,
      ...petUserMessage(PET_IMPORT_MESSAGE_KEYS.imported, { name: importedModel.label }),
    }
  })
}

async function importSpritePetModelFromZipArchive(selectedArchivePath) {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-sprite-pet-zip-import-'))

  try {
    const { manifestPath } = await extractSpritePetZipArchive(selectedArchivePath, temporaryDirectory)
    return await importSpritePetModelFromPath(manifestPath)
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true })
  }
}

async function importSpritePetModelFromRemoteZipUrl(archiveUrl, source = {}) {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-sprite-pet-remote-zip-'))
  const archivePath = path.join(temporaryDirectory, 'remote-codex-pet.zip')

  try {
    await fs.writeFile(
      archivePath,
      await fetchBytes(archiveUrl, {
        maxBytes: SPRITE_PET_ARCHIVE_MAX_BYTES,
        label: 'ZIP 宠物包',
      }),
    )
    const imported = await importSpritePetModelFromZipArchive(archivePath)
    const sourceName = String(source.sourceName ?? '').trim()
    return {
      ...imported,
      ...petUserMessage(PET_IMPORT_MESSAGE_KEYS.importedFrom, sourceName
        ? { name: imported.model.label, source: sourceName }
        : { name: imported.model.label, sourceKey: PET_IMPORT_MESSAGE_KEYS.sourceCommunityZip }),
    }
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true })
  }
}

async function importSpritePetModelFromCodexGalleryUrlCandidates(candidateUrls) {
  if (!candidateUrls.length) {
    throw buildPetIpcError(PET_IPC_ERROR_CODES.GALLERY_INPUT)
  }

  let lastError = null
  for (const pageUrl of candidateUrls) {
    try {
      const petPage = parseCodexPetGalleryPageByHost(pageUrl, await fetchText(pageUrl))
      return importSpritePetModelFromParsedPage(petPage)
    } catch (error) {
      lastError = error
    }
  }

  throw buildPetIpcError(PET_IPC_ERROR_CODES.GALLERY_FAILED, { cause: lastError })
}

async function importSpritePetModelFromCodexGallery(input) {
  const rawInput = String(input ?? '').trim()
  if (!rawInput) {
    throw buildPetIpcError(PET_IPC_ERROR_CODES.GALLERY_INPUT)
  }

  if (isCodingPetsDetailUrl(rawInput)) {
    const page = parseCodingPetsPage(await fetchText(rawInput), rawInput)
    return importSpritePetModelFromRemoteZipUrl(page.downloadUrl, page)
  }

  if (isCodexPetsNetDetailUrl(rawInput)) {
    return importSpritePetModelFromRemoteZipUrl(
      resolveCodexPetsNetDownloadUrl(rawInput),
      { sourceName: 'CodexPets.net' },
    )
  }

  if (isCodexPetOrgDetailUrl(rawInput)) {
    const petPage = parseCodexPetOrgPage(await fetchText(rawInput), rawInput)
    return importSpritePetModelFromParsedPage(petPage)
  }

  if (
    isHttpUrl(rawInput)
    && isKnownPetGalleryHost(rawInput)
    && !isCodexPetGalleryDetailUrl(rawInput)
    && !isKnownPetGalleryZipUrl(rawInput)
  ) {
    throw buildPetIpcError(PET_IPC_ERROR_CODES.GALLERY_INPUT)
  }

  if (isHttpUrl(rawInput) && !isCodexPetGalleryDetailUrl(rawInput)) {
    return importSpritePetModelFromRemoteZipUrl(rawInput)
  }

  const candidates = uniqueCodexPetGalleryCandidates(rawInput, true)

  if (!candidates.length) {
    throw buildPetIpcError(PET_IPC_ERROR_CODES.GALLERY_INPUT)
  }

  return importSpritePetModelFromCodexGalleryUrlCandidates(candidates)
}

async function importSpritePetModelFromParsedPage(petPage) {
  const importedRoot = getImportedSpritePetModelsRoot()
  const packageId = slugifyPetModelId(petPage.id || petPage.displayName)
  const importDirectoryBaseName = `${packageId}-${Date.now()}`

  await fs.mkdir(importedRoot, { recursive: true })
  return withFreshImportDirectory(importedRoot, importDirectoryBaseName, async (targetDirectory) => {
    const targetSpriteName = `spritesheet.${petPage.spriteExtension}`
    const targetSpritePath = path.join(targetDirectory, targetSpriteName)
    const targetManifestPath = path.join(targetDirectory, 'pet.json')
    const targetManifest = {
      id: packageId,
      displayName: petPage.displayName,
      description: petPage.description || IMPORTED_SPRITE_PET_MODEL_DESCRIPTION,
      spritesheetPath: targetSpriteName,
    }

    await fs.mkdir(targetDirectory, { recursive: true })
    await fs.writeFile(targetSpritePath, await fetchBytes(petPage.spriteUrl))
    await fs.writeFile(targetManifestPath, `${JSON.stringify(targetManifest, null, 2)}\n`, 'utf8')
    await readSpritePetPackage(targetManifestPath)

    const importedModels = await listImportedSpritePetModels()
    const importedSpriteUrl = buildImportedSpritePetAssetUrl(
      normalizeAssetRelativePath(importedRoot, targetSpritePath),
    )
    const importedModel = importedModels.find((model) => model.spriteAtlas?.imagePath === importedSpriteUrl)

    if (!importedModel) {
      throw buildPetIpcError(PET_IPC_ERROR_CODES.IMPORT_INCOMPLETE)
    }

    return {
      model: importedModel,
      ...petUserMessage(PET_IMPORT_MESSAGE_KEYS.importedFrom, {
        name: importedModel.label,
        source: petPage.sourceName || 'codex-pet',
      }),
    }
  })
}

async function listCodexPetGalleryCatalog(payload = {}) {
  return fetchCodexPetGalleryCatalog({
    query: String(payload?.query ?? '').trim(),
    limit: payload?.limit,
    fetchText,
  })
}

async function importPetModelFromDialog() {
  const panelWindow = _getPanelWindow()
  const mainWindow = _getMainWindow()
  const sourceWindow = BrowserWindow.getFocusedWindow() ?? panelWindow ?? mainWindow ?? undefined
  const dialogOptions = {
    title: '选择 Live2D 模型或精灵宠物包',
    buttonLabel: '导入',
    properties: ['openFile'],
    filters: [
      {
        name: 'Live2D model or sprite pet package',
        extensions: ['json', 'zip'],
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

  if (/\.model3\.json$/i.test(path.basename(selectedPath))) {
    return importLive2dPetModelFromPath(selectedPath)
  }

  if (path.extname(selectedPath).toLowerCase() === '.zip') {
    return importSpritePetModelFromZipArchive(selectedPath)
  }

  const manifest = await readAndValidateJsonFile(selectedPath)
  if (path.basename(selectedPath) === 'pet.json' || isSpritePetManifest(manifest)) {
    return importSpritePetModelFromPath(selectedPath)
  }

  throw buildPetIpcError(PET_IPC_ERROR_CODES.UNSUPPORTED_FILE)
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
  isPathInsideRoot,
  getImportedPetModelsRoot,
  getImportedSpritePetModelsRoot,
  getCodexCustomSpritePetModelsRoot,
  IMPORTED_PET_MODELS_ROUTE,
  IMPORTED_SPRITE_PET_MODELS_ROUTE,
  CODEX_CUSTOM_SPRITE_PET_MODELS_ROUTE,
  listAvailablePetModels,
  importPetModelFromDialog,
  importSpritePetModelFromCodexGallery,
  listCodexPetGalleryCatalog,
  saveTextFileFromDialog,
  openTextFileFromDialog,
}
