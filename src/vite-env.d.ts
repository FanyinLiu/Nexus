/// <reference types="vite/client" />

import type { PetModelDefinition } from './features/pet'
import type { VoiceEmotionLabel } from './types'
import type {
  AudioSynthesisRequest,
  AudioSynthesisResponse,
  AudioTranscriptionRequest,
  AudioTranscriptionResponse,
  ChatCompletionRequest,
  ChatCompletionResponse,
  DesktopContextRequest,
  DesktopContextSnapshot,
  ExternalLinkRequest,
  ExternalLinkResponse,
  IntegrationInspectRequest,
  IntegrationInspectResponse,
  LocalServiceProbeRequest,
  LocalServiceProbeResult,
  MediaSessionControlRequest,
  MediaSessionControlResponse,
  MediaSessionSnapshot,
  PlatformProfile,
  TextFileOpenRequest,
  TextFileOpenResponse,
  TextFileSaveRequest,
  TextFileSaveResponse,
  PanelWindowState,
  PetWindowState,
  ServiceConnectionRequest,
  ServiceConnectionResponse,
  WeatherLookupRequest,
  WeatherLookupResponse,
  WebSearchRequest,
  WebSearchResponse,
  RuntimeStateSnapshot,
  SpeechVoiceListRequest,
  SpeechVoiceListResponse,
  TtsStreamAbortRequest,
  TtsStreamAbortResponse,
  TtsStreamEvent,
  TtsStreamFinishRequest,
  TtsStreamPushTextRequest,
  TtsStreamStartRequest,
  TtsStreamStartResponse,
} from './types'


type MinecraftGatewayEvent = {
  type: string
  body: string
  sender: string
  timestamp: string
}

type MinecraftGatewayStatus = {
  state: 'disconnected' | 'connecting' | 'connected'
  address: string | null
  port: number | null
  username: string | null
  reconnectCount: number
  recentEvents: MinecraftGatewayEvent[]
}

type MinecraftGameContext = {
  game: 'minecraft'
  connected: true
  address: string
  username: string
  recentChat: string[]
  recentPlayerEvents: string[]
} | null

type FactorioRconStatus = {
  state: 'disconnected' | 'connecting' | 'authenticating' | 'connected'
  address: string | null
  port: number | null
  recentCommands: { command: string; response: string; timestamp: string }[]
}

type FactorioGameContext = {
  game: 'factorio'
  connected: true
  address: string
  recentCommands: { command: string; response: string; timestamp: string }[]
} | null

type TelegramGatewayStatus = {
  state: 'disconnected' | 'connecting' | 'connected' | 'error'
  botUsername: string | null
  allowedChatIds: number[]
  lastError: string | null
}

type TelegramIncomingMessage = {
  chatId: number
  chatTitle: string
  fromUser: string
  text: string
  messageId: number
  timestamp: string
}

type DiscordGatewayStatus = {
  state: 'disconnected' | 'connecting' | 'connected' | 'error'
  botUsername: string | null
  allowedChannelIds: string[]
  lastError: string | null
}

type DiscordIncomingMessage = {
  channelId: string
  guildId: string | null
  guildName: string | null
  channelName: string
  fromUser: string
  fromUserId: string
  text: string
  messageId: string
  timestamp: string
}

type PluginStatus = {
  id: string
  name: string
  description: string
  version: string
  enabled: boolean
  approved: boolean
  running: boolean
  mcpState: 'stopped' | 'starting' | 'running' | 'crashed'
  toolCount: number
  tools: { name: string; description: string }[]
  capabilities: string[]
  skillGuide: string
}

type McpToolDescriptor = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  serverId?: string
}

type McpHostStatus = {
  id: string
  state: 'stopped' | 'starting' | 'running' | 'crashed'
  pid: number | null
  startedAt: string | null
  toolCount: number
  tools: { name: string; description: string }[]
  restartCount: number
}

type RealtimeSessionOptions = {
  apiKey: string
  baseUrl?: string
  model?: string
  voice?: string
  systemPrompt?: string
  temperature?: number
  maxResponseTokens?: number
}

type ModelCatalogEntry = {
  id: string
  label: string
  sizeLabel: string
  purpose: string
  required: boolean
  kind: 'archive' | 'files' | 'standalone'
  present: boolean
  location: string | null
}

