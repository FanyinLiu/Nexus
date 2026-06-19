import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  summarizeExternalActionRequest,
  summarizeExternalActionResult,
} from '../electron/ipc/externalActionAudit.js'

test('external action audit summaries exclude message, command, audio, and target contents', () => {
  const messageSummary = summarizeExternalActionRequest('telegram:send-message', {
    chatId: -100123456,
    text: 'private reminder text',
    replyToMessageId: 7788,
    parseMode: 'Markdown',
  })

  assert.deepEqual(messageSummary, {
    channel: 'telegram:send-message',
    integration: 'telegram',
    actionKind: 'send-message',
    target: {
      kind: 'chatId',
      present: true,
      idLength: 10,
    },
    content: {
      textLength: 21,
      parseModePresent: true,
      parseModeLength: 8,
      replyTo: {
        present: true,
        idLength: 4,
      },
    },
  })

  const voiceSummary = summarizeExternalActionRequest('discord:send-voice', {
    channelId: '123456789012345678',
    audioBase64: 'c2VjcmV0LWF1ZGlv',
    mimeType: 'audio/ogg',
    replyToMessageId: 'reply-secret',
  })

  assert.equal(voiceSummary.content.audioBase64Length, 16)
  assert.equal(voiceSummary.target.idLength, 18)

  const commandSummary = summarizeExternalActionRequest('factorio:execute', {
    command: '/secret command',
  })
  assert.deepEqual(commandSummary.command, { commandLength: 15 })

  const serialized = JSON.stringify({ messageSummary, voiceSummary, commandSummary })
  for (const privateValue of [
    '-100123456',
    'private reminder text',
    '7788',
    '123456789012345678',
    'c2VjcmV0LWF1ZGlv',
    'reply-secret',
    '/secret command',
  ]) {
    assert.ok(!serialized.includes(privateValue), `${privateValue} should not be logged`)
  }
})

test('MCP audit summaries record shape without command, server, tool, or argument contents', () => {
  const syncSummary = summarizeExternalActionRequest('mcp:sync-servers', {
    servers: [
      {
        id: 'private-server',
        label: 'Private Server',
        command: '/Users/me/private/bin/server',
        args: '--token secret-token',
        enabled: true,
      },
    ],
  })

  assert.deepEqual(syncSummary, {
    channel: 'mcp:sync-servers',
    integration: 'mcp',
    actionKind: 'sync-servers',
    servers: {
      serverCount: 1,
      enabledCount: 1,
      commandCount: 1,
      commandTextTotalLength: 28,
      argsTextTotalLength: 20,
    },
  })

  const callSummary = summarizeExternalActionRequest('mcp:call-tool', {
    serverId: 'private-server',
    name: 'read_private_file',
    arguments: {
      path: '/Users/me/private.txt',
      token: 'secret-token',
    },
  })

  assert.deepEqual(callSummary.tool, {
    serverIdPresent: true,
    serverIdLength: 14,
    toolNameLength: 17,
    argumentsKind: 'object',
    argumentsKeyCount: 2,
  })

  const serialized = JSON.stringify({ syncSummary, callSummary })
  for (const privateValue of [
    'private-server',
    '/Users/me/private/bin/server',
    '--token secret-token',
    'read_private_file',
    '/Users/me/private.txt',
    'secret-token',
  ]) {
    assert.ok(!serialized.includes(privateValue), `${privateValue} should not be logged`)
  }
})

test('external action result summaries omit response and error text', () => {
  const success = summarizeExternalActionResult('factorio:execute', {
    response: 'private game response',
  })
  assert.deepEqual(success, {
    channel: 'factorio:execute',
    ok: true,
    resultKind: 'object',
    resultKeyCount: 1,
    responseLength: 21,
    errorName: undefined,
    errorMessageLength: 0,
  })

  const failure = summarizeExternalActionResult(
    'discord:send-message',
    {},
    new Error('private failure details'),
  )

  assert.equal(failure.ok, false)
  assert.equal(failure.resultKind, 'error')
  assert.equal(failure.errorName, 'Error')
  assert.equal(failure.errorMessageLength, 23)

  const serialized = JSON.stringify({ success, failure })
  assert.ok(!serialized.includes('private game response'))
  assert.ok(!serialized.includes('private failure details'))
})
