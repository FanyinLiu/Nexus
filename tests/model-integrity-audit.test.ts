import assert from 'node:assert/strict'
import { test } from 'node:test'

import { inspectModelCatalog, inspectPortraitModelCatalog } from '../scripts/model-integrity-audit.mjs'

test('model integrity audit rejects mutable or unverified assets', () => {
  const unsafe = [{
    id: 'unsafe',
    kind: 'standalone',
    standalone: {
      urls: ['http://example.com/model.onnx'],
      integrity: { sizeBytes: 0, sha256: '' },
    },
  }]
  assert.equal(inspectModelCatalog(unsafe).length, 1)
})

test('model integrity audit pins portrait models to the release, a hash, a source commit, and a licence', () => {
  assert.deepEqual(inspectPortraitModelCatalog(), [])
  const release = { baseUrl: 'https://github.com/FanyinLiu/Nexus/releases/download/t' }
  const good = {
    id: 'm', fileName: 'm.onnx', url: `${release.baseUrl}/m.onnx`, sizeBytes: 10, sha256: 'a'.repeat(64),
    source: { revision: 'b'.repeat(40) }, license: { spdx: 'MIT', url: 'https://example.com/LICENSE' }, trainingDataDocumented: false,
  }
  assert.deepEqual(inspectPortraitModelCatalog([good], release), [])
  const broken = [
    { ...good, id: 'host', url: 'https://example.com/m.onnx' },
    { ...good, id: 'other-asset', url: `${release.baseUrl}/other.onnx` },
    { ...good, id: 'hash', sha256: 'nope' },
    { ...good, id: 'branch', source: { revision: 'main' } },
    { ...good, id: 'licence', license: { spdx: '', url: '' } },
    { ...good, id: 'provenance', trainingDataDocumented: undefined },
  ]
  assert.deepEqual(inspectPortraitModelCatalog(broken, release).map((e: { modelId: string }) => e.modelId), broken.map((m) => m.id))
})
