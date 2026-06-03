import fs from 'node:fs/promises'
import path from 'node:path'
import { inflateRawSync, inflateSync } from 'node:zlib'

export const SPRITE_PET_COLUMNS = 8
export const SPRITE_PET_ROWS = 9
export const SPRITE_PET_CELL_WIDTH = 192
export const SPRITE_PET_CELL_HEIGHT = 208
export const SPRITE_PET_ATLAS_WIDTH = SPRITE_PET_COLUMNS * SPRITE_PET_CELL_WIDTH
export const SPRITE_PET_ATLAS_HEIGHT = SPRITE_PET_ROWS * SPRITE_PET_CELL_HEIGHT
export const SPRITE_PET_MAX_BYTES = 20 * 1024 * 1024
export const SPRITE_PET_ARCHIVE_MAX_BYTES = 50 * 1024 * 1024
export const SPRITE_PET_ARCHIVE_MAX_ENTRIES = 200
export const SPRITE_PET_ARCHIVE_MAX_UNCOMPRESSED_BYTES = 60 * 1024 * 1024
export const SPRITE_PET_ROW_CONTRACT = [
  { state: 'idle', row: 0, frameCount: 6, durationsMs: [280, 110, 110, 140, 140, 320] },
  { state: 'running-right', row: 1, frameCount: 8, durationsMs: [120, 120, 120, 120, 120, 120, 120, 220] },
  { state: 'running-left', row: 2, frameCount: 8, durationsMs: [120, 120, 120, 120, 120, 120, 120, 220] },
  { state: 'waving', row: 3, frameCount: 4, durationsMs: [140, 140, 140, 280] },
  { state: 'jumping', row: 4, frameCount: 5, durationsMs: [140, 140, 140, 140, 280] },
  { state: 'failed', row: 5, frameCount: 8, durationsMs: [140, 140, 140, 140, 140, 140, 140, 240] },
  { state: 'waiting', row: 6, frameCount: 6, durationsMs: [150, 150, 150, 150, 150, 260] },
  { state: 'running', row: 7, frameCount: 6, durationsMs: [120, 120, 120, 120, 120, 220] },
  { state: 'review', row: 8, frameCount: 6, durationsMs: [150, 150, 150, 150, 150, 280] },
]
export const SPRITE_PET_USED_COLUMNS_BY_ROW = SPRITE_PET_ROW_CONTRACT.map(({ frameCount }) => frameCount)

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50
const ZIP_CENTRAL_DIRECTORY_FILE_HEADER_SIGNATURE = 0x02014b50
const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50
const ZIP_UTF8_FLAG = 0x0800

const CRC32_TABLE = new Uint32Array(256)
for (let index = 0; index < CRC32_TABLE.length; index += 1) {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1)
  }
  CRC32_TABLE[index] = value >>> 0
}

export function isPathInsideRoot(rootPath, candidatePath) {
  const relativePath = path.relative(rootPath, candidatePath)
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

export async function readJsonFile(filePath) {
  const rawFile = await fs.readFile(filePath, 'utf8')
  return JSON.parse(rawFile.replace(/^\uFEFF/, ''))
}

function normalizeZipEntryPath(entryName) {
  const normalized = String(entryName ?? '')
    .replaceAll('\\', '/')
    .split('/')
    .filter((segment) => segment && segment !== '.')
    .join('/')

  if (
    !normalized
    || normalized.includes('\0')
    || normalized.startsWith('/')
    || normalized.split('/').includes('..')
    || /^[a-zA-Z]:/.test(normalized)
  ) {
    throw new Error(`ZIP 包含不安全路径：${entryName}`)
  }

  return normalized
}

function crc32(buffer) {
  let value = 0xffffffff
  for (const byte of buffer) {
    value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8)
  }
  return (value ^ 0xffffffff) >>> 0
}

