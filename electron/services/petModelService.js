import { app, dialog, BrowserWindow, shell } from 'electron'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
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
  createSpritePetPackageFromImage,
} from './spritePetMaker.js'
import {
  createSpritePetCreatorKit,
} from './spritePetCreatorKit.js'
import {
  assembleSpritePetCreatorKit,
  inspectSpritePetCreatorKit,
} from './spritePetAssembler.js'
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
  resolveCodexPetFallbackSlug,
  uniqueCodexPetGalleryCandidates,
} from './petGalleryUrls.js'
import {
  configurePetModelPaths,
  getCodexCustomSpritePetModelsRoot,
  getImportedPetModelsRoot,
  getImportedSpritePetModelsRoot,
  getLive2dAssetRoot,
  getSpritePetAssetRoot,
  getSpritePetCreatorKitsRoot,
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
  readAndValidateLive2dModelFile,
} from './live2dModelDiscoveryService.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

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
    timeoutMessage: `请求 ${url} 超时。`,
  })
  if (!response.ok) {
    throw new Error(`请求 ${url} 失败：${response.status} ${response.statusText}`)
  }

  return response.text()
}

async function fetchBytes(url, options = {}) {
  const maxBytes = Number.parseInt(String(options.maxBytes ?? SPRITE_PET_MAX_BYTES), 10) || SPRITE_PET_MAX_BYTES
  const label = String(options.label ?? 'spritesheet')
  const response = await performNetworkRequest(url, {
    timeoutMs: PET_GALLERY_REQUEST_TIMEOUT_MS,
    timeoutMessage: `请求 ${url} 超时。`,
  })
  if (!response.ok) {
    throw new Error(`请求 ${url} 失败：${response.status} ${response.statusText}`)
  }

  return readResponseBufferWithLimit(response, { maxBytes, label })
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
  return readAndValidateLive2dModelFile(filePath)
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

async function importSpritePetModelFromPath(selectedManifestPath) {
  assertNotPrivateCodexPetSource(selectedManifestPath)
  const manifest = await readSpritePetPackage(selectedManifestPath)
  assertNotPrivateCodexPetSource(manifest.sourceSpritePath)
  const importedRoot = getImportedSpritePetModelsRoot()

  if (isPathInsideRoot(importedRoot, selectedManifestPath)) {
    throw new Error('这个宠物包已经在本地模型库里，可以直接在伙伴形象里选择。')
  }

  const sourceDirectory = path.dirname(selectedManifestPath)
  const importDirectoryBaseName = `${slugifyPetModelId(manifest.id || manifest.displayName || path.basename(sourceDirectory))}-${Date.now()}`

  await fs.mkdir(importedRoot, { recursive: true })

  let targetDirectory = path.join(importedRoot, importDirectoryBaseName)
  let duplicateIndex = 2
  while (await pathExists(targetDirectory)) {
    targetDirectory = path.join(importedRoot, `${importDirectoryBaseName}-${duplicateIndex}`)
    duplicateIndex += 1
  }

  await fs.mkdir(targetDirectory, { recursive: true })

  const spriteExtension = path.extname(manifest.sourceSpritePath).toLowerCase()
  const targetSpriteName = `spritesheet${spriteExtension}`
  const targetSpritePath = path.join(targetDirectory, targetSpriteName)
  const targetManifest = {
    id: slugifyPetModelId(manifest.id || manifest.displayName || path.basename(sourceDirectory)),
    displayName: manifest.displayName,
    description: manifest.description || IMPORTED_SPRITE_PET_MODEL_DESCRIPTION,
    spritesheetPath: targetSpriteName,
  }

  await fs.copyFile(manifest.sourceSpritePath, targetSpritePath)
  await fs.writeFile(
    path.join(targetDirectory, 'pet.json'),
    `${JSON.stringify(targetManifest, null, 2)}\n`,
    'utf8',
  )

  const importedModels = await listImportedSpritePetModels()
  const importedSpriteUrl = buildImportedSpritePetAssetUrl(
    normalizeAssetRelativePath(importedRoot, targetSpritePath),
  )
  const importedModel = importedModels.find((model) => model.spriteAtlas?.imagePath === importedSpriteUrl)

  if (!importedModel) {
    throw new Error('宠物包已导入，但未能在应用内完成注册。')
  }

  return {
    model: importedModel,
    message: `已导入 ${importedModel.label}，现在可以直接切换。`,
  }
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
    const sourceName = String(source.sourceName ?? '社区 ZIP').trim() || '社区 ZIP'
    return {
      ...imported,
      message: `已从 ${sourceName} 导入 ${imported.model.label}，现在可以直接切换。`,
    }
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true })
  }
}

