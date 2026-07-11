import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  isTopLevelRendererFrame,
  isTrustedRendererFrameUrl,
} from '../electron/ipc/trustedSenderPolicy.js'
import {
  getRendererViewKind,
  getRequiredWindowCapability,
  isWindowCapabilityClassified,
  isWindowChannelAllowed,
  WINDOW_CAPABILITY_MATRIX,
} from '../electron/ipc/windowCapabilities.js'

test('trusted renderer policy requires the exact renderer origin and path', () => {
  assert.equal(
    isTrustedRendererFrameUrl('http://127.0.0.1:47822/index.html?view=panel', 'http://127.0.0.1:47822/index.html?view=pet'),
    true,
  )
  assert.equal(
    isTrustedRendererFrameUrl('http://127.0.0.1:47823/index.html', 'http://127.0.0.1:47822/index.html'),
    false,
  )
  assert.equal(
    isTrustedRendererFrameUrl('http://127.0.0.1:47822/evil.html', 'http://127.0.0.1:47822/index.html'),
    false,
  )
  assert.equal(
    isTrustedRendererFrameUrl('file:///tmp/other.html', 'file:///tmp/index.html'),
    false,
  )
})

test('trusted renderer policy rejects child frames', () => {
  assert.equal(isTopLevelRendererFrame({ parent: null }), true)
  assert.equal(isTopLevelRendererFrame({ parent: {} }), false)
  assert.equal(isTopLevelRendererFrame(null), false)
})

test('window capability matrix keeps high-impact channels on the panel', () => {
  assert.equal(getRendererViewKind('http://127.0.0.1:47822/index.html?view=panel'), 'panel')
  assert.equal(getRendererViewKind('http://127.0.0.1:47822/index.html?view=pet'), 'pet')
  assert.equal(getRendererViewKind('file:///tmp/index.html'), 'unknown')
  assert.equal(getRequiredWindowCapability('vault:retrieve'), 'panel')
  assert.equal(getRequiredWindowCapability('chat:complete'), 'shared')
  assert.equal(isWindowCapabilityClassified('desktop-context:get'), true)
  assert.equal(isWindowCapabilityClassified('vault:retrieve'), true)
  assert.equal(isWindowCapabilityClassified('chat:complete'), false)
  assert.equal(isWindowChannelAllowed('vault:retrieve', 'panel'), true)
  assert.equal(isWindowChannelAllowed('vault:retrieve', 'pet'), false)
  assert.equal(isWindowChannelAllowed('chat:complete', 'pet'), true)
  assert.equal(WINDOW_CAPABILITY_MATRIX.unknown.panel, false)
})
