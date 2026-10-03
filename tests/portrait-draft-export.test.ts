import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import sharp from 'sharp'
import {
  extractPortraitDraftExportErrorCode,
  isPortraitDraftId,
  normalizePortraitDraftExportPayload,
  PORTRAIT_DRAFT_EXPORT_ERROR_CODES as ERRORS,
  PORTRAIT_DRAFT_EXPORT_LIMITS,
  PORTRAIT_DRAFT_EXPORT_MESSAGE_KEY,
} from '../shared/portraitDraftExport.js'
import { exportPortraitDraftFromPayload } from '../electron/services/portraitGenerator/portraitDraftExport.js'
import { extractSpritePetZipArchive, readSpritePetPackage } from '../electron/services/spritePetPackage.js'
import { deformPortraitPuppetPoint, planPortraitPuppetPose } from '../src/features/pet/portraitPuppet.ts'

const draftId = 'draft-1700000000000-1234abcd'
let workDir = ''
before(async () => { workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-portrait-export-')) })
after(async () => { if (workDir) await fs.rm(workDir, { recursive: true, force: true }) })

async function fixture() {
  const directory = await fs.mkdtemp(path.join(workDir, 'case-'))
  const draftRoot = path.join(directory, 'drafts')
  const draft = path.join(draftRoot, draftId)
  await fs.mkdir(draft, { recursive: true })
  const png = await sharp({ create: { width: 24, height: 32, channels: 4, background: { r: 80, g: 100, b: 160, alpha: 0.5 } } }).png().toBuffer()
  await fs.writeFile(path.join(draft, 'preview.png'), png)
  const manifest = { version: 1, draftId, width: 24, height: 32, preview: 'preview.png', layers: { hair: { file: 'hair.png' } } }
  await fs.writeFile(path.join(draft, 'draft.json'), JSON.stringify(manifest))
  const destination = path.join(directory, 'portrait.zip')
  return { directory, draftRoot, draft, manifest, png, destination,
    deps: { draftRoot, chooseArchivePath: async () => destination } }
}

async function assertClean(directory: string, destination: string) {
  assert.equal((await fs.readdir(directory)).some((name) => name.startsWith('.nexus-portrait-export-')), false)
  await assert.rejects(fs.stat(destination), { code: 'ENOENT' })
}

test('export payload validates an opaque draft id and preserves bounded attribution without accepting paths', () => {
  assert.equal(isPortraitDraftId(draftId), true)
  const attributionText = '  Artist: Example\nSource: https://example.test/art\nLicense: CC BY-SA 3.0\n'
  assert.deepEqual(normalizePortraitDraftExportPayload({ draftId, displayName: '  A portrait  ', attributionText }), {
    draftId, displayName: 'A portrait', attributionText,
  })
  for (const value of [null, [], {}, { draftId: '../other' }, { draftId: `/${draftId}` }, { draftId: `${draftId}/preview.png` },
    { draftId, imagePath: '/private/source.png' }, { draftId, targetPath: '/private/result.zip' },
    { draftId, displayName: 3 }, { draftId, attributionText: [] }, { draftId, attributionText: 'a\0b' },
    { draftId, displayName: 'a'.repeat(121) }, { draftId, attributionText: 'a'.repeat(8193) }]) {
    assert.equal(normalizePortraitDraftExportPayload(value), null)
  }
  assert.ok(normalizePortraitDraftExportPayload({ draftId, displayName: 'a'.repeat(120), attributionText: 'a'.repeat(8192) }))
})

test('export error tokens survive Electron wrapping without returning arbitrary error text', () => {
  for (const code of Object.values(ERRORS)) {
    assert.equal(extractPortraitDraftExportErrorCode(new Error(code)), code)
    assert.equal(extractPortraitDraftExportErrorCode(`Error invoking remote method 'pet-model:export-portrait-draft': Error: ${code}`), code)
  }
  for (const value of [null, 'Permission denied at /private/file', 'portrait_draft_export_unknown', 'portrait_draft_export_invalid_more']) {
    assert.equal(extractPortraitDraftExportErrorCode(value), null)
  }
})

test('cancelled save dialog performs no draft access and invalid payload never opens the dialog', async () => {
  let choices = 0
  const deps = { draftRoot: path.join(workDir, 'does-not-exist'), chooseArchivePath: async () => { choices += 1; return null } }
  assert.equal(await exportPortraitDraftFromPayload({ draftId }, deps), null)
  assert.equal(choices, 1)
  await assert.rejects(exportPortraitDraftFromPayload({ draftId: '../other' }, deps), { message: ERRORS.INVALID })
  assert.equal(choices, 1)
})

test('export writes a round-trippable static format-2 archive with only preview and explicit attribution', async () => {
  const f = await fixture()
  await fs.writeFile(path.join(f.draft, 'hair.png'), 'unreviewed layer must not be exported')
  await fs.writeFile(path.join(f.draft, 'private-original.png'), 'private source must not be exported')
  const attributionText = 'Kasuga — Wikipe-tan\nhttps://commons.wikimedia.org/wiki/File:Wikipe-tan_full_length.png\nCC BY-SA 3.0\nExample attribution supplied by this synthetic test; no third-party pixels are bundled.\n'
  let requestedName = ''
  const result = await exportPortraitDraftFromPayload({ draftId, displayName: 'Static example', attributionText }, {
    ...f.deps, chooseArchivePath: async ({ defaultFileName }) => { requestedName = defaultFileName; return f.destination },
  })
  assert.equal(requestedName, `${draftId}.nexus-portrait.zip`)
  assert.deepEqual(result, { exported: true, formatVersion: 2, static: true, width: 24, height: 32, fileName: 'portrait.zip', messageKey: PORTRAIT_DRAFT_EXPORT_MESSAGE_KEY })
  assert.ok(!JSON.stringify(result).includes(workDir))
  const extracted = path.join(f.directory, 'extracted')
  const { manifestPath } = await extractSpritePetZipArchive(f.destination, extracted)
  assert.deepEqual((await fs.readdir(path.dirname(manifestPath))).sort(), ['ATTRIBUTION.txt', 'README.txt', 'pet.json', 'portrait.png'])
  assert.equal(await fs.readFile(path.join(extracted, 'ATTRIBUTION.txt'), 'utf8'), attributionText)
  const rawManifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  assert.equal(rawManifest.kind, 'portrait-puppet')
  assert.equal(rawManifest.formatVersion, 2)
  assert.equal(rawManifest.rig.motionIntensity, 0)
  for (const key of ['renderMode', 'parts', 'layers', 'sourcePath', 'gate']) assert.equal(key in rawManifest, false)
  const loaded = await readSpritePetPackage(manifestPath)
  assert.equal(loaded.formatVersion, 2)
  assert.equal(loaded.rig.motionIntensity, 0)
  assert.equal(loaded.renderMode, undefined)
  assert.deepEqual(loaded.sourceLayerPaths, {})
  assert.deepEqual(await sharp(loaded.sourcePortraitPath).raw().toBuffer(), await sharp(f.png).raw().toBuffer())
  assert.deepEqual(await fs.readFile(path.join(f.draft, 'preview.png')), f.png, 'export must not modify the source draft')
  assert.equal((await fs.readdir(f.directory)).some((name) => name.startsWith('.nexus-portrait-export-')), false)
})

for (const metadataVersion of [undefined, 1, 999]) {
  const variant = metadataVersion === undefined ? 'legacy v1 without metadata' : `v1 with metadata version ${metadataVersion}`
  test(`${variant} exports and imports unchanged static pixels without private draft metadata`, async () => {
    const f = await fixture()
    const originalPath = path.join(f.directory, 'private-original-sentinel.png')
    const privateSource = 'https://private.example.test/original?token=source-secret-sentinel'
    const secret = 'private-metadata-secret-sentinel'
    const metadata = {
      version: metadataVersion,
      sourcePath: originalPath,
      provenance: { source: privateSource, secret },
      landmarks: [{ x: 0.123456789, y: 0.987654321, label: 'private-point-sentinel' }],
      preview: 'private-original.png',
      width: 512,
      height: 512,
      formatVersion: 99,
      rig: { motionIntensity: 1 },
    }
    const draftManifest = { ...f.manifest, ...(metadataVersion === undefined ? {} : { metadata }) }
    const committed = JSON.stringify(draftManifest)
    await fs.writeFile(path.join(f.draft, 'draft.json'), committed)
    await fs.writeFile(originalPath, secret)
    await fs.writeFile(path.join(f.draft, 'private-original.png'), secret)
    await fs.writeFile(path.join(f.draft, 'hair.png'), secret)
    const pixels = Buffer.alloc(24 * 32 * 4)
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const index = offset / 4
      pixels[offset] = index % 251
      pixels[offset + 1] = Math.floor(index / 24) * 7
      pixels[offset + 2] = (index * 13) % 256
      pixels[offset + 3] = [0, 128, 255][index % 3]
    }
    const png = await sharp(pixels, { raw: { width: 24, height: 32, channels: 4 } }).png().toBuffer()
    await fs.writeFile(path.join(f.draft, 'preview.png'), png)

    const result = await exportPortraitDraftFromPayload({ draftId }, f.deps)
    assert.equal(result?.static, true)
    assert.equal(result?.formatVersion, 2)
    assert.equal(result?.width, 24)
    assert.equal(result?.height, 32)
    const extracted = path.join(f.directory, 'extracted')
    const { manifestPath } = await extractSpritePetZipArchive(f.destination, extracted)
    const files = (await fs.readdir(extracted)).sort()
    assert.deepEqual(files, ['README.txt', 'pet.json', 'portrait.png'])
    const rawManifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
    assert.deepEqual(Object.keys(rawManifest).sort(), ['description', 'displayName', 'formatVersion', 'id', 'kind', 'portraitPath', 'rig'])
    assert.equal(rawManifest.formatVersion, 2)
    assert.equal(rawManifest.rig.motionIntensity, 0)
    const loaded = await readSpritePetPackage(manifestPath)
    assert.equal(loaded.formatVersion, 2)
    assert.equal(loaded.rig.motionIntensity, 0)
    assert.equal(loaded.renderMode, undefined)
    assert.deepEqual(loaded.sourceLayerPaths, {})
    assert.deepEqual(await sharp(loaded.sourcePortraitPath).raw().toBuffer(), pixels)
    for (const file of files) {
      const contents = await fs.readFile(path.join(extracted, file))
      for (const sentinel of [originalPath, privateSource, secret, 'private-point-sentinel', 'private-original.png', 'landmarks', 'provenance']) {
        assert.equal(contents.includes(Buffer.from(sentinel)), false, `${file} must not contain ${sentinel}`)
      }
    }
    assert.deepEqual(await fs.readFile(path.join(f.draft, 'preview.png')), png)
    assert.equal(await fs.readFile(path.join(f.draft, 'draft.json'), 'utf8'), committed)
    assert.equal(await fs.readFile(originalPath, 'utf8'), secret)
  })
}

test('zero-intensity exported rig keeps source geometry static across mood, speech and gaze inputs', async () => {
  const f = await fixture()
  await exportPortraitDraftFromPayload({ draftId }, f.deps)
  const { manifest } = await extractSpritePetZipArchive(f.destination, path.join(f.directory, 'extracted'))
  for (const mood of ['idle', 'happy', 'sleepy', 'thinking'] as const) {
    for (const nowMs of [0, 1234, 5678]) {
      const pose = planPortraitPuppetPose({ mood, nowMs, isSpeaking: true, speechLevel: 1, gazeX: 1, gazeY: -1 })
      for (const point of [{ x: .1, y: .1 }, { x: .4, y: .22 }, { x: .5, y: .255 }, { x: .9, y: .85 }]) {
        const actual = deformPortraitPuppetPoint(point, pose, manifest.rig, 24 / 32)
        assert.ok(Math.abs(actual.x - point.x) < 1e-12 && Math.abs(actual.y - point.y) < 1e-12)
      }
    }
  }
})

test('export strips image metadata and never invents attribution for a user image', async () => {
  const f = await fixture()
  const tagged = await sharp(f.png).withMetadata({ exif: { IFD0: { ImageDescription: '/private/original-file.png' } } }).png().toBuffer()
  await fs.writeFile(path.join(f.draft, 'preview.png'), tagged)
  await exportPortraitDraftFromPayload({ draftId }, f.deps)
  const { manifestPath, manifest } = await extractSpritePetZipArchive(f.destination, path.join(f.directory, 'extracted'))
  const metadata = await sharp(manifest.sourcePortraitPath).metadata()
  assert.equal(metadata.exif, undefined)
  assert.equal(metadata.icc, undefined)
  assert.equal(metadata.xmp, undefined)
  assert.equal((await fs.readdir(path.dirname(manifestPath))).includes('ATTRIBUTION.txt'), false)
})

test('missing or pruned draft returns the stable unavailable result without creating an output', async () => {
  const f = await fixture()
  await fs.rm(f.draft, { recursive: true })
  await assert.rejects(exportPortraitDraftFromPayload({ draftId }, f.deps), { message: ERRORS.UNAVAILABLE })
  await assertClean(f.directory, f.destination)
})

test('root, draft, manifest and preview symlinks are rejected without reading their target', async () => {
  for (const target of ['root', 'draft', 'draft.json', 'preview.png']) {
    const f = await fixture()
    const source = target === 'root' ? f.draftRoot : target === 'draft' ? f.draft : path.join(f.draft, target)
    const outside = path.join(f.directory, 'outside')
    await fs.rename(source, outside)
    await fs.symlink(outside, source, target === 'root' || target === 'draft' ? 'dir' : 'file')
    await assert.rejects(exportPortraitDraftFromPayload({ draftId }, f.deps), { message: ERRORS.INVALID }, target)
    await assertClean(f.directory, f.destination)
  }
})

test('manifest must be bounded, committed, matching the selected id and fixed preview name', async () => {
  for (const patch of [{ version: 2 }, { draftId: 'draft-1700000000000-deadbeef' }, { preview: '../private.png' },
    { width: 0 }, { height: 769 }, { width: 2.5 }, { width: '24' }, { width: 25 }]) {
    const f = await fixture()
    await fs.writeFile(path.join(f.draft, 'draft.json'), JSON.stringify({ ...f.manifest, ...patch }))
    await assert.rejects(exportPortraitDraftFromPayload({ draftId }, f.deps), { message: ERRORS.INVALID })
    await assertClean(f.directory, f.destination)
  }
  for (const contents of ['{bad json', 'null', '[]', ' '.repeat(PORTRAIT_DRAFT_EXPORT_LIMITS.manifestBytes + 1)]) {
    const f = await fixture()
    await fs.writeFile(path.join(f.draft, 'draft.json'), contents)
    await assert.rejects(exportPortraitDraftFromPayload({ draftId }, f.deps), { message: ERRORS.INVALID })
  }
})

test('PNG must decode as bounded nonempty RGBA pixels with meaningful transparency', async () => {
  const transparent = await sharp({ create: { width: 24, height: 32, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer()
  const opaque = await sharp({ create: { width: 24, height: 32, channels: 4, background: '#ff0000' } }).png().toBuffer()
  const rgb = await sharp(opaque).removeAlpha().png().toBuffer()
  for (const bytes of [transparent, opaque, rgb, Buffer.from('not a PNG'), Buffer.alloc(3 * 1024 * 1024 + 1)]) {
    const f = await fixture()
    await fs.writeFile(path.join(f.draft, 'preview.png'), bytes)
    await assert.rejects(exportPortraitDraftFromPayload({ draftId }, f.deps), { message: ERRORS.INVALID })
    await assertClean(f.directory, f.destination)
  }
})

test('corrupt compressed pixels fail even if the PNG framing and dimensions are plausible', async () => {
  const f = await fixture()
  const corrupt = Buffer.from(f.png)
  let offset = 8
  while (offset < corrupt.length) {
    const length = corrupt.readUInt32BE(offset)
    if (corrupt.toString('ascii', offset + 4, offset + 8) === 'IDAT') { corrupt.fill(0xff, offset + 8, offset + 8 + length); break }
    offset += length + 12
  }
  await fs.writeFile(path.join(f.draft, 'preview.png'), corrupt)
  await assert.rejects(exportPortraitDraftFromPayload({ draftId }, f.deps), { message: ERRORS.INVALID })
  await assertClean(f.directory, f.destination)
})

test('existing destination files, directories and symlinks are never overwritten', async () => {
  for (const type of ['file', 'directory', 'symlink']) {
    const f = await fixture()
    const sentinel = path.join(f.directory, 'sentinel')
    await fs.writeFile(sentinel, 'keep me')
    if (type === 'file') await fs.writeFile(f.destination, 'keep me')
    else if (type === 'directory') await fs.mkdir(f.destination)
    else await fs.symlink(sentinel, f.destination)
    await assert.rejects(exportPortraitDraftFromPayload({ draftId }, f.deps), { message: ERRORS.EXISTS })
    assert.equal(await fs.readFile(sentinel, 'utf8'), 'keep me')
    if (type === 'file' || type === 'symlink') assert.equal(await fs.readFile(f.destination, 'utf8'), 'keep me')
    assert.equal((await fs.readdir(f.directory)).some((name) => name.startsWith('.nexus-portrait-export-')), false)
  }
})

test('an atomic publication collision preserves the competing file and removes staged output', async (t) => {
  const f = await fixture()
  const link = fs.link
  t.mock.method(fs, 'link', async (source, destination) => {
    await fs.writeFile(destination, 'arrived after initial check')
    return link(source, destination)
  })
  await assert.rejects(exportPortraitDraftFromPayload({ draftId }, f.deps), { message: ERRORS.EXISTS })
  assert.equal(await fs.readFile(f.destination, 'utf8'), 'arrived after initial check')
  assert.equal((await fs.readdir(f.directory)).some((name) => name.startsWith('.nexus-portrait-export-')), false)
})

test('archive write failure is sanitized and removes only the newly staged package', async (t) => {
  const f = await fixture()
  const writeFile = fs.writeFile
  t.mock.method(fs, 'writeFile', async (...args: Parameters<typeof fs.writeFile>) => {
    if (path.basename(String(args[0])) === 'package.zip') throw new Error('/private/secret: disk full')
    return writeFile(...args)
  })
  await assert.rejects(exportPortraitDraftFromPayload({ draftId }, f.deps), { message: ERRORS.WRITE_FAILED })
  await assertClean(f.directory, f.destination)
  assert.deepEqual(await fs.readFile(path.join(f.draft, 'preview.png')), f.png)
})

test('atomic manifest commit failure cleans temporary JSON and allows retry', async (t) => {
  const f = await fixture()
  const rename = t.mock.method(fs, 'rename', async () => { throw new Error('disk failed at private path') })
  await assert.rejects(exportPortraitDraftFromPayload({ draftId }, f.deps), { message: ERRORS.WRITE_FAILED })
  await assertClean(f.directory, f.destination)
  rename.mock.restore()
  assert.equal((await exportPortraitDraftFromPayload({ draftId }, f.deps))?.exported, true)
})

test('save-dialog errors and nonabsolute host destinations return sanitized write failures', async () => {
  const f = await fixture()
  await assert.rejects(exportPortraitDraftFromPayload({ draftId }, { ...f.deps, chooseArchivePath: async () => { throw new Error('/private/dialog failure') } }), { message: ERRORS.WRITE_FAILED })
  await assert.rejects(exportPortraitDraftFromPayload({ draftId }, { ...f.deps, chooseArchivePath: async () => 'relative.zip' }), { message: ERRORS.WRITE_FAILED })
  await assert.rejects(exportPortraitDraftFromPayload({ draftId }, { ...f.deps, chooseArchivePath: async () => path.join(f.directory, 'missing', 'out.zip') }), { message: ERRORS.WRITE_FAILED })
  await assertClean(f.directory, f.destination)
})
