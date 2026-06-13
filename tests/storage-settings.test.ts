import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import { loadSettings, SETTINGS_STORAGE_KEY } from '../src/lib/storage.ts'
import { commitSettingsUpdate } from '../src/app/store/commitSettingsUpdate.ts'
import { CURRENT_SETTINGS_SCHEMA_VERSION } from '../src/lib/settingsMigrations.ts'

type LocalStorageMock = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
  clear: () => void
}

function createLocalStorageMock(initial: Record<string, string> = {}): LocalStorageMock {
  const store = new Map(Object.entries(initial))

  return {
    getItem(key) {
      return store.has(key) ? store.get(key) ?? null : null
    },
    setItem(key, value) {
      store.set(key, String(value))
    },
    removeItem(key) {
      store.delete(key)
    },
    clear() {
      store.clear()
    },
  }
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage: createLocalStorageMock(),
    },
    configurable: true,
    writable: true,
  })
})

test('fresh settings start with the Phase 1 Ollama text path', () => {
  const settings = loadSettings()

  assert.equal(settings.apiProviderId, 'ollama')
  assert.equal(settings.apiBaseUrl, 'http://127.0.0.1:11434/v1')
  assert.equal(settings.model, 'qwen3:8b')
  assert.equal(settings.petModelId, 'mao')
  assert.equal(settings.apiKey, '')
  assert.equal(settings.chatFailoverEnabled, false)
  assert.equal(settings.speechInputEnabled, false)
  assert.equal(settings.speechOutputEnabled, false)
  assert.equal(settings.toolWebSearchEnabled, true)
  assert.equal(settings.toolWebSearchProviderId, 'bing')
  assert.equal(settings.toolWeatherEnabled, true)
  assert.equal(settings.proactivePresenceEnabled, false)
  assert.equal(settings.telegramAnnounceIncomingEnabled, false)
  assert.equal(settings.telegramAnnounceMessagePreview, false)
  // Auto-reply defaults on (inbound is already owner+allowlist gated);
  // voice replies stay opt-in.
  assert.equal(settings.telegramAutoReplyEnabled, true)
  assert.equal(settings.telegramVoiceReplyMode, 'off')
  assert.equal(settings.discordAnnounceIncomingEnabled, false)
  assert.equal(settings.discordAnnounceMessagePreview, false)
  assert.equal(settings.discordAutoReplyEnabled, true)
  assert.equal(settings.discordVoiceReplyEnabled, false)
  assert.equal(settings.autonomyNotificationMessageAnnouncementsEnabled, false)
  assert.equal(settings.autonomyNotificationMessagePreviewEnabled, false)
  // Desktop message awareness: chat injection rides the bridge master
  // switch so it defaults on; the macOS watcher itself stays opt-in.
  assert.equal(settings.autonomyNotificationMessagesToChatEnabled, true)
  assert.equal(settings.macosMessageWatcherEnabled, false)
  assert.equal(settings.macosMessageWatcherApps, '')
})

test('clamps out-of-range autonomy numerics on load (no 0ms busy-loop, no negative cost cap)', () => {
  window.localStorage.setItem(
    SETTINGS_STORAGE_KEY,
    JSON.stringify({
      settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
      autonomyTickIntervalSeconds: 0,
      autonomySleepAfterIdleMinutes: 0,
      autonomyIdleThresholdSeconds: 0,
      autonomyCostLimitDailyTicks: -5,
      autonomyQuietHoursStart: 99,
      autonomyQuietHoursEnd: -1,
      autonomyDreamIntervalHours: 0,
      autonomyDreamMinSessions: 0,
    }),
  )

  const settings = loadSettings()

  // 0 would become a 0ms setInterval busy-loop; floored to the UI minimum.
  assert.equal(settings.autonomyTickIntervalSeconds, 10)
  assert.equal(settings.autonomySleepAfterIdleMinutes, 5)
  assert.equal(settings.autonomyIdleThresholdSeconds, 60)
  // Negative would make shouldTick always-false (autonomy silently dead).
  assert.equal(settings.autonomyCostLimitDailyTicks, 10)
  // Quiet-hours must stay within 0..23 or night suppression breaks.
  assert.equal(settings.autonomyQuietHoursStart, 23)
  assert.equal(settings.autonomyQuietHoursEnd, 0)
  assert.equal(settings.autonomyDreamIntervalHours, 1)
  assert.equal(settings.autonomyDreamMinSessions, 1)
})

test('falls back to defaults for non-finite autonomy numerics', () => {
  window.localStorage.setItem(
    SETTINGS_STORAGE_KEY,
    JSON.stringify({
      settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
      autonomyTickIntervalSeconds: 'not-a-number',
      autonomyCostLimitDailyTicks: null,
    }),
  )

  const settings = loadSettings()

  assert.equal(settings.autonomyTickIntervalSeconds, 30)
  assert.equal(settings.autonomyCostLimitDailyTicks, 100)
})