type ModelInventory = {
  models: ModelCatalogEntry[]
  ready: boolean
  missingRequired: string[]
  primaryDir: string
  searchRoots: string[]
}

type PythonRuntimeStatus = {
  pythonAvailable: boolean
  binary: string | null
  version: string | null
  omniVoice: { ready: boolean; missingImports: string[] }
  glmAsr: { ready: boolean; missingImports: string[] }
}

type ModelProgressEvent = {
  modelId: string
  phase: 'start' | 'downloading' | 'done' | 'installed' | 'error'
  downloaded?: number
  total?: number
  fileName?: string
  fileIndex?: number
  totalFiles?: number
  message?: string
}

type RealtimeEvent =
  | { type: 'state'; state: 'idle' | 'connecting' | 'active' | 'error'; sessionId: string }
  | { type: 'user_speech_started'; sessionId: string }
  | { type: 'user_speech_stopped'; sessionId: string }
  | { type: 'user_transcript'; sessionId: string; text: string }
  | { type: 'audio'; sessionId: string; samples: number[]; sampleRate: number; channels: number }
  | { type: 'response_transcript_delta'; sessionId: string; delta: string }
  | { type: 'response_transcript_done'; sessionId: string; text: string }
  | { type: 'response_done'; sessionId: string }
  | { type: 'error'; sessionId: string; message: string }

