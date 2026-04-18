import type { AppSettings, VoiceTriggerMode } from '../../types'
import { DEFAULT_MEMORY_EMBEDDING_MODEL } from '../../features/memory/constants.ts'
import { DEFAULT_PET_MODEL_ID } from '../../features/pet/models.ts'
import {
  getSpeechInputProviderPreset,
  getSpeechOutputProviderPreset,
  isBrowserSpeechInputProvider,
  isSenseVoiceSpeechInputProvider,
  normalizeSpeechOutputApiBaseUrl,
  resolveSpeechInputModel,
} from '../audioProviders.ts'
import { inferApiProviderId } from '../apiProviders.ts'
import { clampPresenceIntervalMinutes } from '../settings.ts'
import { CURRENT_SETTINGS_SCHEMA_VERSION, migrateSettings } from '../settingsMigrations.ts'
import {
  readStoredSpeechInputProviderProfiles,
  readStoredSpeechOutputProviderProfiles,
  syncSpeechProviderProfiles,
} from '../speechProviderProfiles.ts'
import {
  readStoredTextProviderProfiles,
  syncTextProviderProfiles,
} from '../textProviderProfiles.ts'
import {
  normalizeWebSearchProviderId,
  resolveWebSearchApiBaseUrl,
} from '../webSearchProviders.ts'
import { normalizeUiLanguage } from '../uiLanguage.ts'
import {
  readJson,
  SETTINGS_STORAGE_KEY,
  SETTINGS_UPDATED_EVENT,
  writeJson,
} from './core.ts'