async function importSpritePetModelFromCodexGalleryUrlCandidates(candidateUrls, fallbackContext) {
  if (!candidateUrls.length) {
    throw new Error(`未提供可用的 Codex 宠物详情页地址：${fallbackContext}`)
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

  const detailHint = candidateUrls.length > 1
    ? '已尝试 codex-pet.com 详情页和 codex-pet.org 详情页。'
    : ''
  throw new Error(`未能导入 ${fallbackContext}。${detailHint}${lastError?.message ? `最近错误：${lastError.message}` : ''}`)
}

async function createSpritePetModelFromImagePath(selectedImagePath) {
  assertNotPrivateCodexPetSource(selectedImagePath)
  const importedRoot = getImportedSpritePetModelsRoot()
  const packageId = slugifyPetModelId(path.basename(selectedImagePath, path.extname(selectedImagePath)))
  const displayName = formatDiscoveredModelLabel(packageId)
  const importDirectoryBaseName = `${packageId}-${Date.now()}`

  await fs.mkdir(importedRoot, { recursive: true })

  let targetDirectory = path.join(importedRoot, importDirectoryBaseName)
  let duplicateIndex = 2
  while (await pathExists(targetDirectory)) {
    targetDirectory = path.join(importedRoot, `${importDirectoryBaseName}-${duplicateIndex}`)
    duplicateIndex += 1
  }

  const {
    spritePath,
    manifestPath,
    targetDirectory: packageDirectory,
    visualAuditPath,
    archivePath,
    sourceLayout = 'single',
    nativeAtlasPreserved = false,
    visualWarnings = [],
  } = await createSpritePetPackageFromImage({
    sourcePath: selectedImagePath,
    targetDirectory,
    id: packageId,
    displayName,
    description: '从一张图片生成的 Codex 风格 Sprite 宠物包。',
  })
  const importedModels = await listImportedSpritePetModels()
  const importedSpriteUrl = buildImportedSpritePetAssetUrl(
    normalizeAssetRelativePath(importedRoot, spritePath),
  )
  const importedModel = importedModels.find((model) => model.spriteAtlas?.imagePath === importedSpriteUrl)

  if (!importedModel) {
    throw new Error('宠物包已生成，但未能在应用内完成注册。')
  }

  const sourceMessage = sourceLayout === 'atlas'
    ? nativeAtlasPreserved
      ? '已原样导入有效 8x9 atlas'
      : '已从 8x9 atlas 生成'
    : '已从图片生成'

  return {
    model: importedModel,
    packageDirectory,
    manifestPath,
    spritesheetPath: spritePath,
    visualAuditPath,
    archivePath,
    message: visualWarnings.length
      ? `${sourceMessage} ${importedModel.label}，现在可以直接切换。可分享 ZIP：${archivePath}。视觉审计有 ${visualWarnings.length} 条提醒，建议预览后再分享。`
      : `${sourceMessage} ${importedModel.label}，现在可以直接切换。可分享 ZIP：${archivePath}。视觉审计通过。`,
  }
}

async function importSpritePetModelFromCodexGallery(input) {
  const rawInput = String(input ?? '').trim()
  if (!rawInput) {
    throw new Error('请输入 Codex 宠物 slug、详情页 URL 或 ZIP 下载 URL。')
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
    throw new Error('请粘贴具体宠物详情页 URL，或粘贴 ZIP 下载 URL。')
  }

  if (isHttpUrl(rawInput) && !isCodexPetGalleryDetailUrl(rawInput)) {
    return importSpritePetModelFromRemoteZipUrl(rawInput)
  }

  const slug = resolveCodexPetFallbackSlug(rawInput)
  const candidates = uniqueCodexPetGalleryCandidates(rawInput, true)

  if (!candidates.length) {
    throw new Error(`请粘贴具体宠物详情页 URL，或粘贴 ZIP 下载 URL。`)
  }

  return importSpritePetModelFromCodexGalleryUrlCandidates(candidates, slug ? `slug ${slug}` : rawInput)
}

async function importSpritePetModelFromParsedPage(petPage) {
  const importedRoot = getImportedSpritePetModelsRoot()
  const packageId = slugifyPetModelId(petPage.id || petPage.displayName)
  const importDirectoryBaseName = `${packageId}-${Date.now()}`

  await fs.mkdir(importedRoot, { recursive: true })

  let targetDirectory = path.join(importedRoot, importDirectoryBaseName)
  let duplicateIndex = 2
  while (await pathExists(targetDirectory)) {
    targetDirectory = path.join(importedRoot, `${importDirectoryBaseName}-${duplicateIndex}`)
    duplicateIndex += 1
  }

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
    throw new Error('Codex 宠物已下载，但未能在应用内完成注册。')
  }

  return {
    model: importedModel,
    message: `已从 ${petPage.sourceName || 'codex-pet'} 导入 ${importedModel.label}，现在可以直接切换。`,
  }
}