test('infers global and Token Plan text providers from stored base URLs', () => {
  const cases = [
    {
      apiBaseUrl: 'https://api.moonshot.ai/v1',
      model: 'kimi-k2.6',
      expectedProviderId: 'moonshot-global',
    },
    {
      apiBaseUrl: 'https://api.moonshot.ai/anthropic',
      model: 'kimi-k2.6',
      expectedProviderId: 'kimi-coding-global',
    },
    {
      apiBaseUrl: 'https://api.minimax.io/anthropic',
      model: 'MiniMax-M3',
      expectedProviderId: 'minimax-coding-global',
    },
    {
      apiBaseUrl: 'https://api.minimaxi.com/anthropic',
      model: 'MiniMax-M3',
      expectedProviderId: 'minimax-coding',
    },
    {
      apiBaseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      model: 'qwen3.6-plus',
      expectedProviderId: 'dashscope-global',
    },
    {
      apiBaseUrl: 'https://api.siliconflow.com/v1',
      model: 'deepseek-ai/DeepSeek-V4-Flash',
      expectedProviderId: 'siliconflow-global',
    },
  ]

  for (const item of cases) {
    const localStorage = createLocalStorageMock({
      [SETTINGS_STORAGE_KEY]: JSON.stringify({
        apiBaseUrl: item.apiBaseUrl,
        model: item.model,
      }),
    })

    Object.defineProperty(globalThis, 'window', {
      value: { localStorage },
      configurable: true,
      writable: true,
    })

    const settings = loadSettings()

    assert.equal(settings.apiProviderId, item.expectedProviderId)
    assert.equal(settings.apiBaseUrl, item.apiBaseUrl)
    assert.equal(settings.model, item.model)
  }
})

test('drops text model API keys that cannot be sent in headers', () => {
  const localStorage = createLocalStorageMock({
    [SETTINGS_STORAGE_KEY]: JSON.stringify({
      apiProviderId: 'minimax-coding',
      apiBaseUrl: 'https://api.minimaxi.com/anthropic',
      apiKey: 'sk-main 套餐说明',
      model: 'MiniMax-M3',
      textProviderProfiles: {
        'minimax-coding': {
          apiBaseUrl: 'https://api.minimaxi.com/anthropic',
          apiKey: 'sk-profile\nnext-line',
          model: 'MiniMax-M3',
        },
        deepseek: {
          apiBaseUrl: 'https://api.deepseek.com',
          apiKey: '  sk-valid  ',
          model: 'deepseek-v4-flash',
        },
      },
    }),
  })

  Object.defineProperty(globalThis, 'window', {
    value: { localStorage },
    configurable: true,
    writable: true,
  })

  const settings = loadSettings()

  assert.equal(settings.apiKey, '')
  assert.equal(settings.textProviderProfiles['minimax-coding']?.apiKey, '')
  assert.equal(settings.textProviderProfiles.deepseek?.apiKey, 'sk-valid')
})

test('ignores malformed root settings values and falls back to defaults', () => {
  for (const storedValue of ['null', '[]', '"legacy"', '42']) {
    const localStorage = createLocalStorageMock({
      [SETTINGS_STORAGE_KEY]: storedValue,
    })

    Object.defineProperty(globalThis, 'window', {
      value: { localStorage },
      configurable: true,
      writable: true,
    })

    const settings = loadSettings()

    assert.equal(settings.settingsSchemaVersion, 5)
    assert.equal(settings.apiProviderId, 'ollama')
    assert.equal(settings.apiBaseUrl, 'http://127.0.0.1:11434/v1')
    assert.equal(settings.model, 'qwen3:8b')
    assert.equal(settings.petModelId, 'mao')
    assert.deepEqual(settings.characterProfiles, [])
    assert.deepEqual(settings.mcpServers, [])
  }
})

test('migrates the old qiyi default pet to the Codex sprite pet', () => {
  const localStorage = createLocalStorageMock({
    [SETTINGS_STORAGE_KEY]: JSON.stringify({
      settingsSchemaVersion: 4,
      petModelId: 'qiyi',
    }),
  })

  Object.defineProperty(globalThis, 'window', {
    value: { localStorage },
    configurable: true,
    writable: true,
  })

  const settings = loadSettings()

  assert.equal(settings.petModelId, 'codex')
})

test('preserves a non-default pet choice during the Codex pet migration', () => {
  const localStorage = createLocalStorageMock({
    [SETTINGS_STORAGE_KEY]: JSON.stringify({
      settingsSchemaVersion: 4,
      petModelId: 'mao',
    }),
  })

  Object.defineProperty(globalThis, 'window', {
    value: { localStorage },
    configurable: true,
    writable: true,
  })

  const settings = loadSettings()

  assert.equal(settings.petModelId, 'mao')
})

