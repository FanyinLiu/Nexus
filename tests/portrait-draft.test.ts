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
import { summarizePetModelResult } from '../electron/ipc/petModelAudit.js'
import { resizeLanczosLikePillow } from '../electron/services/portraitGenerator/cutoutModel.js'
import { PORTRAIT_LANDMARK_GATE_REASONS as R } from '../shared/portraitLandmarkGate.js'
import { PORTRAIT_IMAGE_GATE_MESSAGE_KEYS, PORTRAIT_IMAGE_GATE_REASONS } from '../shared/portraitImageGate.js'
import { PORTRAIT_DRAFT_MESSAGE_KEYS, PORTRAIT_DRAFT_REASONS as D, isPortraitDraftReason } from '../shared/portraitDraft.js'
import { enSettingsWindow } from '../src/i18n/locales/en/settings-window.ts'
import { zhCNSettingsWindow } from '../src/i18n/locales/zh-CN/settings-window.ts'
import { zhTWSettingsWindow } from '../src/i18n/locales/zh-TW/settings-window.ts'
import { jaSettingsWindow } from '../src/i18n/locales/ja/settings-window.ts'
import { koSettingsWindow } from '../src/i18n/locales/ko/settings-window.ts'

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

/** Stand-in for isnet on the flat test image: every pixel that is not near-white is foreground. */
async function stubCutout(image: { rgb: Uint8Array, width: number, height: number }, output: { width: number, height: number }) {
  const resized = resizeLanczosLikePillow(image.rgb, image.width, image.height, 3, output.width, output.height)
  const mask = new Uint8Array(output.width * output.height)
  for (let i = 0; i < mask.length; i += 1) mask[i] = Math.min(resized[i * 3], resized[i * 3 + 1], resized[i * 3 + 2]) < 240 ? 255 : 0
  return { ok: true, mask }
}

/** Engine stub: answers like the worker would, with landmarks in raster pixels. */
function fakeEngine(verdictFor: (image: { width: number, height: number }) => object, status = 'ready') {
  const calls: Array<{ width: number, height: number, options: unknown }> = []
  return {
    calls,
    engine: {
      prepare: async () => ({ status }),
      evaluate: async (image: { width: number, height: number }, options: unknown) => { calls.push({ width: image.width, height: image.height, options }); return verdictFor(image) },
      prepareCutout: async () => ({ status: 'ready' }),
      cutout: stubCutout,
    },
  }
}

const accepted = (keypoints: number[][]) => ({ accepted: true, reasonCode: null, detail: null, messageKey: 'settings.pet.portrait_gate.accepted', messageParams: {}, metrics: { faces: 1 }, keypoints })

