import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { deflateRawSync, deflateSync } from 'node:zlib'

import {
  SPRITE_PET_ATLAS_HEIGHT,
  SPRITE_PET_ATLAS_WIDTH,
  SPRITE_PET_CELL_HEIGHT,
  SPRITE_PET_CELL_WIDTH,
  SPRITE_PET_COLUMNS,
  SPRITE_PET_ROWS,
  extractSpritePetZipArchive,
  normalizeSpritePetManifest,
  readSpritePetPackage,
  readWebpDimensions,
} from '../electron/services/spritePetPackage.js'
import {
  SPRITE_PET_CELL_HEIGHT as RENDERER_SPRITE_PET_CELL_HEIGHT,
  SPRITE_PET_CELL_WIDTH as RENDERER_SPRITE_PET_CELL_WIDTH,
  SPRITE_PET_COLUMNS as RENDERER_SPRITE_PET_COLUMNS,
  SPRITE_PET_ROWS as RENDERER_SPRITE_PET_ROWS,
} from '../src/features/pet/spriteAtlas.ts'

function makePngHeader(width: number, height: number) {
  return makeRgbaPng(width, height)
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const CRC32_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1)
  }
  return value >>> 0
})

function crc32(buffer: Buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  const checksum = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
  return Buffer.concat([length, typeBuffer, data, checksum])
}

function makeRgbaPng(
  width: number,
  height: number,
  paintPixel?: { x: number; y: number; rgba: [number, number, number, number] },
) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const scanlineLength = 1 + (width * 4)
  const rawPixels = Buffer.alloc(scanlineLength * height)
  if (paintPixel) {
    const offset = (paintPixel.y * scanlineLength) + 1 + (paintPixel.x * 4)
    rawPixels[offset] = paintPixel.rgba[0]
    rawPixels[offset + 1] = paintPixel.rgba[1]
    rawPixels[offset + 2] = paintPixel.rgba[2]
    rawPixels[offset + 3] = paintPixel.rgba[3]
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(rawPixels, { level: 9 })),
    pngChunk('IEND'),
  ])
}

function writeUint24LE(buffer: Buffer, offset: number, value: number) {
  buffer[offset] = value & 0xff
  buffer[offset + 1] = (value >> 8) & 0xff
  buffer[offset + 2] = (value >> 16) & 0xff
}

function makeVp8xWebp(width: number, height: number, alpha = false) {
  const alphChunk = alpha
    ? Buffer.concat([
        Buffer.from('ALPH', 'ascii'),
        Buffer.from([1, 0, 0, 0]),
        Buffer.from([0]),
        Buffer.from([0]),
      ])
    : Buffer.alloc(0)
  const vp8Chunk = Buffer.alloc(18)
  vp8Chunk.write('VP8 ', 0, 'ascii')
  vp8Chunk.writeUInt32LE(10, 4)
  vp8Chunk[11] = 0x9d
  vp8Chunk[12] = 0x01
  vp8Chunk[13] = 0x2a
  vp8Chunk.writeUInt16LE(width, 14)
  vp8Chunk.writeUInt16LE(height, 16)

  const buffer = Buffer.alloc(30)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(buffer.length + alphChunk.length + vp8Chunk.length - 8, 4)
  buffer.write('WEBP', 8, 'ascii')
  buffer.write('VP8X', 12, 'ascii')
  buffer.writeUInt32LE(10, 16)
  buffer[20] = alpha ? 0x10 : 0
  writeUint24LE(buffer, 24, width - 1)
  writeUint24LE(buffer, 27, height - 1)
  return Buffer.concat([buffer, alphChunk, vp8Chunk])
}

