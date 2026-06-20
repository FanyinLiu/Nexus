import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  pluginActionNeedsConfirmation,
  summarizePluginRequest,
  summarizePluginResult,
} from '../electron/ipc/pluginAudit.js'

test('plugin audit summaries exclude plugin ids topics payloads and result text', () => {
  const lifecycle = summarizePluginRequest('plugin:start', {
    id: 'private-plugin-id',
  })

  assert.deepEqual(lifecycle, {
    channel: 'plugin:start',
    pluginId: {
      present: true,
      length: 17,
    },
  })

  const bus = summarizePluginRequest('plugin-bus:publish', {
    serverId: 'plugin:private-plugin',
    topic: 'private.topic',
    data: {
      secret: 'token',
      nested: {
        path: '/Users/me/private.txt',
      },
    },
  })

  assert.equal(bus.serverId.length, 21)
  assert.equal(bus.topic.length, 13)
  assert.equal(bus.data.kind, 'object')
  assert.equal(bus.data.keyCount, 2)
  assert.ok(bus.data.serializedLength > 0)

  const result = summarizePluginResult('plugin:start', {
    id: 'private-plugin-id',
    name: 'Private Plugin',
    running: true,
    enabled: true,
    approved: true,
    commandTrusted: true,
    toolCount: 4,
    mcpState: 'private-state',
  })

  assert.deepEqual(result, {
    channel: 'plugin:start',
    ok: true,
    resultKind: 'object',
    resultKeyCount: 8,
    running: true,
    enabled: true,
    approved: true,
    commandTrusted: true,
    toolCount: 4,
    mcpStateLength: 13,
    errorMessageLength: 0,
  })

  const serialized = JSON.stringify({ lifecycle, bus, result })
  for (const privateValue of [
    'private-plugin-id',
    'plugin:private-plugin',
    'private.topic',
    'token',
    '/Users/me/private.txt',
    'Private Plugin',
    'private-state',
  ]) {
    assert.ok(!serialized.includes(privateValue), `${privateValue} should not be logged`)
  }
})

test('plugin audit error summaries omit private error messages', () => {
  const summary = summarizePluginResult(
    'plugin-bus:publish',
    {},
    new Error('failed to publish private.topic with token'),
  )

  assert.equal(summary.ok, false)
  assert.equal(summary.errorName, 'Error')
  assert.equal(summary.errorMessageLength, 42)
  assert.ok(!JSON.stringify(summary).includes('private.topic'))
  assert.ok(!JSON.stringify(summary).includes('token'))
})

test('plugin confirmation policy separates state-changing and reducing actions', () => {
  assert.equal(pluginActionNeedsConfirmation('plugin:start'), true)
  assert.equal(pluginActionNeedsConfirmation('plugin:restart'), true)
  assert.equal(pluginActionNeedsConfirmation('plugin:enable'), true)
  assert.equal(pluginActionNeedsConfirmation('plugin:approve'), true)
  assert.equal(pluginActionNeedsConfirmation('plugin:revoke'), true)
  assert.equal(pluginActionNeedsConfirmation('plugin:stop'), false)
  assert.equal(pluginActionNeedsConfirmation('plugin:disable'), false)

  assert.equal(pluginActionNeedsConfirmation('plugin-bus:publish'), true)
  assert.equal(pluginActionNeedsConfirmation('plugin-bus:subscribe'), true)
  assert.equal(pluginActionNeedsConfirmation('plugin-bus:unsubscribe'), true)
  assert.equal(pluginActionNeedsConfirmation('plugin-bus:stats'), false)
})
