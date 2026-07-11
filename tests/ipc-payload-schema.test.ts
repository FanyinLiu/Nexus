import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  validateChatCompletionPayload,
  validateAudioSynthesisPayload,
  validateAudioTranscriptionPayload,
  validateDesktopContextRequestPayload,
  validateDiscordSendMessagePayload,
  validateDiscordSendVoicePayload,
  validateExternalLinkToolPayload,
  validateExternalActionPolicySyncPayload,
  validateIntegrationInspectPayload,
  validateKwsOptionsPayload,
  validateLocalDataChatComparisonPayload,
  validateLocalDataChatMigrationApplyPayload,
  validateLocalDataChatMigrationRollbackPayload,
  validateLocalDataChatRuntimeMirrorPayload,
  validateLocalDataCompanionComparisonPayload,
  validateLocalDataMemoryMigrationApplyPayload,
  validateLocalDataMemoryMigrationRollbackPayload,
  validateLocalDataOnboardingMirrorPayload,
  validateMcpCallToolPayload,
  validateMcpSyncServersPayload,
  validateMediaSessionControlPayload,
  validateMemoryVectorIndexPayload,
  validateModelDownloadPayload,
  validatePluginBusRecentPayload,
  validatePluginIdPayload,
  validatePetWindowStatePayload,
  validatePetModelCreatorKitCreatePayload,
  validatePetModelCreatorKitInstallPayload,
  validatePetModelCreatorKitOpenPathPayload,
  validatePetModelCreatorKitOptionalPathPayload,
  validatePetModelGalleryImportPayload,
  validatePetModelGalleryListPayload,
  validateRuntimeHeartbeatPayload,
  validateRuntimeStateUpdatePayload,
  validateServiceConnectionTestPayload,
  validateSkillIdPayload,
  validateSkillSavePayload,
  validateSkillSearchPayload,
  validateTelegramSendMessagePayload,
  validateTelegramSendVoicePayload,
  validateTextFileOpenPayload,
  validateTextFileSavePayload,
  validateTtsStreamAbortPayload,
  validateTtsStreamFinishPayload,
  validateTtsStreamPushTextPayload,
  validateTtsStreamStartPayload,
  validateVadStartPayload,
  validateWebSearchToolPayload,
  validateWindowDragPayload,
} from '../electron/ipc/payloadSchemas.js'

test('IPC memory migration schema bounds content-bearing records and rejects unknown fields', () => {
  const migrationPackage = {
    schemaVersion: 1,
    createdAt: '2026-06-19T11:00:00.000Z',
    source: {
      longTermKeyPresent: true,
      legacyLongTermKeyPresent: false,
      dailyKeyPresent: true,
      legacyLongTermUsed: false,
    },
    longTerm: [{
      id: 'memory-1',
      content: 'private content',
      category: 'preference',
      source: 'chat',
      enabled: true,
      createdAt: '2026-06-19T10:00:00.000Z',
    }],
    daily: [{
      id: 'daily-1',
      day: '2026-06-19',
      role: 'user',
      content: 'private daily content',
      source: 'voice',
      createdAt: '2026-06-19T10:30:00.000Z',
    }],
  }

  assert.deepEqual(
    validateLocalDataMemoryMigrationApplyPayload({ confirmed: true, migrationPackage }),
    { confirmed: true, migrationPackage },
  )
  assert.deepEqual(validateLocalDataMemoryMigrationRollbackPayload({ confirmed: false }), { confirmed: false })
  assert.throws(
    () => validateLocalDataMemoryMigrationApplyPayload({
      confirmed: true,
      migrationPackage: {
        ...migrationPackage,
        longTerm: [{ ...migrationPackage.longTerm[0], secretField: 'must reject' }],
      },
    }),
    /secretField is not allowed/,
  )
})

test('IPC companion comparison schema accepts metadata only and rejects content fields', () => {
  const source = {
    schemaVersion: 1,
    generatedAt: '2026-07-09T20:00:00.000Z',
    relationship: [{
      id: 'relationship-state',
      storageKey: 'nexus:autonomy:relationship',
      recordCount: 1,
      payloadBytes: 48,
    }],
    tasks: [],
  }

  assert.deepEqual(
    validateLocalDataCompanionComparisonPayload({ confirmed: true, source }),
    { confirmed: true, source },
  )
  assert.throws(
    () => validateLocalDataCompanionComparisonPayload({
      confirmed: true,
      source: {
        ...source,
        relationship: [{ ...source.relationship[0], value: 'must not cross comparison boundary' }],
      },
    }),
    /value is not allowed/,
  )
})