async function listCodexPetGalleryCatalog(payload = {}) {
  return fetchCodexPetGalleryCatalog({
    query: String(payload?.query ?? '').trim(),
    limit: payload?.limit,
    fetchText,
  })
}

async function createSpritePetCreatorKitFromPayload(payload = {}) {
  const displayName = String(payload?.displayName ?? '').trim()
  const concept = String(payload?.concept ?? '').trim()
  const requestedId = String(payload?.id ?? displayName ?? concept ?? '').trim()
  const packageId = slugifyPetModelId(requestedId || 'sprite-pet')
  const targetDirectory = path.join(getSpritePetCreatorKitsRoot(), `${packageId}-${Date.now()}`)

  await fs.mkdir(getSpritePetCreatorKitsRoot(), { recursive: true })

  return createSpritePetCreatorKit({
    targetDirectory,
    id: packageId,
    displayName,
    concept,
    description: String(payload?.description ?? '').trim(),
    styleNotes: String(payload?.styleNotes ?? '').trim(),
  })
}

function normalizeOptionalKitDirectory(value) {
  const rawDirectory = String(value ?? '').trim()
  return rawDirectory ? path.resolve(rawDirectory) : ''
}

async function assembleSpritePetCreatorKitFromDialog(payload = {}) {
  const directKitDirectory = normalizeOptionalKitDirectory(payload?.kitDirectory)
  if (directKitDirectory) {
    const assembled = await assembleSpritePetCreatorKit({
      kitDirectory: directKitDirectory,
      force: true,
    })
    const imported = await importSpritePetModelFromPath(assembled.manifestPath)

    return {
      ...imported,
      packageDirectory: assembled.packageDirectory,
      manifestPath: assembled.manifestPath,
      spritesheetPath: assembled.spritesheetPath,
      reportPath: assembled.reportPath,
      visualAuditPath: assembled.visualAuditPath,
      archivePath: assembled.archivePath,
      message: assembled.visualWarnings?.length
        ? `已组装并导入 ${imported.model.label}。制作包输出：${assembled.packageDirectory}。视觉审计有 ${assembled.visualWarnings.length} 条提醒。`
        : `已组装并导入 ${imported.model.label}。制作包输出：${assembled.packageDirectory}。视觉审计通过。`,
    }
  }

  const panelWindow = _getPanelWindow()
  const mainWindow = _getMainWindow()
  const sourceWindow = BrowserWindow.getFocusedWindow() ?? panelWindow ?? mainWindow ?? undefined
  const dialogOptions = {
    title: '选择 Codex 宠物制作包目录',
    buttonLabel: '组装并导入',
    properties: ['openDirectory'],
  }
  const selection = sourceWindow
    ? await dialog.showOpenDialog(sourceWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions)

  if (selection.canceled || !selection.filePaths.length) {
    return null
  }

  const assembled = await assembleSpritePetCreatorKit({
    kitDirectory: path.resolve(selection.filePaths[0]),
    force: true,
  })
  const imported = await importSpritePetModelFromPath(assembled.manifestPath)

  return {
    ...imported,
    packageDirectory: assembled.packageDirectory,
    manifestPath: assembled.manifestPath,
    spritesheetPath: assembled.spritesheetPath,
    reportPath: assembled.reportPath,
    visualAuditPath: assembled.visualAuditPath,
    archivePath: assembled.archivePath,
    message: assembled.visualWarnings?.length
      ? `已组装并导入 ${imported.model.label}。制作包输出：${assembled.packageDirectory}。视觉审计有 ${assembled.visualWarnings.length} 条提醒。`
      : `已组装并导入 ${imported.model.label}。制作包输出：${assembled.packageDirectory}。视觉审计通过。`,
  }
}

