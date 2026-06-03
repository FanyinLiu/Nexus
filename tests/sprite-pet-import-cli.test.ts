import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { test } from 'node:test'
import { deflateSync } from 'node:zlib'

import {
  SPRITE_PET_ATLAS_HEIGHT,
  SPRITE_PET_ATLAS_WIDTH,
  readSpritePetPackage,
} from '../electron/services/spritePetPackage.js'

const execFileAsync = promisify(execFile)

function makePngHeader(width: number, height: number) {
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
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

  return Buffer.concat([
    pngSignature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(rawPixels, { level: 9 })),
    pngChunk('IEND'),
  ])
}

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

function makeZipArchive(entries: Array<{ name: string; data: Buffer | string }>) {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let localOffset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8')
    const checksum = crc32(data)
    const localHeader = Buffer.alloc(30)

    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(0x0800, 6)
    localHeader.writeUInt16LE(0, 8)
    localHeader.writeUInt16LE(0, 10)
    localHeader.writeUInt16LE(0, 12)
    localHeader.writeUInt32LE(checksum, 14)
    localHeader.writeUInt32LE(data.length, 18)
    localHeader.writeUInt32LE(data.length, 22)
    localHeader.writeUInt16LE(name.length, 26)
    localHeader.writeUInt16LE(0, 28)

    localParts.push(localHeader, name, data)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(0x0800, 8)
    centralHeader.writeUInt16LE(0, 10)
    centralHeader.writeUInt16LE(0, 12)
    centralHeader.writeUInt16LE(0, 14)
    centralHeader.writeUInt32LE(checksum, 16)
    centralHeader.writeUInt32LE(data.length, 20)
    centralHeader.writeUInt32LE(data.length, 24)
    centralHeader.writeUInt16LE(name.length, 28)
    centralHeader.writeUInt16LE(0, 30)
    centralHeader.writeUInt16LE(0, 32)
    centralHeader.writeUInt16LE(0, 34)
    centralHeader.writeUInt16LE(0, 36)
    centralHeader.writeUInt32LE(0, 38)
    centralHeader.writeUInt32LE(localOffset, 42)
    centralParts.push(centralHeader, name)

    localOffset += localHeader.length + name.length + data.length
  }

  const centralDirectory = Buffer.concat(centralParts)
  const localData = Buffer.concat(localParts)
  const endOfCentralDirectory = Buffer.alloc(22)
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0)
  endOfCentralDirectory.writeUInt16LE(0, 4)
  endOfCentralDirectory.writeUInt16LE(0, 6)
  endOfCentralDirectory.writeUInt16LE(entries.length, 8)
  endOfCentralDirectory.writeUInt16LE(entries.length, 10)
  endOfCentralDirectory.writeUInt32LE(centralDirectory.length, 12)
  endOfCentralDirectory.writeUInt32LE(localData.length, 16)
  endOfCentralDirectory.writeUInt16LE(0, 20)

  return Buffer.concat([localData, centralDirectory, endOfCentralDirectory])
}

async function runImporter(args: string[]) {
  return execFileAsync(process.execPath, ['scripts/import-sprite-pet.mjs', ...args], {
    cwd: process.cwd(),
  })
}

async function withTempDirectory<T>(body: (directoryPath: string) => Promise<T>) {
  const directoryPath = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-sprite-pet-import-'))
  try {
    return await body(directoryPath)
  } finally {
    await fs.rm(directoryPath, { recursive: true, force: true })
  }
}

async function createValidPackage(directoryPath: string) {
  const packagePath = path.join(directoryPath, 'source-pet')
  await fs.mkdir(packagePath, { recursive: true })
  await fs.writeFile(
    path.join(packagePath, 'pet.json'),
    JSON.stringify({
      id: 'copy_cat',
      displayName: 'Copy Cat',
      description: 'A clean-room sprite package.',
      spritesheetPath: 'spritesheet.png',
    }),
    'utf8',
  )
  await fs.writeFile(
    path.join(packagePath, 'spritesheet.png'),
    makePngHeader(SPRITE_PET_ATLAS_WIDTH, SPRITE_PET_ATLAS_HEIGHT),
  )
  return packagePath
}

