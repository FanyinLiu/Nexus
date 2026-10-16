import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { MODEL_CATALOG } from '../electron/services/modelDefinitions.js'
import {
  assertModelDownloadDiskSpace,
  evaluateModelDiskSpace,
  MODEL_DOWNLOAD_DISK_MARGIN_BYTES,
  modelDownloadBytesNeeded,
  modelDownloadCanResume,
  modelResumePartialPath,
  planFileResume,
} from '../electron/services/modelDownloader.js'

const sensevoice = MODEL_CATALOG.find((model) => model.id === 'sensevoice')

test('SenseVoice is an on-demand int8 file download, not a packaged requirement', () => {
  assert.ok(sensevoice)
  assert.equal(sensevoice?.required, false)
  assert.equal(sensevoice?.kind, 'files')
  assert.deepEqual(sensevoice?.files, ['model.int8.onnx', 'tokens.txt'])
  assert.equal(sensevoice?.integrity.files['model.int8.onnx'].sizeBytes, 239_233_841)
  assert.equal(sensevoice?.checkFile, 'model.int8.onnx')
})

test('disk preflight counts only files that are not already the expected size', () => {
  const needed = modelDownloadBytesNeeded(sensevoice, new Set(['tokens.txt']))
  assert.equal(needed, 239_233_841)
  assert.doesNotThrow(() => assertModelDownloadDiskSpace(needed + MODEL_DOWNLOAD_DISK_MARGIN_BYTES, needed))
  assert.throws(
    () => assertModelDownloadDiskSpace(needed, needed),
    /disk space/,
  )
})

test('unknown free space does not block, and a short volume does', () => {
  const needed = 1_000
  assert.equal(evaluateModelDiskSpace(null, needed).ok, true)
  assert.equal(evaluateModelDiskSpace(undefined, needed).ok, true)
  assert.equal(evaluateModelDiskSpace(needed + MODEL_DOWNLOAD_DISK_MARGIN_BYTES, needed).ok, true)
  assert.equal(evaluateModelDiskSpace(needed, needed).ok, false)
  assert.equal(evaluateModelDiskSpace(0, 0).ok, true)
  assert.doesNotThrow(() => assertModelDownloadDiskSpace(null, needed))
  assert.throws(() => assertModelDownloadDiskSpace(needed, needed), /disk space/)
})

test('archive and standalone partials are the files a later download continues', () => {
  const root = mkdtempSync(join(tmpdir(), 'nexus-model-resume-'))
  const archive = { id: 'kws-en', kind: 'archive' }
  const standalone = { kind: 'standalone', standalone: { dest: 'silero_vad_v5.onnx' } }
  const archivePartial = modelResumePartialPath(archive, root)
  const standalonePartial = modelResumePartialPath(standalone, root)
  assert.equal(archivePartial, join(root, '.nexus-partials', 'kws-en.tar.bz2.partial'))
  assert.equal(standalonePartial, join(root, 'silero_vad_v5.onnx.partial'))
  assert.equal(modelDownloadCanResume(archive, root), false)
  mkdirSync(join(root, '.nexus-partials'), { recursive: true })
  const stagedArchive = archivePartial.slice(0, -'.partial'.length)
  writeFileSync(stagedArchive, 'not-the-full-archive')
  assert.equal(modelDownloadCanResume({ ...archive, integrity: { archive: { sizeBytes: 99 } } }, root), false)
  writeFileSync(stagedArchive, 'x'.repeat(99))
  assert.equal(modelDownloadCanResume({ ...archive, integrity: { archive: { sizeBytes: 99 } } }, root), true)
  writeFileSync(archivePartial, 'partial')
  writeFileSync(standalonePartial, 'partial')
  assert.equal(modelDownloadCanResume(archive, root), true)
  assert.equal(modelDownloadCanResume(standalone, root), true)
  const filesRoot = join(root, 'sensevoice')
  mkdirSync(filesRoot)
  writeFileSync(join(filesRoot, 'model.int8.onnx.partial'), 'partial')
  assert.equal(modelDownloadCanResume({ kind: 'files', directory: 'sensevoice' }, root), true)
})

test('a short partial resumes and a finished partial is verified', () => {
  assert.deepEqual(planFileResume(0, 100), { mode: 'fresh', offset: 0 })
  assert.deepEqual(planFileResume(40, 100), { mode: 'resume', offset: 40 })
  assert.deepEqual(planFileResume(100, 100), { mode: 'verify', offset: 100 })
  assert.deepEqual(planFileResume(101, 100), { mode: 'discard', offset: 0 })
})
