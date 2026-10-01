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
  measurePortraitImageBackground,
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
import { zhTWSettingsWindow } from '../src/i18n/locales/zh-TW/settings-window.ts'
import { jaSettingsWindow } from '../src/i18n/locales/ja/settings-window.ts'
import { koSettingsWindow } from '../src/i18n/locales/ko/settings-window.ts'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
let workDir = ''

before(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-portrait-gate-'))
})

after(async () => {
  if (workDir) await fs.rm(workDir, { recursive: true, force: true })
})

type FixtureBackground = 'plain' | 'busy'

/**
 * Hard-edged checkerboard "character" (plenty of outline detail, like line
 * art) on a plain off-white background, touching the bottom edge like a bust
 * crop. `busy` lets the pattern fill the whole frame instead.
 */
function checkerboardRaw(width: number, height: number, background: FixtureBackground = 'plain', cell = 16) {
  const data = Buffer.alloc(width * height * 3)
  const insetX = Math.round(width * 0.15)
  const insetTop = Math.round(height * 0.15)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inCharacter = x >= insetX && x < width - insetX && y >= insetTop
      const value = background === 'plain' && !inCharacter
        ? 245
        : (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0 ? 24 : 232
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
  // Stored sideways (600x800); EXIF orientation 6 turns it back upright to 800x600.
  const sideways = await checkerboardRaw(800, 600).rotate(-90).png().toBuffer()
  const jpeg = await sharp(sideways).jpeg({ quality: 92 }).withMetadata({ orientation: 6 }).toBuffer()
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

test('rejects images narrower than the minimum width', async () => {
  const result = await rejectPortraitImage({ buffer: await checkerboardPng(400, 900) })

  assert.equal(result.reasonCode, PORTRAIT_IMAGE_GATE_REASONS.TOO_SMALL)
  assert.deepEqual(result.messageParams, { minWidth: 512 })
  assert.equal(PORTRAIT_IMAGE_GATE_LIMITS.minWidthPx, 512)
  assert.equal(result.metrics.laplacianVariance, undefined, 'cheap checks must short-circuit before decoding pixels')

  const justWideEnough = await rejectPortraitImage({ buffer: await checkerboardPng(512, 700) })
  assert.equal(justWideEnough.accepted, true)
})

test('rejects wide banners as extreme_aspect_ratio', async () => {
  const wide = await rejectPortraitImage({ buffer: await checkerboardPng(2000, 600) })
  assert.equal(wide.reasonCode, PORTRAIT_IMAGE_GATE_REASONS.EXTREME_ASPECT_RATIO)
  assert.deepEqual(wide.messageParams, { maxRatio: PORTRAIT_IMAGE_GATE_LIMITS.maxWideAspectRatio })

  const landscapeBust = await rejectPortraitImage({ buffer: await checkerboardPng(1200, 600) })
  assert.equal(landscapeBust.accepted, true)
})

test('tall full-body strips get the narrowed-scope half_body_only answer', async () => {
  assert.equal(PORTRAIT_IMAGE_GATE_LIMITS.maxTallAspectRatio, 2)
  // 2.86 tall: used to be extreme_aspect_ratio, now says what v0.5 supports.
  const strip = await rejectPortraitImage({ buffer: await checkerboardPng(560, 1600) })
  assert.equal(strip.reasonCode, PORTRAIT_IMAGE_GATE_REASONS.HALF_BODY_ONLY)
  assert.equal(strip.messageKey, PORTRAIT_IMAGE_GATE_MESSAGE_KEYS.half_body_only)
  assert.equal(strip.metrics.laplacianVariance, undefined, 'shape check must short-circuit before decoding pixels')

  // 2.2 tall (a typical full-body sprite) was accepted under the old 2.5 limit.
  const fullBody = await rejectPortraitImage({ buffer: await checkerboardPng(600, 1320) })
  assert.equal(fullBody.reasonCode, PORTRAIT_IMAGE_GATE_REASONS.HALF_BODY_ONLY)

  // 1.9 tall is still a plausible long half-body crop.
  const longBust = await rejectPortraitImage({ buffer: await checkerboardPng(600, 1140) })
  assert.equal(longBust.accepted, true)
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

test('rejects busy backgrounds and accepts plain or transparent ones', async () => {
  const busy = await rejectPortraitImage({ buffer: await checkerboardRaw(768, 1024, 'busy').png().toBuffer() })
  assert.equal(busy.reasonCode, PORTRAIT_IMAGE_GATE_REASONS.BUSY_BACKGROUND)
  assert.equal(busy.messageKey, PORTRAIT_IMAGE_GATE_MESSAGE_KEYS.busy_background)
  assert.ok((busy.metrics.plainBorderRatio ?? 1) < PORTRAIT_IMAGE_GATE_LIMITS.minPlainBorderRatio)

  const plain = await rejectPortraitImage({ buffer: await checkerboardPng(768, 1024) })
  assert.equal(plain.accepted, true)
  assert.ok((plain.metrics.plainBorderRatio ?? 0) >= PORTRAIT_IMAGE_GATE_LIMITS.minPlainBorderRatio)

  // Transparent background: the hidden RGB under alpha 0 is deliberately noisy.
  const width = 768
  const height = 1024
  const { data: pattern } = await checkerboardRaw(width, height, 'busy').raw().toBuffer({ resolveWithObject: true })
  const rgba = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      const inCharacter = x >= 160 && x < width - 160 && y >= 160 && y < height - 160
      rgba[index * 4] = pattern[index * 3]
      rgba[index * 4 + 1] = pattern[index * 3 + 1]
      rgba[index * 4 + 2] = pattern[index * 3 + 2]
      rgba[index * 4 + 3] = inCharacter ? 255 : 0
    }
  }
  const transparentPng = await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer()
  const transparent = await rejectPortraitImage({ buffer: transparentPng })
  assert.equal(transparent.accepted, true)
  assert.equal(transparent.metrics.transparentBorderRatio, 1)
})

test('background metric treats transparency and one dominant colour as plain', () => {
  const size = 64
  const solid = new Uint8Array(size * size * 4)
  for (let index = 0; index < size * size; index += 1) solid.set([30, 120, 200, 255], index * 4)
  assert.deepEqual(measurePortraitImageBackground(solid, size, size), { plainBorderRatio: 1, transparentBorderRatio: 0, transparentPixelRatio: 0 })

  const clear = new Uint8Array(size * size * 4)
  assert.deepEqual(measurePortraitImageBackground(clear, size, size), { plainBorderRatio: 1, transparentBorderRatio: 1, transparentPixelRatio: 1 })

  const noisy = new Uint8Array(size * size * 4)
  for (let index = 0; index < size * size; index += 1) {
    noisy.set([(index * 67) % 256, (index * 131) % 256, (index * 29) % 256, 255], index * 4)
  }
  assert.ok(measurePortraitImageBackground(noisy, size, size).plainBorderRatio < PORTRAIT_IMAGE_GATE_LIMITS.minPlainBorderRatio)
})

test('background metric ignores the bottom band, where half-body crops meet the frame', () => {
  const size = 400
  const band = Math.round(size * PORTRAIT_IMAGE_GATE_LIMITS.borderBandFraction)
  const rgba = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // Plain top and sides; the whole bottom band is a noisy "torso".
      const value = y >= size - band ? [(x * 67) % 256, (x * 131 + y) % 256, (x * 29) % 256] : [240, 240, 240]
      rgba.set([...value, 255], (y * size + x) * 4)
    }
  }
  assert.equal(measurePortraitImageBackground(rgba, size, size).plainBorderRatio, 1)
})