test('pet:import copies a valid package into a bundled pets directory', async () => {
  await withTempDirectory(async (directoryPath) => {
    const sourcePackage = await createValidPackage(directoryPath)
    const outputDir = path.join(directoryPath, 'public-pets')

    const { stdout } = await runImporter([
      sourcePackage,
      '--output-dir',
      outputDir,
      '--id',
      'custom-copy',
      '--display-name',
      'Custom Copy',
    ])

    const targetManifestPath = path.join(outputDir, 'custom-copy', 'pet.json')
    const targetManifest = JSON.parse(await fs.readFile(targetManifestPath, 'utf8')) as {
      id?: string
      displayName?: string
      description?: string
      spritesheetPath?: string
    }
    const packageInfo = await readSpritePetPackage(targetManifestPath)

    assert.match(stdout, /Sprite pet package imported/)
    assert.equal(targetManifest.id, 'custom-copy')
    assert.equal(targetManifest.displayName, 'Custom Copy')
    assert.equal(targetManifest.description, 'A clean-room sprite package.')
    assert.equal(targetManifest.spritesheetPath, 'spritesheet.png')
    assert.equal(packageInfo.sourceSpritePath, path.join(outputDir, 'custom-copy', 'spritesheet.png'))
  })
})

test('pet:import copies a downloaded Codex pet ZIP package', async () => {
  await withTempDirectory(async (directoryPath) => {
    const sprite = makePngHeader(SPRITE_PET_ATLAS_WIDTH, SPRITE_PET_ATLAS_HEIGHT)
    const zipPath = path.join(directoryPath, 'downloaded-codex-pet.zip')
    const outputDir = path.join(directoryPath, 'public-pets')

    await fs.writeFile(
      zipPath,
      makeZipArchive([
        {
          name: 'zip-cat/pet.json',
          data: JSON.stringify({
            id: 'zip_cat',
            displayName: 'Zip Cat',
            description: 'Downloaded from a Codex pet gallery.',
            spritesheetPath: 'spritesheet.png',
          }),
        },
        {
          name: 'zip-cat/spritesheet.png',
          data: sprite,
        },
      ]),
    )

    const { stdout } = await runImporter([
      zipPath,
      '--output-dir',
      outputDir,
    ])

    const targetManifestPath = path.join(outputDir, 'zip_cat', 'pet.json')
    const targetManifest = JSON.parse(await fs.readFile(targetManifestPath, 'utf8')) as {
      id?: string
      displayName?: string
      description?: string
      spritesheetPath?: string
    }
    const packageInfo = await readSpritePetPackage(targetManifestPath)

    assert.match(stdout, /Sprite pet package imported/)
    assert.equal(targetManifest.id, 'zip_cat')
    assert.equal(targetManifest.displayName, 'Zip Cat')
    assert.equal(targetManifest.description, 'Downloaded from a Codex pet gallery.')
    assert.equal(targetManifest.spritesheetPath, 'spritesheet.png')
    assert.equal(packageInfo.sourceSpritePath, path.join(outputDir, 'zip_cat', 'spritesheet.png'))
  })
})

test('pet:import rejects ZIP packages with unsafe paths', async () => {
  await withTempDirectory(async (directoryPath) => {
    const zipPath = path.join(directoryPath, 'unsafe.zip')

    await fs.writeFile(
      zipPath,
      makeZipArchive([
        {
          name: '../pet.json',
          data: '{}',
        },
      ]),
    )

    await assert.rejects(
      () => runImporter([zipPath, '--output-dir', path.join(directoryPath, 'public-pets')]),
      (error: unknown) => {
        const { stderr = '' } = error as { stderr?: string }
        assert.match(stderr, /不安全路径/)
        return true
      },
    )
  })
})

test('pet:import refuses to overwrite an existing bundled pet unless forced', async () => {
  await withTempDirectory(async (directoryPath) => {
    const sourcePackage = await createValidPackage(directoryPath)
    const outputDir = path.join(directoryPath, 'public-pets')
    const args = [sourcePackage, '--output-dir', outputDir, '--id', 'copy-cat']

    await runImporter(args)

    await assert.rejects(
      () => runImporter(args),
      (error: unknown) => {
        const { stderr = '' } = error as { stderr?: string }
        assert.match(stderr, /already exists/)
        assert.match(stderr, /--force/)
        return true
      },
    )

    await runImporter([...args, '--force'])
  })
})
