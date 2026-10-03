import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import sharp from 'sharp'

import {
  PORTRAIT_DRAFT_KEEP,
  generatePortraitDraftFromPayload,
  resolvePortraitDraftRoot,
} from '../electron/services/portraitGenerator/portraitDraft.js'
import { evaluatePortraitLandmarks } from '../electron/services/portraitGenerator/landmarkGate.js'
import { plainBackgroundAlpha } from '../electron/services/portraitGenerator/portraitLayers.js'
import { summarizePetModelResult } from '../electron/ipc/petModelAudit.js'
import { PORTRAIT_LANDMARK_GATE_REASONS as R } from '../shared/portraitLandmarkGate.js'
import { normalizePortraitPreview } from '../shared/portraitPreview.js'

let workDir = ''
before(async () => { workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-portrait-draft-')) })
after(async () => { if (workDir) await fs.rm(workDir, { recursive: true, force: true }) })

type Point = [number, number, number]
type RGB = [number, number, number]

function frontalKeypoints(cx = 300, cy = 300): Point[] {
  const p = (dx: number, dy: number): Point => [cx + dx, cy + dy, 0.9]
  const eye = (ex: number) => [p(ex - 15, -35), p(ex - 8, -42), p(ex + 8, -42), p(ex + 15, -35), p(ex + 8, -28), p(ex - 8, -28)]
  return [
    p(-100, -50), p(-85, 50), p(0, 100), p(85, 50), p(100, -50),
    p(-70, -85), p(-50, -88), p(-30, -85), p(30, -85), p(50, -88), p(70, -85),
    ...eye(-50), ...eye(50), p(0, 20), p(-15, 60), p(0, 55), p(15, 60), p(0, 65),
  ]
}

function insidePolygon(points: number[][], x: number, y: number) {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i]
    const [xj, yj] = points[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Flat half-body character on white (same layout as tests/portrait-layers.test.ts). */
function paintCharacter() {
  const width = 600
  const height = 700
  const rgb = new Uint8Array(width * height * 3).fill(255)
  const kp = frontalKeypoints()
  const facePoly = [...kp.slice(0, 5).map((q) => [q[0], q[1]]), [400, 185], [200, 185]]
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let c: RGB | null = null
      if ((x - 300) ** 2 / 130 ** 2 + (y - 230) ** 2 / 140 ** 2 < 1 && y < 330) c = [214, 112, 160]
      if (y >= 200 && y < 360 && ((x >= 172 && x < 205) || (x >= 395 && x < 428))) c = [214, 112, 160]
      if (y >= 380 && y < 470 && x >= 265 && x < 335) c = [220, 186, 164]
      if (y >= 460 && x >= 150 && x < 450) c = [40, 70, 160]
      if (insidePolygon(facePoly, x + 0.5, y + 0.5)) {
        c = [246, 214, 190]
        for (const ex of [250, 350]) if ((x - ex) ** 2 / 15 ** 2 + (y - 265) ** 2 / 10 ** 2 < 1) c = [60, 40, 80]
        if ((x - 300) ** 2 / 14 ** 2 + (y - 360) ** 2 / 4 ** 2 < 1) c = [200, 110, 110]
      }
      if (c) rgb.set(c, (y * width + x) * 3)
    }
  }
  return { rgb, width, height, kp }
}

/** Character scaled x4 (2400x2800) so the landmark raster is downsized (pixelScale != 1). */
async function writeCharacter(name: string, factor = 4) {
  const { rgb, width, height } = paintCharacter()
  const filePath = path.join(workDir, name)
  await sharp(Buffer.from(rgb), { raw: { width, height, channels: 3 } }).resize(width * factor, height * factor, { kernel: 'nearest' }).png().toFile(filePath)
  return filePath
}

/** Interior scenery stays outside the controlled character mask, with an unchanged white border. */
async function writeResidualCharacter(name: string, nativeAlpha = false) {
  const image = paintCharacter()
  const { width, height, rgb } = image
  const alpha = plainBackgroundAlpha(image).map((value: number) => value ? 180 : 0)
  for (let y = 150; y < 550; y += 1) for (let x = 20; x < 130; x += 1) rgb.set([50, 90, 140], (y * width + x) * 3)
  const rgba = new Uint8Array(width * height * 4)
  for (let i = 0; i < alpha.length; i += 1) {
    rgba.set(rgb.subarray(i * 3, i * 3 + 3), i * 4)
    rgba[i * 4 + 3] = nativeAlpha ? alpha[i] : 255
  }
  const filePath = path.join(workDir, name)
  await sharp(Buffer.from(rgba), { raw: { width, height, channels: 4 } }).png().toFile(filePath)
  return { ...image, alpha, filePath }
}

/** Engine stub: answers like the worker would, with landmarks in raster pixels. */
function fakeEngine(verdictFor: (image: { width: number, height: number }) => object, status = 'ready') {
  const calls: Array<{ width: number, height: number, options: unknown }> = []
  return {
    calls,
    engine: {
      prepare: async () => ({ status }),
      evaluate: async (image: { width: number, height: number }, options: unknown) => { calls.push({ width: image.width, height: image.height, options }); return verdictFor(image) },
    },
  }
}

const accepted = (keypoints: number[][]) => ({ accepted: true, reasonCode: null, detail: null, messageKey: 'settings.pet.portrait_gate.accepted', messageParams: {}, metrics: { faces: 1 }, keypoints })
// The deterministic fixture mask exercises draft wiring, not real ISNet quality.
const getCutoutEngine = () => ({ prepare: async () => ({ status: 'ready' }), evaluate: async (image: object) => ({ accepted: true, alpha: plainBackgroundAlpha(image) }) })

test('generation: gate -> landmarks (original px) -> hair/head/body PNGs + draft.json, result without paths', async () => {
  const filePath = await writeCharacter('character.png')
  const { kp } = paintCharacter()
  const root = path.join(workDir, 'drafts-a')
  const { engine, calls } = fakeEngine((image) => {
    const k = image.width / 2400
    return accepted(kp.map(([x, y, c]) => [x * 4 * k, y * 4 * k, c]))
  })
  const result = await generatePortraitDraftFromPayload({ imagePath: filePath }, { pickImagePath: async () => null, getEngine: () => engine, getCutoutEngine, draftRoot: root, now: () => 1_700_000_000_000 })
  assert.equal(result?.accepted, true, JSON.stringify(result))
  if (!result?.accepted) return
  assert.deepEqual(calls.map((c) => c.options), [{ keepKeypoints: true }])
  assert.equal(calls[0].width, 1755, 'the landmark raster is downsized to 2048 px')
  assert.match(result.draftId, /^draft-1700000000000-[0-9a-f]{8}$/)
  assert.deepEqual([result.width, result.height], [658, 768])
  assert.equal(result.alphaSource, 'isnet')
  assert.ok(result.layers.hair.share > 0.1 && result.layers.head.share > 0.1 && result.layers.body.share > 0.1, JSON.stringify(result.layers))
  assert.ok(!JSON.stringify(result).includes(workDir), 'no paths in the result')

  const dir = path.join(root, result.draftId)
  assert.deepEqual((await fs.readdir(dir)).sort(), ['body.png', 'draft.json', 'hair.png', 'head.png', 'preview.png'])
  for (const name of ['hair', 'head', 'body', 'preview']) {
    const meta = await sharp(path.join(dir, `${name}.png`)).metadata()
    assert.deepEqual([meta.width, meta.height, meta.channels], [658, 768, 4], name)
  }
  // The head layer is opaque at the face centre and transparent on the white border.
  const { data } = await sharp(path.join(dir, 'head.png')).raw().toBuffer({ resolveWithObject: true })
  const at = (x: number, y: number) => data[(Math.round(y * 768 / 2800 * 4) * 658 + Math.round(x * 658 / 2400 * 4)) * 4 + 3]
  assert.equal(at(300, 300), 255)
  assert.equal(at(20, 20), 0)
  const manifest = JSON.parse(await fs.readFile(path.join(dir, 'draft.json'), 'utf8'))
  assert.equal(manifest.version, 1)
  assert.equal(manifest.preview, 'preview.png')
  assert.deepEqual(Object.keys(manifest.layers), ['hair', 'head', 'body'])
  assert.equal(manifest.metadata.version, 1)
  assert.deepEqual(manifest.metadata.coordinates.landmarkSource, { width: 2400, height: 2800 })
  assert.deepEqual(manifest.metadata.coordinates.analysis, { width: 1755, height: 2048 })
  assert.deepEqual(manifest.metadata.coordinates.work, { width: 658, height: 768 })
  assert.equal(manifest.metadata.landmarks.status, 'recorded')
  assert.equal(manifest.metadata.landmarks.sourcePoints.length, 28)
  assert.equal(manifest.metadata.landmarks.workPoints.length, 28)
  assert.equal(manifest.metadata.capabilities.motionReady, false)
  assert.equal(manifest.metadata.provenance.runtimeModelIdentity, 'not_recorded', 'a fake engine cannot attest catalog models')
  assert.equal('metadata' in result, false, 'internal coordinates never cross generation IPC')
  assert.ok(!JSON.stringify(manifest).includes(workDir), 'no source path in the manifest')
})

test('generation stops at stage A, at missing models, and at a landmark rejection, without writing a draft', async () => {
  const tiny = path.join(workDir, 'tiny.png')
  await sharp({ create: { width: 64, height: 64, channels: 3, background: '#ffffff' } }).png().toFile(tiny)
  const root = path.join(workDir, 'drafts-b')
  const untouched = fakeEngine(() => { throw new Error('not reached') })
  const small = await generatePortraitDraftFromPayload({ imagePath: tiny }, { pickImagePath: async () => null, getEngine: () => untouched.engine, draftRoot: root })
  assert.equal(small?.accepted, false)
  assert.equal(small && !small.accepted && small.stage, 'image')
  assert.equal(untouched.calls.length, 0)

  const filePath = await writeCharacter('character-b.png', 2)
  const missing = await generatePortraitDraftFromPayload({ imagePath: filePath }, { pickImagePath: async () => null, getEngine: () => fakeEngine(() => ({}), 'missing').engine, draftRoot: root })
  assert.deepEqual(missing && !missing.accepted && [missing.stage, missing.reasonCode, missing.detail], ['landmarks', R.MODELS_UNAVAILABLE, 'missing'], 'generation needs the landmarks')

  const hands = fakeEngine(() => ({ accepted: false, reasonCode: R.HANDS_NEAR_FACE, detail: null, messageKey: 'settings.pet.portrait_gate.hands_near_face', messageParams: {}, metrics: {} }))
  const rejected = await generatePortraitDraftFromPayload({ imagePath: filePath }, { pickImagePath: async () => null, getEngine: () => hands.engine, draftRoot: root })
  assert.equal(rejected && !rejected.accepted && rejected.reasonCode, R.HANDS_NEAR_FACE)
  await assert.rejects(fs.stat(root), 'no draft directory is created for a rejected image')

  assert.equal(await generatePortraitDraftFromPayload({}, { pickImagePath: async () => null, getEngine: () => hands.engine, draftRoot: root }), null, 'a cancelled picker returns null')
})

test('transparent preview matches the written layer union pixel-for-pixel, including soft alpha and background holes', async () => {
  const filePath = await writeCharacter('character-preview.png', 1)
  const { kp } = paintCharacter()
  const { engine } = fakeEngine(() => accepted(kp))
  const root = path.join(workDir, 'drafts-preview')
  const result = await generatePortraitDraftFromPayload({ imagePath: filePath }, {
    pickImagePath: async () => null,
    getEngine: () => engine,
    getCutoutEngine: () => ({ prepare: async () => ({ status: 'ready' }), evaluate: async (image: object) => {
      const alpha = plainBackgroundAlpha(image)
      for (let i = 0; i < alpha.length; i += 1) if (alpha[i]) alpha[i] = 180
      // A transparent region inside the face must not be filled by the preview.
      for (let y = 290; y < 310; y += 1) for (let x = 290; x < 310; x += 1) alpha[y * 600 + x] = 0
      return { accepted: true, alpha }
    } }),
    draftRoot: root,
  })
  assert.equal(result?.accepted, true)
  if (!result?.accepted) return
  const dir = path.join(root, result.draftId)
  const layerPixels = await Promise.all(['hair', 'head', 'body'].map((name) => sharp(path.join(dir, `${name}.png`)).raw().toBuffer()))
  const preview = await sharp(path.join(dir, 'preview.png')).raw().toBuffer({ resolveWithObject: true })
  assert.deepEqual([preview.info.width, preview.info.height, preview.info.channels], [600, 700, 4])
  let foreground = 0
  for (let i = 0; i < 600 * 700; i += 1) {
    const offset = i * 4
    const alpha = Math.max(...layerPixels.map((data) => data[offset + 3]))
    assert.equal(preview.data[offset + 3], alpha)
    if (!alpha) continue
    foreground += 1
    assert.equal(alpha, 180, 'preview retains soft cutout alpha')
    const layer = layerPixels.find((data) => data[offset + 3] > 0)!
    assert.deepEqual(preview.data.subarray(offset, offset + 3), layer.subarray(offset, offset + 3))
  }
  assert.ok(foreground > 10_000)
  assert.equal(preview.data[3], 0, 'background is transparent, never filled white')
  assert.equal(preview.data[(300 * 600 + 300) * 4 + 3], 0, 'the interior hole remains transparent')
  assert.equal('preview' in result, false, 'IPC result exposes no preview path or pixels')
})

test('only explicit preview opt-in returns the exact bounded PNG just generated, without a filesystem path', async () => {
  const filePath = await writeCharacter('character-inline-preview.png', 1)
  const { kp } = paintCharacter()
  const { engine } = fakeEngine(() => accepted(kp))
  const root = path.join(workDir, 'drafts-inline-preview')
  const result = await generatePortraitDraftFromPayload({ imagePath: filePath }, {
    pickImagePath: async () => null, getEngine: () => engine, getCutoutEngine, draftRoot: root, includePreview: true,
  })
  assert.equal(result?.accepted, true)
  if (!result?.accepted) return
  assert.ok(result.preview)
  assert.deepEqual(normalizePortraitPreview(result.preview), result.preview)
  assert.deepEqual([result.preview.width, result.preview.height], [result.width, result.height])
  const disk = await fs.readFile(path.join(root, result.draftId, 'preview.png'))
  assert.deepEqual(Buffer.from(result.preview.dataUrl.split(',')[1], 'base64'), disk)
  assert.ok(!JSON.stringify(result).includes(root))
  assert.deepEqual(Object.keys(result.preview).sort(), ['dataUrl', 'height', 'width'])
})

test('an invalid opted-in preview fails with the stable error and removes the partial draft', async (t) => {
  const filePath = await writeCharacter('character-invalid-preview.png', 1)
  const { kp } = paintCharacter()
  const { engine } = fakeEngine(() => accepted(kp))
  const root = path.join(workDir, 'drafts-invalid-preview')
  const readFile = fs.readFile
  t.mock.method(fs, 'readFile', async (...args: Parameters<typeof fs.readFile>) => {
    if (path.basename(String(args[0])) === 'preview.png') return Buffer.from('not PNG')
    return readFile(...args)
  })
  await assert.rejects(generatePortraitDraftFromPayload({ imagePath: filePath }, {
    pickImagePath: async () => null, getEngine: () => engine, getCutoutEngine, draftRoot: root, includePreview: true,
  }), { message: 'portrait_draft_write_failed' })
  assert.deepEqual(await fs.readdir(root), [])
})

test('a preview write failure removes the partial draft, preserves unrelated folders, and permits retry', async (t) => {
  const filePath = await writeCharacter('character-write-retry.png', 1)
  const { kp } = paintCharacter()
  const { engine } = fakeEngine(() => accepted(kp))
  const root = path.join(workDir, 'drafts-write-retry')
  await fs.mkdir(path.join(root, 'keep-me'), { recursive: true })
  await fs.writeFile(path.join(root, 'keep-me', 'notes.txt'), 'leave untouched')
  const toFile = sharp.prototype.toFile
  const seen: string[] = []
  const mocked = t.mock.method(sharp.prototype, 'toFile', async function (this: sharp.Sharp, target: string) {
    seen.push(path.basename(target))
    if (path.basename(target) === 'preview.png') throw new Error(`disk failed at ${target}`)
    return toFile.call(this, target)
  })
  const deps = { pickImagePath: async () => null, getEngine: () => engine, getCutoutEngine, draftRoot: root }
  await assert.rejects(generatePortraitDraftFromPayload({ imagePath: filePath }, deps), (error: unknown) => {
    assert.equal((error as Error).message, 'portrait_draft_write_failed')
    assert.equal((error as Error).cause, undefined)
    assert.ok(!String(error).includes(root))
    return true
  })
  assert.deepEqual(seen, ['hair.png', 'head.png', 'body.png', 'preview.png'])
  assert.deepEqual(await fs.readdir(root), ['keep-me'])
  assert.equal(await fs.readFile(path.join(root, 'keep-me', 'notes.txt'), 'utf8'), 'leave untouched')
  mocked.mock.restore()
  const result = await generatePortraitDraftFromPayload({ imagePath: filePath }, deps)
  assert.equal(result?.accepted, true)
  if (result?.accepted) assert.equal((await fs.stat(path.join(root, result.draftId, 'preview.png'))).isFile(), true)
})

test('an atomic manifest publish failure cleans the preview and temporary manifest without exposing private paths', async (t) => {
  const filePath = await writeCharacter('character-manifest-failure.png', 1)
  const { kp } = paintCharacter()
  const { engine } = fakeEngine(() => accepted(kp))
  const root = path.join(workDir, 'drafts-manifest-failure')
  const rename = fs.rename
  let attempted = false
  t.mock.method(fs, 'rename', async (source: string, target: string) => {
    if (target.endsWith('draft.json')) {
      attempted = true
      assert.equal((await fs.stat(source)).isFile(), true)
      throw new Error(`private rename failure: ${source}`)
    }
    return rename(source, target)
  })
  await assert.rejects(generatePortraitDraftFromPayload({ imagePath: filePath }, { pickImagePath: async () => null, getEngine: () => engine, getCutoutEngine, draftRoot: root }), { message: 'portrait_draft_write_failed' })
  assert.equal(attempted, true)
  assert.deepEqual(await fs.readdir(root), [])
})

test(`only the newest ${PORTRAIT_DRAFT_KEEP} drafts are kept; other folders are left alone`, async () => {
  const filePath = await writeCharacter('character-c.png', 2)
  const { kp } = paintCharacter()
  const root = path.join(workDir, 'drafts-c')
  await fs.mkdir(path.join(root, 'keep-me'), { recursive: true })
  const { engine } = fakeEngine(() => accepted(kp.map(([x, y, c]) => [x * 2, y * 2, c])))
  const ids: string[] = []
  for (let i = 0; i < PORTRAIT_DRAFT_KEEP + 2; i += 1) {
    const result = await generatePortraitDraftFromPayload({ imagePath: filePath }, { pickImagePath: async () => null, getEngine: () => engine, getCutoutEngine, draftRoot: root, now: () => 1_700_000_000_000 + i })
    if (result?.accepted) ids.push(result.draftId)
  }
  assert.equal(ids.length, PORTRAIT_DRAFT_KEEP + 2)
  assert.deepEqual((await fs.readdir(root)).sort(), [...ids.slice(-PORTRAIT_DRAFT_KEEP), 'keep-me'].sort())
  assert.equal(resolvePortraitDraftRoot('/u'), path.join('/u', 'portrait-drafts'))
})

test('an old-draft prune failure preserves the new successful preview, logs no private path, and is retried later', async (t) => {
  const filePath = await writeCharacter('character-prune-retry.png', 1)
  const { kp } = paintCharacter()
  const { engine } = fakeEngine(() => accepted(kp))
  const root = path.join(workDir, 'drafts-prune-retry')
  const stale = 'draft-1699999999997-aaaaaaaa'
  for (const name of [stale, 'draft-1699999999998-bbbbbbbb', 'draft-1699999999999-cccccccc', 'keep-me']) await fs.mkdir(path.join(root, name), { recursive: true })
  const rm = fs.rm
  const mocked = t.mock.method(fs, 'rm', async (...args: Parameters<typeof fs.rm>) => {
    if (path.basename(String(args[0])) === stale) throw new Error(`EPERM private path ${args[0]}`)
    return rm(...args)
  })
  const warnings: unknown[][] = []
  t.mock.method(console, 'warn', (...args: unknown[]) => { warnings.push(args) })
  const deps = { pickImagePath: async () => null, getEngine: () => engine, getCutoutEngine, draftRoot: root, includePreview: true }
  const result = await generatePortraitDraftFromPayload({ imagePath: filePath }, { ...deps, now: () => 1_700_000_000_000 })
  assert.equal(result?.accepted, true)
  if (result?.accepted) {
    assert.ok(normalizePortraitPreview(result.preview))
    assert.equal((await fs.stat(path.join(root, result.draftId, 'draft.json'))).isFile(), true)
  }
  assert.deepEqual(warnings, [['portrait_draft_prune_failed']])
  assert.equal((await fs.stat(path.join(root, stale))).isDirectory(), true)
  mocked.mock.restore()
  const next = await generatePortraitDraftFromPayload({ imagePath: filePath }, { ...deps, now: () => 1_700_000_000_001 })
  assert.equal(next?.accepted, true)
  const remaining = await fs.readdir(root)
  assert.equal(remaining.filter((name) => name.startsWith('draft-')).length, PORTRAIT_DRAFT_KEEP)
  assert.equal(remaining.includes('keep-me'), true)
  assert.equal(remaining.includes(stale), false)
})

test('the gate returns landmarks only when asked and only on acceptance', async () => {
  const { rgb, width, height, kp } = paintCharacter()
  const face = { bbox: [180, 160, 420, 420, 0.95], keypoints: kp }
  const detector = { detect: async () => [face] }
  const plain = await evaluatePortraitLandmarks({ rgb, alpha: null, width, height }, detector)
  assert.equal(plain.accepted, true, JSON.stringify(plain))
  assert.equal('keypoints' in plain, false)
  const kept = await evaluatePortraitLandmarks({ rgb, alpha: null, width, height }, detector, { keepKeypoints: true })
  assert.deepEqual(kept.keypoints, kp)
  const blank = await evaluatePortraitLandmarks({ rgb, alpha: null, width, height }, { detect: async () => [] }, { keepKeypoints: true })
  assert.equal('keypoints' in blank, false)
})

test('draft creation stops before disk writes when cutout is missing or its alpha is invalid, and can be retried', async () => {
  const filePath = await writeCharacter('character-cutout-retry.png', 1)
  const { kp } = paintCharacter()
  const { engine } = fakeEngine(() => accepted(kp))
  const root = path.join(workDir, 'drafts-cutout-retry')
  const deps = { pickImagePath: async () => null, getEngine: () => engine, draftRoot: root }
  const missing = await generatePortraitDraftFromPayload({ imagePath: filePath }, deps)
  assert.deepEqual(missing && !missing.accepted && [missing.stage, missing.reasonCode, missing.detail], ['cutout', 'cutout_models_unavailable', 'missing'])
  const invalid = await generatePortraitDraftFromPayload({ imagePath: filePath }, {
    ...deps,
    getCutoutEngine: () => ({ prepare: async () => ({ status: 'ready' }), evaluate: async () => ({ accepted: true, alpha: new Uint8Array(2) }) }),
  })
  assert.deepEqual(invalid && !invalid.accepted && [invalid.stage, invalid.reasonCode], ['cutout', 'cutout_mask_invalid'])
  await assert.rejects(fs.stat(root), 'no partial draft is written on cutout failure')
  const retry = await generatePortraitDraftFromPayload({ imagePath: filePath }, { ...deps, getCutoutEngine })
  assert.equal(retry?.accepted, true)
  assert.equal(retry?.accepted && retry.alphaSource, 'isnet')
})

test('interior background rejection writes no draft, preserves existing drafts, and allows a clean-image retry', async () => {
  const fixture = await writeResidualCharacter('interior-background.png')
  const originalAlpha = fixture.alpha.slice()
  const { engine, calls } = fakeEngine(() => accepted(fixture.kp))
  const root = path.join(workDir, 'drafts-background-retry')
  let cutoutCalls = 0
  const deps = {
    pickImagePath: async () => null, getEngine: () => engine, draftRoot: root,
    getCutoutEngine: () => ({ prepare: async () => ({ status: 'ready' }), evaluate: async () => {
      cutoutCalls += 1
      return { accepted: true, alpha: fixture.alpha }
    } }),
  }
  const expected = { accepted: false, stage: 'cutout', reasonCode: 'busy_background', detail: 'background_residual', messageKey: 'settings.pet.portrait_gate.busy_background', messageParams: {} }
  assert.deepEqual(await generatePortraitDraftFromPayload({ imagePath: fixture.filePath }, deps), expected)
  assert.equal(calls.length, 1, 'the white-border fixture reaches real stage B before the new background check')
  assert.equal(cutoutCalls, 1)
  await assert.rejects(fs.stat(root), { code: 'ENOENT' })
  const old = ['draft-1700000000000-aaaaaaaa', 'draft-1700000000001-bbbbbbbb', 'draft-1700000000002-cccccccc', 'external-not-a-draft']
  for (const name of old) {
    await fs.mkdir(path.join(root, name), { recursive: true })
    await fs.writeFile(path.join(root, name, 'keep.txt'), `preserve ${name}`)
  }
  assert.deepEqual(await generatePortraitDraftFromPayload({ imagePath: fixture.filePath }, deps), expected)
  assert.deepEqual((await fs.readdir(root)).sort(), old)
  for (const name of old) assert.equal(await fs.readFile(path.join(root, name, 'keep.txt'), 'utf8'), `preserve ${name}`)
  assert.deepEqual(fixture.alpha, originalAlpha)
  const clean = await writeCharacter('clean-background-retry.png', 1)
  const retry = await generatePortraitDraftFromPayload({ imagePath: clean }, { ...deps, now: () => 1_700_000_000_100 })
  assert.equal(retry?.accepted, true, JSON.stringify(retry))
  if (!retry?.accepted) return
  assert.equal(retry.alphaSource, 'isnet')
  assert.equal((await fs.stat(path.join(root, retry.draftId, 'draft.json'))).isFile(), true)
  assert.deepEqual((await fs.readdir(root)).sort(), [...old.slice(1), retry.draftId].sort(), 'only the successful retry performs ordinary keep-three pruning')
  assert.deepEqual(fixture.alpha, originalAlpha)
})

test('meaningful native alpha bypasses residual analysis of hidden scenery and preserves the generated transparency', async () => {
  const fixture = await writeResidualCharacter('hidden-interior-background.png', true)
  const { engine } = fakeEngine(() => accepted(fixture.kp))
  const root = path.join(workDir, 'drafts-native-background')
  let cutoutCalls = 0
  const result = await generatePortraitDraftFromPayload({ imagePath: fixture.filePath }, {
    pickImagePath: async () => null, getEngine: () => engine, draftRoot: root,
    getCutoutEngine: () => { cutoutCalls += 1; throw new Error('native transparency must bypass cutout') },
  })
  assert.equal(result?.accepted, true, JSON.stringify(result))
  assert.equal(cutoutCalls, 0)
  if (!result?.accepted) return
  assert.equal(result.alphaSource, 'image')
  const preview = await sharp(path.join(root, result.draftId, 'preview.png')).raw().toBuffer()
  for (let i = 0; i < fixture.alpha.length; i += 1) assert.equal(preview[i * 4 + 3], fixture.alpha[i])
})

test('landmark and cutout failures retain their original priority over residual background rejection', async () => {
  const fixture = await writeResidualCharacter('interior-background-priority.png')
  const root = path.join(workDir, 'drafts-background-priority')
  let cutoutCalls = 0
  const rejected = await generatePortraitDraftFromPayload({ imagePath: fixture.filePath }, {
    pickImagePath: async () => null, draftRoot: root,
    getEngine: () => fakeEngine(() => ({ accepted: false, reasonCode: R.HANDS_NEAR_FACE, detail: null, messageKey: 'settings.pet.portrait_gate.hands_near_face', messageParams: {} })).engine,
    getCutoutEngine: () => { cutoutCalls += 1; throw new Error('landmark rejection must stop first') },
  })
  assert.deepEqual(rejected && !rejected.accepted && [rejected.stage, rejected.reasonCode, rejected.detail], ['landmarks', R.HANDS_NEAR_FACE, null])
  assert.equal(cutoutCalls, 0)
  for (const detail of ['missing', 'invalid', 'timeout', 'invalid_mask']) {
    const result = await generatePortraitDraftFromPayload({ imagePath: fixture.filePath }, {
      pickImagePath: async () => null, draftRoot: root, getEngine: () => fakeEngine(() => accepted(fixture.kp)).engine,
      getCutoutEngine: () => ({
        prepare: async () => ({ status: detail === 'missing' || detail === 'invalid' ? detail : 'ready' }),
        evaluate: async () => detail === 'invalid_mask' ? { accepted: true, alpha: new Uint8Array(2) } : { accepted: false, detail },
      }),
    })
    assert.deepEqual(result && !result.accepted && [result.stage, result.reasonCode, result.detail], ['cutout', detail === 'invalid_mask' ? 'cutout_mask_invalid' : 'cutout_models_unavailable', detail])
  }
  await assert.rejects(fs.stat(root), { code: 'ENOENT' })
})

test('the audit trail records the draft verdict and reason, never paths', () => {
  const ok = summarizePetModelResult('pet-model:generate-portrait-draft', { accepted: true, draftId: 'draft-1', layers: {} })
  assert.equal(ok.gateAccepted, true)
  assert.equal(ok.draftCreated, true)
  const rejected = summarizePetModelResult('pet-model:generate-portrait-draft', { accepted: false, reasonCode: R.HANDS_NEAR_FACE })
  assert.equal(rejected.gateReasonCode, R.HANDS_NEAR_FACE)
  assert.equal(rejected.draftCreated, false)
  assert.equal(summarizePetModelResult('pet-model:generate-portrait-draft', { accepted: false, reasonCode: '/Users/me/a.png' }).gateReasonCode, undefined)
})