test('mostly transparent images skip the busy-border check even when the character fills the edges', async () => {
  const width = 768
  const height = 1024
  const { data: pattern } = await checkerboardRaw(width, height, 'busy').raw().toBuffer({ resolveWithObject: true })
  const rgba = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      // Opaque everywhere except a transparent block in the top centre (~8%).
      const clear = y < 160 && x >= 192 && x < width - 192
      rgba.set([pattern[index * 3], pattern[index * 3 + 1], pattern[index * 3 + 2], clear ? 0 : 255], index * 4)
    }
  }
  const result = await rejectPortraitImage({ buffer: await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer() })
  assert.ok((result.metrics.plainBorderRatio ?? 1) < PORTRAIT_IMAGE_GATE_LIMITS.minPlainBorderRatio)
  assert.ok((result.metrics.transparentPixelRatio ?? 0) >= PORTRAIT_IMAGE_GATE_LIMITS.transparentImageMinRatio)
  assert.equal(result.accepted, true)
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

test('every reason code has a message key with copy in all five locales', () => {
  const zh = zhCNSettingsWindow as Record<string, string>
  const en = enSettingsWindow as Record<string, string>
  for (const code of Object.values(PORTRAIT_IMAGE_GATE_REASONS)) {
    assert.equal(isPortraitImageGateReason(code), true)
    const key = PORTRAIT_IMAGE_GATE_MESSAGE_KEYS[code]
    assert.ok(zh[key], `${key} needs zh-CN copy`)
    assert.ok(en[key], `${key} needs en copy`)
    for (const [locale, table] of Object.entries({ zhTWSettingsWindow, jaSettingsWindow, koSettingsWindow })) {
      assert.ok((table as Record<string, string>)[key], `${key} needs ${locale} copy`)
    }
  }
  const halfBodyKey = PORTRAIT_IMAGE_GATE_MESSAGE_KEYS.half_body_only
  assert.match(zh[halfBodyKey], /0\.5 暂时只支持半身立绘/)
  assert.match(en[halfBodyKey], /0\.5 currently supports half-body illustrations only/)
  assert.ok(zh[PORTRAIT_IMAGE_GATE_MESSAGE_KEYS.accepted])
  assert.equal(isPortraitImageGateReason('/Users/me/private.png'), false)
})

test('privacy boundary: the gate module only touches the filesystem, sharp, and its shared contract', async () => {
  const source = await fs.readFile(path.join(ROOT, 'electron/services/portraitGenerator/rejectImage.js'), 'utf8')
  const imports = [...source.matchAll(/^import\s[^'"]*['"]([^'"]+)['"]/gm)].map((match) => match[1]).sort()

  assert.deepEqual(imports, ['../../../shared/portraitImageGate.js', 'node:fs/promises', 'sharp'])
  assert.doesNotMatch(source, /\baudit\(|console\.|desktopContext|chatRuntime|fetch\(/)
})