function dateToDosTime(date = new Date()) {
  const year = Math.max(date.getFullYear(), 1980)
  const month = date.getMonth() + 1
  const day = date.getDate()
  const hours = date.getHours()
  const minutes = date.getMinutes()
  const seconds = Math.floor(date.getSeconds() / 2)

  return {
    time: (hours << 11) | (minutes << 5) | seconds,
    date: ((year - 1980) << 9) | (month << 5) | day,
  }
}

function createZipLocalFileHeader({ nameBuffer, fileBuffer, crc, dosTime, localHeaderOffset }) {
  if (fileBuffer.length > 0xffffffff || localHeaderOffset > 0xffffffff) {
    throw new Error('ZIP 文件过大。')
  }

  const header = Buffer.alloc(30)
  header.writeUInt32LE(ZIP_LOCAL_FILE_HEADER_SIGNATURE, 0)
  header.writeUInt16LE(20, 4)
  header.writeUInt16LE(ZIP_UTF8_FLAG, 6)
  header.writeUInt16LE(0, 8)
  header.writeUInt16LE(dosTime.time, 10)
  header.writeUInt16LE(dosTime.date, 12)
  header.writeUInt32LE(crc, 14)
  header.writeUInt32LE(fileBuffer.length, 18)
  header.writeUInt32LE(fileBuffer.length, 22)
  header.writeUInt16LE(nameBuffer.length, 26)
  header.writeUInt16LE(0, 28)
  return header
}

function createZipCentralDirectoryHeader({ nameBuffer, fileBuffer, crc, dosTime, localHeaderOffset }) {
  const header = Buffer.alloc(46)
  header.writeUInt32LE(ZIP_CENTRAL_DIRECTORY_FILE_HEADER_SIGNATURE, 0)
  header.writeUInt16LE(20, 4)
  header.writeUInt16LE(20, 6)
  header.writeUInt16LE(ZIP_UTF8_FLAG, 8)
  header.writeUInt16LE(0, 10)
  header.writeUInt16LE(dosTime.time, 12)
  header.writeUInt16LE(dosTime.date, 14)
  header.writeUInt32LE(crc, 16)
  header.writeUInt32LE(fileBuffer.length, 20)
  header.writeUInt32LE(fileBuffer.length, 24)
  header.writeUInt16LE(nameBuffer.length, 28)
  header.writeUInt16LE(0, 30)
  header.writeUInt16LE(0, 32)
  header.writeUInt16LE(0, 34)
  header.writeUInt16LE(0, 36)
  header.writeUInt32LE(0, 38)
  header.writeUInt32LE(localHeaderOffset, 42)
  return header
}

function createZipEndOfCentralDirectory({ entryCount, centralDirectorySize, centralDirectoryOffset }) {
  if (entryCount > 0xffff || centralDirectorySize > 0xffffffff || centralDirectoryOffset > 0xffffffff) {
    throw new Error('ZIP 文件过大。')
  }

  const footer = Buffer.alloc(22)
  footer.writeUInt32LE(ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0)
  footer.writeUInt16LE(0, 4)
  footer.writeUInt16LE(0, 6)
  footer.writeUInt16LE(entryCount, 8)
  footer.writeUInt16LE(entryCount, 10)
  footer.writeUInt32LE(centralDirectorySize, 12)
  footer.writeUInt32LE(centralDirectoryOffset, 16)
  footer.writeUInt16LE(0, 20)
  return footer
}