const defaultSettings: AppSettings = {
  settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
  petModelId: DEFAULT_PET_MODEL_ID,
  uiLanguage: 'zh-CN',
  themeId: 'nexus-default',
  apiProviderId: 'openai',
  companionName: '星绘',
  userName: '主人',
  characterProfiles: [],
  activeCharacterProfileId: '',
  apiBaseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4.1-mini',
  systemPrompt:
    'You are a Live2D AI desktop companion. Your name is 星绘 (Xinghui). You are not a general-purpose agent — you are a long-term companion who lives on the desktop. Speak gently, naturally, and concisely: respond to what was said first, then add one short line of warmth when it fits. Only draw on memory, desktop context, or tool results when they are genuinely relevant to the current turn; never fabricate details you have not observed. Always reply in the same language the user just spoke to you.',
  speechInputEnabled: true,
  speechOutputEnabled: true,
  speechInputProviderId: 'local-sensevoice',
  speechInputApiBaseUrl: '',
  speechInputApiKey: '',
  speechInputModel: 'sensevoice-zh-en',
  speechOutputProviderId: 'edge-tts',
  speechOutputApiBaseUrl: '',
  speechOutputApiKey: '',
  speechOutputModel: '',
  speechOutputVoice: 'zh-CN-XiaoxiaoNeural',
  speechOutputInstructions: '',
  speechRecognitionLang: 'zh-CN',
  speechInputHotwords: '',
  speechSynthesisLang: 'zh-CN',
  speechRate: 0.92,
  speechPitch: 1.08,
  speechVolume: 1,
  chatFailoverEnabled: true,
  mcpPromptModeEnabled: false,
  speechInputFailoverEnabled: true,
  speechOutputFailoverEnabled: true,
  continuousVoiceModeEnabled: false,
  voiceActivityDetectionEnabled: true,
  // Default raised to 'high' — the wake-word step already gates the
  // session so aggressive VAD can't barge into dead air, and user reports
  // on low-gain desktop mics consistently show the first post-wake command
  // missed because 'medium' (threshold 0.3) waited for a louder onset
  // than the speech actually had.
  vadSensitivity: 'high',
  voiceInterruptionEnabled: false,
  voiceTriggerMode: 'direct_send',
  wakeWordEnabled: false,
  wakeWord: '星绘',
  wakewordAlwaysOn: false,
  wakewordSessionIdleTimeoutMs: 10_000,
  memorySearchMode: 'hybrid',
  memoryEmbeddingModel: DEFAULT_MEMORY_EMBEDDING_MODEL,
  memoryLongTermRecallCount: 4,
  memoryDailyRecallCount: 4,
  memorySemanticRecallCount: 4,
  memoryDiaryRetentionDays: 7,
  memoryHotTierMaxChars: 3500,
  autoSkillGenerationEnabled: true,
  contextAwarenessEnabled: true,
  activeWindowContextEnabled: true,
  clipboardContextEnabled: true,
  screenContextEnabled: false,
  screenOcrLanguage: 'chi_sim+eng',
  screenVlmEnabled: false,
  screenVlmProviderId: 'openai',
  screenVlmBaseUrl: '',
  screenVlmApiKey: '',
  screenVlmModel: '',
  toolWebSearchEnabled: true,
  toolWebSearchProviderId: 'duckduckgo',
  toolWebSearchApiBaseUrl: '',
  toolWebSearchApiKey: '',
  toolWebSearchFallbackToBing: true,
  toolWeatherEnabled: true,
  toolWeatherDefaultLocation: '',
  toolOpenExternalEnabled: true,
  toolOpenExternalRequiresConfirmation: true,
  proactivePresenceEnabled: true,
  proactivePresenceIntervalMinutes: 25,
  launchOnStartup: false,
  mcpServers: [],
  minecraftIntegrationEnabled: false,
  minecraftServerAddress: '',
  minecraftServerPort: 25565,
  minecraftUsername: '',
  minecraftPermissionMode: 'confirm',
  factorioIntegrationEnabled: false,
  factorioServerAddress: '',
  factorioServerPort: 34197,
  factorioUsername: '',
  factorioPermissionMode: 'confirm',
  telegramIntegrationEnabled: false,
  telegramBotToken: '',
  telegramAllowedChatIds: '',
  ownerTelegramChatIds: '',
  telegramPermissionMode: 'confirm',
  discordIntegrationEnabled: false,
  discordBotToken: '',
  discordAllowedChannelIds: '',
  ownerDiscordUserIds: '',
  discordPermissionMode: 'confirm',
  mcpPermissionMode: 'auto',
  textProviderProfiles: {},
  speechInputProviderProfiles: {},
  speechOutputProviderProfiles: {},
  smartModelRoutingEnabled: false,
  modelCheap: '',
  modelStandard: '',
  modelHeavy: '',
  budgetDailyCapUsd: 0,
  budgetMonthlyCapUsd: 0,
  budgetHardStopEnabled: false,
  budgetDowngradeRatio: 0.8,
  agentWorkspaceRoot: '',
  agentMaxIterations: 8,
  chatOutputTransforms: [],
  // Autonomy defaults — all off so existing users see no behavior change
  autonomyEnabled: false,
  autonomyTickIntervalSeconds: 30,
  autonomySleepAfterIdleMinutes: 15,
  autonomyWakeOnInput: true,
  autonomyDreamEnabled: true,
  autonomyDreamIntervalHours: 24,
  autonomyDreamMinSessions: 5,
  autonomyFocusAwarenessEnabled: true,
  autonomyIdleThresholdSeconds: 300,
  autonomyContextTriggersEnabled: false,
  autonomyNotificationsEnabled: false,
  autonomyQuietHoursStart: 23,
  autonomyQuietHoursEnd: 7,
  autonomyCostLimitDailyTicks: 100,
  autonomyMonologueEnabled: false,
  autonomyMonologueIntervalTicks: 6,
  autonomyMonologueSpeechThreshold: 65,
  // v2 engine — now the default path (Phase 5b landed the full pipeline).
  // Only kicks in when autonomyEnabled is also true, so users who haven't
  // opted into autonomy at all are unaffected. Legacy v1 proactiveEngine
  // stays in the codebase until Phase 6 so users can flip back via this
  // flag if the LLM-driven behaviour isn't what they want.
  autonomyEngineV2: true,
  autonomyLevelV2: 'med',
  autonomyModelV2: '',
  autonomyPersonaStrictnessV2: 'med',
}

