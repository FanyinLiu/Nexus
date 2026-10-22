import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  isTopLevelRendererFrame,
  isTrustedRendererFrameUrl,
} from '../electron/ipc/trustedSenderPolicy.js'
import {
  assertBoundWindowChannelAllowed,
  bindWindowCapability,
  getBoundWindowCapability,
  getRendererViewKind,
  getRequiredWindowCapability,
  isWindowCapabilityClassified,
  isWindowChannelAllowed,
  unbindWindowCapability,
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
  assert.equal(isWindowChannelAllowed('telegram:connect', 'pet'), false)
  assert.equal(isWindowChannelAllowed('discord:connect', 'pet'), false)
  assert.equal(isWindowChannelAllowed('updater:install', 'pet'), false)
  assert.equal(isWindowChannelAllowed('models:download', 'pet'), false)
  assert.equal(isWindowChannelAllowed('integrations:inspect', 'panel'), true)
  assert.equal(isWindowChannelAllowed('integrations:inspect', 'pet'), false)
  assert.equal(isWindowChannelAllowed('integrations:inspect', 'unknown'), false)
  assert.equal(getRequiredWindowCapability('integrations:inspect'), 'panel')
  assert.equal(getRequiredWindowCapability('memory:clear-user-data'), 'panel')
  assert.equal(isWindowChannelAllowed('memory:clear-user-data', 'panel'), true)
  assert.equal(isWindowChannelAllowed('memory:clear-user-data', 'pet'), false)
  assert.equal(isWindowChannelAllowed('memory:clear-user-data', 'unknown'), false)
  assert.equal(isWindowChannelAllowed('chat:complete', 'pet'), true)
  assert.equal(isWindowChannelAllowed('persona:load-profile', 'pet'), true)
  assert.equal(isWindowChannelAllowed('persona:save-soul', 'pet'), false)
  assert.equal(WINDOW_CAPABILITY_MATRIX.unknown.panel, false)
})

test('pet window cannot call panel-only channels after the url claims view=panel', () => {
  const pet = { id: 1101 }
  bindWindowCapability(pet, 'pet')
  try {
    const rewrittenPanelUrl = 'http://127.0.0.1:47822/index.html?view=panel'
    assert.equal(getRendererViewKind(rewrittenPanelUrl), 'panel')
    assert.equal(getBoundWindowCapability(pet), 'pet')
    assert.throws(
      () => assertBoundWindowChannelAllowed(pet, 'persona:open-dir'),
      /panel capability is unavailable to pet window/,
    )
    assert.throws(
      () => assertBoundWindowChannelAllowed(pet, 'vault:retrieve'),
      /panel capability is unavailable to pet window/,
    )
    assert.throws(
      () => assertBoundWindowChannelAllowed(pet, 'file:save-text'),
      /panel capability is unavailable to pet window/,
    )
    assert.throws(
      () => assertBoundWindowChannelAllowed(pet, 'memory:clear-user-data'),
      /panel capability is unavailable to pet window/,
    )
    assert.doesNotThrow(() => assertBoundWindowChannelAllowed(pet, 'chat:complete'))
    assert.doesNotThrow(() => assertBoundWindowChannelAllowed(pet, 'desktop-context:get'))
  } finally {
    unbindWindowCapability(pet)
  }
})

test('panel window keeps panel-only channels', () => {
  const panel = { id: 1102 }
  bindWindowCapability(panel, 'panel')
  try {
    assert.doesNotThrow(() => assertBoundWindowChannelAllowed(panel, 'vault:retrieve'))
    assert.doesNotThrow(() => assertBoundWindowChannelAllowed(panel, 'persona:open-dir'))
    assert.doesNotThrow(() => assertBoundWindowChannelAllowed(panel, 'file:open-text'))
    assert.doesNotThrow(() => assertBoundWindowChannelAllowed(panel, 'updater:install'))
    assert.doesNotThrow(() => assertBoundWindowChannelAllowed(panel, 'memory:clear-user-data'))
  } finally {
    unbindWindowCapability(panel)
  }
})

test('settings window keeps panel-only channels', () => {
  // Settings is the panel BrowserWindow opened on section=settings.
  const settings = { id: 1103 }
  bindWindowCapability(settings, 'panel')
  try {
    assert.equal(
      getRendererViewKind('http://127.0.0.1:47822/index.html?view=panel&section=settings'),
      'panel',
    )
    assert.equal(getBoundWindowCapability(settings), 'panel')
    assert.doesNotThrow(() => assertBoundWindowChannelAllowed(settings, 'vault:retrieve'))
    assert.doesNotThrow(() => assertBoundWindowChannelAllowed(settings, 'file:save-text'))
    assert.doesNotThrow(() => assertBoundWindowChannelAllowed(settings, 'persona:open-dir'))
    assert.doesNotThrow(() => assertBoundWindowChannelAllowed(settings, 'tool:open-external'))
  } finally {
    unbindWindowCapability(settings)
  }
})

test('an unbound window stays unprivileged even if its url says panel', () => {
  const stranger = { id: 1104 }
  assert.equal(getBoundWindowCapability(stranger), 'unknown')
  assert.throws(
    () => assertBoundWindowChannelAllowed(stranger, 'vault:retrieve'),
    /panel capability is unavailable to unknown window/,
  )
})

test('trusted sender checks the bound capability rather than the live url', async () => {
  const source = await readFile(new URL('../electron/ipc/validate.js', import.meta.url), 'utf8')
  assert.match(source, /getBoundWindowCapability\(sender\)/)
  assert.match(source, /isWindowChannelAllowed\(resolvedChannel, viewKind\)/)
  assert.doesNotMatch(source, /getRendererViewKind/)
})
