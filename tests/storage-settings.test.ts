import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import { loadSettings, saveSettings, SETTINGS_STORAGE_KEY } from '../src/lib/storage.ts'
import { commitSettingsUpdate } from '../src/app/store/commitSettingsUpdate.ts'
import { CURRENT_SETTINGS_SCHEMA_VERSION, migrateSettings } from '../src/lib/settingsMigrations.ts'
import { getApiProviderPreset } from '../src/features/models/providerCatalog.ts'
import { getSpeechOutputProvider } from '../src/lib/speechProviderCatalog.ts'

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
  assert.equal(settings.memoryPaused, false)
  assert.equal(settings.companionAwarenessPaused, false)
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

test('preserves the memory pause switch on load', () => {
  window.localStorage.setItem(
    SETTINGS_STORAGE_KEY,
    JSON.stringify({
      settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
      memoryPaused: true,
    }),
  )

  const settings = loadSettings()

  assert.equal(settings.memoryPaused, true)
})

test('preserves the companion awareness pause switch on load', () => {
  window.localStorage.setItem(
    SETTINGS_STORAGE_KEY,
    JSON.stringify({
      settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
      companionAwarenessPaused: true,
    }),
  )

  const settings = loadSettings()

  assert.equal(settings.companionAwarenessPaused, true)
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
        settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
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

    assert.equal(settings.settingsSchemaVersion, 10)
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

test('migrates a stored previous catalog default to the current flagship', () => {
  const localStorage = createLocalStorageMock({
    [SETTINGS_STORAGE_KEY]: JSON.stringify({
      settingsSchemaVersion: 5,
      apiProviderId: 'openai',
      apiBaseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.5',
      textProviderProfiles: {
        openai: { apiBaseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-5.5' },
        anthropic: { apiBaseUrl: 'https://api.anthropic.com', apiKey: '', model: 'claude-sonnet-4-6' },
        xai: { apiBaseUrl: 'https://api.x.ai/v1', apiKey: '', model: 'grok-4.20' },
      },
    }),
  })

  Object.defineProperty(globalThis, 'window', {
    value: { localStorage },
    configurable: true,
    writable: true,
  })

  const settings = loadSettings()

  assert.equal(settings.model, 'gpt-6-sol')
  assert.equal(settings.textProviderProfiles.openai?.model, 'gpt-6-sol')
  assert.equal(settings.textProviderProfiles.anthropic?.model, 'claude-sonnet-5-5')
  assert.equal(settings.textProviderProfiles.xai?.model, 'grok-4.20')
})

test('migrates stored Qwen 3.7-plus and GLM-5.2 defaults to the 3.8 / 5.3 flagships', () => {
  const localStorage = createLocalStorageMock({
    [SETTINGS_STORAGE_KEY]: JSON.stringify({
      settingsSchemaVersion: 6,
      apiProviderId: 'dashscope',
      apiBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen3.7-plus',
      textProviderProfiles: {
        dashscope: {
          apiBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
          apiKey: '',
          model: 'qwen3.7-plus',
        },
        zai: { apiBaseUrl: 'https://open.bigmodel.cn/api/paas/v4', apiKey: '', model: 'glm-5.2' },
        openai: { apiBaseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-5.4-mini' },
      },
    }),
  })

  Object.defineProperty(globalThis, 'window', {
    value: { localStorage },
    configurable: true,
    writable: true,
  })

  const settings = loadSettings()

  assert.equal(settings.model, 'qwen3.8-max')
  assert.equal(settings.textProviderProfiles.dashscope?.model, 'qwen3.8-max')
  assert.equal(settings.textProviderProfiles.zai?.model, 'glm-5.3')
  assert.equal(settings.textProviderProfiles.openai?.model, 'gpt-5.4-mini')
})

test('migrates stored October 2026 catalog defaults without touching custom ids', () => {
  const localStorage = createLocalStorageMock({
    [SETTINGS_STORAGE_KEY]: JSON.stringify({
      settingsSchemaVersion: 7,
      apiProviderId: 'deepseek',
      apiBaseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
      speechInputProviderId: 'grok-stt',
      speechInputModel: 'grok-stt',
      textProviderProfiles: {
        anthropic: { apiBaseUrl: 'https://api.anthropic.com', apiKey: '', model: 'claude-sonnet-5' },
        xai: { apiBaseUrl: 'https://api.x.ai/v1', apiKey: '', model: 'grok-4.20' },
        venice: { apiBaseUrl: 'https://api.venice.ai/api/v1', apiKey: '', model: 'deepseek-v4-flash' },
      },
      speechInputProviderProfiles: {
        'openai-stt': { model: 'gpt-4o-mini-transcribe' },
        'elevenlabs-stt': { model: 'scribe_v2' },
      },
    }),
  })

  Object.defineProperty(globalThis, 'window', {
    value: { localStorage },
    configurable: true,
    writable: true,
  })

  const settings = loadSettings()

  assert.equal(settings.model, 'deepseek-flash')
  assert.equal(settings.speechInputModel, 'grok-voice-transcribe-2.0')
  assert.equal(settings.textProviderProfiles.anthropic?.model, 'claude-sonnet-5-5')
  assert.equal(settings.textProviderProfiles.xai?.model, 'grok-4.20')
  assert.equal(settings.textProviderProfiles.venice?.model, 'deepseek-v4-1-flash')
  assert.equal(settings.speechInputProviderProfiles['openai-stt']?.model, 'gpt-transcribe')
  assert.equal(settings.speechInputProviderProfiles['elevenlabs-stt']?.model, 'scribe_v2')
})

test('migrates removed October 2026 catalog and speech ids', () => {
  const localStorage = createLocalStorageMock({
    [SETTINGS_STORAGE_KEY]: JSON.stringify({
      settingsSchemaVersion: 8,
      apiProviderId: 'openai',
      apiBaseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.6-sol',
      speechOutputProviderId: 'dashscope-tts',
      speechOutputModel: 'qwen3-tts-instruct-flash',
      textProviderProfiles: {
        together: {
          apiBaseUrl: 'https://api.together.xyz/v1',
          apiKey: '',
          model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
        },
        mistral: { apiBaseUrl: 'https://api.mistral.ai/v1', apiKey: '', model: 'devstral-small-latest' },
        qianfan: { apiBaseUrl: 'https://qianfan.baidubce.com/v2', apiKey: '', model: 'ernie-x1-turbo-32k' },
        nvidia: { apiBaseUrl: 'https://integrate.api.nvidia.com/v1', apiKey: '', model: 'deepseek-ai/deepseek-r1' },
        siliconflow: {
          apiBaseUrl: 'https://api.siliconflow.cn/v1',
          apiKey: '',
          model: 'Qwen/Qwen3.8-Max',
        },
        moonshot: { apiBaseUrl: 'https://api.moonshot.cn/v1', apiKey: '', model: 'kimi-k2.6' },
      },
      speechOutputProviderProfiles: {
        'elevenlabs-tts': { model: 'eleven_v4' },
      },
    }),
  })

  Object.defineProperty(globalThis, 'window', {
    value: { localStorage },
    configurable: true,
    writable: true,
  })

  const settings = loadSettings()

  assert.equal(settings.model, 'gpt-6-sol')
  assert.equal(settings.speechOutputModel, 'qwen3-tts-flash')
  assert.equal(settings.textProviderProfiles.together?.model, 'moonshotai/Kimi-K3')
  assert.equal(settings.textProviderProfiles.mistral?.model, 'mistral-small-2603')
  assert.equal(settings.textProviderProfiles.qianfan?.model, 'ernie-4.5-turbo-128k')
  assert.equal(settings.textProviderProfiles.nvidia?.model, 'deepseek-ai/deepseek-v4.1-flash')
  assert.equal(settings.textProviderProfiles.siliconflow?.model, 'deepseek-ai/DeepSeek-V4.1-Flash')
  assert.equal(settings.textProviderProfiles.moonshot?.model, 'kimi-k2.6')
  assert.equal(settings.speechOutputProviderProfiles['elevenlabs-tts']?.model, 'eleven_multilingual_v2')
})

test('migrates SiliconFlow, NVIDIA, and MiniMax PAYG defaults without moving coding plans', () => {
  const localStorage = createLocalStorageMock({
    [SETTINGS_STORAGE_KEY]: JSON.stringify({
      settingsSchemaVersion: 9,
      apiBaseUrl: 'https://api.minimaxi.com/anthropic',
      model: 'MiniMax-M2.7',
      textProviderProfiles: {
        siliconflow: {
          apiBaseUrl: 'https://api.siliconflow.cn/v1',
          apiKey: '',
          model: 'deepseek-ai/DeepSeek-V4-Flash',
        },
        'siliconflow-global': {
          apiBaseUrl: 'https://api.siliconflow.com/v1',
          apiKey: '',
          model: 'deepseek-ai/DeepSeek-V4-Pro',
        },
        nvidia: {
          apiBaseUrl: 'https://integrate.api.nvidia.com/v1',
          apiKey: '',
          model: 'deepseek-ai/deepseek-v4-flash',
        },
        'minimax-global': {
          apiBaseUrl: 'https://api.minimax.io/anthropic',
          apiKey: '',
          model: 'MiniMax-M2.7',
        },
        'minimax-coding': {
          apiBaseUrl: 'https://api.minimaxi.com/anthropic',
          apiKey: '',
          model: 'MiniMax-M3.1-Flash-Preview',
        },
        'minimax-coding-global': {
          apiBaseUrl: 'https://api.minimax.io/anthropic',
          apiKey: '',
          model: 'MiniMax-M2.7',
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

  assert.equal(settings.apiProviderId, 'minimax')
  assert.equal(settings.model, 'MiniMax-M3')
  assert.equal(settings.textProviderProfiles.siliconflow?.model, 'deepseek-ai/DeepSeek-V4.1-Flash')
  assert.equal(settings.textProviderProfiles['siliconflow-global']?.model, 'deepseek-ai/DeepSeek-V4-Pro')
  assert.equal(settings.textProviderProfiles.nvidia?.model, 'deepseek-ai/deepseek-v4.1-flash')
  assert.equal(settings.textProviderProfiles['minimax-global']?.model, 'MiniMax-M3')
  assert.equal(settings.textProviderProfiles['minimax-coding']?.model, 'MiniMax-M3.1-Flash-Preview')
  assert.equal(settings.textProviderProfiles['minimax-coding-global']?.model, 'MiniMax-M2.7')
})

test('v9 retired ids land on a model that provider still lists', () => {
  const cases: Array<[string, string]> = [
    ['openai', 'gpt-5.6-sol'],
    ['together', 'deepseek-ai/DeepSeek-V4-Flash-0731'],
    ['together', 'Qwen/Qwen3.5-397B-A17B'],
    ['together', 'MiniMaxAI/MiniMax-M2.7'],
    ['together', 'meta-llama/Llama-3.3-70B-Instruct-Turbo'],
    ['siliconflow', 'Qwen/Qwen3.8-Max'],
    ['siliconflow-global', 'Qwen/Qwen3.8-27B'],
    ['qianfan', 'ernie-x1-turbo-32k'],
    ['qianfan', 'ernie-x1-turbo-32k-preview'],
    ['nvidia', 'deepseek-ai/deepseek-r1'],
    ['mistral', 'devstral-medium-latest'],
    ['mistral', 'devstral-small-latest'],
  ]

  for (const [providerId, model] of cases) {
    const migrated = migrateSettings({
      settingsSchemaVersion: 8,
      apiProviderId: providerId,
      model,
    }, 8)
    const nextModel = typeof migrated.model === 'string' ? migrated.model : ''
    const preset = getApiProviderPreset(providerId)
    assert.ok(
      preset.models.includes(nextModel),
      `${providerId} ${model} migrated to ${nextModel}, which is not in the catalog`,
    )
  }

  const speechCases: Array<[string, string]> = [
    ['dashscope-tts', 'qwen3-tts-instruct-flash'],
    ['elevenlabs-tts', 'eleven_turbo_v2_5'],
    ['elevenlabs-tts', 'eleven_v4'],
    ['elevenlabs-tts', 'eleven_v4_turbo'],
  ]
  for (const [providerId, model] of speechCases) {
    const migrated = migrateSettings({
      settingsSchemaVersion: 8,
      speechOutputProviderId: providerId,
      speechOutputModel: model,
    }, 8)
    const nextModel = typeof migrated.speechOutputModel === 'string' ? migrated.speechOutputModel : ''
    const preset = getSpeechOutputProvider(providerId)
    assert.ok(
      preset.modelOptions.some((entry) => entry.value === nextModel),
      `${providerId} ${model} migrated to ${nextModel}, which is not a speech option`,
    )
  }
})

test('re-applying v9 and v10 does not move a manual non-default again', () => {
  const raw = {
    settingsSchemaVersion: 8,
    apiProviderId: 'openai',
    apiBaseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.6-terra',
    textProviderProfiles: {
      siliconflow: {
        apiBaseUrl: 'https://api.siliconflow.cn/v1',
        apiKey: '',
        model: 'deepseek-ai/DeepSeek-V4-Pro',
      },
      openai: {
        apiBaseUrl: 'https://api.openai.com/v1',
        apiKey: '',
        model: 'gpt-5.6-luna',
      },
    },
  }
  const once = migrateSettings(raw, 8)
  const twice = migrateSettings(once, 8)
  assert.equal(once.model, 'gpt-5.6-terra')
  assert.equal(twice.model, 'gpt-5.6-terra')
  assert.equal(
    (twice.textProviderProfiles as { siliconflow: { model: string } }).siliconflow.model,
    'deepseek-ai/DeepSeek-V4-Pro',
  )
  assert.equal(
    (twice.textProviderProfiles as { openai: { model: string } }).openai.model,
    'gpt-5.6-luna',
  )
  assert.equal(migrateSettings(once, 10).model, 'gpt-5.6-terra')
})

test('a schema 10 store keeps a model the user selected after the default promotion', () => {
  const localStorage = createLocalStorageMock({
    [SETTINGS_STORAGE_KEY]: JSON.stringify({
      settingsSchemaVersion: 10,
      apiProviderId: 'siliconflow',
      apiBaseUrl: 'https://api.siliconflow.cn/v1',
      model: 'deepseek-ai/DeepSeek-V4-Flash',
      textProviderProfiles: {
        minimax: {
          apiBaseUrl: 'https://api.minimaxi.com/anthropic',
          apiKey: '',
          model: 'MiniMax-M2.7',
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

  assert.equal(settings.settingsSchemaVersion, 10)
  assert.equal(settings.model, 'deepseek-ai/DeepSeek-V4-Flash')
  assert.equal(settings.textProviderProfiles.minimax?.model, 'MiniMax-M2.7')
})

test('missing apiProviderId does not promote a non-default MiniMax or SiliconFlow model', () => {
  const localStorage = createLocalStorageMock({
    [SETTINGS_STORAGE_KEY]: JSON.stringify({
      settingsSchemaVersion: 9,
      apiBaseUrl: 'https://api.minimaxi.com/anthropic',
      model: 'MiniMax-M2.5',
      textProviderProfiles: {
        siliconflow: {
          apiBaseUrl: 'https://api.siliconflow.cn/v1',
          apiKey: '',
          model: 'deepseek-ai/DeepSeek-V4-Pro',
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

  assert.equal(settings.apiProviderId, 'minimax')
  assert.equal(settings.model, 'MiniMax-M2.5')
  assert.equal(settings.textProviderProfiles.siliconflow?.model, 'deepseek-ai/DeepSeek-V4-Pro')
})

test('a newer schema version is left untouched and stays newer after save', () => {
  const localStorage = createLocalStorageMock({
    [SETTINGS_STORAGE_KEY]: JSON.stringify({
      settingsSchemaVersion: 11,
      apiProviderId: 'siliconflow',
      apiBaseUrl: 'https://api.siliconflow.cn/v1',
      model: 'deepseek-ai/DeepSeek-V4-Flash',
    }),
  })

  Object.defineProperty(globalThis, 'window', {
    value: { localStorage },
    configurable: true,
    writable: true,
  })

  const settings = loadSettings()
  assert.equal(settings.settingsSchemaVersion, 11)
  assert.equal(settings.model, 'deepseek-ai/DeepSeek-V4-Flash')

  saveSettings(settings, { silent: true })
  const saved = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{}') as {
    settingsSchemaVersion?: number
    model?: string
  }
  assert.equal(saved.settingsSchemaVersion, 11)
  assert.equal(saved.model, 'deepseek-ai/DeepSeek-V4-Flash')
})

test('preserves an explicit older model that was not the previous default', () => {
  const localStorage = createLocalStorageMock({
    [SETTINGS_STORAGE_KEY]: JSON.stringify({
      settingsSchemaVersion: 5,
      apiProviderId: 'openai',
      apiBaseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.4-mini',
    }),
  })

  Object.defineProperty(globalThis, 'window', {
    value: { localStorage },
    configurable: true,
    writable: true,
  })

  const settings = loadSettings()

  assert.equal(settings.model, 'gpt-5.4-mini')
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

  await commitSettingsUpdate(
    (current) => ({
      ...current,
      continuousVoiceModeEnabled: true,
    }),
    (nextSettings) => {
      appliedSettings = nextSettings
    },
  )

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
  let storedSpeechOutputApiKey = ''

  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage,
      dispatchEvent: () => true,
      desktopPet: {
        vaultStore: async () => {},
        vaultStoreMany: async (entries: Record<string, string>) => {
          storedVaultEntries = entries
          storedSpeechOutputApiKey = entries['settings:speechOutputApiKey'] ?? storedSpeechOutputApiKey
        },
        vaultRetrieveMany: async () => ({
          'settings:speechOutputApiKey': storedSpeechOutputApiKey,
        }),
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
