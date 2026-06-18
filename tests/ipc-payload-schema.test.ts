import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  validateChatCompletionPayload,
  validateAudioSynthesisPayload,
  validateAudioTranscriptionPayload,
  validateCodexPetGalleryInputPayload,
  validateCodexPetGalleryListPayload,
  validateConfirmDialogPayload,
  validateCreatorKitCreatePayload,
  validateCreatorKitInstallPayload,
  validateCreatorKitOpenPathPayload,
  validateCreatorKitOptionalDirectoryPayload,
  validateDesktopContextRequestPayload,
  validateExternalLinkToolPayload,
  validateIntegrationInspectPayload,
  validateKwsOptionsPayload,
  validateLaunchOnStartupPayload,
  validateMcpCallToolPayload,
  validateMcpSyncServersPayload,
  validateMediaSessionControlPayload,
  validateMemoryVectorIndexPayload,
  validateModelDownloadPayload,
  validateNotificationWatcherSetPayload,
  validatePersonaContentPayload,
  validatePersonaInitPayload,
  validatePersonaProfileIdPayload,
  validatePetFreeModePayload,
  validatePluginBusRecentPayload,
  validatePluginIdPayload,
  validateProactiveNotificationPayload,
  validatePetWindowStatePayload,
  validateRuntimeHeartbeatPayload,
  validateRuntimeStateUpdatePayload,
  validateServiceConnectionTestPayload,
  validateSkillIdPayload,
  validateSkillSavePayload,
  validateSkillSearchPayload,
  validateTextFileOpenPayload,
  validateTextFileSavePayload,
  validateTtsStreamPushTextPayload,
  validateTtsStreamRequestIdPayload,
  validateTtsStreamStartPayload,
  validateVadStartPayload,
  validateWebSearchToolPayload,
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

test('IPC desktop utility schemas validate launch, dialog, file, and integration payloads', () => {
  assert.equal(validateLaunchOnStartupPayload(true), true)
  assert.throws(
    () => validateLaunchOnStartupPayload('true'),
    /Invalid IPC payload for app:set-launch-on-startup: payload must be a boolean/,
  )

  assert.deepEqual(validatePetFreeModePayload({ freeMode: true, ignored: true }), { freeMode: true })
  assert.deepEqual(validatePetFreeModePayload(undefined), { freeMode: false })

  assert.equal(validateConfirmDialogPayload('x'.repeat(5_000)).length, 4_000)

  assert.deepEqual(
    validateTextFileSavePayload({
      title: ' Save ',
      defaultFileName: ' export.json ',
      content: '{"ok":true}',
      filters: [{ name: ' JSON ', extensions: [' json ', 'txt'] }],
      ignored: true,
    }),
    {
      title: 'Save',
      defaultFileName: 'export.json',
      content: '{"ok":true}',
      filters: [{ name: 'JSON', extensions: ['json', 'txt'] }],
    },
  )

  assert.throws(
    () => validateTextFileOpenPayload({ filters: [{ name: 'JSON', extensions: ['json', 42] }] }),
    /Invalid IPC payload for file:open-text: payload\.filters\[0\]\.extensions\[1\] must be a string/,
  )

  assert.deepEqual(
    validateIntegrationInspectPayload({
      mcpServers: [{ id: ' srv ', command: ' node ', args: ' server.js ', enabled: true, ignored: true }],
      minecraftIntegrationEnabled: true,
      minecraftServerAddress: ' localhost ',
      minecraftServerPort: 25565,
      minecraftUsername: ' Alex ',
      ignored: true,
    }),
    {
      mcpServers: [{ id: 'srv', command: 'node', args: 'server.js', enabled: true }],
      minecraftIntegrationEnabled: true,
      minecraftServerAddress: 'localhost',
      minecraftServerPort: 25565,
      minecraftUsername: 'Alex',
    },
  )

  assert.throws(
    () => validateIntegrationInspectPayload({ factorioServerPort: 70_000 }),
    /Invalid IPC payload for integrations:inspect: payload\.factorioServerPort must be <= 65535/,
  )
})