export async function writeSpritePetZipArchive({ archivePath, files } = {}) {
  const rawArchivePath = String(archivePath ?? '').trim()
  if (!rawArchivePath) {
    throw new Error('请选择 ZIP 宠物包输出路径。')
  }

  const resolvedArchivePath = path.resolve(rawArchivePath)
  const entries = Array.isArray(files) ? files : []
  if (!entries.length) {
    throw new Error('ZIP 宠物包至少需要一个文件。')
  }

  if (entries.length > SPRITE_PET_ARCHIVE_MAX_ENTRIES) {
    throw new Error(`ZIP 包文件过多，最多支持 ${SPRITE_PET_ARCHIVE_MAX_ENTRIES} 个文件。`)
  }

  const dosTime = dateToDosTime(new Date(2026, 0, 1, 0, 0, 0))
  const localParts = []
  const centralEntries = []
  const seenNames = new Set()
  let localHeaderOffset = 0
  let totalUncompressedBytes = 0

  for (const entry of entries) {
    const rawSourcePath = String(entry?.path ?? entry?.sourcePath ?? '').trim()
    if (!rawSourcePath) {
      throw new Error('ZIP 宠物包文件缺少源路径。')
    }

    const sourcePath = path.resolve(rawSourcePath)
    const entryName = normalizeZipEntryPath(entry?.name ?? entry?.entryName ?? path.basename(sourcePath))
    if (seenNames.has(entryName)) {
      throw new Error(`ZIP 宠物包包含重复路径：${entryName}`)
    }
    seenNames.add(entryName)

    const sourceStats = await fs.stat(sourcePath)
    if (!sourceStats.isFile()) {
      throw new Error(`ZIP 宠物包源路径不是文件：${sourcePath}`)
    }

    const fileBuffer = await fs.readFile(sourcePath)
    totalUncompressedBytes += fileBuffer.length
    if (totalUncompressedBytes > SPRITE_PET_ARCHIVE_MAX_UNCOMPRESSED_BYTES) {
      throw new Error('ZIP 包解压后过大。')
    }

    const nameBuffer = Buffer.from(entryName, 'utf8')
    if (nameBuffer.length > 0xffff) {
      throw new Error(`ZIP 宠物包路径过长：${entryName}`)
    }

    const crc = crc32(fileBuffer)
    const localHeader = createZipLocalFileHeader({
      nameBuffer,
      fileBuffer,
      crc,
      dosTime,
      localHeaderOffset,
    })

    localParts.push(localHeader, nameBuffer, fileBuffer)
    centralEntries.push({
      nameBuffer,
      fileBuffer,
      crc,
      dosTime,
      localHeaderOffset,
    })
    localHeaderOffset += localHeader.length + nameBuffer.length + fileBuffer.length

    if (localHeaderOffset > 0xffffffff) {
      throw new Error('ZIP 文件过大。')
    }
  }

  const centralDirectoryOffset = localHeaderOffset
  const centralParts = []
  let centralDirectorySize = 0

  for (const entry of centralEntries) {
    const centralHeader = createZipCentralDirectoryHeader(entry)
    centralParts.push(centralHeader, entry.nameBuffer)
    centralDirectorySize += centralHeader.length + entry.nameBuffer.length
  }

  const footer = createZipEndOfCentralDirectory({
    entryCount: centralEntries.length,
    centralDirectorySize,
    centralDirectoryOffset,
  })
  const archiveBuffer = Buffer.concat([...localParts, ...centralParts, footer])

  if (archiveBuffer.length > SPRITE_PET_ARCHIVE_MAX_BYTES) {
    throw new Error('ZIP 宠物包不能超过 50MB。')
  }

  await fs.mkdir(path.dirname(resolvedArchivePath), { recursive: true })
  await fs.writeFile(resolvedArchivePath, archiveBuffer)

  return {
    archivePath: resolvedArchivePath,
    entryCount: centralEntries.length,
    bytes: archiveBuffer.length,
  }
}

function findZipEndOfCentralDirectory(buffer) {
  const minimumOffset = Math.max(0, buffer.length - 65557)

  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      return offset
    }
  }

  throw new Error('ZIP 包缺少中央目录。')
}