test('IPC window state schema strips unknown keys and rejects wrong types', () => {
  assert.deepEqual(
    validatePetWindowStatePayload({
      isPinned: true,
      clickThrough: false,
      unknown: 'ignored',
    }),
    {
      isPinned: true,
      clickThrough: false,
    },
  )

  assert.throws(
    () => validatePetWindowStatePayload({ isPinned: 'true' }),
    /Invalid IPC payload for pet-window:update-state: payload\.isPinned must be a boolean/,
  )
})

test('IPC runtime schema normalizes heartbeat and preserves hearing state fields', () => {
  assert.deepEqual(validateRuntimeHeartbeatPayload(undefined), { view: 'pet' })
  assert.deepEqual(validateRuntimeHeartbeatPayload({ view: 'panel' }), { view: 'panel' })

  assert.deepEqual(
    validateRuntimeStateUpdatePayload({
      hearingEngine: 'browser-vad',
      hearingPhase: 'listening',
      wakewordActive: true,
      extra: 'ignored',
    }),
    {
      hearingEngine: 'browser-vad',
      hearingPhase: 'listening',
      wakewordActive: true,
    },
  )

  assert.equal(
    validateRuntimeStateUpdatePayload({ activeTaskLabel: 'x'.repeat(300) }).activeTaskLabel.length,
    256,
  )
})

test('IPC window command schemas reject invalid action payloads', () => {
  assert.deepEqual(validateWindowDragPayload({ x: 12, y: -4 }), { x: 12, y: -4 })
  assert.throws(
    () => validateWindowDragPayload({ x: Number.NaN, y: 0 }),
    /payload\.x must be a finite number/,
  )

  assert.deepEqual(validateMediaSessionControlPayload({ action: 'next' }), { action: 'next' })
  assert.throws(
    () => validateMediaSessionControlPayload({ action: 'seek' }),
    /payload\.action must be one of: play, pause, toggle, next, previous/,
  )
})

test('IPC desktop context schema accepts policy booleans only', () => {
  assert.deepEqual(
    validateDesktopContextRequestPayload({
      includeActiveWindow: true,
      includeClipboard: false,
      policy: {
        activeWindow: true,
        clipboard: false,
        screenshot: true,
        unknown: 'ignored',
      },
    }),
    {
      includeActiveWindow: true,
      includeClipboard: false,
      policy: {
        activeWindow: true,
        clipboard: false,
        screenshot: true,
      },
    },
  )

  assert.throws(
    () => validateDesktopContextRequestPayload({ includeScreenshot: 'yes' }),
    /payload\.includeScreenshot must be a boolean/,
  )
})

test('IPC audio schemas bound renderer payload shape before network work', () => {
  assert.deepEqual(
    validateAudioTranscriptionPayload({
      providerId: 'openai-transcribe',
      baseUrl: 'https://api.example.test/v1',
      apiKey: 'nexus-vault-ref:token',
      audioBase64: 'AAAA',
      mimeType: 'audio/webm',
      ignored: true,
    }),
    {
      providerId: 'openai-transcribe',
      baseUrl: 'https://api.example.test/v1',
      apiKey: 'nexus-vault-ref:token',
      audioBase64: 'AAAA',
      mimeType: 'audio/webm',
    },
  )

  assert.throws(
    () => validateAudioTranscriptionPayload({
      providerId: 'openai-transcribe',
      baseUrl: 'https://api.example.test/v1',
      apiKey: '',
      audioBase64: 123,
      mimeType: 'audio/webm',
    }),
    /payload\.audioBase64 must be a string/,
  )

  assert.deepEqual(
    validateAudioSynthesisPayload({
      providerId: 'openai-tts',
      baseUrl: 'https://api.example.test/v1',
      apiKey: 'nexus-vault-ref:token',
      text: 'hello',
      rate: 1.2,
      volume: 1,
    }),
    {
      providerId: 'openai-tts',
      baseUrl: 'https://api.example.test/v1',
      apiKey: 'nexus-vault-ref:token',
      text: 'hello',
      rate: 1.2,
      volume: 1,
    },
  )

  assert.throws(
    () => validateAudioSynthesisPayload({
      providerId: 'openai-tts',
      baseUrl: 'https://api.example.test/v1',
      apiKey: '',
      text: 'hello',
      rate: 10,
    }),
    /payload\.rate must be <= 4/,
  )
})

