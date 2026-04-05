import type {
  AmbientPresenceState,
  AppSettings,
  ChatMessage,
  DailyMemoryStore,
  DebugConsoleEvent,
  MemoryItem,
  PetMood,
  PresenceHistoryItem,
  PetWindowPreferences,
  ReminderTask,
  VoiceTraceEntry,
  VoicePipelineState,
  VoiceTriggerMode,
  ReminderTaskAction,
} from '../types'
import { DEFAULT_MEMORY_EMBEDDING_MODEL } from '../features/memory/constants.ts'
import { DEFAULT_PET_MODEL_ID } from '../features/pet/models.ts'
import {
  getSpeechInputProviderPreset,
  getSpeechOutputProviderPreset,
  isBrowserSpeechInputProvider,
  isLocalSherpaSpeechInputProvider,
  isLocalWhisperSpeechInputProvider,
  normalizeSpeechOutputApiBaseUrl,
  resolveSpeechInputModel,
} from './audioProviders.ts'
import { inferApiProviderId } from './apiProviders.ts'
import { clampPresenceIntervalMinutes } from './settings.ts'
import { CURRENT_SETTINGS_SCHEMA_VERSION, migrateSettings } from './settingsMigrations.ts'
import {
  readStoredSpeechInputProviderProfiles,
  readStoredSpeechOutputProviderProfiles,
  syncSpeechProviderProfiles,
} from './speechProviderProfiles.ts'
import {
  readStoredTextProviderProfiles,
  syncTextProviderProfiles,
} from './textProviderProfiles.ts'
import {
  normalizeWebSearchProviderId,
  resolveWebSearchApiBaseUrl,
} from './webSearchProviders.ts'
import { normalizeUiLanguage } from './uiLanguage.ts'

export const CHAT_STORAGE_KEY = 'nexus:chat'
export const LEGACY_MEMORY_STORAGE_KEY = 'nexus:memory'
export const MEMORY_STORAGE_KEY = 'nexus:memory:long-term'
export const DAILY_MEMORY_STORAGE_KEY = 'nexus:memory:daily'
export const SETTINGS_STORAGE_KEY = 'nexus:settings'
export const SETTINGS_UPDATED_EVENT = 'nexus:settings-updated'
export const PET_RUNTIME_STORAGE_KEY = 'nexus:runtime'
export const PET_WINDOW_PREFERENCES_STORAGE_KEY = 'nexus:pet-window-preferences'
export const AMBIENT_PRESENCE_STORAGE_KEY = 'nexus:ambient-presence'
export const PRESENCE_ACTIVITY_AT_STORAGE_KEY = 'nexus:presence-activity-at'
export const LAST_PROACTIVE_PRESENCE_AT_STORAGE_KEY = 'nexus:last-proactive-presence-at'
export const PRESENCE_HISTORY_STORAGE_KEY = 'nexus:presence-history'
export const VOICE_PIPELINE_STORAGE_KEY = 'nexus:voice-pipeline'
export const VOICE_TRACE_STORAGE_KEY = 'nexus:voice-trace'
export const ONBOARDING_STORAGE_KEY = 'nexus:onboarding'
export const REMINDER_TASKS_STORAGE_KEY = 'nexus:reminder-tasks'
export const DEBUG_CONSOLE_EVENTS_STORAGE_KEY = 'nexus:debug-console-events'