async function installSpritePetCreatorKitPackageToCodex(payload = {}) {
  const rawKitDirectory = String(payload?.kitDirectory ?? '').trim()
  const rawManifestPath = String(payload?.manifestPath ?? '').trim()

  if (!rawKitDirectory || !rawManifestPath) {
    throw new Error('请先选择一个 Codex 宠物包。')
  }

  const kitDirectory = path.resolve(rawKitDirectory)
  const manifestPath = path.resolve(rawManifestPath)
  const [kitRealPath, manifestRealPath] = await Promise.all([
    fs.realpath(kitDirectory),
    fs.realpath(manifestPath),
  ])

  if (!isPathInsideRoot(kitRealPath, manifestRealPath)) {
    throw new Error('只能安装当前 Codex 宠物包目录内的文件。')
  }

  const sourcePackage = await readSpritePetPackage(manifestRealPath)
  const petsRoot = getCodexCustomSpritePetModelsRoot()
  const basePackageId = slugifyPetModelId(
    sourcePackage.id || sourcePackage.displayName || path.basename(path.dirname(manifestRealPath)),
  )

  await fs.mkdir(petsRoot, { recursive: true })

  let packageId = basePackageId
  let targetDirectory = path.join(petsRoot, packageId)
  let duplicateIndex = 2
  while (await pathExists(targetDirectory)) {
    packageId = `${basePackageId}-${duplicateIndex}`
    targetDirectory = path.join(petsRoot, packageId)
    duplicateIndex += 1
  }

  await fs.mkdir(targetDirectory, { recursive: true })

  const spriteExtension = path.extname(sourcePackage.sourceSpritePath).toLowerCase()
  const targetSpriteName = `spritesheet${spriteExtension}`
  const targetSpritePath = path.join(targetDirectory, targetSpriteName)
  const targetManifestPath = path.join(targetDirectory, 'pet.json')
  const targetManifest = {
    id: packageId,
    displayName: sourcePackage.displayName,
    description: sourcePackage.description || IMPORTED_SPRITE_PET_MODEL_DESCRIPTION,
    spritesheetPath: targetSpriteName,
  }

  await fs.copyFile(sourcePackage.sourceSpritePath, targetSpritePath)
  await fs.writeFile(targetManifestPath, `${JSON.stringify(targetManifest, null, 2)}\n`, 'utf8')
  await readSpritePetPackage(targetManifestPath)

  return {
    ok: true,
    id: packageId,
    directoryPath: targetDirectory,
    manifestPath: targetManifestPath,
    message: `已安装到 Codex 自定义宠物目录：${targetDirectory}`,
  }
}

async function inspectSpritePetCreatorKitFromDialog(payload = {}) {
  const directKitDirectory = normalizeOptionalKitDirectory(payload?.kitDirectory)
  if (directKitDirectory) {
    return inspectSpritePetCreatorKit({
      kitDirectory: directKitDirectory,
    })
  }

  const panelWindow = _getPanelWindow()
  const mainWindow = _getMainWindow()
  const sourceWindow = BrowserWindow.getFocusedWindow() ?? panelWindow ?? mainWindow ?? undefined
  const dialogOptions = {
    title: '检查 Codex 宠物制作包目录',
    buttonLabel: '检查制作包',
    properties: ['openDirectory'],
  }
  const selection = sourceWindow
    ? await dialog.showOpenDialog(sourceWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions)

  if (selection.canceled || !selection.filePaths.length) {
    return null
  }

  return inspectSpritePetCreatorKit({
    kitDirectory: path.resolve(selection.filePaths[0]),
  })
}