function readZipEntries(buffer) {
  const eocdOffset = findZipEndOfCentralDirectory(buffer)
  const entryCount = buffer.readUInt16LE(eocdOffset + 10)
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12)
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16)

  if (entryCount > SPRITE_PET_ARCHIVE_MAX_ENTRIES) {
    throw new Error(`ZIP 包文件过多，最多支持 ${SPRITE_PET_ARCHIVE_MAX_ENTRIES} 个文件。`)
  }

  if (
    centralDirectoryOffset + centralDirectorySize > buffer.length
    || centralDirectoryOffset >= buffer.length
  ) {
    throw new Error('ZIP 包中央目录位置无效。')
  }

  const entries = []
  let offset = centralDirectoryOffset
  let totalUncompressedBytes = 0

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== ZIP_CENTRAL_DIRECTORY_FILE_HEADER_SIGNATURE) {
      throw new Error('ZIP 包中央目录结构无效。')
    }

    const flags = buffer.readUInt16LE(offset + 8)
    const compressionMethod = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const uncompressedSize = buffer.readUInt32LE(offset + 24)
    const fileNameLength = buffer.readUInt16LE(offset + 28)
    const extraFieldLength = buffer.readUInt16LE(offset + 30)
    const fileCommentLength = buffer.readUInt16LE(offset + 32)
    const localHeaderOffset = buffer.readUInt32LE(offset + 42)
    const fileNameStart = offset + 46
    const fileNameEnd = fileNameStart + fileNameLength
    const nextOffset = fileNameEnd + extraFieldLength + fileCommentLength

    if (fileNameEnd > buffer.length || nextOffset > buffer.length) {
      throw new Error('ZIP 包文件名长度无效。')
    }

    if ((flags & 0x01) !== 0) {
      throw new Error('不支持加密 ZIP 宠物包。')
    }

    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
      throw new Error('不支持 Zip64 宠物包。')
    }

    const rawName = buffer.toString((flags & 0x0800) !== 0 ? 'utf8' : 'utf8', fileNameStart, fileNameEnd)
    const isDirectory = rawName.endsWith('/')

    if (!isDirectory) {
      const safeName = normalizeZipEntryPath(rawName)
      totalUncompressedBytes += uncompressedSize
      if (totalUncompressedBytes > SPRITE_PET_ARCHIVE_MAX_UNCOMPRESSED_BYTES) {
        throw new Error('ZIP 包解压后过大。')
      }

      entries.push({
        compressionMethod,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
        safeName,
      })
    }

    offset = nextOffset
  }

  return entries
}

async function collectPetManifestFiles(directoryPath) {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true })
  const manifestFiles = []

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name)

    if (entry.isDirectory()) {
      manifestFiles.push(...await collectPetManifestFiles(entryPath))
      continue
    }

    if (entry.name === 'pet.json') {
      manifestFiles.push(entryPath)
    }
  }

  return manifestFiles
}

function sortPetManifestCandidates(rootPath, manifestFiles) {
  return [...manifestFiles].sort((left, right) => {
    const leftRelative = path.relative(rootPath, left)
    const rightRelative = path.relative(rootPath, right)
    const leftDepth = leftRelative.split(path.sep).length
    const rightDepth = rightRelative.split(path.sep).length

    return leftDepth - rightDepth || leftRelative.localeCompare(rightRelative)
  })
}