declare global {
  interface Window {
    desktopPet?: {
      updatePetWindowState: (state: Partial<PetWindowState>) => Promise<PetWindowState>
      getPetWindowState: () => Promise<PetWindowState>
      subscribePetWindowState: (listener: (state: PetWindowState) => void) => () => void
      dragBy: (delta: { x: number; y: number }) => Promise<void>
      openPanel: (section?: 'chat' | 'settings') => Promise<void>
      openPetMenu: () => Promise<void>
      closePanel: () => Promise<void>
      getPanelWindowState: () => Promise<PanelWindowState>
      setPanelWindowState: (state: Partial<PanelWindowState>) => Promise<PanelWindowState>
      isPanelWindow: () => Promise<boolean>
      subscribePanelSection: (listener: (payload: { section: 'chat' | 'settings' }) => void) => () => void
      subscribePanelWindowState: (listener: (state: PanelWindowState) => void) => () => void
      subscribeRuntimeState: (listener: (state: {
        mood: 'idle' | 'thinking' | 'happy' | 'sleepy'
        continuousVoiceActive?: boolean
        panelSettingsOpen?: boolean
      } & RuntimeStateSnapshot) => void) => () => void
      getRuntimeState: () => Promise<RuntimeStateSnapshot>
      heartbeatRuntimeState: (payload: { view: 'pet' | 'panel' }) => Promise<RuntimeStateSnapshot>
      updateRuntimeState: (state: Partial<RuntimeStateSnapshot>) => Promise<void>
      getLaunchOnStartup: () => Promise<boolean>
      setLaunchOnStartup: (value: boolean) => Promise<boolean>
      getPlatformProfile: () => Promise<PlatformProfile>
      listPetModels: () => Promise<PetModelDefinition[]>
      importPetModel: () => Promise<{
        model: PetModelDefinition
        message: string
      } | null>
      showConfirmDialog: (message: string) => Promise<boolean>
      saveTextFile: (payload: TextFileSaveRequest) => Promise<TextFileSaveResponse>
      openTextFile: (payload: TextFileOpenRequest) => Promise<TextFileOpenResponse>
      searchWeb: (payload: WebSearchRequest) => Promise<WebSearchResponse>
      getWeather: (payload: WeatherLookupRequest) => Promise<WeatherLookupResponse>
      openExternalLink: (payload: ExternalLinkRequest) => Promise<ExternalLinkResponse>
      completeChat: (payload: ChatCompletionRequest) => Promise<ChatCompletionResponse>
      completeChatStream: (
        payload: ChatCompletionRequest,
        onDelta: (delta: string, done: boolean) => void,
      ) => Promise<ChatCompletionResponse> & { abort: () => Promise<void> }
      testChatConnection: (payload: {
        providerId?: string
        baseUrl: string
        apiKey: string
        model?: string
      }) => Promise<ServiceConnectionResponse>
      testServiceConnection: (payload: ServiceConnectionRequest) => Promise<ServiceConnectionResponse>
      probeLocalServices: (
        payload: LocalServiceProbeRequest[],
      ) => Promise<LocalServiceProbeResult[]>
      inspectIntegrations: (
        payload: IntegrationInspectRequest,
      ) => Promise<IntegrationInspectResponse>
      listSpeechVoices: (payload: SpeechVoiceListRequest) => Promise<SpeechVoiceListResponse>
      transcribeAudio: (payload: AudioTranscriptionRequest) => Promise<AudioTranscriptionResponse>
      synthesizeAudio: (payload: AudioSynthesisRequest) => Promise<AudioSynthesisResponse>
      ttsStreamStart: (payload: TtsStreamStartRequest) => Promise<TtsStreamStartResponse>
      ttsStreamPushText: (payload: TtsStreamPushTextRequest) => Promise<{ ok: boolean }>
      ttsStreamFinish: (payload: TtsStreamFinishRequest) => Promise<{ ok: boolean }>
      ttsStreamAbort: (payload: TtsStreamAbortRequest) => Promise<TtsStreamAbortResponse>
      subscribeTtsStream: (
        listener: (event: TtsStreamEvent) => void,
      ) => () => void
      getDesktopContext: (request?: DesktopContextRequest) => Promise<DesktopContextSnapshot>
      getSystemMediaSession: () => Promise<MediaSessionSnapshot>
      controlSystemMediaSession: (payload: MediaSessionControlRequest) => Promise<MediaSessionControlResponse>

      // Tencent Cloud Real-Time ASR
      tencentAsrConnect: (payload: { apiKey?: string; appId: string; secretId: string; secretKey: string; engineModelType?: string; hotwordList?: string }) => Promise<{ state: string }>
      tencentAsrDisconnect: () => Promise<{ ok: boolean }>
      tencentAsrFeed: (payload: { samples: number[] | Float32Array; sampleRate?: number }) => Promise<{ ok: boolean }>
      tencentAsrFinish: () => Promise<{ text: string }>
      tencentAsrAbort: () => Promise<{ ok: boolean }>
      tencentAsrStatus: () => Promise<{ state: string }>
      subscribeTencentAsrResult: (listener: (event: { type: 'partial' | 'final' | 'error'; text: string }) => void) => () => void

      // Minecraft Gateway
      minecraftConnect: (payload: { address: string; port: number; username: string }) => Promise<MinecraftGatewayStatus>
      minecraftDisconnect: () => Promise<{ ok: boolean }>
      minecraftSendCommand: (payload: { command: string }) => Promise<{ ok: boolean }>
      minecraftStatus: () => Promise<MinecraftGatewayStatus>
      minecraftGameContext: () => Promise<MinecraftGameContext>

      // Factorio RCON
      factorioConnect: (payload: { address: string; port: number; password: string }) => Promise<FactorioRconStatus>
      factorioDisconnect: () => Promise<{ ok: boolean }>
      factorioExecute: (payload: { command: string }) => Promise<{ response: string }>
      factorioStatus: () => Promise<FactorioRconStatus>
      factorioGameContext: () => Promise<FactorioGameContext>

      // Telegram Gateway
      telegramConnect: (payload: { botToken: string; allowedChatIds?: number[] }) => Promise<TelegramGatewayStatus>
      telegramDisconnect: () => Promise<{ ok: boolean }>
      telegramSendMessage: (payload: { chatId: number; text: string; replyToMessageId?: number; parseMode?: string }) => Promise<{ ok: boolean }>
      telegramStatus: () => Promise<TelegramGatewayStatus>
      subscribeTelegramMessage: (listener: (msg: TelegramIncomingMessage) => void) => () => void

      // Discord Gateway
      discordConnect: (payload: { botToken: string; allowedChannelIds?: string[] }) => Promise<DiscordGatewayStatus>
      discordDisconnect: () => Promise<{ ok: boolean }>
      discordSendMessage: (payload: { channelId: string; text: string; replyToMessageId?: string }) => Promise<{ ok: boolean }>
      discordStatus: () => Promise<DiscordGatewayStatus>
      subscribeDiscordMessage: (listener: (msg: DiscordIncomingMessage) => void) => () => void

      // MCP Host (multi-server) — start/stop/restart restricted to main process only
      mcpStatus: (payload?: { id: string }) => Promise<McpHostStatus | McpHostStatus[]>
      mcpListTools: (payload?: { id: string }) => Promise<McpToolDescriptor[]>
      mcpCallTool: (payload: { serverId?: string; name: string; arguments?: Record<string, unknown> }) => Promise<unknown>
      mcpSyncServers: (payload: { servers: Array<{ id: string; label?: string; command: string; args?: string; enabled: boolean }> }) => Promise<McpHostStatus[]>

      // Plugin Host
      pluginScan: () => Promise<PluginStatus[]>
      pluginList: () => Promise<PluginStatus[]>
      pluginStart: (payload: { id: string }) => Promise<McpHostStatus>
      pluginStop: (payload: { id: string }) => Promise<{ ok: boolean }>
      pluginRestart: (payload: { id: string }) => Promise<McpHostStatus>
      pluginEnable: (payload: { id: string }) => Promise<PluginStatus>
      pluginDisable: (payload: { id: string }) => Promise<PluginStatus>
      pluginStatus: (payload: { id: string }) => Promise<PluginStatus | null>
      pluginDir: () => Promise<string>
      pluginApprove: (payload: { id: string }) => Promise<PluginStatus | null>
      pluginRevoke: (payload: { id: string }) => Promise<PluginStatus | null>

      // Memory Vector Store
      memoryVectorIndex: (payload: {
        id: string
        content: string
        embedding: number[]
        layer?: string
      }) => Promise<{ ok: boolean }>
      memoryVectorIndexBatch: (payload: Array<{
        id: string
        content: string
        embedding: number[]
        layer?: string
      }>) => Promise<{ ok: boolean; count: number }>
      memoryVectorSearch: (payload: {
        queryEmbedding: number[]
        limit?: number
        threshold?: number
        layer?: string
      }) => Promise<Array<{
        id: string
        content: string
        layer: string
        score: number
      }>>
      memoryVectorRemove: (payload: { id?: string; ids?: string[] }) => Promise<{ ok: boolean; count?: number }>
      memoryVectorStats: () => Promise<{
        totalEntries: number
        longTermCount: number
        dailyCount: number
        maxEntries: number
        storePath: string
      }>
      memoryKeywordSearch: (payload: {
        query: string
        limit?: number
        threshold?: number
        layer?: string
      }) => Promise<Array<{
        id: string
        content: string
        layer: string
        score: number
      }>>
      memoryHybridSearch: (payload: {
        queryEmbedding: number[]
        queryText: string
        limit?: number
        threshold?: number
        layer?: string
      }) => Promise<Array<{
        id: string
        content: string
        layer: string
        vectorScore: number
        keywordScore: number
        score: number
      }>>

      // Auto-generated Skills
      skillSave: (payload: {
        id: string
        title: string
        trigger: string
        summary: string
        content: string
      }) => Promise<{
        id: string
        title: string
        trigger: string
        summary: string
        createdAt: string
        usedCount: number
        lastUsedAt: string | null
      }>
      skillSearch: (payload: {
        query: string
        limit?: number
      }) => Promise<Array<{
        id: string
        title: string
        trigger: string
        summary: string
        content: string
        relevance: number
      }>>
      skillList: () => Promise<Array<{
        id: string
        title: string
        trigger: string
        summary: string
        createdAt: string
        usedCount: number
      }>>
      skillGet: (payload: { id: string }) => Promise<{
        id: string
        title: string
        content: string
      } | null>
      skillRemove: (payload: { id: string }) => Promise<boolean>
      skillMarkUsed: (payload: { id: string }) => Promise<{ ok: boolean }>
      skillStats: () => Promise<{ totalSkills: number; maxSkills: number; skillsDir: string }>

      // Persona (SOUL.md file-based identity)
      personaLoadSoul: () => Promise<string>
      personaLoadMemory: () => Promise<string>
      personaSaveSoul: (payload: { content: string }) => Promise<{ ok: boolean }>
      personaSaveMemory: (payload: { content: string }) => Promise<{ ok: boolean }>
      personaPaths: () => Promise<{ personaDir: string; soulPath: string; memoryPath: string }>
      personaOpenDir: () => Promise<{ ok: boolean }>
      personaInit: (payload: { defaultSoul: string }) => Promise<{ personaDir: string; soulPath: string; memoryPath: string }>
      /**
       * Load a v2 per-profile persona (userData/personas/<id>/soul.md etc.).
       * Every file on disk is optional; missing files become empty strings /
       * empty objects / empty arrays. `present` is true iff at least one
       * file was actually read.
       */
      personaLoadProfile: (profileId: string) => Promise<{
        id: string
        rootDir: string
        soul: string
        memory: string
        examplesRaw: string
        examples: Array<{ user: string; assistant: string }>
        style: {
          signaturePhrases?: string[]
          forbiddenPhrases?: string[]
          toneTags?: string[]
        }
        voice: {
          providerId?: string
          voice?: string
          model?: string
          instructions?: string
          apiBaseUrl?: string
        }
        tools: { allowlist?: string[]; blocklist?: string[] }
        present: boolean
      }>
      personaProfileDir: (profileId: string) => Promise<{ dir: string }>
      personaImportCard: () => Promise<{
        profile: {
          id: string
          label: string
          companionName: string
          systemPrompt: string
          petModelId: string
        }
        greeting: string | null
        lorebookEntries: Array<{
          id: string
          label: string
          keywords: string[]
          content: string
          enabled: boolean
          priority: number
          createdAt: string
          updatedAt: string
        }>
      } | null>

      // Sandboxed workspace fs (agent loop tools)
      workspaceSetRoot: (payload: { root: string }) => Promise<{ ok: boolean; root: string }>
      workspaceGetRoot: () => Promise<{ root: string }>
      workspaceRead: (payload: { path: string }) => Promise<{ path: string; content: string; truncated: boolean; bytes: number }>
      workspaceWrite: (payload: { path: string; content: string }) => Promise<{ path: string; bytes: number }>
      workspaceEdit: (payload: { path: string; oldString: string; newString: string }) => Promise<{ path: string; bytes: number; occurrences: number }>
      workspaceGlob: (payload: { pattern: string }) => Promise<{ pattern: string; matches: string[]; totalMatched: number; visited: number; hitLimit: boolean }>
      workspaceGrep: (payload: { query: string; caseSensitive?: boolean; maxResults?: number }) => Promise<{ query: string; matches: Array<{ path: string; line: number; text: string }>; visited: number; hitLimit: boolean }>

      // Model manager (first-launch setup wizard)
      modelsGetInventory: () => Promise<ModelInventory>
      modelsDownload: (modelId: string) => Promise<ModelInventory>
      modelsDownloadMissing: () => Promise<{ results: { id: string; ok: boolean; message?: string }[]; inventory: ModelInventory }>
      modelsNetworkProbe: () => Promise<{ huggingFaceReachable: boolean }>
      subscribeModelsProgress: (listener: (event: ModelProgressEvent) => void) => () => void
      pythonRuntimeStatus: () => Promise<PythonRuntimeStatus>

      // SenseVoice offline ASR (sherpa-onnx OfflineRecognizer)
      sensevoiceStatus: () => Promise<{ installed: boolean; modelFound: boolean; modelsDir: string; currentModelId: string | null }>
      sensevoiceStart: () => Promise<{ ok: boolean; sampleRate: number }>
      sensevoiceFeed: (
        payload: { samples: number[] | Float32Array },
      ) => Promise<{ ok: boolean }>
      sensevoiceFinish: () => Promise<{ text: string; voiceEmotion: VoiceEmotionLabel | null }>
      sensevoiceAbort: () => Promise<{ ok: boolean }>
      sensevoiceTranscribe: (
        payload: { samples: number[] | Float32Array; sampleRate?: number },
      ) => Promise<{ text: string; voiceEmotion: VoiceEmotionLabel | null }>

      // Paraformer streaming ASR (sherpa-onnx OnlineRecognizer)
      paraformerStatus: () => Promise<{ installed: boolean; modelFound: boolean; modelsDir: string; currentModelId: string | null }>
      paraformerStart: () => Promise<{ ok: boolean; sampleRate: number }>
      paraformerFeed: (
        payload: { samples: number[] | Float32Array },
      ) => Promise<{ text: string; isEndpoint: boolean }>
      paraformerFinish: () => Promise<{ text: string }>
      paraformerAbort: () => Promise<{ ok: boolean }>

      // Sherpa-onnx streaming ASR
      sherpaStatus: () => Promise<{ installed: boolean; modelFound: boolean; modelsDir: string }>
      sherpaStart: (payload?: { modelId?: string }) => Promise<{ ok: boolean; sampleRate: number }>
      sherpaFeed: (
        payload: { samples: number[] | Float32Array; sampleRate?: number },
      ) => Promise<{ partial: string | null; endpoint: string | null }>
      sherpaFinish: () => Promise<{ text: string }>
      sherpaAbort: () => Promise<{ ok: boolean }>
      kwsStatus: (payload?: { wakeWord?: string }) => Promise<{
        installed: boolean
        modelFound: boolean
        active: boolean
        reason?: string
        modelKind?: 'zh' | 'en' | null
      }>
      kwsStart: (payload?: { wakeWord?: string }) => Promise<{ ok: boolean }>
      kwsFeed: (
        payload: { samples: number[] | Float32Array; sampleRate?: number },
      ) => Promise<{ keyword: string | null }>
      kwsStop: () => Promise<{ ok: boolean }>

      vadStatus: () => Promise<{ installed: boolean; modelFound: boolean; active: boolean }>
      vadStart: (payload?: {
        threshold?: number
        minSilenceDuration?: number
        minSpeechDuration?: number
        maxSpeechDuration?: number
      }) => Promise<{ ok: boolean; sampleRate?: number; reason?: string }>
      vadFeed: (
        payload: { samples: number[] | Float32Array },
      ) => Promise<{
        speechDetected: boolean
        speechStarted: boolean
        speechEnded: boolean
        segments: Float32Array[]
      }>
      vadFlush: () => Promise<{ segments: Float32Array[] }>
      vadStop: () => Promise<{ ok: boolean }>

      // Realtime Voice (OpenAI Realtime API)
      realtimeStart?: (payload: RealtimeSessionOptions) => Promise<{ sessionId: string }>
      realtimeStop?: () => Promise<void>
      realtimeFeed?: (payload: { samples: number[] | Float32Array }) => Promise<{ ok: boolean }>
      realtimeInterrupt?: () => Promise<{ ok: boolean }>
      realtimeSendText?: (payload: { text: string }) => Promise<{ ok: boolean }>
      realtimeState?: () => Promise<{ state: 'idle' | 'connecting' | 'active' | 'error'; sessionId: string }>
      subscribeRealtimeEvent?: (listener: (event: RealtimeEvent) => void) => () => void

      // Autonomy: system idle & power events
      /** Returns system idle time in seconds. */
      getSystemIdleTime: () => Promise<number>
      subscribePowerEvents: (listener: (event: { kind: import('./types').PowerEventKind }) => void) => () => void

      // Autonomy: notification bridge
      getNotificationChannels: () => Promise<import('./types').NotificationChannel[]>
      getNotificationWebhookInfo: () => Promise<{
        url: string
        token: string
        authHeader: string
        maxBodyBytes: number
      }>
      setNotificationChannels: (channels: import('./types').NotificationChannel[]) => Promise<void>
      startNotificationBridge: () => Promise<void>
      stopNotificationBridge: () => Promise<void>
      subscribeNotifications: (listener: (message: import('./types').NotificationMessage) => void) => () => void

      // Proactive OS-level notification ("[name] 在想你")
      showProactiveNotification: (payload: { title: string; body: string }) => Promise<{ ok: boolean }>

      // Key vault (safeStorage encryption)
      vaultIsAvailable: () => Promise<boolean>
      vaultStore: (slot: string, plaintext: string) => Promise<void>
      vaultRetrieve: (slot: string) => Promise<string>
      vaultDelete: (slot: string) => Promise<void>
      vaultListSlots: () => Promise<string[]>
      vaultStoreMany: (entries: Record<string, string>) => Promise<void>
      vaultRetrieveMany: (slots: string[]) => Promise<Record<string, string>>

      // Auto-updater (electron-updater + GitHub Releases)
      updaterCheck: () => Promise<{
        ok: boolean
        currentVersion: string
        latestVersion?: string | null
        reason?: string
      }>
      updaterStatus: () => Promise<{
        currentVersion: string
        isPackaged: boolean
        last: import('./features/updater').UpdaterEvent
      }>
      updaterInstall: () => Promise<boolean>
      subscribeUpdaterEvent: (listener: (event: import('./features/updater').UpdaterEvent) => void) => () => void
    }
  }
}

export {}