test('IPC chat and service schemas bound large request objects', () => {
  assert.deepEqual(
    validateChatCompletionPayload('chat:complete', {
      baseUrl: 'https://api.example.test/v1',
      apiKey: 'nexus-vault-ref:token',
      model: 'gpt-test',
      messages: [
        { role: 'system', content: 'brief' },
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      ],
      temperature: 0.4,
      unknown: 'ignored',
    }),
    {
      baseUrl: 'https://api.example.test/v1',
      apiKey: 'nexus-vault-ref:token',
      model: 'gpt-test',
      messages: [
        { role: 'system', content: 'brief' },
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      ],
      temperature: 0.4,
    },
  )

  assert.throws(
    () => validateChatCompletionPayload('chat:complete', {
      baseUrl: 'https://api.example.test/v1',
      apiKey: '',
      model: 'gpt-test',
      messages: [{ role: 'operator', content: 'bad' }],
    }),
    /payload\.messages\[0\]\.role must be one of: system, user, assistant, tool/,
  )

  assert.deepEqual(
    validateServiceConnectionTestPayload({
      providerId: 'openai',
      baseUrl: 'https://api.example.test/v1',
      apiKey: '',
      capability: 'speech-output',
      voice: 'alloy',
    }),
    {
      providerId: 'openai',
      baseUrl: 'https://api.example.test/v1',
      apiKey: '',
      capability: 'speech-output',
      voice: 'alloy',
    },
  )
})

test('IPC tool schemas reject oversized or invalid renderer tool payloads', () => {
  assert.deepEqual(
    validateWebSearchToolPayload({
      query: 'nexus desktop',
      limit: 5,
      keywords: ['nexus'],
      policy: { enabled: true, requiresConfirmation: false, extra: 'ignored' },
    }),
    {
      query: 'nexus desktop',
      limit: 5,
      keywords: ['nexus'],
      policy: { enabled: true, requiresConfirmation: false },
    },
  )

  assert.throws(
    () => validateWebSearchToolPayload({ query: 'nexus', limit: 100 }),
    /payload\.limit must be <= 20/,
  )

  assert.deepEqual(
    validateExternalLinkToolPayload({ url: 'https://example.test', policy: { requiresConfirmation: true } }),
    { url: 'https://example.test', policy: { requiresConfirmation: true } },
  )
})

test('IPC text file schemas bound file dialog payloads without reading files', () => {
  assert.deepEqual(
    validateTextFileSavePayload({
      title: 'Save chat history',
      defaultFileName: 'nexus-chat-history.json',
      content: '{"messages":[]}',
      filters: [{ name: 'JSON', extensions: ['json'], ignored: true }],
      ignored: true,
    }),
    {
      title: 'Save chat history',
      defaultFileName: 'nexus-chat-history.json',
      content: '{"messages":[]}',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    },
  )

  assert.deepEqual(
    validateTextFileOpenPayload({
      title: 'Open memory archive',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      ignored: true,
    }),
    {
      title: 'Open memory archive',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    },
  )

  assert.throws(
    () => validateTextFileSavePayload({
      title: 'Save',
      defaultFileName: 'archive.json',
      content: 'x'.repeat(10_000_001),
    }),
    /payload\.content must be at most 10000000 characters/,
  )

  assert.throws(
    () => validateTextFileOpenPayload({
      title: 'Open',
      filters: [{ name: 'Bad', extensions: ['../secret'] }],
    }),
    /payload\.filters\[0\]\.extensions\[0\] has an invalid format/,
  )
})

test('IPC memory and workspace schemas reject malformed storage payloads', () => {
  assert.deepEqual(
    validateMemoryVectorIndexPayload({
      id: 'memory-1',
      content: 'hello',
      embedding: [0.1, -0.2],
      layer: 'long_term',
      ignored: true,
    }),
    {
      id: 'memory-1',
      content: 'hello',
      embedding: [0.1, -0.2],
      layer: 'long_term',
    },
  )

  assert.throws(
    () => validateMemoryVectorIndexPayload({
      id: 'memory-1',
      content: 'hello',
      embedding: [Number.NaN],
    }),
    /payload\.embedding\[0\] must be a finite number/,
  )
})

