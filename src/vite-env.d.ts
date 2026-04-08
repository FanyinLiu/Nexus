/// <reference types="vite/client" />

import type { PetModelDefinition } from './features/pet'
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
  VoiceCloneRequest,
  VoiceCloneResponse,
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

type PluginStatus = {
  id: string
  name: string
  description: string
  version: string
  enabled: boolean
  running: boolean
  mcpState: 'stopped' | 'starting' | 'running' | 'crashed'
  toolCount: number
  tools: { name: string; description: string }[]
  capabilities: string[]
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
      listPetModels: () => Promise<PetModelDefinition[]>
      importPetModel: () => Promise<{
        model: PetModelDefinition
        message: string
      } | null>
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
      cloneVoice: (payload: VoiceCloneRequest) => Promise<VoiceCloneResponse>
      getDesktopContext: (request?: DesktopContextRequest) => Promise<DesktopContextSnapshot>
      getSystemMediaSession: () => Promise<MediaSessionSnapshot>
      controlSystemMediaSession: (payload: MediaSessionControlRequest) => Promise<MediaSessionControlResponse>

      // Tencent Cloud Real-Time ASR
      tencentAsrConnect: (payload: { appId: string; secretId: string; secretKey: string; engineModelType?: string; hotwordList?: string }) => Promise<{ state: string }>
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

      // MCP Host (multi-server)
      mcpStart: (payload: { id: string; command: string; args?: string }) => Promise<McpHostStatus>
      mcpStop: (payload: { id: string }) => Promise<{ ok: boolean }>
      mcpRestart: (payload: { id: string; command: string; args?: string }) => Promise<McpHostStatus>
      mcpStatus: (payload?: { id: string }) => Promise<McpHostStatus | McpHostStatus[]>
      mcpListTools: (payload?: { id: string }) => Promise<McpToolDescriptor[]>
      mcpCallTool: (payload: { serverId?: string; name: string; arguments?: Record<string, unknown> }) => Promise<unknown>

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

      // SenseVoice offline ASR (sherpa-onnx OfflineRecognizer)
      sensevoiceStatus: () => Promise<{ installed: boolean; modelFound: boolean; modelsDir: string; currentModelId: string | null }>
      sensevoiceStart: () => Promise<{ ok: boolean; sampleRate: number }>
      sensevoiceFeed: (
        payload: { samples: number[] | Float32Array },
      ) => Promise<{ ok: boolean }>
      sensevoiceFinish: () => Promise<{ text: string }>
      sensevoiceAbort: () => Promise<{ ok: boolean }>
      sensevoiceTranscribe: (
        payload: { samples: number[] | Float32Array; sampleRate?: number },
      ) => Promise<{ text: string }>

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

      // Realtime Voice (OpenAI Realtime API)
      realtimeStart: (payload: RealtimeSessionOptions) => Promise<{ sessionId: string }>
      realtimeStop: () => Promise<void>
      realtimeFeed: (payload: { samples: number[] | Float32Array }) => Promise<{ ok: boolean }>
      realtimeInterrupt: () => Promise<{ ok: boolean }>
      realtimeSendText: (payload: { text: string }) => Promise<{ ok: boolean }>
      realtimeState: () => Promise<{ state: 'idle' | 'connecting' | 'active' | 'error'; sessionId: string }>
      subscribeRealtimeEvent: (listener: (event: RealtimeEvent) => void) => () => void

      // Autonomy: system idle & power events
      /** Returns system idle time in seconds. */
      getSystemIdleTime: () => Promise<number>
      subscribePowerEvents: (listener: (event: { kind: import('./types').PowerEventKind }) => void) => () => void

      // Autonomy: notification bridge
      getNotificationChannels: () => Promise<import('./types').NotificationChannel[]>
      setNotificationChannels: (channels: import('./types').NotificationChannel[]) => Promise<void>
      startNotificationBridge: () => Promise<void>
      stopNotificationBridge: () => Promise<void>
      subscribeNotifications: (listener: (message: import('./types').NotificationMessage) => void) => () => void

      // Key vault (safeStorage encryption)
      vaultIsAvailable: () => Promise<boolean>
      vaultStore: (slot: string, plaintext: string) => Promise<void>
      vaultRetrieve: (slot: string) => Promise<string>
      vaultDelete: (slot: string) => Promise<void>
      vaultListSlots: () => Promise<string[]>
      vaultStoreMany: (entries: Record<string, string>) => Promise<void>
      vaultRetrieveMany: (slots: string[]) => Promise<Record<string, string>>
    }
  }
}

export {}
