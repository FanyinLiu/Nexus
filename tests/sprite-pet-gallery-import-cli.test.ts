import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import http from 'node:http'
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

function makeTransparentPng(width: number, height: number) {
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const rawPixels = Buffer.alloc((1 + (width * 4)) * height)

  return Buffer.concat([
    pngSignature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(rawPixels, { level: 9 })),
    pngChunk('IEND'),
  ])
}

async function runGalleryImporter(args: string[]) {
  return execFileAsync(process.execPath, ['scripts/import-codex-pet-gallery.mjs', ...args], {
    cwd: process.cwd(),
  })
}

async function withTempDirectory<T>(body: (directoryPath: string) => Promise<T>) {
  const directoryPath = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-sprite-pet-gallery-import-'))
  try {
    return await body(directoryPath)
  } finally {
    await fs.rm(directoryPath, { recursive: true, force: true })
  }
}

async function withPetServer<T>(body: (baseUrl: string) => Promise<T>) {
  const sprite = makeTransparentPng(SPRITE_PET_ATLAS_WIDTH, SPRITE_PET_ATLAS_HEIGHT)
  const server = http.createServer((request, response) => {
    if (request.url === '/pets/sample-pet') {
      response.setHeader('content-type', 'text/html; charset=utf-8')
      response.end([
        '<script>',
        '$R[1]={pet:$R[2]={slug:"sample-pet",displayName:"Sample Pet",',
        'description:"Gallery pet",spritesheetUrl:"http://127.0.0.1:0/spritesheet.png",',
        'spritesheetExt:"png",petJson:$R[3]={id:"sample-pet",displayName:"Sample Pet",',
        'description:"Gallery pet",spritesheetPath:"spritesheet.png"}}}',
        '</script>',
      ].join(''))
      return
    }

    if (request.url === '/spritesheet.png') {
      response.setHeader('content-type', 'image/png')
      response.end(sprite)
      return
    }

    response.statusCode = 404
    response.end('not found')
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const baseUrl = `http://127.0.0.1:${address.port}`

  server.removeAllListeners('request')
  server.on('request', (request, response) => {
    if (request.url === '/pets/sample-pet') {
      response.setHeader('content-type', 'text/html; charset=utf-8')
      response.end([
        '<script>',
        '$R[1]={pet:$R[2]={slug:"sample-pet",displayName:"Sample Pet",',
        `description:"Gallery pet",spritesheetUrl:"${baseUrl}/spritesheet.png",`,
        'spritesheetExt:"png",petJson:$R[3]={id:"sample-pet",displayName:"Sample Pet",',
        'description:"Gallery pet",spritesheetPath:"spritesheet.png"}}}',
        '</script>',
      ].join(''))
      return
    }

    if (request.url === '/spritesheet.png') {
      response.setHeader('content-type', 'image/png')
      response.end(sprite)
      return
    }

    response.statusCode = 404
    response.end('not found')
  })

  try {
    return await body(baseUrl)
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
}

test('pet:import-gallery downloads a Codex pet gallery page into a bundled package', async () => {
  await withTempDirectory(async (directoryPath) => {
    await withPetServer(async (baseUrl) => {
      const outputDir = path.join(directoryPath, 'public-pets')
      const { stdout } = await runGalleryImporter([
        `${baseUrl}/pets/sample-pet`,
        '--output-dir',
        outputDir,
      ])
      const manifestPath = path.join(outputDir, 'sample-pet', 'pet.json')
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as {
        id?: string
        displayName?: string
        description?: string
        spritesheetPath?: string
      }
      const packageInfo = await readSpritePetPackage(manifestPath)

      assert.match(stdout, /Codex pet gallery package imported/)
      assert.match(stdout, /private Codex code\/assets copied: false/)
      assert.equal(manifest.id, 'sample-pet')
      assert.equal(manifest.displayName, 'Sample Pet')
      assert.equal(manifest.description, 'Gallery pet')
      assert.equal(manifest.spritesheetPath, 'spritesheet.png')
      assert.equal(packageInfo.sourceSpritePath, path.join(outputDir, 'sample-pet', 'spritesheet.png'))
    })
  })
})

test('pet:import-gallery refuses to overwrite unless forced', async () => {
  await withTempDirectory(async (directoryPath) => {
    await withPetServer(async (baseUrl) => {
      const outputDir = path.join(directoryPath, 'public-pets')
      const args = [`${baseUrl}/pets/sample-pet`, '--output-dir', outputDir]

      await runGalleryImporter(args)

      await assert.rejects(
        () => runGalleryImporter(args),
        (error: unknown) => {
          const { stderr = '' } = error as { stderr?: string }
          assert.match(stderr, /already exists/)
          assert.match(stderr, /--force/)
          return true
        },
      )

      await runGalleryImporter([...args, '--force'])
    })
  })
})