test('IPC MCP and plugin schemas bound command and plugin surfaces', () => {
  assert.deepEqual(
    validateMcpCallToolPayload({
      serverId: 'srv',
      name: 'search',
      arguments: { query: 'nexus' },
      ignored: true,
    }),
    {
      serverId: 'srv',
      name: 'search',
      arguments: { query: 'nexus' },
    },
  )

  assert.deepEqual(
    validateMcpSyncServersPayload({
      servers: [
        { id: 'srv', label: 'Server', command: 'node', args: 'server.js', enabled: true, ignored: true },
      ],
    }),
    {
      servers: [
        { id: 'srv', label: 'Server', command: 'node', args: 'server.js', enabled: true },
      ],
    },
  )

  assert.deepEqual(validatePluginIdPayload('plugin:start', { id: 'plugin-a', ignored: true }), { id: 'plugin-a' })
  assert.deepEqual(validatePluginBusRecentPayload({ limit: 50 }), { limit: 50 })
  assert.throws(
    () => validatePluginBusRecentPayload({ limit: 500 }),
    /payload\.limit must be <= 200/,
  )
})

test('IPC external action schemas bound outbound message payloads', () => {
  assert.deepEqual(
    validateTelegramSendMessagePayload({
      chatId: -100123456,
      text: '  hello  ',
      replyToMessageId: 42,
      parseMode: ' Markdown ',
      ignored: 'drop',
    }),
    {
      chatId: -100123456,
      text: 'hello',
      replyToMessageId: 42,
      parseMode: 'Markdown',
    },
  )

  assert.deepEqual(
    validateDiscordSendMessagePayload({
      channelId: ' 123456789012345678 ',
      text: ' hi ',
      replyToMessageId: ' abc ',
    }),
    {
      channelId: '123456789012345678',
      text: 'hi',
      replyToMessageId: 'abc',
    },
  )

  assert.deepEqual(
    validateTelegramSendVoicePayload({
      chatId: 123,
      audioBase64: 'YWJj',
      mimeType: ' audio/ogg ',
    }),
    {
      chatId: 123,
      audioBase64: 'YWJj',
      mimeType: 'audio/ogg',
    },
  )

  assert.deepEqual(
    validateDiscordSendVoicePayload({
      channelId: '123456789012345678',
      audioBase64: 'YWJj',
      mimeType: 'audio/ogg',
    }),
    {
      channelId: '123456789012345678',
      audioBase64: 'YWJj',
      mimeType: 'audio/ogg',
    },
  )

  assert.throws(
    () => validateTelegramSendMessagePayload({ chatId: 1.5, text: 'hello' }),
    /payload\.chatId must be an integer/,
  )
  assert.throws(
    () => validateDiscordSendMessagePayload({ channelId: '123', text: '' }),
    /payload\.text must be a non-empty string/,
  )
})

test('IPC external action policy schema accepts modes and active flags only', () => {
  assert.deepEqual(
    validateExternalActionPolicySyncPayload({
      policies: {
        telegram: { mode: 'auto', active: true, token: 'secret' },
        discord: { mode: 'confirm', active: false },
        minecraft: { mode: 'read-only' },
        factorio: undefined,
        mcp: { mode: 'auto', active: true },
        ignored: { mode: 'auto', active: true },
      },
    }),
    {
      policies: {
        telegram: { mode: 'auto', active: true },
        discord: { mode: 'confirm', active: false },
        minecraft: { mode: 'read-only' },
        mcp: { mode: 'auto', active: true },
      },
    },
  )

  assert.throws(
    () => validateExternalActionPolicySyncPayload({
      policies: {
        telegram: { mode: 'always', active: true },
      },
    }),
    /payload\.policies\.telegram\.mode must be one of: read-only, confirm, auto/,
  )
})

