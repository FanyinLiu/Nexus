/**
 * Explicit local export of one committed preview as a static format-2 package.
 * Source paths are fixed under the private draft root, never renderer supplied.
 * A same-directory staged archive is linked exclusively into the chosen path:
 * cancellation and failures cannot overwrite another file or activate a pet.
 */
import fs from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import {
  normalizePortraitDraftExportPayload,
  PORTRAIT_DRAFT_EXPORT_ERROR_CODES as ERRORS,
  PORTRAIT_DRAFT_EXPORT_LIMITS,
  PORTRAIT_DRAFT_EXPORT_MESSAGE_KEY,
} from '../../../shared/portraitDraftExport.js'
import { normalizePortraitPreview, PORTRAIT_PREVIEW_MAX_BASE64_BYTES } from '../../../shared/portraitPreview.js'
import { normalizePortraitPuppetRig, PORTRAIT_PUPPET_KIND } from '../../../shared/portraitPuppetContract.js'
import { createAsyncJsonFileStore } from '../jsonFileStore.js'
import { atomicWriteJson } from '../localDataStoreCore.js'
import { readSpritePetPackage, writeSpritePetZipArchive } from '../spritePetPackage.js'
import { PORTRAIT_DRAFT_VERSION } from './portraitDraft.js'

function failure(code) {
  return new Error(code)
}

async function fixedDirectory(directory) {
  const stats = await fs.lstat(directory)
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw failure(ERRORS.INVALID)
  return fs.realpath(directory)
}

async function fixedFile(directory, name, maxBytes) {
  const file = path.join(directory, name)
  const stats = await fs.lstat(file)
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size < 1 || stats.size > maxBytes
    || await fs.realpath(file) !== file) throw failure(ERRORS.INVALID)
  return file
}

