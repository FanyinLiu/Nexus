import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  validateChatCompletionPayload,
  validateAudioSynthesisPayload,
  validateAudioTranscriptionPayload,
  validateDesktopContextRequestPayload,
  validateExternalLinkToolPayload,
  validateMcpCallToolPayload,
  validateMcpSyncServersPayload,
  validateMediaSessionControlPayload,
  validateMemoryVectorIndexPayload,
  validatePluginBusRecentPayload,
  validatePluginIdPayload,
  validatePetWindowStatePayload,
  validateRuntimeHeartbeatPayload,
  validateRuntimeStateUpdatePayload,
  validateServiceConnectionTestPayload,
  validateWebSearchToolPayload,
  validateWorkspaceGrepPayload,
  validateWorkspaceWritePayload,
  validateWindowDragPayload,
} from '../electron/ipc/payloadSchemas.js'

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

  assert.deepEqual(
    validateWorkspaceWritePayload({ path: 'notes/a.md', content: 'body' }),
    { path: 'notes/a.md', content: 'body' },
  )

  assert.throws(
    () => validateWorkspaceGrepPayload({ query: 'x', maxResults: 500 }),
    /payload\.maxResults must be <= 200/,
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
