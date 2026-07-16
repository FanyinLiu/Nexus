import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { verifyPackagedResources } from '../scripts/release-resource-verifier.mjs'

const VAD_SIZE = 2_243_022
const VAD_SHA256 = 'a4a068cd6cf1ea8355b84327595838ca748ec29a25bc91fc82e6c299ccdc5808'
const WORKLET_SIZE = 2_480
const WORKLET_SHA256 = '8a48fdc7429948a2fde3d29a84bb1a64c1f67b4ba578ccaa7548b7f989f06a74'

function validOptions() {
  return {
    pathExists: () => true,
    fileSize: (path: string) => path.endsWith('silero_vad_v5.onnx') ? VAD_SIZE : 1,
    fileSha256: () => VAD_SHA256,
    readDirectory: () => [],
    inspectPackedFile: (_asarPath: string, relativePath: string) => relativePath.endsWith('vad.worklet.bundle.min.js')
      ? { sizeBytes: WORKLET_SIZE, sha256: WORKLET_SHA256 }
      : { sizeBytes: VAD_SIZE, sha256: VAD_SHA256 },
  }
}

function fakeDirent(name: string, kind: 'directory' | 'file' | 'symlink') {
  return {
    name,
    isDirectory: () => kind === 'directory',
    isFile: () => kind === 'file',
    isSymbolicLink: () => kind === 'symlink',
  }
}

test('packaged resource verifier requires app.asar, all voice models, and both VAD copies', () => {
  const result = verifyPackagedResources('/release/resources', validOptions())

  assert.equal(result.ok, true)
  assert.deepEqual(result.requiredResources, ['app-asar', 'kws-en', 'kws-zh', 'sensevoice', 'vad'])
  assert.equal(result.browserVadPath, 'dist/vendor/vad/silero_vad_v5.onnx')
  assert.equal(result.browserVadWorkletPath, 'dist/vendor/vad/vad.worklet.bundle.min.js')
})

test('packaged resource verifier rejects missing model and tampered external VAD', () => {
  const missing = verifyPackagedResources('/release/resources', {
    ...validOptions(),
    pathExists: (path: string) => !path.includes('sherpa-onnx-sense-voice'),
  })
  assert.equal(missing.ok, false)
  assert.match(missing.errors.join('\n'), /required packaged resource is missing: sensevoice/)

  const tampered = verifyPackagedResources('/release/resources', {
    ...validOptions(),
    fileSha256: () => '0'.repeat(64),
  })
  assert.equal(tampered.ok, false)
  assert.match(tampered.errors.join('\n'), /sha256 mismatch: vad/)
})

test('packaged resource verifier rejects missing or tampered browser VAD inside app.asar', () => {
  const missing = verifyPackagedResources('/release/resources', {
    ...validOptions(),
    inspectPackedFile: () => { throw new Error('file not found') },
  })
  assert.equal(missing.ok, false)
  assert.match(missing.errors.join('\n'), /browser VAD is missing or unreadable in app\.asar/)

  const tampered = verifyPackagedResources('/release/resources', {
    ...validOptions(),
    inspectPackedFile: (_asarPath: string, relativePath: string) => relativePath.endsWith('vad.worklet.bundle.min.js')
      ? { sizeBytes: WORKLET_SIZE, sha256: WORKLET_SHA256 }
      : { sizeBytes: VAD_SIZE, sha256: '0'.repeat(64) },
  })
  assert.equal(tampered.ok, false)
  assert.match(tampered.errors.join('\n'), /browser VAD in app\.asar has the wrong sha256/)
})

test('packaged resource verifier rejects a missing browser VAD AudioWorklet', () => {
  const result = verifyPackagedResources('/release/resources', {
    ...validOptions(),
    inspectPackedFile: (_asarPath: string, relativePath: string) => {
      if (relativePath.endsWith('vad.worklet.bundle.min.js')) throw new Error('file not found')
      return { sizeBytes: VAD_SIZE, sha256: VAD_SHA256 }
    },
  })

  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /browser VAD worklet is missing or unreadable in app\.asar/)
})

test('packaged resource verifier rejects transient model download trees and partial archives', () => {
  const modelsRoot = '/release/resources/sherpa-models'
  const temporaryDirectory = `${modelsRoot}/.nexus-sensevoice-4LEvAY`
  const result = verifyPackagedResources('/release/resources', {
    ...validOptions(),
    readDirectory: (directory: string) => {
      if (directory === modelsRoot) {
        return [
          fakeDirent('.nexus-sensevoice-4LEvAY', 'directory'),
          fakeDirent('sherpa-onnx-kws', 'directory'),
          fakeDirent('download-cache.tar.zst', 'file'),
          fakeDirent('.nexus-linked-download', 'symlink'),
        ]
      }
      if (directory === temporaryDirectory) {
        return [fakeDirent('model.tar.bz2.partial-123-456', 'file')]
      }
      return []
    },
  })

  assert.equal(result.ok, false)
  assert.match(
    result.errors.join('\n'),
    /sherpa-models\/\.nexus-sensevoice-4LEvAY\/model\.tar\.bz2\.partial-123-456/,
  )
  assert.deepEqual(
    result.transientModelArtifacts.map((artifact: { path: string }) => artifact.path),
    [
      'sherpa-models/.nexus-sensevoice-4LEvAY',
      'sherpa-models/.nexus-sensevoice-4LEvAY/model.tar.bz2.partial-123-456',
      'sherpa-models/download-cache.tar.zst',
      'sherpa-models/.nexus-linked-download',
    ],
  )
})

test('packaged resource verifier accepts a clean model tree and does not follow symlinks', () => {
  const modelsRoot = '/release/resources/sherpa-models'
  let reads = 0
  const result = verifyPackagedResources('/release/resources', {
    ...validOptions(),
    readDirectory: (directory: string) => {
      reads += 1
      assert.equal(directory, modelsRoot)
      return [
        fakeDirent('.nexus-model.json', 'file'),
        fakeDirent('external-model-cache', 'symlink'),
      ]
    },
  })

  assert.equal(result.ok, true)
  assert.equal(reads, 1)
  assert.deepEqual(result.transientModelArtifacts, [])
})

test('packaged resource verifier fails closed when the model tree cannot be inspected', () => {
  const result = verifyPackagedResources('/release/resources', {
    ...validOptions(),
    readDirectory: () => { throw new Error('permission denied') },
  })

  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /failed to inspect packaged sherpa-models tree: permission denied/)
})

test('all formal platform packages exclude transient model download artifacts', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const requiredFilters = [
    '!**/.nexus-*/**',
    '!**/*.partial',
    '!**/*.partial-*',
    '!**/*.tar',
    '!**/*.tar.*',
    '!**/*.tgz',
    '!**/*.tbz',
    '!**/*.tbz2',
    '!**/*.txz',
  ]

  for (const platform of ['win', 'mac', 'linux']) {
    const modelMapping = pkg.build[platform].extraResources.find(
      (entry: { from?: string; to?: string }) => entry.from === 'sherpa-models' && entry.to === 'sherpa-models',
    )
    assert.ok(modelMapping, `${platform} must package the sherpa-models tree`)
    for (const filter of requiredFilters) {
      assert.ok(modelMapping.filter.includes(filter), `${platform} sherpa-models filter is missing ${filter}`)
    }
    assert.equal(
      modelMapping.filter.includes('!**/.nexus-*'),
      false,
      `${platform} must preserve .nexus-model.json integrity markers`,
    )
  }
})