export async function extractSpritePetZipArchive(archivePath, targetDirectory) {
  const stats = await fs.stat(archivePath)
  if (!stats.isFile()) {
    throw new Error('ZIP 宠物包必须是文件。')
  }

  if (stats.size > SPRITE_PET_ARCHIVE_MAX_BYTES) {
    throw new Error('ZIP 宠物包不能超过 50MB。')
  }

  const archiveBuffer = await fs.readFile(archivePath)
  const entries = readZipEntries(archiveBuffer)

  await fs.mkdir(targetDirectory, { recursive: true })

  for (const entry of entries) {
    if (entry.localHeaderOffset + 30 > archiveBuffer.length) {
      throw new Error('ZIP 包本地文件头位置无效。')
    }

    if (archiveBuffer.readUInt32LE(entry.localHeaderOffset) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) {
      throw new Error('ZIP 包本地文件头结构无效。')
    }

    const localNameLength = archiveBuffer.readUInt16LE(entry.localHeaderOffset + 26)
    const localExtraLength = archiveBuffer.readUInt16LE(entry.localHeaderOffset + 28)
    const dataStart = entry.localHeaderOffset + 30 + localNameLength + localExtraLength
    const dataEnd = dataStart + entry.compressedSize

    if (dataEnd > archiveBuffer.length) {
      throw new Error('ZIP 包压缩数据长度无效。')
    }

    const compressed = archiveBuffer.subarray(dataStart, dataEnd)
    let fileBytes

    if (entry.compressionMethod === 0) {
      fileBytes = Buffer.from(compressed)
    } else if (entry.compressionMethod === 8) {
      try {
        fileBytes = inflateRawSync(compressed, { maxOutputLength: entry.uncompressedSize })
      } catch (error) {
        throw new Error(`ZIP 文件 ${entry.safeName} 解压失败：${error?.message ?? error}`)
      }
    } else {
      throw new Error(`不支持 ZIP 压缩方式：${entry.compressionMethod}。`)
    }

    if (fileBytes.length !== entry.uncompressedSize) {
      throw new Error(`ZIP 文件 ${entry.safeName} 解压长度不匹配。`)
    }

    const targetPath = path.resolve(targetDirectory, entry.safeName)
    if (!isPathInsideRoot(targetDirectory, targetPath)) {
      throw new Error(`ZIP 包含不安全路径：${entry.safeName}`)
    }

    await fs.mkdir(path.dirname(targetPath), { recursive: true })
    await fs.writeFile(targetPath, fileBytes)
  }

  const manifestFiles = sortPetManifestCandidates(
    targetDirectory,
    await collectPetManifestFiles(targetDirectory),
  )

  if (!manifestFiles.length) {
    throw new Error('ZIP 宠物包缺少 pet.json。')
  }

  let lastError = null
  for (const manifestPath of manifestFiles) {
    try {
      const manifest = await readSpritePetPackage(manifestPath)
      return {
        manifest,
        manifestPath,
      }
    } catch (error) {
      lastError = error
    }
  }

  throw new Error(`ZIP 宠物包没有可用的 Sprite pet manifest：${lastError?.message ?? '未知错误'}`)
}

export function formatSpritePetDisplayName(name) {
  const rawName = String(name ?? '').trim()

  if (!rawName) {
    return 'Sprite Pet'
  }

  if (/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(rawName)) {
    return rawName
  }

  return rawName
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

function readUint24LE(buffer, offset) {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16)
}

function parsePngInfo(buffer) {
  if (buffer.length < 33 || !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error('spritesheet.png 不是有效的 PNG 文件。')
  }

  let offset = PNG_SIGNATURE.length
  let ihdr = null
  const idatChunks = []

  while (offset + 12 <= buffer.length) {
    const chunkLength = buffer.readUInt32BE(offset)
    const chunkType = buffer.toString('ascii', offset + 4, offset + 8)
    const dataOffset = offset + 8
    const nextOffset = dataOffset + chunkLength + 4

    if (nextOffset > buffer.length) {
      throw new Error('spritesheet.png 的 chunk 长度无效。')
    }

    if (chunkType === 'IHDR') {
      if (chunkLength !== 13) {
        throw new Error('spritesheet.png 的 IHDR 长度无效。')
      }
      ihdr = buffer.subarray(dataOffset, dataOffset + chunkLength)
    } else if (chunkType === 'IDAT') {
      idatChunks.push(buffer.subarray(dataOffset, dataOffset + chunkLength))
    } else if (chunkType === 'IEND') {
      break
    }

    offset = nextOffset
  }

  if (!ihdr) {
    throw new Error('spritesheet.png 缺少 IHDR。')
  }

  return {
    width: ihdr.readUInt32BE(0),
    height: ihdr.readUInt32BE(4),
    bitDepth: ihdr[8],
    colorType: ihdr[9],
    compressionMethod: ihdr[10],
    filterMethod: ihdr[11],
    interlaceMethod: ihdr[12],
    idat: Buffer.concat(idatChunks),
  }
}