test('IPC local data onboarding mirror schema rejects unknown or oversized fields', () => {
  assert.deepEqual(
    validateLocalDataOnboardingMirrorPayload({
      state: {
        completedAt: ' 2026-06-04T09:00:00.000Z ',
        firstConversationAt: ' 2026-06-04T09:04:59.000Z ',
        firstConversationElapsedMs: 299000,
      },
    }),
    {
      state: {
        completedAt: '2026-06-04T09:00:00.000Z',
        firstConversationAt: '2026-06-04T09:04:59.000Z',
        firstConversationElapsedMs: 299000,
      },
    },
  )

  assert.deepEqual(validateLocalDataOnboardingMirrorPayload(undefined), {})
  assert.throws(
    () => validateLocalDataOnboardingMirrorPayload({
      state: {
        completedAt: '2026-06-04T09:00:00.000Z',
        note: 'should not cross into main process',
      },
    }),
    /payload\.state\.note is not allowed/,
  )
  assert.throws(
    () => validateLocalDataOnboardingMirrorPayload({
      state: {
        completedAt: '2026-06-04T09:00:00.000Z',
        firstConversationElapsedMs: 100_000_000,
      },
    }),
    /payload\.state\.firstConversationElapsedMs must be <= 86400000/,
  )
})

test('IPC local data chat migration schema bounds content-bearing packages', () => {
  const packagePayload = {
    confirmed: true,
    migrationPackage: {
      schemaVersion: 1,
      createdAt: ' 2026-06-19T08:00:00.000Z ',
      source: {
        sessionsKeyPresent: true,
        legacyFlatChatKeyPresent: false,
        legacyFlatChatUsed: false,
      },
      dryRunReport: { status: 'needs_review', contentFree: true },
      sessions: [{
        id: ' session-1 ',
        startedAt: 1781856000000,
        lastActiveAt: 1781856300000,
        title: ' Private title ',
        messages: [{
          id: ' msg-1 ',
          role: 'user',
          content: 'private message content',
          createdAt: ' 2026-06-19T08:00:00.000Z ',
        }],
      }],
    },
  }

  assert.deepEqual(validateLocalDataChatMigrationApplyPayload(packagePayload), {
    confirmed: true,
    migrationPackage: {
      schemaVersion: 1,
      createdAt: '2026-06-19T08:00:00.000Z',
      source: {
        sessionsKeyPresent: true,
        legacyFlatChatKeyPresent: false,
        legacyFlatChatUsed: false,
      },
      dryRunReport: { status: 'needs_review', contentFree: true },
      sessions: [{
        id: 'session-1',
        startedAt: 1781856000000,
        lastActiveAt: 1781856300000,
        title: 'Private title',
        messages: [{
          id: 'msg-1',
          role: 'user',
          content: 'private message content',
          createdAt: '2026-06-19T08:00:00.000Z',
        }],
      }],
    },
  })
  assert.deepEqual(validateLocalDataChatMigrationRollbackPayload({ confirmed: true }), { confirmed: true })
  assert.deepEqual(validateLocalDataChatRuntimeMirrorPayload({
    confirmed: true,
    session: {
      id: ' session-1 ',
      startedAt: 1781856000000,
      lastActiveAt: 1781856300000,
      title: ' Private title ',
      messages: [{
        id: ' msg-1 ',
        role: 'user',
        content: 'private message content',
        createdAt: ' 2026-06-19T08:00:00.000Z ',
      }],
    },
  }), {
    confirmed: true,
    session: {
      id: 'session-1',
      startedAt: 1781856000000,
      lastActiveAt: 1781856300000,
      title: 'Private title',
      messages: [{
        id: 'msg-1',
        role: 'user',
        content: 'private message content',
        createdAt: '2026-06-19T08:00:00.000Z',
      }],
    },
  })
  assert.deepEqual(validateLocalDataChatComparisonPayload({
    confirmed: true,
    source: {
      schemaVersion: 1,
      generatedAt: ' 2026-06-19T08:01:00.000Z ',
      source: {
        sessionsKeyPresent: true,
        legacyFlatChatKeyPresent: false,
        legacyFlatChatUsed: false,
      },
      sessions: [{
        id: ' session-1 ',
        startedAt: 1781856000000,
        lastActiveAt: 1781856300000,
        messageCount: 1,
        payloadBytes: 512,
      }],
    },
  }), {
    confirmed: true,
    source: {
      schemaVersion: 1,
      generatedAt: '2026-06-19T08:01:00.000Z',
      source: {
        sessionsKeyPresent: true,
        legacyFlatChatKeyPresent: false,
        legacyFlatChatUsed: false,
      },
      sessions: [{
        id: 'session-1',
        startedAt: 1781856000000,
        lastActiveAt: 1781856300000,
        messageCount: 1,
        payloadBytes: 512,
      }],
    },
  })

  assert.throws(
    () => validateLocalDataChatMigrationApplyPayload({
      ...packagePayload,
      migrationPackage: {
        ...packagePayload.migrationPackage,
        sessions: [{
          ...packagePayload.migrationPackage.sessions[0],
          privateExtra: true,
        }],
      },
    }),
    /payload\.migrationPackage\.sessions\[0\]\.privateExtra is not allowed/,
  )
  assert.throws(
    () => validateLocalDataChatMigrationApplyPayload({
      ...packagePayload,
      migrationPackage: {
        ...packagePayload.migrationPackage,
        sessions: [{
          ...packagePayload.migrationPackage.sessions[0],
          messages: [{
            ...packagePayload.migrationPackage.sessions[0].messages[0],
            content: 'x'.repeat(200_001),
          }],
        }],
      },
    }),
    /payload\.migrationPackage\.sessions\[0\]\.messages\[0\]\.content must be at most 200000 characters/,
  )
  assert.throws(
    () => validateLocalDataChatMigrationRollbackPayload({ confirmed: true, recordId: 'session-1' }),
    /payload\.recordId is not allowed/,
  )
  assert.throws(
    () => validateLocalDataChatComparisonPayload({
      confirmed: true,
      source: {
        schemaVersion: 1,
        generatedAt: '2026-06-19T08:01:00.000Z',
        source: {
          sessionsKeyPresent: true,
          legacyFlatChatKeyPresent: false,
          legacyFlatChatUsed: false,
        },
        sessions: [{
          id: 'session-1',
          startedAt: 1781856000000,
          lastActiveAt: 1781856300000,
          messageCount: 1,
          payloadBytes: 512,
          content: 'private message content',
        }],
      },
    }),
    /payload\.source\.sessions\[0\]\.content is not allowed/,
  )
  assert.throws(
    () => validateLocalDataChatComparisonPayload({
      confirmed: true,
      source: {
        schemaVersion: 1,
        generatedAt: '2026-06-19T08:01:00.000Z',
        source: {
          sessionsKeyPresent: true,
          legacyFlatChatKeyPresent: false,
          legacyFlatChatUsed: false,
        },
        sessions: [{
          id: 'session-1',
          startedAt: 1781856000000,
          lastActiveAt: 1781856300000,
          messageCount: 501,
          payloadBytes: 512,
        }],
      },
    }),
    /payload\.source\.sessions\[0\]\.messageCount must be <= 500/,
  )
  assert.throws(
    () => validateLocalDataChatRuntimeMirrorPayload({
      confirmed: true,
      session: {
        id: 'session-1',
        startedAt: 1781856000000,
        lastActiveAt: 1781856300000,
        messages: [{
          id: 'msg-1',
          role: 'user',
          content: 'private message content',
          createdAt: '2026-06-19T08:00:00.000Z',
          images: ['data:image/png;base64,ignored'],
        }],
      },
    }),
    /payload\.session\.messages\[0\]\.images is not allowed/,
  )
  assert.throws(
    () => validateLocalDataChatRuntimeMirrorPayload({
      confirmed: true,
      session: {
        id: 'session-1',
        startedAt: 1781856000000,
        lastActiveAt: 1781856300000,
        messages: [{
          id: 'msg-1',
          role: 'user',
          content: 'x'.repeat(200_001),
          createdAt: '2026-06-19T08:00:00.000Z',
        }],
      },
    }),
    /payload\.session\.messages\[0\]\.content must be at most 200000 characters/,
  )
})

