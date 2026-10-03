import assert from 'node:assert/strict'
import { test } from 'node:test'
import sharp from 'sharp'

import { normalizePortraitPreview, PORTRAIT_PREVIEW_MAX_BASE64_BYTES } from '../shared/portraitPreview.js'

async function png(width = 2, height = 3) {
  return sharp({ create: { width, height, channels: 4, background: { r: 80, g: 120, b: 160, alpha: 0.5 } } }).png().toBuffer()
}

const preview = (bytes: Buffer, width = 2, height = 3) => ({ dataUrl: `data:image/png;base64,${bytes.toString('base64')}`, width, height })

test('preview normalizer preserves a real PNG and verified dimensions while stripping extra fields', async () => {
  const payload = preview(await png())
  assert.deepEqual(normalizePortraitPreview({ ...payload, path: '/private/image.png', secret: 'not returned', draftId: 'ignored' }), payload)
  const max = preview(await png(768, 768), 768, 768)
  assert.deepEqual(normalizePortraitPreview(max), max)
})

test('preview dimensions must be bounded positive integers matching PNG intrinsic dimensions', async () => {
  const payload = preview(await png())
  for (const width of [0, -1, 769, 1.1, NaN, Infinity, '2', 3]) assert.equal(normalizePortraitPreview({ ...payload, width }), null)
  for (const height of [0, -1, 769, 3.1, NaN, Infinity, '3', 2]) assert.equal(normalizePortraitPreview({ ...payload, height }), null)
  for (const value of [null, undefined, 'file:///private.png', 1, [], {}]) assert.equal(normalizePortraitPreview(value), null)
})

test('preview accepts only canonical PNG base64, never SVG, file paths, remote URLs or alternate data MIME types', async () => {
  const payload = preview(await png())
  const encoded = payload.dataUrl.slice(payload.dataUrl.indexOf(',') + 1)
  for (const dataUrl of [
    '/private/image.png', 'file:///private/image.png', 'https://example.test/image.png',
    'data:image/svg+xml;base64,PHN2Zy8+', `data:image/jpeg;base64,${encoded}`,
    `data:image/png;name=private.png;base64,${encoded}`, `data:image/png;base64, ${encoded}`,
    `data:image/png;base64,${encoded}\n`, `data:image/png;base64,${encoded.slice(1)}`,
    'data:image/png;base64,%%%=', 'data:image/png;base64,PHN2Zy8+',
  ]) assert.equal(normalizePortraitPreview({ ...payload, dataUrl }), null)
})

test('encoded preview data is bounded before decoding', async () => {
  const payload = preview(await png())
  const oversized = 'data:image/png;base64,' + 'A'.repeat(PORTRAIT_PREVIEW_MAX_BASE64_BYTES + 4)
  assert.equal(normalizePortraitPreview({ ...payload, dataUrl: oversized }), null)
  assert.equal(normalizePortraitPreview({ ...payload, dataUrl: 'data:image/png;base64,' }), null)
})

test('truncated, missing-data, corrupt chunk lengths, bad headers and trailing bytes are rejected', async () => {
  const bytes = await png()
  const badLength = Buffer.from(bytes)
  badLength.writeUInt32BE(0xffffffff, 33)
  const badHeader = Buffer.from(bytes)
  badHeader[24] = 7
  const noData = Buffer.concat([bytes.subarray(0, 33), bytes.subarray(bytes.length - 12)])
  const unknownCritical = Buffer.from(bytes)
  unknownCritical.write('FAKE', 37, 'ascii')
  for (const invalid of [bytes.subarray(1), bytes.subarray(0, 40), bytes.subarray(0, bytes.length - 1), badLength, badHeader, noData, unknownCritical, Buffer.concat([bytes, Buffer.from('extra')])]) {
    assert.equal(normalizePortraitPreview(preview(invalid)), null)
  }
})

test('animated PNG control chunks are rejected; preview transport represents one static frame', async () => {
  const bytes = await png()
  const chunk = Buffer.alloc(20)
  chunk.writeUInt32BE(8, 0)
  chunk.write('acTL', 4, 'ascii')
  chunk.writeUInt32BE(2, 8)
  const animated = Buffer.concat([bytes.subarray(0, 33), chunk, bytes.subarray(33)])
  assert.equal(normalizePortraitPreview(preview(animated)), null)
})
