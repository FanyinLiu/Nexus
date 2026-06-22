import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  resolveExternalActionFailureCode,
  runAuditedExternalAction,
  summarizeExternalActionFinish,
  summarizeExternalActionRequest,
  summarizeExternalActionResult,
  summarizeExternalActionStart,
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

test('external action lifecycle audit records start finish duration and metadata-only payloads', async () => {
  const events: Array<{ category: string; action: string; details: Record<string, unknown> | undefined }> = []
  let nowMs = 1_000

  const result = await runAuditedExternalAction(
    'telegram:send-message',
    {
      chatId: -100123456,
      text: 'private lifecycle text',
      replyToMessageId: 99,
    },
    async () => {
      nowMs = 1_125
      return { response: 'private gateway response' }
    },
    {
      actionId: 'audit-1',
      now: () => nowMs,
      audit: (category, action, details) => events.push({ category, action, details }),
      requirePermission: async () => {},
    },
  )

  assert.deepEqual(result, { response: 'private gateway response' })
  assert.deepEqual(events.map((event) => [event.category, event.action]), [
    ['external-action', 'start'],
    ['external-action', 'finish'],
  ])

  assert.equal(events[0]?.details?.actionId, 'audit-1')
  assert.equal(events[0]?.details?.phase, 'start')
  assert.equal(events[0]?.details?.type, 'send-message')
  assert.equal(events[1]?.details?.actionId, 'audit-1')
  assert.equal(events[1]?.details?.phase, 'finish')
  assert.equal(events[1]?.details?.ok, true)
  assert.equal(events[1]?.details?.durationMs, 125)
  assert.equal(events[1]?.details?.failureCode, null)

  const serialized = JSON.stringify(events)
  for (const privateValue of [
    '-100123456',
    'private lifecycle text',
    'private gateway response',
    '99',
  ]) {
    assert.ok(!serialized.includes(privateValue), `${privateValue} should not be logged`)
  }
})

test('external action lifecycle audit records stable failure code without error text', async () => {
  const events: Array<{ category: string; action: string; details: Record<string, unknown> | undefined }> = []
  let nowMs = 2_000
  const error = new Error('private rejection details') as Error & { code?: string }
  error.code = 'external_action_rejected'

  await assert.rejects(
    () => runAuditedExternalAction(
      'discord:send-message',
      {
        channelId: '123456789012345678',
        text: 'private rejected text',
      },
      async () => ({ ok: true }),
      {
        actionId: 'audit-2',
        now: () => nowMs,
        audit: (category, action, details) => events.push({ category, action, details }),
        requirePermission: async () => {
          nowMs = 2_010
          throw error
        },
      },
    ),
    /private rejection details/,
  )

  assert.deepEqual(events.map((event) => event.action), ['start', 'finish'])
  assert.equal(events[1]?.details?.ok, false)
  assert.equal(events[1]?.details?.durationMs, 10)
  assert.equal(events[1]?.details?.failureCode, 'external_action_rejected')

  const serialized = JSON.stringify(events)
  for (const privateValue of [
    '123456789012345678',
    'private rejected text',
    'private rejection details',
  ]) {
    assert.ok(!serialized.includes(privateValue), `${privateValue} should not be logged`)
  }
})

test('external action lifecycle summary helpers expose type input result and failure code', () => {
  const error = new TypeError('private type details') as TypeError & { code?: string }
  error.code = 'bad code with spaces'

  const start = summarizeExternalActionStart('audit-3', 'mcp:call-tool', {
    serverId: 'private-server',
    name: 'read_private_file',
    arguments: { path: '/Users/me/private.txt' },
  })
  const finish = summarizeExternalActionFinish('audit-3', 'mcp:call-tool', 10, 42, {}, error)

  assert.equal(start.type, 'call-tool')
  assert.equal(start.input.integration, 'mcp')
  assert.equal(start.input.tool.argumentsKeyCount, 1)
  assert.equal(finish.durationMs, 32)
  assert.equal(finish.failureCode, 'bad_code_with_spaces')
  assert.equal(resolveExternalActionFailureCode(error), 'bad_code_with_spaces')

  const serialized = JSON.stringify({ start, finish })
  for (const privateValue of [
    'private-server',
    'read_private_file',
    '/Users/me/private.txt',
    'private type details',
  ]) {
    assert.ok(!serialized.includes(privateValue), `${privateValue} should not be logged`)
  }
})
