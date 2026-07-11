import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  resolveModelDownloadRedirect,
  validateModelArchiveListing,
  validateModelDownloadUrl,
  validateModelIntegrity,
} from '../electron/services/modelDownloadSecurity.js'

test('model downloads require allowlisted HTTPS URLs', () => {
  assert.equal(validateModelDownloadUrl('https://huggingface.co/org/model').hostname, 'huggingface.co')
  assert.equal(validateModelDownloadUrl('https://release-assets.githubusercontent.com/file').hostname, 'release-assets.githubusercontent.com')
  assert.throws(() => validateModelDownloadUrl('http://huggingface.co/model'), /require HTTPS/)
  assert.throws(() => validateModelDownloadUrl('https://example.com/model'), /not allowlisted/)
  assert.throws(() => validateModelDownloadUrl('https://user:pass@huggingface.co/model'), /credentials/)
})

test('model redirects are resolved and revalidated', () => {
  assert.equal(
    resolveModelDownloadRedirect('https://github.com/org/repo', 'https://release-assets.githubusercontent.com/asset'),
    'https://release-assets.githubusercontent.com/asset',
  )
  assert.throws(
    () => resolveModelDownloadRedirect('https://github.com/org/repo', 'http://example.com/asset'),
    /require HTTPS/,
  )
})

test('model integrity metadata requires exact size and SHA-256', () => {
  const sha256 = 'a'.repeat(64)
  assert.deepEqual(validateModelIntegrity({ sizeBytes: 42, sha256 }), { sizeBytes: 42, sha256 })
  assert.throws(() => validateModelIntegrity({ sizeBytes: 0, sha256 }), /invalid size/)
  assert.throws(() => validateModelIntegrity({ sizeBytes: 42, sha256: 'abc' }), /invalid SHA-256/)
})

test('model archive listing stays inside one directory and rejects links', () => {
  validateModelArchiveListing(
    ['model/', 'model/encoder.onnx', './model/tokens.txt'],
    ['drwxr-xr-x model/', '-rw-r--r-- model/encoder.onnx'],
    'model',
  )
  assert.throws(
    () => validateModelArchiveListing(['../outside'], ['-rw-r--r-- ../outside'], 'model'),
    /path traversal/,
  )
  assert.throws(
    () => validateModelArchiveListing(['other/file'], ['-rw-r--r-- other/file'], 'model'),
    /outside its expected directory/,
  )
  assert.throws(
    () => validateModelArchiveListing(['model/link'], ['lrwxr-xr-x model/link -> /tmp/file'], 'model'),
    /contains links/,
  )
})