export function readPngDimensions(buffer) {
  const info = parsePngInfo(buffer)

  return {
    width: info.width,
    height: info.height,
  }
}

function paethPredictor(left, up, upLeft) {
  const estimate = left + up - upLeft
  const distanceLeft = Math.abs(estimate - left)
  const distanceUp = Math.abs(estimate - up)
  const distanceUpLeft = Math.abs(estimate - upLeft)

  if (distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft) return left
  if (distanceUp <= distanceUpLeft) return up
  return upLeft
}

function inflatePngRgbaPixels(info) {
  if (
    info.bitDepth !== 8
    || info.colorType !== 6
    || info.compressionMethod !== 0
    || info.filterMethod !== 0
    || info.interlaceMethod !== 0
  ) {
    throw new Error('spritesheet.png 必须是非交错 8-bit RGBA，才能验证未使用格子的透明度。')
  }

  const bytesPerPixel = 4
  const rowLength = info.width * bytesPerPixel
  const expectedLength = (rowLength + 1) * info.height
  const inflated = inflateSync(info.idat)

  if (inflated.length < expectedLength) {
    throw new Error('spritesheet.png 的像素数据不完整。')
  }

  const pixels = Buffer.alloc(rowLength * info.height)
  const previousRow = Buffer.alloc(rowLength)

  for (let y = 0; y < info.height; y += 1) {
    const sourceOffset = y * (rowLength + 1)
    const filterType = inflated[sourceOffset]
    const currentRow = Buffer.alloc(rowLength)

    for (let x = 0; x < rowLength; x += 1) {
      const raw = inflated[sourceOffset + 1 + x]
      const left = x >= bytesPerPixel ? currentRow[x - bytesPerPixel] : 0
      const up = previousRow[x]
      const upLeft = x >= bytesPerPixel ? previousRow[x - bytesPerPixel] : 0

      if (filterType === 0) {
        currentRow[x] = raw
      } else if (filterType === 1) {
        currentRow[x] = (raw + left) & 0xff
      } else if (filterType === 2) {
        currentRow[x] = (raw + up) & 0xff
      } else if (filterType === 3) {
        currentRow[x] = (raw + Math.floor((left + up) / 2)) & 0xff
      } else if (filterType === 4) {
        currentRow[x] = (raw + paethPredictor(left, up, upLeft)) & 0xff
      } else {
        throw new Error(`spritesheet.png 使用了未知 PNG filter: ${filterType}。`)
      }
    }

    currentRow.copy(pixels, y * rowLength)
    currentRow.copy(previousRow)
  }

  return pixels
}

function assertPngUnusedCellsTransparent(buffer) {
  const info = parsePngInfo(buffer)

  if (
    info.width !== SPRITE_PET_ATLAS_WIDTH
    || info.height !== SPRITE_PET_ATLAS_HEIGHT
  ) {
    return
  }

  const pixels = inflatePngRgbaPixels(info)
  const rowLength = info.width * 4

  for (let row = 0; row < SPRITE_PET_ROWS; row += 1) {
    const usedColumns = SPRITE_PET_USED_COLUMNS_BY_ROW[row]

    for (let column = usedColumns; column < SPRITE_PET_COLUMNS; column += 1) {
      const startX = column * SPRITE_PET_CELL_WIDTH
      const endX = startX + SPRITE_PET_CELL_WIDTH
      const startY = row * SPRITE_PET_CELL_HEIGHT
      const endY = startY + SPRITE_PET_CELL_HEIGHT

      for (let y = startY; y < endY; y += 1) {
        for (let x = startX; x < endX; x += 1) {
          const alpha = pixels[(y * rowLength) + (x * 4) + 3]
          if (alpha !== 0) {
            throw new Error(`spritesheet.png 第 ${row} 行第 ${column} 列是未使用格子，必须完全透明。`)
          }
        }
      }
    }
  }
}