test('IPC persona and pet creator schemas bound local file workflows', () => {
  assert.deepEqual(validatePersonaContentPayload('persona:save-soul', { content: 'hello', ignored: true }), {
    content: 'hello',
  })
  assert.deepEqual(validatePersonaInitPayload(undefined), { defaultSoul: '' })
  assert.deepEqual(validatePersonaProfileIdPayload('persona:load-profile', { profileId: ' star-hui ' }), {
    profileId: 'star-hui',
  })
  assert.throws(
    () => validatePersonaProfileIdPayload('persona:profile-dir', { profileId: '   ' }),
    /Invalid IPC payload for persona:profile-dir: payload\.profileId must be a non-empty string/,
  )

  assert.equal(validateCodexPetGalleryInputPayload(' codex-pet-slug '), 'codex-pet-slug')
  assert.deepEqual(validateCodexPetGalleryListPayload({ query: ' cat ', limit: 12, ignored: true }), {
    query: 'cat',
    limit: 12,
  })
  assert.deepEqual(
    validateCreatorKitCreatePayload({
      displayName: ' Star Hui ',
      concept: ' desktop companion ',
      styleNotes: 'soft idle',
      ignored: true,
    }),
    {
      displayName: 'Star Hui',
      concept: 'desktop companion',
      styleNotes: 'soft idle',
    },
  )
  assert.deepEqual(
    validateCreatorKitOptionalDirectoryPayload('pet-model:inspect-creator-kit', {
      kitDirectory: ' /tmp/nexus-kit ',
      ignored: true,
    }),
    { kitDirectory: '/tmp/nexus-kit' },
  )
  assert.deepEqual(
    validateCreatorKitInstallPayload({
      kitDirectory: ' /tmp/nexus-kit ',
      manifestPath: ' /tmp/nexus-kit/pet.json ',
      ignored: true,
    }),
    {
      kitDirectory: '/tmp/nexus-kit',
      manifestPath: '/tmp/nexus-kit/pet.json',
    },
  )
  assert.deepEqual(
    validateCreatorKitOpenPathPayload({
      kitDirectory: '/tmp/nexus-kit',
      targetPath: '/tmp/nexus-kit/pet.json',
      mode: 'reveal',
    }),
    {
      kitDirectory: '/tmp/nexus-kit',
      targetPath: '/tmp/nexus-kit/pet.json',
      mode: 'reveal',
    },
  )
  assert.throws(
    () => validateCreatorKitOpenPathPayload({
      kitDirectory: '/tmp/nexus-kit',
      targetPath: '/tmp/nexus-kit/pet.json',
      mode: 'delete',
    }),
    /Invalid IPC payload for pet-model:open-creator-kit-path: payload\.mode must be one of: open, reveal/,
  )
})

test('IPC voice and notification schemas validate streaming and local model requests', () => {
  assert.deepEqual(validateNotificationWatcherSetPayload({ enabled: true, appsPattern: ' Telegram|Discord ' }), {
    enabled: true,
    appsPattern: 'Telegram|Discord',
  })
  assert.deepEqual(validateProactiveNotificationPayload({ title: ' Hi ', body: ' there ', ignored: true }), {
    title: 'Hi',
    body: 'there',
  })
  assert.deepEqual(validateKwsOptionsPayload('kws:start', { wakeWord: ' Star Hui ' }), {
    wakeWord: 'Star Hui',
  })
  assert.deepEqual(
    validateVadStartPayload({
      threshold: 0.45,
      minSilenceDuration: 0.2,
      minSpeechDuration: 0.08,
      maxSpeechDuration: 30,
      ignored: true,
    }),
    {
      threshold: 0.45,
      minSilenceDuration: 0.2,
      minSpeechDuration: 0.08,
      maxSpeechDuration: 30,
    },
  )
  assert.throws(
    () => validateVadStartPayload({ threshold: 2 }),
    /Invalid IPC payload for vad:start: payload\.threshold must be <= 1/,
  )

  assert.deepEqual(validateModelDownloadPayload({ modelId: ' sensevoice ' }), {
    modelId: 'sensevoice',
  })
  assert.deepEqual(
    validateTtsStreamStartPayload({
      requestId: ' tts-1 ',
      providerId: ' openai-tts ',
      baseUrl: ' https://api.example.test/v1 ',
      apiKey: 'nexus-vault-ref:token',
      rate: 1.1,
      pitch: 0,
      volume: 1,
      ignored: true,
    }),
    {
      requestId: 'tts-1',
      providerId: 'openai-tts',
      baseUrl: 'https://api.example.test/v1',
      apiKey: 'nexus-vault-ref:token',
      rate: 1.1,
      pitch: 0,
      volume: 1,
    },
  )
  assert.deepEqual(validateTtsStreamPushTextPayload({ requestId: 'tts-1', text: 'hello', ignored: true }), {
    requestId: 'tts-1',
    text: 'hello',
  })
  assert.deepEqual(validateTtsStreamRequestIdPayload('tts:stream-finish', { requestId: ' tts-1 ' }), {
    requestId: 'tts-1',
  })
  assert.throws(
    () => validateTtsStreamStartPayload({ requestId: 'tts-1', providerId: 'openai-tts', rate: 10 }),
    /Invalid IPC payload for tts:stream-start: payload\.rate must be <= 4/,
  )
})