test('IPC pet model schemas bound local artifact payloads', () => {
  assert.equal(
    validatePetModelGalleryImportPayload('  https://codex-pet.example/pet.zip  '),
    'https://codex-pet.example/pet.zip',
  )
  assert.deepEqual(
    validatePetModelGalleryListPayload({ query: '  solid box  ', limit: 12, ignored: true }),
    {
      query: 'solid box',
      limit: 12,
    },
  )
  assert.deepEqual(
    validatePetModelCreatorKitCreatePayload({
      id: ' pet-1 ',
      displayName: '  Private Pet  ',
      concept: '  tiny helper  ',
      ignored: 'drop',
    }),
    {
      id: 'pet-1',
      displayName: 'Private Pet',
      concept: 'tiny helper',
    },
  )
  assert.deepEqual(
    validatePetModelCreatorKitOptionalPathPayload('pet-model:inspect-creator-kit', {
      kitDirectory: '  /Users/me/private-kit  ',
    }),
    {
      kitDirectory: '/Users/me/private-kit',
    },
  )
  assert.deepEqual(
    validatePetModelCreatorKitInstallPayload({
      kitDirectory: ' /Users/me/private-kit ',
      manifestPath: ' /Users/me/private-kit/pet.json ',
    }),
    {
      kitDirectory: '/Users/me/private-kit',
      manifestPath: '/Users/me/private-kit/pet.json',
    },
  )
  assert.deepEqual(
    validatePetModelCreatorKitOpenPathPayload({
      kitDirectory: '/Users/me/private-kit',
      targetPath: '/Users/me/private-kit/pet.json',
      mode: 'reveal',
    }),
    {
      kitDirectory: '/Users/me/private-kit',
      targetPath: '/Users/me/private-kit/pet.json',
      mode: 'reveal',
    },
  )

  assert.throws(
    () => validatePetModelGalleryImportPayload(''),
    /payload must be a non-empty string/,
  )
  assert.throws(
    () => validatePetModelGalleryListPayload({ limit: 0 }),
    /payload\.limit must be >= 1/,
  )
  assert.throws(
    () => validatePetModelCreatorKitOpenPathPayload({
      kitDirectory: '/Users/me/private-kit',
      targetPath: '/Users/me/private-kit/pet.json',
      mode: 'launch',
    }),
    /payload\.mode must be one of: open, reveal/,
  )
})