export function readWebpInfo(buffer) {
  if (
    buffer.length < 30
    || buffer.toString('ascii', 0, 4) !== 'RIFF'
    || buffer.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    throw new Error('spritesheet.webp 不是有效的 WebP 文件。')
  }

  let offset = 12
  let extendedInfo = null
  let sawAlphaChunk = false

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4)
    const chunkSize = buffer.readUInt32LE(offset + 4)
    const dataOffset = offset + 8

    if (chunkId === 'VP8X' && chunkSize >= 10 && dataOffset + 10 <= buffer.length) {
      extendedInfo = {
        width: readUint24LE(buffer, dataOffset + 4) + 1,
        height: readUint24LE(buffer, dataOffset + 7) + 1,
        hasAlpha: (buffer[dataOffset] & 0x10) !== 0,
      }
    } else if (chunkId === 'ALPH') {
      sawAlphaChunk = true
    } else if (chunkId === 'VP8L' && chunkSize >= 5 && dataOffset + 5 <= buffer.length) {
      if (buffer[dataOffset] !== 0x2f) {
        throw new Error('spritesheet.webp 的 VP8L 头无效。')
      }
      const byte1 = buffer[dataOffset + 1]
      const byte2 = buffer[dataOffset + 2]
      const byte3 = buffer[dataOffset + 3]
      const byte4 = buffer[dataOffset + 4]
      const imageInfo = {
        width: 1 + (((byte2 & 0x3f) << 8) | byte1),
        height: 1 + (((byte4 & 0x0f) << 10) | (byte3 << 2) | ((byte2 & 0xc0) >> 6)),
        hasAlpha: (byte4 & 0x10) !== 0,
      }

      return extendedInfo
        ? {
            ...extendedInfo,
            hasAlpha: extendedInfo.hasAlpha || imageInfo.hasAlpha || sawAlphaChunk,
          }
        : imageInfo
    } else if (chunkId === 'VP8 ' && chunkSize >= 10 && dataOffset + 10 <= buffer.length) {
      if (
        buffer[dataOffset + 3] !== 0x9d
        || buffer[dataOffset + 4] !== 0x01
        || buffer[dataOffset + 5] !== 0x2a
      ) {
          throw new Error('spritesheet.webp 的 VP8 头无效。')
      }
      const imageInfo = {
        width: buffer.readUInt16LE(dataOffset + 6) & 0x3fff,
        height: buffer.readUInt16LE(dataOffset + 8) & 0x3fff,
        hasAlpha: sawAlphaChunk,
      }

      return extendedInfo
        ? {
            ...extendedInfo,
            hasAlpha: extendedInfo.hasAlpha && sawAlphaChunk,
          }
        : imageInfo
    }

    offset = dataOffset + chunkSize + (chunkSize % 2)
  }

  throw new Error(extendedInfo ? 'spritesheet.webp 缺少图像数据。' : '无法读取 spritesheet.webp 的尺寸。')
}

export function readWebpDimensions(buffer) {
  const info = readWebpInfo(buffer)

  return {
    width: info.width,
    height: info.height,
  }
}

export async function readImageDimensions(imagePath) {
  const buffer = await fs.readFile(imagePath)
  const extension = path.extname(imagePath).toLowerCase()

  if (extension === '.png') {
    return readPngDimensions(buffer)
  }

  if (extension === '.webp') {
    return readWebpDimensions(buffer)
  }

  throw new Error('Sprite 宠物只支持 PNG 或 WebP spritesheet。')
}

export function isSpritePetManifest(value) {
  return Boolean(value && typeof value === 'object' && 'spritesheetPath' in value)
}

const PRIVATE_CODEX_APP_PATH_PATTERNS = [
  /(?:^|\/)Codex\.app(?:\/|$)/iu,
  /(?:^|\/)app\.asar(?:\/|$)/iu,
  /(?:^|\/)app\.asar\.unpacked(?:\/|$)/iu,
  /(?:^|\/)codex-app(?:\/|$)/iu,
]