function makeDeflatedZipWithDeclaredSize(name: string, data: Buffer, declaredUncompressedSize: number) {
  const encodedName = Buffer.from(name, 'utf8')
  const compressed = deflateRawSync(data, { level: 9 })
  const checksum = crc32(data)
  const localHeader = Buffer.alloc(30)

  localHeader.writeUInt32LE(0x04034b50, 0)
  localHeader.writeUInt16LE(20, 4)
  localHeader.writeUInt16LE(0x0800, 6)
  localHeader.writeUInt16LE(8, 8)
  localHeader.writeUInt16LE(0, 10)
  localHeader.writeUInt16LE(0, 12)
  localHeader.writeUInt32LE(checksum, 14)
  localHeader.writeUInt32LE(compressed.length, 18)
  localHeader.writeUInt32LE(declaredUncompressedSize, 22)
  localHeader.writeUInt16LE(encodedName.length, 26)
  localHeader.writeUInt16LE(0, 28)

  const centralHeader = Buffer.alloc(46)
  centralHeader.writeUInt32LE(0x02014b50, 0)
  centralHeader.writeUInt16LE(20, 4)
  centralHeader.writeUInt16LE(20, 6)
  centralHeader.writeUInt16LE(0x0800, 8)
  centralHeader.writeUInt16LE(8, 10)
  centralHeader.writeUInt16LE(0, 12)
  centralHeader.writeUInt16LE(0, 14)
  centralHeader.writeUInt32LE(checksum, 16)
  centralHeader.writeUInt32LE(compressed.length, 20)
  centralHeader.writeUInt32LE(declaredUncompressedSize, 24)
  centralHeader.writeUInt16LE(encodedName.length, 28)
  centralHeader.writeUInt16LE(0, 30)
  centralHeader.writeUInt16LE(0, 32)
  centralHeader.writeUInt16LE(0, 34)
  centralHeader.writeUInt16LE(0, 36)
  centralHeader.writeUInt32LE(0, 38)
  centralHeader.writeUInt32LE(0, 42)

  const localData = Buffer.concat([localHeader, encodedName, compressed])
  const centralDirectory = Buffer.concat([centralHeader, encodedName])
  const endOfCentralDirectory = Buffer.alloc(22)
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0)
  endOfCentralDirectory.writeUInt16LE(0, 4)
  endOfCentralDirectory.writeUInt16LE(0, 6)
  endOfCentralDirectory.writeUInt16LE(1, 8)
  endOfCentralDirectory.writeUInt16LE(1, 10)
  endOfCentralDirectory.writeUInt32LE(centralDirectory.length, 12)
  endOfCentralDirectory.writeUInt32LE(localData.length, 16)
  endOfCentralDirectory.writeUInt16LE(0, 20)

  return Buffer.concat([localData, centralDirectory, endOfCentralDirectory])
}

async function withTempPetPackage<T>(
  body: (directoryPath: string, manifestPath: string) => Promise<T>,
) {
  const directoryPath = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-sprite-pet-'))
  try {
    return await body(directoryPath, path.join(directoryPath, 'pet.json'))
  } finally {
    await fs.rm(directoryPath, { recursive: true, force: true })
  }
}

test('sprite package validator uses the same atlas contract as the renderer', () => {
  assert.equal(SPRITE_PET_COLUMNS, RENDERER_SPRITE_PET_COLUMNS)
  assert.equal(SPRITE_PET_ROWS, RENDERER_SPRITE_PET_ROWS)
  assert.equal(SPRITE_PET_CELL_WIDTH, RENDERER_SPRITE_PET_CELL_WIDTH)
  assert.equal(SPRITE_PET_CELL_HEIGHT, RENDERER_SPRITE_PET_CELL_HEIGHT)
  assert.equal(SPRITE_PET_ATLAS_WIDTH, 1536)
  assert.equal(SPRITE_PET_ATLAS_HEIGHT, 1872)
})

test('extractSpritePetZipArchive bounds deflated output before allocation completes', async () => {
  await withTempPetPackage(async (directoryPath) => {
    const archivePath = path.join(directoryPath, 'oversized-deflate.zip')
    const extractPath = path.join(directoryPath, 'extract')
    await fs.writeFile(
      archivePath,
      makeDeflatedZipWithDeclaredSize('pet.json', Buffer.alloc(1024 * 1024, 0x61), 1),
    )

    await assert.rejects(
      () => extractSpritePetZipArchive(archivePath, extractPath),
      /解压没成功/,
    )
  })
})

test('readSpritePetPackage accepts and normalizes a valid clean-room package', async () => {
  await withTempPetPackage(async (directoryPath, manifestPath) => {
    await fs.writeFile(
      manifestPath,
      JSON.stringify({
        id: 'copy_cat',
        displayName: ' Copy Cat ',
        description: ' Clean-room sprite pet. ',
        spritesheetPath: 'spritesheet.png',
      }),
      'utf8',
    )
    await fs.writeFile(
      path.join(directoryPath, 'spritesheet.png'),
      makePngHeader(SPRITE_PET_ATLAS_WIDTH, SPRITE_PET_ATLAS_HEIGHT),
    )

    const manifest = await readSpritePetPackage(manifestPath)

    assert.equal(manifest.id, 'copy_cat')
    assert.equal(manifest.displayName, 'Copy Cat')
    assert.equal(manifest.description, 'Clean-room sprite pet.')
    assert.equal(manifest.sourceSpritePath, path.join(directoryPath, 'spritesheet.png'))
  })
})