test('IPC remaining runtime schemas bound integration voice model and TTS payloads', () => {
  assert.deepEqual(
    validateIntegrationInspectPayload({
      mcpServers: [{
        id: 'mcp-1',
        label: 'Local MCP',
        command: '/usr/bin/node',
        args: 'server.js',
        enabled: true,
        ignored: true,
      }],
      minecraftIntegrationEnabled: true,
      minecraftServerAddress: ' localhost ',
      minecraftServerPort: 25565,
      minecraftUsername: ' steve ',
      factorioIntegrationEnabled: false,
      factorioServerAddress: ' factorio.local ',
      factorioServerPort: 34197,
      factorioUsername: ' engineer ',
      ignored: true,
    }),
    {
      mcpServers: [{
        id: 'mcp-1',
        label: 'Local MCP',
        command: '/usr/bin/node',
        args: 'server.js',
        enabled: true,
      }],
      minecraftIntegrationEnabled: true,
      minecraftServerAddress: 'localhost',
      minecraftServerPort: 25565,
      minecraftUsername: 'steve',
      factorioIntegrationEnabled: false,
      factorioServerAddress: 'factorio.local',
      factorioServerPort: 34197,
      factorioUsername: 'engineer',
    },
  )

  assert.deepEqual(validateModelDownloadPayload({ modelId: '  sensevoice  ', ignored: true }), {
    modelId: 'sensevoice',
  })

  assert.deepEqual(validateKwsOptionsPayload('kws:start', undefined), {})
  assert.deepEqual(validateKwsOptionsPayload('kws:status', { wakeWord: '  Nexus  ', ignored: true }), {
    wakeWord: 'Nexus',
  })

  assert.deepEqual(validateVadStartPayload({
    threshold: 0.35,
    minSilenceDuration: 0.9,
    minSpeechDuration: 0.08,
    maxSpeechDuration: 20,
    ignored: true,
  }), {
    threshold: 0.35,
    minSilenceDuration: 0.9,
    minSpeechDuration: 0.08,
    maxSpeechDuration: 20,
  })

  assert.deepEqual(validateTtsStreamStartPayload({
    requestId: ' req-1 ',
    providerId: 'edge-tts',
    baseUrl: 'http://localhost:3000',
    apiKey: 'nexus-vault-ref:token',
    model: 'cluster-a',
    voice: 'voice-a',
    instructions: 'speak warmly',
    language: 'en-US',
    rate: 1,
    pitch: 0,
    volume: 1,
    ignored: true,
  }), {
    requestId: 'req-1',
    providerId: 'edge-tts',
    baseUrl: 'http://localhost:3000',
    apiKey: 'nexus-vault-ref:token',
    model: 'cluster-a',
    voice: 'voice-a',
    instructions: 'speak warmly',
    language: 'en-US',
    rate: 1,
    pitch: 0,
    volume: 1,
  })

  assert.deepEqual(validateTtsStreamPushTextPayload({
    requestId: ' req-1 ',
    text: ' hello ',
    ignored: true,
  }), {
    requestId: 'req-1',
    text: 'hello',
  })

  assert.deepEqual(validateTtsStreamFinishPayload({ requestId: ' req-1 ', ignored: true }), {
    requestId: 'req-1',
  })
  assert.deepEqual(validateTtsStreamAbortPayload({ requestId: ' req-1 ', ignored: true }), {
    requestId: 'req-1',
  })

  assert.throws(
    () => validateIntegrationInspectPayload({
      mcpServers: [],
      minecraftIntegrationEnabled: true,
      minecraftServerAddress: 'localhost',
      minecraftServerPort: 0,
      minecraftUsername: 'steve',
      factorioIntegrationEnabled: false,
      factorioServerAddress: 'factorio.local',
      factorioServerPort: 34197,
      factorioUsername: 'engineer',
    }),
    /payload\.minecraftServerPort must be >= 1/,
  )
  assert.throws(
    () => validateModelDownloadPayload({ modelId: '' }),
    /payload\.modelId must be a non-empty string/,
  )
  assert.throws(
    () => validateVadStartPayload({ threshold: 2 }),
    /payload\.threshold must be <= 1/,
  )
  assert.throws(
    () => validateTtsStreamPushTextPayload({ requestId: 'req-1', text: '   ' }),
    /payload\.text must be a non-empty string/,
  )
  assert.throws(
    () => validateTtsStreamFinishPayload({}),
    /payload\.requestId is required/,
  )
})