test('preserves volcengine-tts selection without migration', () => {
  const localStorage = createLocalStorageMock({
    [SETTINGS_STORAGE_KEY]: JSON.stringify({
      speechOutputProviderId: 'volcengine-tts',
      speechOutputApiBaseUrl: 'https://openspeech.bytedance.com/api',
      speechOutputApiKey: '1000:test-token',
      speechOutputModel: 'volcano_tts',
      speechOutputVoice: 'BV001_streaming',
    }),
  })

  Object.defineProperty(globalThis, 'window', {
    value: { localStorage },
    configurable: true,
    writable: true,
  })

  const settings = loadSettings()

  assert.equal(settings.speechOutputProviderId, 'volcengine-tts')
  assert.equal(settings.speechOutputApiBaseUrl, 'https://openspeech.bytedance.com/api')
  assert.equal(settings.speechOutputApiKey, '1000:test-token')
  assert.equal(settings.speechOutputModel, 'volcano_tts')
  assert.equal(settings.speechOutputVoice, 'BV001_streaming')
})

test('preserves an explicit local sensevoice speech input selection on load', () => {
  const localStorage = createLocalStorageMock({
    [SETTINGS_STORAGE_KEY]: JSON.stringify({
      speechInputProviderId: 'local-sensevoice',
      speechInputApiBaseUrl: 'http://should-not-stick.example.com',
      speechInputApiKey: 'legacy-secret',
      speechInputModel: 'sensevoice-zh-en',
    }),
  })

  Object.defineProperty(globalThis, 'window', {
    value: { localStorage },
    configurable: true,
    writable: true,
  })

  const settings = loadSettings()

  assert.equal(settings.speechInputProviderId, 'local-sensevoice')
  assert.equal(settings.speechInputApiBaseUrl, '')
  assert.equal(settings.speechInputApiKey, '')
  assert.equal(settings.speechInputModel, 'sensevoice-zh-en')
})

test('preserves the editorial theme selection on load', () => {
  const localStorage = createLocalStorageMock({
    [SETTINGS_STORAGE_KEY]: JSON.stringify({
      themeId: 'editorial',
    }),
  })

  Object.defineProperty(globalThis, 'window', {
    value: { localStorage },
    configurable: true,
    writable: true,
  })

  const settings = loadSettings()

  assert.equal(settings.themeId, 'editorial')
})

test('commitSettingsUpdate persists settings changes and applies them in memory', async () => {
  const localStorage = createLocalStorageMock({
    [SETTINGS_STORAGE_KEY]: JSON.stringify({
      continuousVoiceModeEnabled: false,
    }),
  })

  let appliedSettings = null as Awaited<ReturnType<typeof loadSettings>> | null

  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage,
      dispatchEvent: () => true,
    },
    configurable: true,
    writable: true,
  })

  commitSettingsUpdate(
    (current) => ({
      ...current,
      continuousVoiceModeEnabled: true,
    }),
    (nextSettings) => {
      appliedSettings = nextSettings
    },
  )

  await Promise.resolve()

  assert.equal(appliedSettings?.continuousVoiceModeEnabled, true)
  assert.equal(
    JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{}').continuousVoiceModeEnabled,
    true,
  )
})

test('commitSettingsUpdate stores secret settings in vault and persists stripped settings', async () => {
  const localStorage = createLocalStorageMock({
    [SETTINGS_STORAGE_KEY]: JSON.stringify({
      speechOutputApiKey: '',
    }),
  })

  let appliedSettings = null as Awaited<ReturnType<typeof loadSettings>> | null
  let storedVaultEntries: Record<string, string> | null = null

  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage,
      dispatchEvent: () => true,
      desktopPet: {
        vaultStore: async () => {},
        vaultStoreMany: async (entries: Record<string, string>) => {
          storedVaultEntries = entries
        },
        vaultRetrieveMany: async () => ({}),
      },
    },
    configurable: true,
    writable: true,
  })

  await commitSettingsUpdate(
    (current) => ({
      ...current,
      speechOutputApiKey: 'tts-secret',
    }),
    (nextSettings) => {
      appliedSettings = nextSettings
    },
  )

  assert.deepEqual(storedVaultEntries, {
    'settings:speechOutputApiKey': 'tts-secret',
  })
  assert.equal(appliedSettings?.speechOutputApiKey, 'tts-secret')
  assert.equal(
    JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{}').speechOutputApiKey,
    '',
  )
})

test('commitSettingsUpdate does not re-store vault refs as plaintext secrets', async () => {
  const localStorage = createLocalStorageMock({
    [SETTINGS_STORAGE_KEY]: JSON.stringify({
      speechOutputApiKey: '',
    }),
  })

  let storedVaultEntries: Record<string, string> | null = null

  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage,
      dispatchEvent: () => true,
      desktopPet: {
        vaultStore: async () => {},
        vaultStoreMany: async (entries: Record<string, string>) => {
          storedVaultEntries = entries
        },
        vaultRetrieveMany: async () => ({}),
      },
    },
    configurable: true,
    writable: true,
  })

  await commitSettingsUpdate(
    (current) => ({
      ...current,
      speechOutputApiKey: 'nexus-vault-ref:already-issued',
    }),
    () => {},
  )

  assert.deepEqual(storedVaultEntries, null)
  assert.equal(
    JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{}').speechOutputApiKey,
    '',
  )
})
