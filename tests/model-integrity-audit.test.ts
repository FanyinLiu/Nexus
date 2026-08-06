import assert from 'node:assert/strict'
import { test } from 'node:test'

import { inspectModelCatalog } from '../scripts/model-integrity-audit.mjs'

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