const VALID_PERMISSION_MODES = new Set(['read-only', 'confirm', 'auto'])

function readPermissionMode(
  value: unknown,
  fallback: import('../../types').IntegrationPermissionMode,
): import('../../types').IntegrationPermissionMode {
  if (typeof value === 'string' && VALID_PERMISSION_MODES.has(value)) {
    return value as import('../../types').IntegrationPermissionMode
  }
  return fallback
}

function clampInteger(value: number, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) return fallback

  return Math.min(max, Math.max(min, Math.round(value)))
}

function resolveVoiceTriggerMode(stored: Partial<AppSettings>): VoiceTriggerMode {
  switch (stored.voiceTriggerMode) {
    case 'direct_send':
    case 'wake_word':
    case 'manual_confirm':
      return stored.voiceTriggerMode
    default:
      return 'direct_send'
  }
}

function syncActiveCharacterProfile(settings: AppSettings): AppSettings {
  if (!settings.activeCharacterProfileId) return settings
  const profile = settings.characterProfiles.find(
    (p) => p.id === settings.activeCharacterProfileId,
  )
  if (!profile) return settings

  return {
    ...settings,
    characterProfiles: settings.characterProfiles.map((p) =>
      p.id !== profile.id ? p : {
        ...p,
        companionName: settings.companionName,
        systemPrompt: settings.systemPrompt,
        petModelId: settings.petModelId,
        speechOutputProviderId: settings.speechOutputProviderId,
        speechOutputVoice: settings.speechOutputVoice,
        speechOutputApiBaseUrl: settings.speechOutputApiBaseUrl,
        speechOutputApiKey: settings.speechOutputApiKey,
        speechOutputModel: settings.speechOutputModel,
        speechOutputInstructions: settings.speechOutputInstructions,
      },
    ),
  }
}

function readStoredCharacterProfiles(raw: unknown): import('../../types').CharacterProfile[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (entry: unknown): entry is import('../../types').CharacterProfile =>
      typeof entry === 'object'
      && entry !== null
      && typeof (entry as Record<string, unknown>).id === 'string'
      && typeof (entry as Record<string, unknown>).companionName === 'string',
  )
}

function readStoredMcpServers(stored: Record<string, unknown>) {
  if (Array.isArray(stored.mcpServers)) {
    return stored.mcpServers.filter(
      (entry: unknown): entry is import('../../types').McpServerConfig =>
        typeof entry === 'object'
        && entry !== null
        && typeof (entry as Record<string, unknown>).id === 'string'
        && typeof (entry as Record<string, unknown>).command === 'string',
    )
  }

  const legacyCommand = String(stored.mcpServerCommand ?? '').trim()
  const legacyArgs = String(stored.mcpServerArgs ?? '').trim()
  if (legacyCommand) {
    return [{
      id: 'mcp-migrated',
      label: legacyCommand.split(/[\\/]/).pop() ?? 'MCP Server',
      command: legacyCommand,
      args: legacyArgs,
      enabled: true,
    }]
  }

  return []
}

function resolveThemeId(storedThemeId: unknown): AppSettings['themeId'] {
  switch (storedThemeId) {
    case 'editorial':
    case 'soft':
    case 'high-contrast':
    case 'nexus-default':
    case 'system-dark':
      return storedThemeId
    default:
      return defaultSettings.themeId
  }
}