async function openSpritePetCreatorKitPathFromPayload(payload = {}) {
  const rawKitDirectory = String(payload?.kitDirectory ?? '').trim()
  const rawTargetPath = String(payload?.targetPath ?? '').trim()
  const mode = String(payload?.mode ?? 'open').trim()

  if (!rawKitDirectory || !rawTargetPath) {
    throw new Error('请选择一个已检查的 Codex 宠物制作包路径。')
  }

  const kitDirectory = path.resolve(rawKitDirectory)
  const targetPath = path.resolve(rawTargetPath)
  const [kitRealPath, targetRealPath] = await Promise.all([
    fs.realpath(kitDirectory),
    fs.realpath(targetPath),
  ])

  if (!isPathInsideRoot(kitRealPath, targetRealPath)) {
    throw new Error('只能打开当前 Codex 宠物制作包内的文件。')
  }

  const stats = await fs.stat(targetRealPath)
  const openTargetPath = mode === 'reveal' && !stats.isDirectory()
    ? path.dirname(targetRealPath)
    : targetRealPath
  const errorMessage = await shell.openPath(openTargetPath)

  if (errorMessage) {
    throw new Error(`打开制作包路径失败：${errorMessage}`)
  }

  return {
    ok: true,
    message: stats.isDirectory()
      ? `已打开制作包文件夹：${targetRealPath}`
      : `已打开制作包文件：${targetRealPath}`,
  }
}

async function importPetModelFromDialog() {
  const panelWindow = _getPanelWindow()
  const mainWindow = _getMainWindow()
  const sourceWindow = BrowserWindow.getFocusedWindow() ?? panelWindow ?? mainWindow ?? undefined
  const dialogOptions = {
    title: '选择 Live2D 模型或 Sprite 宠物包',
    buttonLabel: '导入模型',
    properties: ['openFile'],
    filters: [
      {
        name: 'Model or pet package',
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

  throw new Error('请选择 Live2D 的 .model3.json 文件，或 Sprite 宠物包的 pet.json / ZIP。')
}

async function createSpritePetModelFromImageDialog() {
  const panelWindow = _getPanelWindow()
  const mainWindow = _getMainWindow()
  const sourceWindow = BrowserWindow.getFocusedWindow() ?? panelWindow ?? mainWindow ?? undefined
  const dialogOptions = {
    title: '选择图片或 8x9 atlas 制作 Codex 宠物',
    buttonLabel: '制作宠物',
    properties: ['openFile'],
    filters: [
      {
        name: 'Image',
        extensions: ['png', 'jpg', 'jpeg', 'webp'],
      },
    ],
  }
  const selection = sourceWindow
    ? await dialog.showOpenDialog(sourceWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions)

  if (selection.canceled || !selection.filePaths.length) {
    return null
  }

  return createSpritePetModelFromImagePath(path.resolve(selection.filePaths[0]))
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
  getImportedSpritePetModelsRoot,
  getCodexCustomSpritePetModelsRoot,
  IMPORTED_PET_MODELS_ROUTE,
  IMPORTED_SPRITE_PET_MODELS_ROUTE,
  CODEX_CUSTOM_SPRITE_PET_MODELS_ROUTE,
  listAvailablePetModels,
  importPetModelFromDialog,
  importSpritePetModelFromCodexGallery,
  listCodexPetGalleryCatalog,
  createSpritePetCreatorKitFromPayload,
  inspectSpritePetCreatorKitFromDialog,
  assembleSpritePetCreatorKitFromDialog,
  installSpritePetCreatorKitPackageToCodex,
  openSpritePetCreatorKitPathFromPayload,
  createSpritePetModelFromImageDialog,
  saveTextFileFromDialog,
  openTextFileFromDialog,
}