test('IPC skill schemas bound persisted skill payloads and file ids', () => {
  assert.deepEqual(
    validateSkillSavePayload({
      id: ' skill-1 ',
      title: ' Research workflow ',
      trigger: ' research, summarize ',
      summary: ' Summarize source-backed findings. ',
      content: ' # Steps\nUse sources. ',
      ignored: true,
    }),
    {
      id: 'skill-1',
      title: 'Research workflow',
      trigger: 'research, summarize',
      summary: 'Summarize source-backed findings.',
      content: '# Steps\nUse sources.',
    },
  )

  assert.throws(
    () => validateSkillSavePayload({
      id: '../outside',
      title: 'Research workflow',
      trigger: 'research',
      summary: 'summary',
      content: 'body',
    }),
    /Invalid IPC payload for skill:save: payload\.id has an invalid format/,
  )

  assert.throws(
    () => validateSkillSavePayload({
      id: 'skill-1',
      title: 'Research workflow',
      trigger: 'research',
      summary: 'summary',
      content: '   ',
    }),
    /Invalid IPC payload for skill:save: payload\.content must be a non-empty string/,
  )

  assert.deepEqual(validateSkillSearchPayload({ query: '  research workflow ', limit: 2 }), {
    query: 'research workflow',
    limit: 2,
  })
  assert.throws(
    () => validateSkillSearchPayload({ query: 'research', limit: 2.5 }),
    /Invalid IPC payload for skill:search: payload\.limit must be an integer/,
  )
  assert.throws(
    () => validateSkillSearchPayload({ query: 'research', limit: 50 }),
    /Invalid IPC payload for skill:search: payload\.limit must be <= 20/,
  )

  assert.deepEqual(validateSkillIdPayload('skill:get', { id: ' auto-ab12-cd34 ', ignored: true }), {
    id: 'auto-ab12-cd34',
  })
  assert.throws(
    () => validateSkillIdPayload('skill:remove', { id: '' }),
    /Invalid IPC payload for skill:remove: payload\.id must be a non-empty string/,
  )
  assert.throws(
    () => validateSkillIdPayload('skill:mark-used', { id: '.hidden' }),
    /Invalid IPC payload for skill:mark-used: payload\.id has an invalid format/,
  )
})