test('normalizeSpritePetManifest derives a readable display name from the id', async () => {
  await withTempPetPackage(async (_directoryPath, manifestPath) => {
    const manifest = normalizeSpritePetManifest({
      id: 'nexus_mini_sprite',
      spritesheetPath: 'spritesheet.png',
    }, manifestPath)

    assert.equal(manifest.displayName, 'Nexus Mini Sprite')
  })
})

test('readSpritePetPackage blocks spritesheet paths outside the package folder', async () => {
  await withTempPetPackage(async (_directoryPath, manifestPath) => {
    await fs.writeFile(
      manifestPath,
      JSON.stringify({
        id: 'escape',
        spritesheetPath: '../spritesheet.png',
      }),
      'utf8',
    )

    await assert.rejects(
      () => readSpritePetPackage(manifestPath),
      /不能指向 pet\.json 所在目录之外/,
    )
  })
})

test('readSpritePetPackage rejects unsupported spritesheet file types', async () => {
  await withTempPetPackage(async (directoryPath, manifestPath) => {
    await fs.writeFile(
      manifestPath,
      JSON.stringify({
        id: 'bad-format',
        spritesheetPath: 'spritesheet.gif',
      }),
      'utf8',
    )
    await fs.writeFile(path.join(directoryPath, 'spritesheet.gif'), 'GIF89a', 'utf8')

    await assert.rejects(
      () => readSpritePetPackage(manifestPath),
      /只支持 PNG 或 WebP/,
    )
  })
})

test('readSpritePetPackage rejects spritesheets with the wrong atlas size', async () => {
  await withTempPetPackage(async (directoryPath, manifestPath) => {
    await fs.writeFile(
      manifestPath,
      JSON.stringify({
        id: 'bad-size',
        spritesheetPath: 'spritesheet.png',
      }),
      'utf8',
    )
    await fs.writeFile(path.join(directoryPath, 'spritesheet.png'), makePngHeader(192, 208))

    await assert.rejects(
      () => readSpritePetPackage(manifestPath),
      /1536x1872/,
    )
  })
})

test('readSpritePetPackage rejects opaque pixels in unused PNG cells', async () => {
  await withTempPetPackage(async (directoryPath, manifestPath) => {
    await fs.writeFile(
      manifestPath,
      JSON.stringify({
        id: 'dirty-unused-cell',
        spritesheetPath: 'spritesheet.png',
      }),
      'utf8',
    )
    await fs.writeFile(
      path.join(directoryPath, 'spritesheet.png'),
      makeRgbaPng(SPRITE_PET_ATLAS_WIDTH, SPRITE_PET_ATLAS_HEIGHT, {
        x: 6 * SPRITE_PET_CELL_WIDTH,
        y: 0,
        rgba: [255, 0, 0, 255],
      }),
    )

    await assert.rejects(
      () => readSpritePetPackage(manifestPath),
      /未使用格子，必须完全透明/,
    )
  })
})

test('readSpritePetPackage rejects WebP spritesheets without alpha', async () => {
  await withTempPetPackage(async (directoryPath, manifestPath) => {
    await fs.writeFile(
      manifestPath,
      JSON.stringify({
        id: 'webp-no-alpha',
        spritesheetPath: 'spritesheet.webp',
      }),
      'utf8',
    )
    await fs.writeFile(
      path.join(directoryPath, 'spritesheet.webp'),
      makeVp8xWebp(SPRITE_PET_ATLAS_WIDTH, SPRITE_PET_ATLAS_HEIGHT, false),
    )

    await assert.rejects(
      () => readSpritePetPackage(manifestPath),
      /alpha 透明通道/,
    )
  })
})

test('readWebpDimensions reads VP8X WebP atlas dimensions', () => {
  assert.deepEqual(readWebpDimensions(makeVp8xWebp(1536, 1872, true)), {
    width: 1536,
    height: 1872,
  })
})
