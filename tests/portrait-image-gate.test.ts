import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { crc32, deflateSync } from 'node:zlib'
import sharp from 'sharp'

import {
  PORTRAIT_IMAGE_GATE_LIMITS,
  checkPortraitImageFromPayload,
  measurePortraitImageSharpness,
  rejectPortraitImage,
} from '../electron/services/portraitGenerator/rejectImage.js'
import {
  PORTRAIT_IMAGE_GATE_MESSAGE_KEYS,
  PORTRAIT_IMAGE_GATE_REASONS,
  isPortraitImageGateReason,
} from '../shared/portraitImageGate.js'
import { zhCNSettingsWindow } from '../src/i18n/locales/zh-CN/settings-window.ts'
import { enSettingsWindow } from '../src/i18n/locales/en/settings-window.ts'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
let workDir = ''

before(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-portrait-gate-'))
})

after(async () => {
  if (workDir) await fs.rm(workDir, { recursive: true, force: true })
})

/** Hard-edged checkerboard: plenty of outline detail, like line art. */
function checkerboardRaw(width: number, height: number, cell = 16) {
  const data = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0 ? 24 : 232
      data.fill(value, (y * width + x) * 3, (y * width + x) * 3 + 3)
    }
  }
  return sharp(data, { raw: { width, height, channels: 3 } })
}

function checkerboardPng(width: number, height: number) {
  return checkerboardRaw(width, height).png().toBuffer()
}