export function loadSettings(): AppSettings {
  const raw = readJson<Record<string, unknown>>(SETTINGS_STORAGE_KEY, {})
  const storedVersion = typeof raw.settingsSchemaVersion === 'number' ? raw.settingsSchemaVersion : 0
  const migrated = storedVersion < CURRENT_SETTINGS_SCHEMA_VERSION
    ? migrateSettings(raw, storedVersion)
    : raw
  const stored = migrated as Partial<AppSettings>
  const voiceTriggerMode = resolveVoiceTriggerMode(stored)
  const inferredProviderId = stored.apiProviderId
    ?? inferApiProviderId(stored.apiBaseUrl ?? defaultSettings.apiBaseUrl)
  const storedSpeechOutputProviderProfiles = readStoredSpeechOutputProviderProfiles(
    stored.speechOutputProviderProfiles,
  )
  const requestedSpeechInputProviderId = stored.speechInputProviderId ?? defaultSettings.speechInputProviderId
  const migrateLegacySpeechInputProvider = isBrowserSpeechInputProvider(requestedSpeechInputProviderId)
  const effectiveSpeechInputProviderId = migrateLegacySpeechInputProvider
    ? 'local-sensevoice'
    : requestedSpeechInputProviderId
  const hasLocalSpeechInputProvider = (
    isSenseVoiceSpeechInputProvider(effectiveSpeechInputProviderId)
  )
  const speechInputPreset = getSpeechInputProviderPreset(effectiveSpeechInputProviderId)
  const requestedSpeechInputModel = migrateLegacySpeechInputProvider
    ? undefined
    : stored.speechInputModel
  const speechInputModel = resolveSpeechInputModel(
    effectiveSpeechInputProviderId,
    requestedSpeechInputModel ?? speechInputPreset.defaultModel,
  )
  const speechInputApiBaseUrl = hasLocalSpeechInputProvider
    ? ''
    : stored.speechInputApiBaseUrl ?? defaultSettings.speechInputApiBaseUrl
  const requestedSpeechOutputProviderId = stored.speechOutputProviderId ?? defaultSettings.speechOutputProviderId
  // If the stored provider no longer exists in the catalog, fall back to default
  const resolvedOutputPreset = getSpeechOutputProviderPreset(requestedSpeechOutputProviderId)
  const speechOutputProviderId = resolvedOutputPreset.id === requestedSpeechOutputProviderId
    ? requestedSpeechOutputProviderId
    : defaultSettings.speechOutputProviderId
  const speechOutputPreset = getSpeechOutputProviderPreset(speechOutputProviderId)
  const speechOutputApiBaseUrl = normalizeSpeechOutputApiBaseUrl(
    speechOutputProviderId,
    stored.speechOutputApiBaseUrl ?? defaultSettings.speechOutputApiBaseUrl,
  )
  const speechOutputModel = String(stored.speechOutputModel ?? defaultSettings.speechOutputModel).trim()
    || speechOutputPreset.defaultModel || defaultSettings.speechOutputModel
  const speechOutputVoice = String(stored.speechOutputVoice ?? defaultSettings.speechOutputVoice).trim()
    || speechOutputPreset.defaultVoice || defaultSettings.speechOutputVoice
  const speechOutputApiKey = String(stored.speechOutputApiKey ?? defaultSettings.speechOutputApiKey)
  const speechOutputInstructions = String(stored.speechOutputInstructions ?? defaultSettings.speechOutputInstructions)
  const toolWebSearchProviderId = normalizeWebSearchProviderId(
    stored.toolWebSearchProviderId ?? defaultSettings.toolWebSearchProviderId,
  )
  const toolWebSearchApiBaseUrl = resolveWebSearchApiBaseUrl(
    toolWebSearchProviderId,
    stored.toolWebSearchApiBaseUrl ?? defaultSettings.toolWebSearchApiBaseUrl,
  )

  const loadedSettings: AppSettings = {
    ...defaultSettings,
    ...stored,
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
    uiLanguage: normalizeUiLanguage(stored.uiLanguage),
    themeId: resolveThemeId(stored.themeId),
    apiProviderId: inferredProviderId,
    speechInputProviderId: effectiveSpeechInputProviderId,
    speechInputApiBaseUrl,
    speechInputApiKey: hasLocalSpeechInputProvider || migrateLegacySpeechInputProvider
      ? ''
      : String(stored.speechInputApiKey ?? defaultSettings.speechInputApiKey),
    speechInputModel,
    speechOutputProviderId,
    speechOutputApiBaseUrl,
    speechOutputApiKey,
    speechOutputModel,
    speechOutputVoice,
    speechOutputInstructions,
    toolWebSearchProviderId,
    toolWebSearchApiBaseUrl,
    toolWebSearchFallbackToBing: stored.toolWebSearchFallbackToBing !== false,
    chatFailoverEnabled: stored.chatFailoverEnabled !== false,
    mcpPromptModeEnabled: stored.mcpPromptModeEnabled === true,
    speechInputFailoverEnabled: stored.speechInputFailoverEnabled !== false,
    speechOutputFailoverEnabled: stored.speechOutputFailoverEnabled !== false,
    toolWeatherDefaultLocation: String(
      stored.toolWeatherDefaultLocation ?? defaultSettings.toolWeatherDefaultLocation,
    ).trim(),
    voiceTriggerMode,
    wakeWordEnabled: voiceTriggerMode === 'wake_word',
    memorySearchMode:
      stored.memorySearchMode === 'keyword'
      || stored.memorySearchMode === 'hybrid'
      || stored.memorySearchMode === 'vector'
        ? stored.memorySearchMode
        : defaultSettings.memorySearchMode,
    memoryEmbeddingModel: String(stored.memoryEmbeddingModel ?? defaultSettings.memoryEmbeddingModel).trim()
      || defaultSettings.memoryEmbeddingModel,
    memoryLongTermRecallCount: clampInteger(
      stored.memoryLongTermRecallCount ?? defaultSettings.memoryLongTermRecallCount,
      defaultSettings.memoryLongTermRecallCount,
      1,
      8,
    ),
    memoryDailyRecallCount: clampInteger(
      stored.memoryDailyRecallCount ?? defaultSettings.memoryDailyRecallCount,
      defaultSettings.memoryDailyRecallCount,
      1,
      8,
    ),
    memorySemanticRecallCount: clampInteger(
      stored.memorySemanticRecallCount ?? defaultSettings.memorySemanticRecallCount,
      defaultSettings.memorySemanticRecallCount,
      1,
      8,
    ),
    memoryDiaryRetentionDays: clampInteger(
      stored.memoryDiaryRetentionDays ?? defaultSettings.memoryDiaryRetentionDays,
      defaultSettings.memoryDiaryRetentionDays,
      1,
      30,
    ),
    memoryHotTierMaxChars: clampInteger(
      stored.memoryHotTierMaxChars ?? defaultSettings.memoryHotTierMaxChars,
      defaultSettings.memoryHotTierMaxChars,
      500,
      8000,
    ),
    autoSkillGenerationEnabled: stored.autoSkillGenerationEnabled ?? defaultSettings.autoSkillGenerationEnabled,
    proactivePresenceIntervalMinutes: clampPresenceIntervalMinutes(
      stored.proactivePresenceIntervalMinutes ?? defaultSettings.proactivePresenceIntervalMinutes,
    ),
    characterProfiles: readStoredCharacterProfiles(stored.characterProfiles),
    activeCharacterProfileId: String(stored.activeCharacterProfileId ?? ''),
    mcpServers: readStoredMcpServers(stored),
    minecraftIntegrationEnabled: stored.minecraftIntegrationEnabled === true,
    minecraftServerAddress: String(
      stored.minecraftServerAddress ?? defaultSettings.minecraftServerAddress,
    ).trim(),
    minecraftServerPort: clampInteger(
      stored.minecraftServerPort ?? defaultSettings.minecraftServerPort,
      defaultSettings.minecraftServerPort,
      1,
      65535,
    ),
    minecraftUsername: String(stored.minecraftUsername ?? defaultSettings.minecraftUsername).trim(),
    minecraftPermissionMode: readPermissionMode(stored.minecraftPermissionMode, defaultSettings.minecraftPermissionMode),
    factorioIntegrationEnabled: stored.factorioIntegrationEnabled === true,
    factorioServerAddress: String(
      stored.factorioServerAddress ?? defaultSettings.factorioServerAddress,
    ).trim(),
    factorioServerPort: clampInteger(
      stored.factorioServerPort ?? defaultSettings.factorioServerPort,
      defaultSettings.factorioServerPort,
      1,
      65535,
    ),
    factorioUsername: String(stored.factorioUsername ?? defaultSettings.factorioUsername).trim(),
    factorioPermissionMode: readPermissionMode(stored.factorioPermissionMode, defaultSettings.factorioPermissionMode),
    telegramIntegrationEnabled: Boolean(stored.telegramIntegrationEnabled ?? defaultSettings.telegramIntegrationEnabled),
    telegramBotToken: String(stored.telegramBotToken ?? defaultSettings.telegramBotToken).trim(),
    telegramAllowedChatIds: String(stored.telegramAllowedChatIds ?? defaultSettings.telegramAllowedChatIds).trim(),
    ownerTelegramChatIds: String(stored.ownerTelegramChatIds ?? defaultSettings.ownerTelegramChatIds).trim(),
    telegramPermissionMode: readPermissionMode(stored.telegramPermissionMode, defaultSettings.telegramPermissionMode),
    discordIntegrationEnabled: Boolean(stored.discordIntegrationEnabled ?? defaultSettings.discordIntegrationEnabled),
    discordBotToken: String(stored.discordBotToken ?? defaultSettings.discordBotToken).trim(),
    discordAllowedChannelIds: String(stored.discordAllowedChannelIds ?? defaultSettings.discordAllowedChannelIds).trim(),
    ownerDiscordUserIds: String(stored.ownerDiscordUserIds ?? defaultSettings.ownerDiscordUserIds).trim(),
    discordPermissionMode: readPermissionMode(stored.discordPermissionMode, defaultSettings.discordPermissionMode),
    mcpPermissionMode: readPermissionMode(stored.mcpPermissionMode, defaultSettings.mcpPermissionMode),
    agentWorkspaceRoot: String(stored.agentWorkspaceRoot ?? defaultSettings.agentWorkspaceRoot).trim(),
    agentMaxIterations: clampInteger(
      stored.agentMaxIterations ?? defaultSettings.agentMaxIterations,
      defaultSettings.agentMaxIterations,
      1,
      32,
    ),
    textProviderProfiles: readStoredTextProviderProfiles(stored.textProviderProfiles),
    speechInputProviderProfiles: readStoredSpeechInputProviderProfiles(stored.speechInputProviderProfiles),
    speechOutputProviderProfiles: storedSpeechOutputProviderProfiles,
  }

  return syncTextProviderProfiles(syncSpeechProviderProfiles(loadedSettings))
}

export function saveSettings(settings: AppSettings, options?: { silent?: boolean }) {
  const withProfileSync = syncActiveCharacterProfile(settings)
  const nextSettings = syncTextProviderProfiles(syncSpeechProviderProfiles(withProfileSync))

  const persistedSettings = {
    ...nextSettings,
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
    speechOutputApiBaseUrl: normalizeSpeechOutputApiBaseUrl(
      nextSettings.speechOutputProviderId,
      nextSettings.speechOutputApiBaseUrl,
    ),
    toolWebSearchProviderId: normalizeWebSearchProviderId(nextSettings.toolWebSearchProviderId),
    toolWebSearchApiBaseUrl: resolveWebSearchApiBaseUrl(
      nextSettings.toolWebSearchProviderId,
      nextSettings.toolWebSearchApiBaseUrl,
    ),
    wakeWordEnabled: nextSettings.voiceTriggerMode === 'wake_word',
  }

  writeJson(SETTINGS_STORAGE_KEY, persistedSettings)

  if (!options?.silent && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SETTINGS_UPDATED_EVENT, {
      detail: persistedSettings,
    }))
  }
}