const EXTRACTED_CODEX_APP_ASSET_PATTERNS = [
  /^codex-spritesheet[-_.]/iu,
  /^codex-avatar[-_.]/iu,
  /^avatar-(?:mascot|overlay|options)[-_.]/iu,
  /^use-avatar-options[-_.]/iu,
]

function normalizePolicyPath(value) {
  return String(value ?? '').replaceAll('\\', '/')
}

export function getPrivateCodexPetSourceReason(sourcePath) {
  const normalizedPath = normalizePolicyPath(path.resolve(String(sourcePath ?? '')))
  const baseName = path.basename(normalizedPath)

  if (PRIVATE_CODEX_APP_PATH_PATTERNS.some((pattern) => pattern.test(normalizedPath))) {
    return 'source is inside a Codex application bundle or app.asar extraction'
  }

  if (EXTRACTED_CODEX_APP_ASSET_PATTERNS.some((pattern) => pattern.test(baseName))) {
    return 'source looks like an extracted Codex built-in pet asset'
  }

  return ''
}

export function assertNotPrivateCodexPetSource(sourcePath) {
  const reason = getPrivateCodexPetSourceReason(sourcePath)
  if (reason) {
    throw new Error(
      `不能复制 Codex 私有代码或内置宠物素材：${sourcePath} (${reason})。请使用公开社区包、原创/授权素材，或用户自己创建的 ~/.codex/pets 宠物包。`,
    )
  }
}

export function normalizeSpritePetManifest(manifest, manifestPath) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('pet.json 必须是 JSON 对象。')
  }

  const sourceDirectory = path.dirname(manifestPath)
  const rawSpritePath = String(manifest.spritesheetPath ?? 'spritesheet.webp').trim()
  if (!rawSpritePath) {
    throw new Error('pet.json 缺少 spritesheetPath。')
  }

  const sourceSpritePath = path.resolve(sourceDirectory, rawSpritePath)
  if (!isPathInsideRoot(sourceDirectory, sourceSpritePath)) {
    throw new Error('spritesheetPath 不能指向 pet.json 所在目录之外。')
  }

  const rawDisplayName = String(manifest.displayName ?? '').trim()
  const rawId = String(manifest.id ?? '').trim()
  const displayName = rawDisplayName || formatSpritePetDisplayName(rawId || path.basename(sourceDirectory))
  const description = typeof manifest.description === 'string'
    ? manifest.description.trim()
    : ''

  return {
    id: rawId,
    displayName,
    description,
    sourceSpritePath,
  }
}

export async function validateSpritePetAsset(spritePath) {
  const extension = path.extname(spritePath).toLowerCase()
  if (extension !== '.png' && extension !== '.webp') {
    throw new Error('Sprite 宠物只支持 PNG 或 WebP spritesheet。')
  }

  const stats = await fs.stat(spritePath)
  if (!stats.isFile()) {
    throw new Error('spritesheetPath 必须指向一个文件。')
  }

  if (stats.size > SPRITE_PET_MAX_BYTES) {
    throw new Error('spritesheet 文件不能超过 20MB。')
  }

  const dimensions = await readImageDimensions(spritePath)
  if (
    dimensions.width !== SPRITE_PET_ATLAS_WIDTH
    || dimensions.height !== SPRITE_PET_ATLAS_HEIGHT
  ) {
    throw new Error(`spritesheet 尺寸必须是 ${SPRITE_PET_ATLAS_WIDTH}x${SPRITE_PET_ATLAS_HEIGHT}。`)
  }

  const buffer = await fs.readFile(spritePath)
  if (extension === '.png') {
    assertPngUnusedCellsTransparent(buffer)
  } else {
    const webpInfo = readWebpInfo(buffer)
    if (!webpInfo.hasAlpha) {
      throw new Error('spritesheet.webp 必须包含 alpha 透明通道。')
    }
  }
}

export async function readSpritePetPackage(manifestPath) {
  const manifest = normalizeSpritePetManifest(
    await readJsonFile(manifestPath),
    manifestPath,
  )
  await validateSpritePetAsset(manifest.sourceSpritePath)
  return manifest
}