type PetRuntimeState = {
  mood: PetMood
}

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
    '你是一位 Windows 桌面上的 Live2D AI 陪伴体。你的名字是星绘。你不是万能 Agent，而是桌边可以长期相处的伙伴。说话温柔、自然、简洁，先直接回应，再自然补一句陪伴感。只在真正相关时使用记忆、桌面上下文和工具结果，不要编造没有观察到的信息。',
  speechInputEnabled: true,
  speechOutputEnabled: true,
  speechInputProviderId: 'local-sherpa',
  speechInputApiBaseUrl: '',
  speechInputApiKey: '',
  speechInputModel: 'streaming-paraformer-bilingual-zh-en',
  speechOutputProviderId: 'browser',
  speechOutputApiBaseUrl: '',
  speechOutputApiKey: '',
  speechOutputModel: '',
  speechOutputVoice: 'zh-CN-XiaoxiaoNeural',
  speechOutputInstructions: '',
  voiceCloneProviderId: 'elevenlabs-ivc',
  voiceCloneApiBaseUrl: 'https://api.elevenlabs.io/v1',
  voiceCloneApiKey: '',
  clonedVoiceId: '',
  speechRecognitionLang: 'zh-CN',
  speechSynthesisLang: 'zh-CN',
  speechRate: 1,
  speechPitch: 1.08,
  speechVolume: 1,
  chatFailoverEnabled: true,
  speechInputFailoverEnabled: true,
  speechOutputFailoverEnabled: true,
  continuousVoiceModeEnabled: false,
  voiceActivityDetectionEnabled: true,
  vadSensitivity: 'medium',
  voiceInterruptionEnabled: false,
  voiceTriggerMode: 'direct_send',
  wakeWordEnabled: false,
  wakeWord: '星绘',
  memorySearchMode: 'hybrid',
  memoryEmbeddingModel: DEFAULT_MEMORY_EMBEDDING_MODEL,
  memoryLongTermRecallCount: 4,
  memoryDailyRecallCount: 4,
  memorySemanticRecallCount: 4,
  memoryDiaryRetentionDays: 7,
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
  toolWebSearchProviderId: 'bing',
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
  factorioIntegrationEnabled: false,
  factorioServerAddress: '',
  factorioServerPort: 34197,
  factorioUsername: '',
  textProviderProfiles: {},
  speechInputProviderProfiles: {},
  speechOutputProviderProfiles: {},
}

const defaultPetRuntimeState: PetRuntimeState = {
  mood: 'idle',
}

const defaultPetWindowPreferences: PetWindowPreferences = {
  isPinned: true,
  clickThrough: false,
}

const defaultVoicePipelineState: VoicePipelineState = {
  step: 'idle',
  transcript: '',
  detail: '等待语音输入',
  updatedAt: '',
}

const defaultVoiceTrace: VoiceTraceEntry[] = []
const defaultReminderTasks: ReminderTask[] = []
const defaultDebugConsoleEvents: DebugConsoleEvent[] = []