test('generation: gate -> cutout -> landmarks (original px) -> hair/head/body PNGs + draft.json, result without paths', async () => {
  const filePath = await writeCharacter('character.png')
  const { kp } = paintCharacter()
  const root = path.join(workDir, 'drafts-a')
  const { engine, calls } = fakeEngine((image) => {
    const k = image.width / 2400
    return accepted(kp.map(([x, y, c]) => [x * 4 * k, y * 4 * k, c]))
  })
  const result = await generatePortraitDraftFromPayload({ imagePath: filePath }, { pickImagePath: async () => null, getEngine: () => engine, draftRoot: root, now: () => 1_700_000_000_000 })
  assert.equal(result?.accepted, true, JSON.stringify(result))
  if (!result?.accepted) return
  assert.deepEqual(calls.map((c) => c.options), [{ keepKeypoints: true }])
  assert.equal(calls[0].width, 1755, 'the landmark raster is downsized to 2048 px')
  assert.match(result.draftId, /^draft-1700000000000-[0-9a-f]{8}$/)
  assert.deepEqual([result.width, result.height], [658, 768])
  assert.equal(result.alphaSource, 'cutout')
  assert.equal(result.cutout.status, 'ok')
  assert.ok(result.layers.hair.share > 0.1 && result.layers.head.share > 0.1 && result.layers.body.share > 0.1, JSON.stringify(result.layers))
  assert.ok(!JSON.stringify(result).includes(workDir), 'no paths in the result')

  const dir = path.join(root, result.draftId)
  assert.deepEqual((await fs.readdir(dir)).sort(), ['body.png', 'draft.json', 'hair.png', 'head.png'])
  for (const name of ['hair', 'head', 'body']) {
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
  assert.deepEqual(manifest.cutout, result.cutout)
  assert.ok(Number.isInteger(manifest.timingsMs.cutout) && Number.isInteger(manifest.timingsMs.landmarks) && Number.isInteger(manifest.timingsMs.layers), JSON.stringify(manifest.timingsMs))
  assert.deepEqual(Object.keys(manifest.layers), ['hair', 'head', 'body'])
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
  assert.deepEqual(missing && !missing.accepted && [missing.stage, missing.reasonCode, missing.detail, missing.messageKey], ['models', D.MODELS_NOT_DOWNLOADED, 'face_models_missing', PORTRAIT_DRAFT_MESSAGE_KEYS.portrait_models_not_downloaded], 'generation needs the face models: download them')
  const damaged = await generatePortraitDraftFromPayload({ imagePath: filePath }, { pickImagePath: async () => null, getEngine: () => fakeEngine(() => ({}), 'invalid').engine, draftRoot: root })
  assert.deepEqual(damaged && !damaged.accepted && [damaged.reasonCode, damaged.detail], [D.MODELS_NOT_DOWNLOADED, 'face_models_invalid'])
  const noRuntime = await generatePortraitDraftFromPayload({ imagePath: filePath }, { pickImagePath: async () => null, getEngine: () => fakeEngine(() => ({}), 'runtime_unavailable').engine, draftRoot: root })
  assert.deepEqual(noRuntime && !noRuntime.accepted && [noRuntime.stage, noRuntime.reasonCode], ['landmarks', R.MODELS_UNAVAILABLE], 'a missing runtime is not a download problem')

  const hands = fakeEngine(() => ({ accepted: false, reasonCode: R.HANDS_NEAR_FACE, detail: null, messageKey: 'settings.pet.portrait_gate.hands_near_face', messageParams: {}, metrics: {} }))
  const rejected = await generatePortraitDraftFromPayload({ imagePath: filePath }, { pickImagePath: async () => null, getEngine: () => hands.engine, draftRoot: root })
  assert.equal(rejected && !rejected.accepted && rejected.reasonCode, R.HANDS_NEAR_FACE)
  await assert.rejects(fs.stat(root), 'no draft directory is created for a rejected image')

  assert.equal(await generatePortraitDraftFromPayload({}, { pickImagePath: async () => null, getEngine: () => hands.engine, draftRoot: root }), null, 'a cancelled picker returns null')
})

type Size = { width: number, height: number }
type Raster = { rgb: Uint8Array, width: number, height: number }

/**
 * Engine stub with the cutout API. Its "model" marks every pixel that is
 * not near-white as foreground (stands in for isnet on the flat test image);
 * `events` records the order in which the stages ran.
 */
function cutoutEngine(verdictFor: (image: Size) => object, overrides: Record<string, unknown> = {}) {
  const events: string[] = []
  const engine = {
    prepare: async () => { events.push('prepare'); return { status: 'ready' } },
    evaluate: async (image: Size) => { events.push('landmarks'); return verdictFor(image) },
    prepareCutout: async () => { events.push('prepareCutout'); return { status: 'ready' } },
    cutout: async (image: Raster, output: Size) => {
      events.push(`cutout:${image.width}x${image.height}->${output.width}x${output.height}`)
      const resized = resizeLanczosLikePillow(image.rgb, image.width, image.height, 3, output.width, output.height)
      const mask = new Uint8Array(output.width * output.height)
      for (let i = 0; i < mask.length; i += 1) mask[i] = Math.min(resized[i * 3], resized[i * 3 + 1], resized[i * 3 + 2]) < 240 ? 255 : 0
      return { ok: true, mask }
    },
    ...overrides,
  }
  return { engine, events }
}

const scaledVerdict = (kp: number[][], factor: number, originalWidth: number) => (image: Size) => {
  const k = image.width / originalWidth
  return accepted(kp.map(([x, y, c]) => [x * factor * k, y * factor * k, c]))
}

test('generation with the cutout: gate -> cutout (full-size RGB in, working-size mask out) -> landmarks -> layers cut with the isnet mask', async () => {
  const filePath = await writeCharacter('character-cut.png', 2)
  const { kp } = paintCharacter()
  const root = path.join(workDir, 'drafts-cut')
  const { engine, events } = cutoutEngine(scaledVerdict(kp, 2, 1200))
  const result = await generatePortraitDraftFromPayload({ imagePath: filePath }, { pickImagePath: async () => null, getEngine: () => engine, draftRoot: root })
  assert.equal(result?.accepted, true, JSON.stringify(result))
  if (!result?.accepted) return
  assert.deepEqual(events, ['prepare', 'prepareCutout', 'cutout:1200x1400->658x768', 'prepare', 'landmarks'], 'face models checked first, then cutout, then landmarks')
  assert.equal(result.alphaSource, 'cutout')
  assert.equal(result.cutout.status, 'ok')
  assert.ok(result.cutout.foreground && result.cutout.foreground > 0.3 && result.cutout.foreground < 0.8, JSON.stringify(result.cutout))
  assert.ok(result.layers.hair.share > 0.1 && result.layers.head.share > 0.1 && result.layers.body.share > 0.1, JSON.stringify(result.layers))
  const manifest = JSON.parse(await fs.readFile(path.join(root, result.draftId, 'draft.json'), 'utf8'))
  assert.equal(manifest.alphaSource, 'cutout')
  assert.deepEqual(manifest.cutout, result.cutout)
  assert.ok(Number.isInteger(manifest.timingsMs.cutout), JSON.stringify(manifest.timingsMs))
  const { data } = await sharp(path.join(root, result.draftId, 'head.png')).raw().toBuffer({ resolveWithObject: true })
  assert.equal(data[(Math.round(300 * 768 / 700) * 658 + Math.round(300 * 658 / 600)) * 4 + 3], 255, 'face centre opaque')
  assert.equal(data[(10 * 658 + 10) * 4 + 3], 0, 'background transparent')
})

test('when unsure, reject: failing or untrusted cutouts give background_not_separable, a missing cutout model asks for the download, nothing is written', async () => {
  const filePath = await writeCharacter('character-noseparate.png', 2)
  const { kp } = paintCharacter()
  const root = path.join(workDir, 'drafts-noseparate')
  const cases: Array<[string, string, string, Record<string, unknown>]> = [
    ['models', D.MODELS_NOT_DOWNLOADED, 'cutout_model_missing', { prepareCutout: async () => ({ status: 'missing' }) }],
    ['models', D.MODELS_NOT_DOWNLOADED, 'cutout_model_invalid', { prepareCutout: async () => ({ status: 'invalid' }) }],
    ['cutout', D.BACKGROUND_NOT_SEPARABLE, 'runtime_unavailable', { prepareCutout: undefined, cutout: undefined }],
    ['cutout', D.BACKGROUND_NOT_SEPARABLE, 'timeout', { cutout: async () => ({ ok: false, code: 'timeout' }) }],
    ['cutout', D.BACKGROUND_NOT_SEPARABLE, 'load_failed', { cutout: async () => ({ ok: false, code: 'load_failed' }) }],
    ['cutout', D.BACKGROUND_NOT_SEPARABLE, 'analysis_failed', { cutout: async () => { throw new Error('boom') } }],
    ['cutout', D.BACKGROUND_NOT_SEPARABLE, 'empty', { cutout: async (_image: Raster, output: Size) => ({ ok: true, mask: new Uint8Array(output.width * output.height) }) }],
    ['cutout', D.BACKGROUND_NOT_SEPARABLE, 'empty', { cutout: async (_image: Raster, output: Size) => ({ ok: true, mask: new Uint8Array(output.width * output.height).fill(255) }) }],
  ]
  for (const [stage, reasonCode, detail, overrides] of cases) {
    const { engine, events } = cutoutEngine(scaledVerdict(kp, 2, 1200), overrides)
    const result = await generatePortraitDraftFromPayload({ imagePath: filePath }, { pickImagePath: async () => null, getEngine: () => engine, draftRoot: root })
    assert.deepEqual(result && !result.accepted && [result.stage, result.reasonCode, result.detail, result.messageKey], [stage, reasonCode, detail, PORTRAIT_DRAFT_MESSAGE_KEYS[reasonCode as keyof typeof PORTRAIT_DRAFT_MESSAGE_KEYS]], detail)
    assert.ok(!events.includes('landmarks'), `${detail}: the landmarks never run after a failed cutout`)
  }
  await assert.rejects(fs.stat(root), 'no plain-background draft is ever written')
})

test('a plain border around a busy interior: a faded figure left outside the cutout is busy_background (stage cutout), nothing is written', async () => {
  const { rgb, width, height, kp } = paintCharacter()
  // a faded close-up of the character behind it, on the left; the border stays plain white
  for (let y = 40; y < 520; y += 1) for (let x = 20; x < 150; x += 1) rgb.set([250, 232, 216], (y * width + x) * 3)
  const filePath = path.join(workDir, 'character-ghost.png')
  await sharp(Buffer.from(rgb), { raw: { width, height, channels: 3 } }).resize(width * 2, height * 2, { kernel: 'nearest' }).png().toFile(filePath)
  const root = path.join(workDir, 'drafts-ghost')
  // isnet keeps the character and drops the faded figure
  const { engine, events } = cutoutEngine(scaledVerdict(kp, 2, 1200), {
    cutout: async (image: Raster, output: Size) => {
      const resized = resizeLanczosLikePillow(image.rgb, image.width, image.height, 3, output.width, output.height)
      const mask = new Uint8Array(output.width * output.height)
      for (let i = 0; i < mask.length; i += 1) {
        const x = i % output.width
        mask[i] = x > output.width * 0.27 && Math.min(resized[i * 3], resized[i * 3 + 1], resized[i * 3 + 2]) < 240 ? 255 : 0
      }
      return { ok: true, mask }
    },
  })
  const result = await generatePortraitDraftFromPayload({ imagePath: filePath }, { pickImagePath: async () => null, getEngine: () => engine, draftRoot: root })
  const busy = PORTRAIT_IMAGE_GATE_REASONS.BUSY_BACKGROUND
  assert.deepEqual(result && !result.accepted && [result.stage, result.reasonCode, result.detail, result.messageKey], ['cutout', busy, 'background_residual', PORTRAIT_IMAGE_GATE_MESSAGE_KEYS[busy]], JSON.stringify(result))
  assert.ok(!events.includes('landmarks'), 'the landmarks never run')
  await assert.rejects(fs.stat(root), 'no draft is written')
})

test('draft reasons have copy in all five locales, and the audit trail knows them', () => {
  const tables = { enSettingsWindow, zhCNSettingsWindow, zhTWSettingsWindow, jaSettingsWindow, koSettingsWindow }
  for (const code of Object.values(D)) {
    assert.equal(isPortraitDraftReason(code), true)
    const key = PORTRAIT_DRAFT_MESSAGE_KEYS[code]
    for (const [locale, table] of Object.entries(tables)) assert.ok((table as Record<string, string>)[key], `${key} needs ${locale} copy`)
    assert.equal(summarizePetModelResult('pet-model:generate-portrait-draft', { accepted: false, reasonCode: code }).gateReasonCode, code)
  }
  assert.equal((zhCNSettingsWindow as Record<string, string>)[PORTRAIT_DRAFT_MESSAGE_KEYS.background_not_separable], '背景分不干净，请换一张纯色或透明背景的立绘')
  assert.match((enSettingsWindow as Record<string, string>)[PORTRAIT_DRAFT_MESSAGE_KEYS.background_not_separable], /plain or transparent background/)
  assert.match((enSettingsWindow as Record<string, string>)[PORTRAIT_DRAFT_MESSAGE_KEYS.portrait_models_not_downloaded], /Download/)
  assert.equal(isPortraitDraftReason('plain_background'), false)
})

test('transparent inputs keep their own alpha and never run the cutout; missing face models stop before the cutout runs', async () => {
  const { rgb, width, height, kp } = paintCharacter()
  const rgba = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i += 1) {
    rgba.set(rgb.subarray(i * 3, i * 3 + 3), i * 4)
    rgba[i * 4 + 3] = rgb[i * 3] === 255 && rgb[i * 3 + 1] === 255 && rgb[i * 3 + 2] === 255 ? 0 : 255
  }
  const filePath = path.join(workDir, 'transparent.png')
  await sharp(Buffer.from(rgba), { raw: { width, height, channels: 4 } }).png().toFile(filePath)
  const root = path.join(workDir, 'drafts-transparent')
  const own = cutoutEngine(scaledVerdict(kp, 1, 600))
  const result = await generatePortraitDraftFromPayload({ imagePath: filePath }, { pickImagePath: async () => null, getEngine: () => own.engine, draftRoot: root })
  assert.equal(result?.accepted, true, JSON.stringify(result))
  assert.equal(result?.accepted && result.alphaSource, 'image')
  assert.deepEqual(result?.accepted && result.cutout, { status: 'skipped_transparent' })
  assert.ok(!own.events.some((e) => e.startsWith('cutout') || e === 'prepareCutout'), own.events.join(','))

  const opaque = await writeCharacter('character-nomodels.png', 2)
  const noFaces = cutoutEngine(() => { throw new Error('not reached') }, { prepare: async () => ({ status: 'missing' }) })
  const stopped = await generatePortraitDraftFromPayload({ imagePath: opaque }, { pickImagePath: async () => null, getEngine: () => noFaces.engine, draftRoot: root })
  assert.deepEqual(stopped && !stopped.accepted && [stopped.stage, stopped.reasonCode, stopped.detail], ['models', D.MODELS_NOT_DOWNLOADED, 'face_models_missing'])
  assert.deepEqual(noFaces.events, [], 'no cutout work when the landmarks cannot run')

  const rejecting = cutoutEngine(() => ({ accepted: false, reasonCode: R.HANDS_NEAR_FACE, detail: null, messageKey: 'settings.pet.portrait_gate.hands_near_face', messageParams: {}, metrics: {} }))
  const rejectRoot = path.join(workDir, 'drafts-rejected-after-cutout')
  const rejected = await generatePortraitDraftFromPayload({ imagePath: opaque }, { pickImagePath: async () => null, getEngine: () => rejecting.engine, draftRoot: rejectRoot })
  assert.equal(rejected && !rejected.accepted && rejected.reasonCode, R.HANDS_NEAR_FACE)
  await assert.rejects(fs.stat(rejectRoot), 'a landmark rejection after the cutout writes nothing')
})

