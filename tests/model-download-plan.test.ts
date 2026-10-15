import assert from 'node:assert/strict'
import test from 'node:test'

import { MODEL_CATALOG } from '../electron/services/modelDefinitions.js'
import {
  assertModelDownloadDiskSpace,
  MODEL_DOWNLOAD_DISK_MARGIN_BYTES,
  modelDownloadBytesNeeded,
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

test('a short partial resumes and a finished partial is verified', () => {
  assert.deepEqual(planFileResume(0, 100), { mode: 'fresh', offset: 0 })
  assert.deepEqual(planFileResume(40, 100), { mode: 'resume', offset: 40 })
  assert.deepEqual(planFileResume(100, 100), { mode: 'verify', offset: 100 })
  assert.deepEqual(planFileResume(101, 100), { mode: 'discard', offset: 0 })
})