async function readCommittedPreview(draftRoot, draftId) {
  try {
    const root = await fixedDirectory(path.resolve(draftRoot))
    const directory = await fixedDirectory(path.join(root, draftId))
    if (directory !== path.join(root, draftId)) throw failure(ERRORS.INVALID)
    const manifestPath = await fixedFile(directory, 'draft.json', PORTRAIT_DRAFT_EXPORT_LIMITS.manifestBytes)
    const store = createAsyncJsonFileStore({ getStorePath: () => manifestPath })
    const manifest = await store.ensureLoaded()
    if (manifest.version !== PORTRAIT_DRAFT_VERSION || manifest.draftId !== draftId || manifest.preview !== 'preview.png'
      || !Number.isInteger(manifest.width) || !Number.isInteger(manifest.height)
      || manifest.width < 1 || manifest.height < 1 || manifest.width > 768 || manifest.height > 768) throw failure(ERRORS.INVALID)
    const previewPath = await fixedFile(directory, 'preview.png', PORTRAIT_PREVIEW_MAX_BASE64_BYTES * 3 / 4)
    const handle = await fs.open(previewPath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
    let bytes
    try { bytes = await handle.readFile() } finally { await handle.close() }
    if (!normalizePortraitPreview({ dataUrl: `data:image/png;base64,${bytes.toString('base64')}`, width: manifest.width, height: manifest.height })) throw failure(ERRORS.INVALID)
    const image = sharp(bytes, { limitInputPixels: 768 * 768, failOn: 'warning' })
    const metadata = await image.metadata()
    if (metadata.format !== 'png' || metadata.depth !== 'uchar' || metadata.channels !== 4 || !metadata.hasAlpha) throw failure(ERRORS.INVALID)
    const { data, info } = await image.raw().toBuffer({ resolveWithObject: true })
    if (info.width !== manifest.width || info.height !== manifest.height || info.channels !== 4) throw failure(ERRORS.INVALID)
    let foreground = false
    let transparent = false
    for (let offset = 3; offset < data.length; offset += 4) {
      foreground ||= data[offset] > 0
      transparent ||= data[offset] < 255
    }
    if (!foreground || !transparent) throw failure(ERRORS.INVALID)
    // Only decoded preview pixels leave the draft store, without PNG metadata,
    // source paths, model files, diagnostics, or unreviewed individual layers.
    const png = await sharp(data, { raw: info }).png().toBuffer()
    return { png, width: info.width, height: info.height }
  } catch (error) {
    if (error?.code === 'ENOENT') throw failure(ERRORS.UNAVAILABLE)
    throw failure(ERRORS.INVALID)
  }
}

/**
 * @param {unknown} payload
 * @param {{draftRoot: string, chooseArchivePath: (options: {defaultFileName: string}) => Promise<string | null | undefined>}} deps
 * @returns {Promise<import('../../../shared/portraitDraftExport.js').PortraitDraftExportResult | null>}
 */
export async function exportPortraitDraftFromPayload(payload, deps) {
  const input = normalizePortraitDraftExportPayload(payload)
  if (!input) throw failure(ERRORS.INVALID)
  let destination
  try { destination = await deps.chooseArchivePath({ defaultFileName: `${input.draftId}.nexus-portrait.zip` }) } catch { throw failure(ERRORS.WRITE_FAILED) }
  if (!destination) return null
  if (typeof destination !== 'string' || !path.isAbsolute(destination)) throw failure(ERRORS.WRITE_FAILED)
  const preview = await readCommittedPreview(deps.draftRoot, input.draftId)
  let staging
  try {
    const parent = await fs.realpath(path.dirname(destination))
    const target = path.join(parent, path.basename(destination))
    try {
      await fs.lstat(target)
      throw failure(ERRORS.EXISTS)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    staging = await fs.mkdtemp(path.join(parent, '.nexus-portrait-export-'))
    const manifestPath = path.join(staging, 'pet.json')
    const portraitPath = path.join(staging, 'portrait.png')
    const readmePath = path.join(staging, 'README.txt')
    await fs.writeFile(portraitPath, preview.png)
    await atomicWriteJson(manifestPath, {
      id: `portrait-${input.draftId.slice(6)}`,
      displayName: input.displayName || 'Static portrait',
      description: 'Static portrait package. No blinking, lip sync, head turn or independent layer animation.',
      kind: PORTRAIT_PUPPET_KIND,
      formatVersion: 2,
      portraitPath: 'portrait.png',
      rig: normalizePortraitPuppetRig({ motionIntensity: 0 }),
    })
    await fs.writeFile(readmePath, 'Nexus static portrait package (format 2)\n\nThis package contains one generated preview image. It is static: no blinking, lip sync, head turning or independent layer animation. Export does not install or select a companion. Import or activate it only when you choose to do so.\n\nSource-image rights are not inferred or granted by Nexus. Retain any supplied attribution when sharing the image or this package.\n')
    const files = [{ path: manifestPath, name: 'pet.json' }, { path: portraitPath, name: 'portrait.png' }, { path: readmePath, name: 'README.txt' }]
    if (input.attributionText) {
      const attributionPath = path.join(staging, 'ATTRIBUTION.txt')
      await fs.writeFile(attributionPath, input.attributionText)
      files.push({ path: attributionPath, name: 'ATTRIBUTION.txt' })
    }
    await readSpritePetPackage(manifestPath)
    const archivePath = path.join(staging, 'package.zip')
    await writeSpritePetZipArchive({ archivePath, files })
    // link is atomic and fails if the destination appeared after the check.
    // Staging beside it keeps publication on the same filesystem.
    await fs.link(archivePath, target)
    return { exported: true, formatVersion: 2, static: true, width: preview.width, height: preview.height,
      fileName: path.basename(target), messageKey: PORTRAIT_DRAFT_EXPORT_MESSAGE_KEY }
  } catch (error) {
    if (error?.code === 'EEXIST' || error?.message === ERRORS.EXISTS) throw failure(ERRORS.EXISTS)
    throw failure(ERRORS.WRITE_FAILED)
  } finally {
    if (staging) await fs.rm(staging, { recursive: true, force: true }).catch(() => {})
  }
}