test(`only the newest ${PORTRAIT_DRAFT_KEEP} drafts are kept; other folders are left alone`, async () => {
  const filePath = await writeCharacter('character-c.png', 2)
  const { kp } = paintCharacter()
  const root = path.join(workDir, 'drafts-c')
  await fs.mkdir(path.join(root, 'keep-me'), { recursive: true })
  const { engine } = fakeEngine(() => accepted(kp.map(([x, y, c]) => [x * 2, y * 2, c])))
  const ids: string[] = []
  for (let i = 0; i < PORTRAIT_DRAFT_KEEP + 2; i += 1) {
    const result = await generatePortraitDraftFromPayload({ imagePath: filePath }, { pickImagePath: async () => null, getEngine: () => engine, draftRoot: root, now: () => 1_700_000_000_000 + i })
    if (result?.accepted) ids.push(result.draftId)
  }
  assert.equal(ids.length, PORTRAIT_DRAFT_KEEP + 2)
  assert.deepEqual((await fs.readdir(root)).sort(), [...ids.slice(-PORTRAIT_DRAFT_KEEP), 'keep-me'].sort())
  assert.equal(resolvePortraitDraftRoot('/u'), path.join('/u', 'portrait-drafts'))
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

test('the audit trail records the draft verdict and reason, never paths', () => {
  const ok = summarizePetModelResult('pet-model:generate-portrait-draft', { accepted: true, draftId: 'draft-1', layers: {} })
  assert.equal(ok.gateAccepted, true)
  assert.equal(ok.draftCreated, true)
  const rejected = summarizePetModelResult('pet-model:generate-portrait-draft', { accepted: false, reasonCode: R.HANDS_NEAR_FACE })
  assert.equal(rejected.gateReasonCode, R.HANDS_NEAR_FACE)
  assert.equal(rejected.draftCreated, false)
  assert.equal(summarizePetModelResult('pet-model:generate-portrait-draft', { accepted: false, reasonCode: '/Users/me/a.png' }).gateReasonCode, undefined)
})
