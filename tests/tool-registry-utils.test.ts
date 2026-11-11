import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { translateMainMessage } from '../electron/mainMessages.js'
import { normalizeExternalUrl } from '../electron/tools/toolRegistryUtils.js'

const LINK_PROTOCOL = translateMainMessage('tool.linkProtocol', undefined, 'en-US')
const LINK_UNSAFE = translateMainMessage('tool.linkUnsafe', undefined, 'en-US')

describe('toolRegistryUtils.normalizeExternalUrl', () => {
  test('normalizes bare domains to https URLs', () => {
    assert.equal(normalizeExternalUrl('example.com/path'), 'https://example.com/path')
  })

  test('allows public http and https URLs', () => {
    assert.equal(normalizeExternalUrl('http://example.com/a'), 'http://example.com/a')
    assert.equal(normalizeExternalUrl('https://example.com/a'), 'https://example.com/a')
  })

  test('rejects non-http schemes', () => {
    assert.throws(
      () => normalizeExternalUrl('file:///etc/passwd'),
      new RegExp(LINK_PROTOCOL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    )
  })

  test('rejects private and metadata-range targets in the main process layer', () => {
    for (const url of [
      'http://localhost:3000',
      'http://127.0.0.1:11434',
      'http://192.168.1.10',
      'http://169.254.169.254/latest/meta-data',
      'http://[::1]/',
    ]) {
      assert.throws(
        () => normalizeExternalUrl(url),
        new RegExp(LINK_UNSAFE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      )
    }
  })
})
