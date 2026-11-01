// @ts-nocheck
/**
 * Move a legacy bundled SenseVoice int8 install into userData.
 *
 * Packaged upgrades replace resources/sherpa-models, so a model that only
 * lives inside the app bundle disappears on the next install. Copying the
 * already-verified int8 files into the writable user-data directory keeps
 * speech recognition working without a 239 MB download and without blocking
 * startup. The source is left in place: if the copy fails, discovery still
 * finds the original.
 */

import { createHash } from 'node:crypto'
import {
  createReadStream,
  createWriteStream,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { MODEL_CATALOG } from './modelDefinitions.js'
import { checkModelPresence, planFileResume } from './modelDownloader.js'

function hashFile(filePath, byteLength) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath, { start: 0, end: byteLength - 1 })
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

function fileSize(filePath) {
  try { return statSync(filePath).size } catch { return null }
}

/**
 * A legacy directory is usable when both int8 files are present at the
 * catalog sizes. The checksum is checked while copying, not here.
 * @param {object} model
 * @param {string} directory
 */
export function legacySenseVoiceFileSizes(model, directory) {
  const sizes = {}
  for (const fileName of model.files ?? []) {
    sizes[fileName] = fileSize(join(directory, fileName))
  }
  return sizes
}

/**
 * @param {object} model
 * @param {Record<string, number | null>} sizes
 */
export function legacySenseVoiceSizesMatch(model, sizes) {
  return (model.files ?? []).every((fileName) => {
    const expected = model.integrity?.files?.[fileName]?.sizeBytes
    return Number.isSafeInteger(expected) && sizes[fileName] === expected
  })
}

function writeReceipt(model, directory) {
  const checkFilePath = join(directory, model.checkFile)
  const receipt = {
    schemaVersion: 1,
    modelId: model.id,
    installedAt: new Date().toISOString(),
    checkFileSize: statSync(checkFilePath).size,
    integrity: model.integrity,
  }
  writeFileSync(join(directory, '.nexus-model.json'), `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
}

function replaceDirectory(sourceDir, destDir) {
  const backupDir = `${destDir}.backup-${process.pid}-${Date.now()}`
  const hadDestination = fileSize(destDir) !== null || statExists(destDir)
  try {
    if (hadDestination) renameSync(destDir, backupDir)
    renameSync(sourceDir, destDir)
    if (hadDestination) rmSync(backupDir, { recursive: true, force: true })
  } catch (error) {
    if (!statExists(destDir) && hadDestination && statExists(backupDir)) {
      try { renameSync(backupDir, destDir) } catch {}
    }
    throw error
  }
}

function statExists(filePath) {
  try {
    statSync(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Copy a verified SenseVoice int8 install into `userRoot` when one is not
 * already there. Never deletes the legacy source.
 * @param {{ userRoot: string, legacyRoots: string[], model?: object }} options
 */
export async function migrateLegacySenseVoice({ userRoot, legacyRoots, model }) {
  const entry = model ?? MODEL_CATALOG.find((item) => item.id === 'sensevoice')
  if (!entry || entry.kind !== 'files') return { action: 'missing' }

  const userPresence = checkModelPresence(entry, [userRoot])
  if (userPresence.present && userPresence.verified) return { action: 'keep' }

  const source = (legacyRoots ?? []).map((root) => join(root, entry.directory)).find((directory) => (
    legacySenseVoiceSizesMatch(entry, legacySenseVoiceFileSizes(entry, directory))
  ))
  if (!source) return { action: 'missing' }

  mkdirSync(userRoot, { recursive: true })
  const staging = mkdtempSync(join(userRoot, '.nexus-sensevoice-migrate-'))
  try {
    for (const fileName of entry.files) {
      const expected = entry.integrity.files[fileName]
      const from = join(source, fileName)
      const to = join(staging, fileName)
      await pipeline(createReadStream(from), createWriteStream(to, { flags: 'w' }))
      const size = statSync(to).size
      if (planFileResume(size, expected.sizeBytes).mode !== 'verify') {
        return { action: 'rejected', reason: 'size' }
      }
      const digest = await hashFile(to, size)
      if (digest !== expected.sha256) return { action: 'rejected', reason: 'checksum' }
    }
    writeReceipt(entry, staging)
    replaceDirectory(staging, join(userRoot, entry.directory))
    return { action: 'copied', from: source }
  } catch (error) {
    return { action: 'rejected', reason: error instanceof Error ? error.message : 'copy' }
  } finally {
    try { rmSync(staging, { recursive: true, force: true }) } catch {}
  }
}
