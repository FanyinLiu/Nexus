import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  legacySenseVoiceSizesMatch,
  migrateLegacySenseVoice,
} from '../electron/services/senseVoiceMigration.js'

function sha256(body: string) {
  return createHash('sha256').update(body).digest('hex')
}

function tinyModel() {
  const modelBody = 'int8-model'
  const tokensBody = 'tokens'
  return {
    id: 'sensevoice',
    kind: 'files' as const,
    directory: 'sensevoice-dir',
    checkFile: 'model.int8.onnx',
    files: ['model.int8.onnx', 'tokens.txt'],
    integrity: {
      files: {
        'model.int8.onnx': { sizeBytes: Buffer.byteLength(modelBody), sha256: sha256(modelBody) },
        'tokens.txt': { sizeBytes: Buffer.byteLength(tokensBody), sha256: sha256(tokensBody) },
      },
    },
    bodies: { 'model.int8.onnx': modelBody, 'tokens.txt': tokensBody },
  }
}

test('legacy size check accepts only the catalog byte lengths', () => {
  const model = tinyModel()
  assert.equal(legacySenseVoiceSizesMatch(model, {
    'model.int8.onnx': model.integrity.files['model.int8.onnx'].sizeBytes,
    'tokens.txt': model.integrity.files['tokens.txt'].sizeBytes,
  }), true)
  assert.equal(legacySenseVoiceSizesMatch(model, {
    'model.int8.onnx': 1,
    'tokens.txt': model.integrity.files['tokens.txt'].sizeBytes,
  }), false)
})

test('migration copies a matching legacy install and leaves the source in place', async () => {
  const model = tinyModel()
  const root = mkdtempSync(join(tmpdir(), 'nexus-sensevoice-'))
  const legacy = join(root, 'legacy', model.directory)
  const userRoot = join(root, 'user')
  mkdirSync(legacy, { recursive: true })
  mkdirSync(userRoot, { recursive: true })
  for (const [name, body] of Object.entries(model.bodies)) {
    writeFileSync(join(legacy, name), body)
  }

  try {
    const copied = await migrateLegacySenseVoice({
      userRoot,
      legacyRoots: [join(root, 'legacy')],
      model,
    })
    assert.equal(copied.action, 'copied')
    const dest = join(userRoot, model.directory)
    assert.equal(readFileSync(join(dest, 'model.int8.onnx'), 'utf8'), model.bodies['model.int8.onnx'])
    assert.equal(readFileSync(join(legacy, 'model.int8.onnx'), 'utf8'), model.bodies['model.int8.onnx'])
    const receipt = JSON.parse(readFileSync(join(dest, '.nexus-model.json'), 'utf8'))
    assert.equal(receipt.modelId, 'sensevoice')
    assert.equal(receipt.checkFileSize, model.integrity.files['model.int8.onnx'].sizeBytes)

    const again = await migrateLegacySenseVoice({
      userRoot,
      legacyRoots: [join(root, 'legacy')],
      model,
    })
    assert.equal(again.action, 'keep')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('migration rejects a same-size file with the wrong checksum and keeps the source', async () => {
  const model = tinyModel()
  const root = mkdtempSync(join(tmpdir(), 'nexus-sensevoice-bad-'))
  const legacy = join(root, 'legacy', model.directory)
  const userRoot = join(root, 'user')
  mkdirSync(legacy, { recursive: true })
  mkdirSync(userRoot, { recursive: true })
  writeFileSync(join(legacy, 'model.int8.onnx'), 'x'.repeat(model.integrity.files['model.int8.onnx'].sizeBytes))
  writeFileSync(join(legacy, 'tokens.txt'), model.bodies['tokens.txt'])

  try {
    const result = await migrateLegacySenseVoice({
      userRoot,
      legacyRoots: [join(root, 'legacy')],
      model,
    })
    assert.equal(result.action, 'rejected')
    assert.equal(result.reason, 'checksum')
    assert.equal(
      readFileSync(join(legacy, 'model.int8.onnx'), 'utf8'),
      'x'.repeat(model.integrity.files['model.int8.onnx'].sizeBytes),
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
