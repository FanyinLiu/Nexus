import assert from 'node:assert/strict'
import { test } from 'node:test'

import { MODEL_CATALOG } from '../electron/services/modelDefinitions.js'
import { inspectModelCatalog } from '../scripts/model-integrity-audit.mjs'

test('model catalog pins integrity metadata for every remote asset', () => {
  assert.deepEqual(inspectModelCatalog(MODEL_CATALOG), [])
})

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