/** Minimal PNG whose IHDR claims the given size; the pixel data is a stub. */
function pngHeaderOnly(width: number, height: number) {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(typeAndData))
    return Buffer.concat([length, typeAndData, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr.writeUInt8(8, 8)
  ihdr.writeUInt8(2, 9)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.alloc(64))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

async function writeFixture(name: string, bytes: Buffer) {
  const filePath = path.join(workDir, name)
  await fs.writeFile(filePath, bytes)
  return filePath
}

test('accepts a sharp, portrait-shaped PNG from a file path', async () => {
  const filePath = await writeFixture('sharp-portrait.png', await checkerboardPng(768, 1024))
  const result = await rejectPortraitImage({ filePath })

  assert.equal(result.accepted, true)
  assert.equal(result.reasonCode, null)
  assert.equal(result.messageKey, PORTRAIT_IMAGE_GATE_MESSAGE_KEYS.accepted)
  assert.equal(result.metrics.format, 'png')
  assert.equal(result.metrics.width, 768)
  assert.equal(result.metrics.height, 1024)
  assert.ok((result.metrics.laplacianVariance ?? 0) >= PORTRAIT_IMAGE_GATE_LIMITS.minLaplacianVariance)
  assert.ok((result.metrics.edgeDensity ?? 0) >= PORTRAIT_IMAGE_GATE_LIMITS.minEdgeDensity)
})

test('accepts JPEG and WebP buffers and judges EXIF-oriented dimensions', async () => {
  const jpeg = await checkerboardRaw(600, 800).jpeg({ quality: 92 }).withMetadata({ orientation: 6 }).toBuffer()
  const jpegResult = await rejectPortraitImage({ buffer: jpeg })
  assert.equal(jpegResult.accepted, true)
  assert.equal(jpegResult.metrics.format, 'jpeg')
  assert.equal(jpegResult.metrics.width, 800)
  assert.equal(jpegResult.metrics.height, 600)

  const webp = await checkerboardRaw(800, 800).webp({ lossless: true }).toBuffer()
  const webpResult = await rejectPortraitImage({ buffer: webp })
  assert.equal(webpResult.accepted, true)
  assert.equal(webpResult.metrics.format, 'webp')
})

test('rejects a blurry image with the too_blurry reason', async () => {
  const blurry = await checkerboardRaw(768, 1024).blur(24).png().toBuffer()
  const result = await rejectPortraitImage({ buffer: blurry })

  assert.equal(result.accepted, false)
  assert.equal(result.reasonCode, PORTRAIT_IMAGE_GATE_REASONS.TOO_BLURRY)
  assert.equal(result.messageKey, PORTRAIT_IMAGE_GATE_MESSAGE_KEYS.too_blurry)
  assert.ok((result.metrics.laplacianVariance ?? Infinity) < PORTRAIT_IMAGE_GATE_LIMITS.minLaplacianVariance)
})

test('rejects images whose shorter side is below the illustration minimum', async () => {
  const result = await rejectPortraitImage({ buffer: await checkerboardPng(400, 900) })

  assert.equal(result.reasonCode, PORTRAIT_IMAGE_GATE_REASONS.TOO_SMALL)
  assert.deepEqual(result.messageParams, { minSide: PORTRAIT_IMAGE_GATE_LIMITS.minShortSidePx })
  assert.equal(result.metrics.laplacianVariance, undefined, 'cheap checks must short-circuit before decoding pixels')
})

test('rejects banner and strip aspect ratios', async () => {
  const wide = await rejectPortraitImage({ buffer: await checkerboardPng(2000, 600) })
  assert.equal(wide.reasonCode, PORTRAIT_IMAGE_GATE_REASONS.EXTREME_ASPECT_RATIO)
  assert.deepEqual(wide.messageParams, { maxRatio: PORTRAIT_IMAGE_GATE_LIMITS.maxAspectRatio })

  const tall = await rejectPortraitImage({ buffer: await checkerboardPng(560, 1600) })
  assert.equal(tall.reasonCode, PORTRAIT_IMAGE_GATE_REASONS.EXTREME_ASPECT_RATIO)
})

test('rejects oversized files from their size alone without reading them', async () => {
  const filePath = path.join(workDir, 'huge.png')
  const handle = await fs.open(filePath, 'w')
  // A sparse file: stat reports the size, but nothing valid is inside.
  await handle.truncate(PORTRAIT_IMAGE_GATE_LIMITS.maxFileBytes + 1)
  await handle.close()

  const result = await rejectPortraitImage({ filePath })
  assert.equal(result.reasonCode, PORTRAIT_IMAGE_GATE_REASONS.FILE_TOO_LARGE)
  assert.deepEqual(result.messageParams, { maxMegabytes: 32 })
  assert.equal(result.metrics.byteLength, PORTRAIT_IMAGE_GATE_LIMITS.maxFileBytes + 1)
})

test('rejects headers that claim more pixels than the decode limit', async () => {
  const result = await rejectPortraitImage({ buffer: pngHeaderOnly(9000, 8000) })

  assert.equal(result.reasonCode, PORTRAIT_IMAGE_GATE_REASONS.DIMENSIONS_TOO_LARGE)
  assert.deepEqual(result.messageParams, { maxMegapixels: 64 })
})

test('rejects corrupt, truncated, empty, and missing inputs as stable codes', async () => {
  const notImage = await rejectPortraitImage({ buffer: Buffer.from('definitely not an image') })
  assert.equal(notImage.reasonCode, PORTRAIT_IMAGE_GATE_REASONS.DECODE_FAILED)

  const jpeg = await checkerboardRaw(768, 1024).jpeg().toBuffer()
  const truncated = await rejectPortraitImage({ buffer: jpeg.subarray(0, Math.floor(jpeg.length / 3)) })
  assert.equal(truncated.reasonCode, PORTRAIT_IMAGE_GATE_REASONS.DECODE_FAILED)

  const empty = await rejectPortraitImage({ filePath: await writeFixture('empty.png', Buffer.alloc(0)) })
  assert.equal(empty.reasonCode, PORTRAIT_IMAGE_GATE_REASONS.DECODE_FAILED)

  const missing = await rejectPortraitImage({ filePath: path.join(workDir, 'missing.png') })
  assert.equal(missing.reasonCode, PORTRAIT_IMAGE_GATE_REASONS.UNREADABLE)

  const directory = await rejectPortraitImage({ filePath: workDir })
  assert.equal(directory.reasonCode, PORTRAIT_IMAGE_GATE_REASONS.UNREADABLE)

  const nothing = await rejectPortraitImage({})
  assert.equal(nothing.reasonCode, PORTRAIT_IMAGE_GATE_REASONS.UNREADABLE)
})

test('rejects decodable but unsupported or animated formats', async () => {
  const gif = await checkerboardRaw(768, 1024).gif().toBuffer()
  assert.equal((await rejectPortraitImage({ buffer: gif })).reasonCode, PORTRAIT_IMAGE_GATE_REASONS.UNSUPPORTED_FORMAT)

  const tiff = await checkerboardRaw(768, 1024).tiff().toBuffer()
  assert.equal((await rejectPortraitImage({ buffer: tiff })).reasonCode, PORTRAIT_IMAGE_GATE_REASONS.UNSUPPORTED_FORMAT)

  const width = 600
  const pageHeight = 800
  // Frames must differ or the encoder collapses them into a still image.
  const frames = Buffer.alloc(width * pageHeight * 2 * 3, 200)
  frames.fill(0, 0, width * pageHeight * 3)
  const animated = await sharp(frames, { raw: { width, height: pageHeight * 2, channels: 3, pageHeight } })
    .webp({ loop: 0, delay: [100, 100] })
    .toBuffer()
  assert.equal((await rejectPortraitImage({ buffer: animated })).reasonCode, PORTRAIT_IMAGE_GATE_REASONS.ANIMATED)
})

test('sharpness metric is zero for flat images and high for hard edges', () => {
  const flat = new Uint8Array(64 * 64).fill(128)
  assert.deepEqual(measurePortraitImageSharpness(flat, 64, 64), { laplacianVariance: 0, edgeDensity: 0 })
  assert.deepEqual(measurePortraitImageSharpness(flat, 2, 2), { laplacianVariance: 0, edgeDensity: 0 })

  const edges = new Uint8Array(64 * 64)
  for (let index = 0; index < edges.length; index += 1) edges[index] = (index % 64) < 32 ? 0 : 255
  const measured = measurePortraitImageSharpness(edges, 64, 64)
  assert.ok(measured.laplacianVariance > PORTRAIT_IMAGE_GATE_LIMITS.minLaplacianVariance)
  assert.ok(measured.edgeDensity > PORTRAIT_IMAGE_GATE_LIMITS.minEdgeDensity)
})

test('IPC entry uses the payload path, falls back to the picker, and returns null on cancel', async () => {
  const filePath = await writeFixture('private-character-name.png', await checkerboardPng(768, 1024))
  let pickerCalls = 0
  const pickImagePath = async () => {
    pickerCalls += 1
    return null
  }

  const direct = await checkPortraitImageFromPayload({ imagePath: filePath }, { pickImagePath })
  assert.equal(direct?.accepted, true)
  assert.equal(pickerCalls, 0)

  assert.equal(await checkPortraitImageFromPayload({}, { pickImagePath }), null)
  assert.equal(pickerCalls, 1)

  const picked = await checkPortraitImageFromPayload({}, { pickImagePath: async () => filePath })
  assert.equal(picked?.accepted, true)

  const serialized = JSON.stringify([direct, picked])
  assert.ok(!serialized.includes(workDir), 'gate results must not echo the image path')
  assert.ok(!serialized.includes('private-character-name'))
})

test('every reason code has a message key with copy in zh-CN and en', () => {
  const zh = zhCNSettingsWindow as Record<string, string>
  const en = enSettingsWindow as Record<string, string>
  for (const code of Object.values(PORTRAIT_IMAGE_GATE_REASONS)) {
    assert.equal(isPortraitImageGateReason(code), true)
    const key = PORTRAIT_IMAGE_GATE_MESSAGE_KEYS[code]
    assert.ok(zh[key], `${key} needs zh-CN copy`)
    assert.ok(en[key], `${key} needs en copy`)
  }
  assert.ok(zh[PORTRAIT_IMAGE_GATE_MESSAGE_KEYS.accepted])
  assert.equal(isPortraitImageGateReason('/Users/me/private.png'), false)
})

test('privacy boundary: the gate module only touches the filesystem, sharp, and its shared contract', async () => {
  const source = await fs.readFile(path.join(ROOT, 'electron/services/portraitGenerator/rejectImage.js'), 'utf8')
  const imports = [...source.matchAll(/^import\s[^'"]*['"]([^'"]+)['"]/gm)].map((match) => match[1]).sort()

  assert.deepEqual(imports, ['../../../shared/portraitImageGate.js', 'node:fs/promises', 'sharp'])
  assert.doesNotMatch(source, /\baudit\(|console\.|desktopContext|chatRuntime|fetch\(/)
})