function normalizeReminderTaskAction(action: ReminderTaskAction | null | undefined): ReminderTaskAction {
  if (!action || action.kind === 'notice') {
    return { kind: 'notice' }
  }

  if (action.kind === 'weather') {
    return {
      kind: 'weather',
      location: String(action.location ?? '').trim(),
    }
  }

  return {
    kind: 'web_search',
    query: String(action.query ?? '').trim(),
    limit: Math.max(1, Math.min(Number(action.limit) || 5, 8)),
  }
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson<T>(key: string, value: T) {
  window.localStorage.setItem(key, JSON.stringify(value))
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



export function loadChatMessages(): ChatMessage[] {
  return readJson<ChatMessage[]>(CHAT_STORAGE_KEY, [])
}

export function saveChatMessages(messages: ChatMessage[]) {
  writeJson(CHAT_STORAGE_KEY, messages)
}

export function loadVoicePipelineState(): VoicePipelineState {
  return {
    ...defaultVoicePipelineState,
    ...readJson<Partial<VoicePipelineState>>(VOICE_PIPELINE_STORAGE_KEY, {}),
  }
}

export function saveVoicePipelineState(state: VoicePipelineState) {
  writeJson(VOICE_PIPELINE_STORAGE_KEY, state)
}

export function loadVoiceTrace(): VoiceTraceEntry[] {
  return readJson<VoiceTraceEntry[]>(VOICE_TRACE_STORAGE_KEY, defaultVoiceTrace).slice(0, 8)
}

export function saveVoiceTrace(trace: VoiceTraceEntry[]) {
  writeJson(VOICE_TRACE_STORAGE_KEY, trace.slice(0, 8))
}

export function loadDebugConsoleEvents(): DebugConsoleEvent[] {
  return readJson<Array<Partial<DebugConsoleEvent>>>(
    DEBUG_CONSOLE_EVENTS_STORAGE_KEY,
    defaultDebugConsoleEvents,
  )
    .map((event): DebugConsoleEvent => {
      const source: DebugConsoleEvent['source'] = (
        event.source === 'voice'
        || event.source === 'reminder'
        || event.source === 'scheduler'
        || event.source === 'tool'
        || event.source === 'system'
      )
        ? event.source
        : 'system'

      const tone: DebugConsoleEvent['tone'] = (
        event.tone === 'success'
        || event.tone === 'warning'
        || event.tone === 'error'
      )
        ? event.tone
        : 'info'

      return {
        id: String(event.id ?? '').trim(),
        source,
        title: String(event.title ?? '').trim(),
        detail: String(event.detail ?? '').trim(),
        tone,
        createdAt: String(event.createdAt ?? '').trim(),
        relatedTaskId: String(event.relatedTaskId ?? '').trim() || undefined,
      }
    })
    .filter((event) => event.id && event.title && event.detail && event.createdAt)
    .slice(0, 60)
}

export function saveDebugConsoleEvents(events: DebugConsoleEvent[]) {
  writeJson(DEBUG_CONSOLE_EVENTS_STORAGE_KEY, events.slice(0, 60))
}

export function loadReminderTasks(): ReminderTask[] {
  return readJson<Array<Partial<ReminderTask>>>(REMINDER_TASKS_STORAGE_KEY, defaultReminderTasks)
    .map((task) => ({
      id: String(task.id ?? ''),
      title: String(task.title ?? '').trim(),
      prompt: String(task.prompt ?? '').trim(),
      speechText: String(task.speechText ?? '').trim() || undefined,
      action: normalizeReminderTaskAction(task.action),
      enabled: task.enabled !== false,
      createdAt: String(task.createdAt ?? ''),
      updatedAt: String(task.updatedAt ?? ''),
      lastTriggeredAt: String(task.lastTriggeredAt ?? '').trim() || undefined,
      nextRunAt: String(task.nextRunAt ?? '').trim() || undefined,
      schedule: task.schedule as ReminderTask['schedule'],
    }))
    .filter((task) => task.id && task.title && task.prompt && task.schedule)
}

export function saveReminderTasks(tasks: ReminderTask[]) {
  writeJson(REMINDER_TASKS_STORAGE_KEY, tasks)
}

export function loadOnboardingCompleted() {
  const stored = readJson<{ completedAt?: string } | null>(ONBOARDING_STORAGE_KEY, null)
  if (stored?.completedAt) {
    return true
  }

  return Boolean(
    window.localStorage.getItem(SETTINGS_STORAGE_KEY)
    || window.localStorage.getItem(CHAT_STORAGE_KEY)
    || window.localStorage.getItem(MEMORY_STORAGE_KEY)
    || window.localStorage.getItem(DAILY_MEMORY_STORAGE_KEY),
  )
}

export function saveOnboardingCompleted(completed = true) {
  if (!completed) {
    window.localStorage.removeItem(ONBOARDING_STORAGE_KEY)
    return
  }

  writeJson(ONBOARDING_STORAGE_KEY, {
    completedAt: new Date().toISOString(),
  })
}

export function loadMemories(): MemoryItem[] {
  const next = readJson<MemoryItem[]>(MEMORY_STORAGE_KEY, [])
  if (next.length) {
    return next
  }

  const legacy = readJson<MemoryItem[]>(LEGACY_MEMORY_STORAGE_KEY, [])
  if (legacy.length) {
    writeJson(MEMORY_STORAGE_KEY, legacy)
  }

  return legacy
}

export function saveMemories(memories: MemoryItem[]) {
  writeJson(MEMORY_STORAGE_KEY, memories)
}

export function loadDailyMemories(): DailyMemoryStore {
  return readJson<DailyMemoryStore>(DAILY_MEMORY_STORAGE_KEY, {})
}

export function saveDailyMemories(memories: DailyMemoryStore) {
  writeJson(DAILY_MEMORY_STORAGE_KEY, memories)
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

function readStoredCharacterProfiles(raw: unknown): import('../types').CharacterProfile[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (entry: unknown): entry is import('../types').CharacterProfile =>
      typeof entry === 'object'
      && entry !== null
      && typeof (entry as Record<string, unknown>).id === 'string'
      && typeof (entry as Record<string, unknown>).companionName === 'string',
  )
}

function readStoredMcpServers(stored: Record<string, unknown>) {
  if (Array.isArray(stored.mcpServers)) {
    return stored.mcpServers.filter(
      (entry: unknown): entry is import('../types').McpServerConfig =>
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
  const clonedVoiceId = String(stored.clonedVoiceId ?? defaultSettings.clonedVoiceId).trim()
  const storedSpeechOutputProviderProfiles = readStoredSpeechOutputProviderProfiles(
    stored.speechOutputProviderProfiles,
    { clonedVoiceId },
  )
  const requestedSpeechInputProviderId = stored.speechInputProviderId ?? defaultSettings.speechInputProviderId
  const migrateLegacySpeechInputProvider = isBrowserSpeechInputProvider(requestedSpeechInputProviderId)
  const effectiveSpeechInputProviderId = migrateLegacySpeechInputProvider
    ? 'local-sherpa'
    : requestedSpeechInputProviderId
  const hasLocalSpeechInputProvider = (
    isLocalSherpaSpeechInputProvider(effectiveSpeechInputProviderId)
    || isLocalWhisperSpeechInputProvider(effectiveSpeechInputProviderId)
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
  const rawSpeechOutputModel = String(stored.speechOutputModel ?? defaultSettings.speechOutputModel).trim()
    || speechOutputPreset.defaultModel || defaultSettings.speechOutputModel
  const speechOutputModel = (
    speechOutputProviderId === 'cosyvoice-tts'
    && rawSpeechOutputModel !== 'sft'
    && rawSpeechOutputModel !== 'instruct'
  ) ? 'sft' : rawSpeechOutputModel
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

function resolveThemeId(storedThemeId: unknown): AppSettings['themeId'] {
  switch (storedThemeId) {
    case 'soft':
    case 'high-contrast':
    case 'nexus-default':
      return storedThemeId
    default:
      return defaultSettings.themeId
  }
}

export function loadAmbientPresence(): AmbientPresenceState | null {
  const stored = readJson<AmbientPresenceState | null>(AMBIENT_PRESENCE_STORAGE_KEY, null)
  if (!stored?.text || !stored.createdAt || !stored.expiresAt) {
    return null
  }

  if (Date.parse(stored.expiresAt) <= Date.now()) {
    return null
  }

  return stored
}

export function saveAmbientPresence(state: AmbientPresenceState | null) {
  if (!state) {
    window.localStorage.removeItem(AMBIENT_PRESENCE_STORAGE_KEY)
    return
  }

  writeJson(AMBIENT_PRESENCE_STORAGE_KEY, state)
}

export function loadPresenceActivityAt() {
  const stored = readJson<number>(PRESENCE_ACTIVITY_AT_STORAGE_KEY, Date.now())
  return Number.isFinite(stored) ? stored : Date.now()
}

export function savePresenceActivityAt(timestamp: number) {
  writeJson(PRESENCE_ACTIVITY_AT_STORAGE_KEY, timestamp)
}

export function loadLastProactivePresenceAt() {
  const stored = readJson<number>(LAST_PROACTIVE_PRESENCE_AT_STORAGE_KEY, 0)
  return Number.isFinite(stored) ? stored : 0
}

export function saveLastProactivePresenceAt(timestamp: number) {
  writeJson(LAST_PROACTIVE_PRESENCE_AT_STORAGE_KEY, timestamp)
}

export function loadPresenceHistory() {
  return readJson<PresenceHistoryItem[]>(PRESENCE_HISTORY_STORAGE_KEY, []).slice(0, 6)
}

export function savePresenceHistory(history: PresenceHistoryItem[]) {
  writeJson(PRESENCE_HISTORY_STORAGE_KEY, history.slice(0, 6))
}

export function loadPetWindowPreferences(): PetWindowPreferences {
  return {
    ...defaultPetWindowPreferences,
    ...readJson<Partial<PetWindowPreferences>>(PET_WINDOW_PREFERENCES_STORAGE_KEY, {}),
  }
}

export function savePetWindowPreferences(preferences: PetWindowPreferences) {
  writeJson(PET_WINDOW_PREFERENCES_STORAGE_KEY, preferences)
}

export function loadPetRuntimeState(): PetRuntimeState {
  return {
    ...defaultPetRuntimeState,
    ...readJson<Partial<PetRuntimeState>>(PET_RUNTIME_STORAGE_KEY, {}),
  }
}

export function savePetRuntimeState(state: PetRuntimeState) {
  writeJson(PET_RUNTIME_STORAGE_KEY, state)
}

export function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`
}
