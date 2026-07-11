/// <reference types="vite/client" />

import type {
  CodexPetGalleryCatalogResult,
  PetModelDefinition,
  SpritePetCreatorKitInspection,
} from './features/pet'
import type { VoiceEmotionLabel } from './types'
import type {
  AudioSynthesisRequest,
  AudioSynthesisResponse,
  AudioTranscriptionRequest,
  AudioTranscriptionResponse,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatModelListRequest,
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
  ProviderHealthResult,
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

type NotificationWatcherStatus = {
  status: 'stopped' | 'running' | 'needs-permission' | 'unsupported' | 'error'
  lastError: string | null
  platformSupported: boolean
}

type PairingRequest = {
  senderId: string
  name: string
  code: string
  createdAt: number
}

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

type ModelCatalogEntry = {
  id: string
  label: string
  sizeLabel: string
  purpose: string
  required: boolean
  kind: 'archive' | 'files' | 'standalone'
  present: boolean
  verified: boolean
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

type LocalDataStatus = {
  initialized: boolean
  healthy: boolean
  backend: 'sqlite'
  schemaVersion: number
  targetSchemaVersion: number
  migrationCount: number
  lastMigrationId: string | null
  storageDirectoryName: 'local-data'
  errorKind: string | null
  errorMessage: string | null
}

type LocalDataOnboardingMirrorState = {
  completedAt: string
  firstConversationAt?: string
  firstConversationElapsedMs?: number
}

type LocalDataOnboardingMirrorResult = {
  ok: boolean
  domainId: 'onboarding'
  recordId: 'state'
  mirrored: boolean
  deleted: boolean
  schemaVersion?: number
  errorKind: string | null
  errorMessage: string | null
}

type LocalDataChatMigrationMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: string
  tone?: 'neutral' | 'error'
  reasoning_content?: string
  toolResult?: unknown
}

type LocalDataChatMigrationSession = {
  id: string
  startedAt: number
  lastActiveAt: number
  title?: string
  messages: LocalDataChatMigrationMessage[]
}

type LocalDataChatMigrationPackage = {
  schemaVersion: 1
  createdAt: string
  source: {
    sessionsKeyPresent: boolean
    legacyFlatChatKeyPresent: boolean
    legacyFlatChatUsed: boolean
  }
  dryRunReport?: unknown
  sessions: LocalDataChatMigrationSession[]
}

type LocalDataChatMigrationApplyResult = {
  ok: boolean
  targetDomainId: 'chat-sessions'
  schemaVersion?: number
  sessionCount?: number
  messageCount?: number
  payloadBytes?: number
  legacyFlatChatUsed?: boolean
  requiresConfirmation?: boolean
  writesData?: boolean
  applied: boolean
  recordsWritten: number
  auditRecordId: string | null
  errorKind: string | null
  errorMessage: string | null
}

type LocalDataChatMigrationRollbackResult = {
  ok: boolean
  targetDomainId: 'chat-sessions'
  recordsDeleted: number
  auditRecordId: string | null
  errorKind: string | null
  errorMessage: string | null
}

type LocalDataChatMigrationStatusResult = {
  ok: boolean
  targetDomainId: 'chat-sessions'
  schemaVersion?: number
  recordCount: number
  messageCount: number
  recordPayloadsIncluded: false
  lastAuditRecordId: string | null
  lastAuditAction: 'chat-sessions-migration-applied' | 'chat-sessions-migration-rolled-back' | null
  lastAuditAt: string | null
  errorKind: string | null
  errorMessage: string | null
}

type LocalDataChatRuntimeMirrorResult = {
  ok: boolean
  targetDomainId: 'chat-sessions'
  schemaVersion?: number
  mirrored: boolean
  deleted: boolean
  recordsWritten: number
  recordsDeleted: number
  messageCount: number
  auditRecordId: string | null
  errorKind: string | null
  errorMessage: string | null
}

type LocalDataChatSessionsReadResult = {
  ok: boolean
  targetDomainId: 'chat-sessions'
  schemaVersion?: number
  recordPayloadsIncluded: true
  recordCount: number
  validSessionCount: number
  messageCount: number
  malformedRecordCount: number
  sessions: LocalDataChatMigrationSession[]
  errorKind: string | null
  errorMessage: string | null
}

type LocalDataChatComparisonSourceSession = {
  id: string
  startedAt: number
  lastActiveAt: number
  messageCount: number
  payloadBytes: number
}

type LocalDataChatComparisonSource = {
  schemaVersion: 1
  generatedAt: string
  source: {
    sessionsKeyPresent: boolean
    legacyFlatChatKeyPresent: boolean
    legacyFlatChatUsed: boolean
  }
  sessions: LocalDataChatComparisonSourceSession[]
}

type LocalDataChatComparisonResult = {
  ok: boolean
  targetDomainId: 'chat-sessions'
  schemaVersion?: number
  compared: boolean
  recordPayloadsIncluded: false
  status: 'aligned' | 'differences' | 'empty' | 'blocked'
  sourceSessionCount: number
  sqliteSessionCount: number
  matchedRecordCount: number
  metadataAlignedRecordCount: number
  metadataMismatchCount: number
  missingSqliteRecordCount: number
  extraSqliteRecordCount: number
  malformedSqliteRecordCount: number
  sourceMessageCount: number
  sqliteMessageCount: number
  messageCountDelta: number
  sourcePayloadBytes: number
  sqlitePayloadBytes: number
  issueCodes: string[]
  auditRecordId: string | null
  errorKind: string | null
  errorMessage: string | null
}

type LocalDataMemoryItem = {
  id: string
  content: string
  category: string
  source: string
  kind?: string
  enabled: boolean
  sourceRef?: string
  createdAt: string
  lastUsedAt?: string
  importance?: string
  importanceScore?: number
  recallCount?: number
  lastRecalledAt?: string
  relatedIds?: string[]
  emotionSnapshot?: { energy: number; warmth: number; curiosity: number; concern: number }
  emotionalValence?: string
  significance?: number
  reflectionTopic?: string
  reflectionConfidence?: number
}

type LocalDataMemoryDailyEntry = {
  id: string
  day: string
  role: 'user' | 'assistant'
  content: string
  source: 'chat' | 'voice'
  createdAt: string
}

type LocalDataMemoryMigrationPackage = {
  schemaVersion: 1
  createdAt: string
  source: {
    longTermKeyPresent: boolean
    legacyLongTermKeyPresent: boolean
    dailyKeyPresent: boolean
    legacyLongTermUsed: boolean
  }
  longTerm: LocalDataMemoryItem[]
  daily: LocalDataMemoryDailyEntry[]
}

type LocalDataMemoryMigrationApplyResult = {
  ok: boolean
  targetDomainIds: ['memory-long-term', 'memory-daily']
  schemaVersion?: number
  longTermRecordCount?: number
  dailyEntryCount?: number
  payloadBytes?: number
  legacyLongTermUsed?: boolean
  requiresConfirmation?: boolean
  writesData?: boolean
  applied: boolean
  recordsWritten: number
  auditRecordId: string | null
  errorKind: string | null
  errorMessage: string | null
}

type LocalDataMemoryMigrationRollbackResult = {
  ok: boolean
  targetDomainIds: ['memory-long-term', 'memory-daily']
  recordsDeleted: number
  auditRecordId: string | null
  errorKind: string | null
  errorMessage: string | null
}

type LocalDataMemoryMigrationStatusResult = {
  ok: boolean
  targetDomainIds: ['memory-long-term', 'memory-daily']
  schemaVersion?: number
  longTermRecordCount: number
  dailyEntryCount: number
  recordPayloadsIncluded: false
  lastAuditRecordId: string | null
  lastAuditAction: 'memory-migration-applied' | 'memory-migration-rolled-back' | null
  lastAuditAt: string | null
  errorKind: string | null
  errorMessage: string | null
}

type LocalDataMemoryReadResult = {
  ok: boolean
  targetDomainIds: ['memory-long-term', 'memory-daily']
  schemaVersion?: number
  recordPayloadsIncluded: true
  longTermRecordCount: number
  dailyEntryCount: number
  malformedRecordCount: number
  memories: LocalDataMemoryItem[]
  daily: LocalDataMemoryDailyEntry[]
  errorKind: string | null
  errorMessage: string | null
}

type LocalDataCompanionStorageKey = 'nexus:autonomy:relationship' | 'nexus:autonomy:relationship-history' | 'nexus:autonomy:emotion' | 'nexus:autonomy:emotion-history' | 'nexus:autonomy:rhythm' | 'nexus:autonomy:user-affect-history' | 'nexus:plans' | 'nexus:open-goals' | 'nexus:agent-traces' | 'nexus:background-tasks' | 'nexus:agent:errands' | 'nexus:reminder-tasks'
type LocalDataCompanionDataset = { id: string; storageKey: LocalDataCompanionStorageKey; value: unknown; recordCount?: number; payloadBytes?: number }
type LocalDataCompanionMigrationPackage = { schemaVersion: 1; createdAt: string; source: { relationshipKeysPresent: string[]; taskKeysPresent: string[]; invalidKeys: string[] }; relationship: LocalDataCompanionDataset[]; tasks: LocalDataCompanionDataset[] }
type LocalDataCompanionTarget = ['companion-relationship', 'companion-tasks']
type LocalDataCompanionBaseResult = { ok: boolean; targetDomainIds: LocalDataCompanionTarget; schemaVersion?: number; errorKind: string | null; errorMessage: string | null }
type LocalDataCompanionMigrationStatusResult = LocalDataCompanionBaseResult & { relationshipDatasetCount: number; taskDatasetCount: number; totalRecordCount: number; payloadBytes: number; recordPayloadsIncluded: false; lastAuditRecordId: string | null; lastAuditAction: 'companion-migration-applied' | 'companion-migration-compared' | 'companion-migration-rolled-back' | null; lastAuditAt: string | null }
type LocalDataCompanionReadResult = LocalDataCompanionBaseResult & { recordPayloadsIncluded: true; relationship: LocalDataCompanionDataset[]; tasks: LocalDataCompanionDataset[]; malformedRecordCount: number }
type LocalDataCompanionComparisonDataset = { id: string; storageKey: LocalDataCompanionStorageKey; recordCount: number; payloadBytes: number }
type LocalDataCompanionComparisonSource = { schemaVersion: 1; generatedAt: string; relationship: LocalDataCompanionComparisonDataset[]; tasks: LocalDataCompanionComparisonDataset[] }
type LocalDataCompanionComparisonResult = LocalDataCompanionBaseResult & { compared: boolean; recordPayloadsIncluded: false; status: 'aligned' | 'differences' | 'empty' | 'blocked'; sourceDatasetCount: number; sqliteDatasetCount: number; matchedDatasetCount: number; metadataMismatchCount: number; missingSqliteDatasetCount: number; extraSqliteDatasetCount: number; malformedSqliteRecordCount: number; sourceRecordCount: number; sqliteRecordCount: number; sourcePayloadBytes: number; sqlitePayloadBytes: number; issueCodes: string[]; auditRecordId: string | null }
type LocalDataCompanionMirrorResult = { ok: boolean; mirrored: boolean; datasetId?: string; schemaVersion?: number; errorKind?: string; errorMessage?: string }
type LocalDataCompanionMigrationApplyResult = LocalDataCompanionBaseResult & { relationshipDatasetCount?: number; taskDatasetCount?: number; relationshipRecordCount?: number; taskRecordCount?: number; totalRecordCount?: number; payloadBytes?: number; requiresConfirmation?: boolean; writesData?: boolean; applied: boolean; recordsWritten: number; auditRecordId: string | null }
type LocalDataCompanionMigrationRollbackResult = LocalDataCompanionBaseResult & { recordsDeleted: number; auditRecordId: string | null }

declare global {
  interface Window {
    desktopPet?: {
      updatePetWindowState: (state: Partial<PetWindowState>) => Promise<PetWindowState>
      getPetWindowState: () => Promise<PetWindowState>
      setPetFreeMode: (freeMode: boolean) => Promise<PetWindowState | null>
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
      importCodexPetGallery: (input: string) => Promise<{
        model: PetModelDefinition
        message: string
      }>
      listCodexPetGallery: (payload?: { query?: string; limit?: number }) => Promise<CodexPetGalleryCatalogResult>
      createCodexPetCreatorKit: (payload: {
        id?: string
        displayName?: string
        description?: string
        concept?: string
        styleNotes?: string
      }) => Promise<{
        id: string
        displayName: string
        directoryPath: string
        directoryPathDisplay?: string
        sourceRowsDirectory?: string
        sourceRowsDirectoryDisplay?: string
        message: string
      }>
      inspectCodexPetCreatorKit: (payload?: { kitDirectory?: string }) => Promise<SpritePetCreatorKitInspection | null>
      assembleCodexPetCreatorKit: (payload?: { kitDirectory?: string }) => Promise<{
        model: PetModelDefinition
        message: string
        packageDirectory?: string
        packageDirectoryDisplay?: string
        manifestPath?: string
        manifestPathDisplay?: string
        spritesheetPath?: string
        spritesheetPathDisplay?: string
        reportPath?: string
        reportPathDisplay?: string
        visualAuditPath?: string
        visualAuditPathDisplay?: string
        archivePath?: string
        archivePathDisplay?: string
      } | null>
      installCodexPetCreatorKitToCodex: (payload: {
        kitDirectory: string
        manifestPath: string
      }) => Promise<{
        ok: boolean
        id: string
        directoryPath: string
        directoryPathDisplay?: string
        manifestPath: string
        manifestPathDisplay?: string
        message: string
      }>
      openCodexPetCreatorKitPath: (payload: {
        kitDirectory: string
        targetPath: string
        mode?: 'open' | 'reveal'
      }) => Promise<{
        ok: boolean
        message: string
      }>
      createSpritePetFromImage: () => Promise<{
        model: PetModelDefinition
        message: string
        packageDirectory?: string
        packageDirectoryDisplay?: string
        manifestPath?: string
        manifestPathDisplay?: string
        spritesheetPath?: string
        spritesheetPathDisplay?: string
        visualAuditPath?: string
        visualAuditPathDisplay?: string
        archivePath?: string
        archivePathDisplay?: string
      } | null>
      showConfirmDialog: (message: string) => Promise<boolean>
      saveTextFile: (payload: TextFileSaveRequest) => Promise<TextFileSaveResponse>
      openTextFile: (payload: TextFileOpenRequest) => Promise<TextFileOpenResponse>
      searchWeb: (payload: WebSearchRequest) => Promise<WebSearchResponse>
      getWeather: (payload: WeatherLookupRequest) => Promise<WeatherLookupResponse | null>
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
      listChatModels: (payload: ChatModelListRequest) => Promise<ProviderHealthResult>
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
      telegramSendVoice: (payload: { chatId: number; audioBase64: string; mimeType: string; replyToMessageId?: number }) => Promise<{ ok: boolean }>
      telegramPairingList: () => Promise<PairingRequest[]>
      telegramPairingResolve: (payload: { senderId: string }) => Promise<{ removed: boolean }>
      subscribeTelegramPairing: (listener: (request: PairingRequest) => void) => () => void
      telegramStatus: () => Promise<TelegramGatewayStatus>
      subscribeTelegramMessage: (listener: (msg: TelegramIncomingMessage) => void) => () => void

      // Discord Gateway
      discordConnect: (payload: { botToken: string; allowedChannelIds?: string[] }) => Promise<DiscordGatewayStatus>
      discordDisconnect: () => Promise<{ ok: boolean }>
      discordSendMessage: (payload: { channelId: string; text: string; replyToMessageId?: string }) => Promise<{ ok: boolean }>
      discordSendVoice: (payload: { channelId: string; audioBase64: string; mimeType: string; replyToMessageId?: string }) => Promise<{ ok: boolean }>
      discordPairingList: () => Promise<PairingRequest[]>
      discordPairingResolve: (payload: { senderId: string }) => Promise<{ removed: boolean }>
      subscribeDiscordPairing: (listener: (request: PairingRequest) => void) => () => void
      discordStatus: () => Promise<DiscordGatewayStatus>
      subscribeDiscordMessage: (listener: (msg: DiscordIncomingMessage) => void) => () => void

      // MCP Host (multi-server) — start/stop/restart restricted to main process only
      mcpStatus: (payload?: { id: string }) => Promise<McpHostStatus | McpHostStatus[]>
      mcpListTools: (payload?: { id: string }) => Promise<McpToolDescriptor[]>
      mcpCallTool: (payload: { serverId?: string; name: string; arguments?: Record<string, unknown> }) => Promise<unknown>
      mcpSyncServers: (payload: { servers: Array<{ id: string; label?: string; command: string; args?: string; enabled: boolean }> }) => Promise<McpHostStatus[]>

      // External action permission policy
      externalActionPolicyGet: () => Promise<Record<'telegram' | 'discord' | 'minecraft' | 'factorio' | 'mcp', 'read-only' | 'confirm' | 'auto'>>
      externalActionPolicySync: (payload: {
        policies: Record<'telegram' | 'discord' | 'minecraft' | 'factorio' | 'mcp', {
          mode: 'read-only' | 'confirm' | 'auto'
          active?: boolean
        }>
      }) => Promise<{
        policy: Record<'telegram' | 'discord' | 'minecraft' | 'factorio' | 'mcp', 'read-only' | 'confirm' | 'auto'>
        changes: Array<{ integration: string; from: string; to: string; active: boolean }>
        rejected: Array<{ integration: string; from: string; to: string; active: boolean }>
      }>
      localDataStatus: () => Promise<LocalDataStatus>
      localDataMirrorOnboarding: (payload?: { state?: LocalDataOnboardingMirrorState }) => Promise<LocalDataOnboardingMirrorResult>
      localDataChatMigrationStatus: () => Promise<LocalDataChatMigrationStatusResult>
      localDataReadChatSessions: () => Promise<LocalDataChatSessionsReadResult>
      localDataMirrorChatSession: (payload: {
        confirmed: boolean
        session: LocalDataChatMigrationSession
      }) => Promise<LocalDataChatRuntimeMirrorResult>
      localDataCompareChatSessions: (payload: {
        confirmed: boolean
        source: LocalDataChatComparisonSource
      }) => Promise<LocalDataChatComparisonResult>
      localDataApplyChatMigration: (payload: {
        confirmed: boolean
        migrationPackage: LocalDataChatMigrationPackage
      }) => Promise<LocalDataChatMigrationApplyResult>
      localDataRollbackChatMigration: (payload: { confirmed: boolean }) => Promise<LocalDataChatMigrationRollbackResult>
      localDataMemoryMigrationStatus: () => Promise<LocalDataMemoryMigrationStatusResult>
      localDataReadMemory: () => Promise<LocalDataMemoryReadResult>
      localDataApplyMemoryMigration: (payload: {
        confirmed: boolean
        migrationPackage: LocalDataMemoryMigrationPackage
      }) => Promise<LocalDataMemoryMigrationApplyResult>
      localDataRollbackMemoryMigration: (payload: { confirmed: boolean }) => Promise<LocalDataMemoryMigrationRollbackResult>
      localDataCompanionMigrationStatus: () => Promise<LocalDataCompanionMigrationStatusResult>
      localDataReadCompanion: () => Promise<LocalDataCompanionReadResult>
      localDataCompareCompanion: (payload: {
        confirmed: boolean
        source: LocalDataCompanionComparisonSource
      }) => Promise<LocalDataCompanionComparisonResult>
      localDataMirrorCompanionDataset: (payload: {
        confirmed: boolean
        storageKey: LocalDataCompanionStorageKey
        value: unknown
      }) => Promise<LocalDataCompanionMirrorResult>
      localDataApplyCompanionMigration: (payload: {
        confirmed: boolean
        migrationPackage: LocalDataCompanionMigrationPackage
      }) => Promise<LocalDataCompanionMigrationApplyResult>
      localDataRollbackCompanionMigration: (payload: { confirmed: boolean }) => Promise<LocalDataCompanionMigrationRollbackResult>

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

      // Plugin Message Bus
      pluginBusPublish: (payload: { serverId: string; topic: string; data?: unknown }) => Promise<{ delivered: number }>
      pluginBusSubscribe: (payload: { serverId: string; topic: string }) => Promise<{ accepted: boolean }>
      pluginBusUnsubscribe: (payload: { serverId: string; topic: string }) => Promise<void>
      pluginBusSubscriptions: () => Promise<Record<string, string[]>>
      pluginBusRecent: (payload?: { limit?: number }) => Promise<Array<{
        topic: string
        payload: unknown
        from: string
        timestamp: string
      }>>
      pluginBusStats: () => Promise<{
        topicCount: number
        totalSubscriptions: number
        recentMessageCount: number
      }>

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
        logPath: string
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

      // Autonomy: system idle & power events
      /** Returns system idle time in seconds. */
      getSystemIdleTime: () => Promise<number>
      subscribePowerEvents: (listener: (event: { kind: import('./types').PowerEventKind }) => void) => () => void

      // Autonomy: notification bridge
      getNotificationChannels: () => Promise<import('./types').NotificationChannel[]>
      getNotificationWebhookInfo: () => Promise<{
        url: string
        requiresAuth: boolean
        tokenFileName: string
        maxBodyBytes: number
      }>
      setNotificationChannels: (channels: import('./types').NotificationChannel[]) => Promise<void>
      startNotificationBridge: () => Promise<void>
      stopNotificationBridge: () => Promise<void>
      notificationWatcherSet: (payload: { enabled: boolean; appsPattern?: string }) => Promise<NotificationWatcherStatus>
      notificationWatcherStatus: () => Promise<NotificationWatcherStatus>
      subscribeNotificationWatcherStatus: (listener: (status: NotificationWatcherStatus) => void) => () => void
      subscribeNotifications: (listener: (message: import('./types').NotificationMessage) => void) => () => void

      // Proactive OS-level notification ("[name] 在想你")
      showProactiveNotification: (payload: { title: string; body: string }) => Promise<{ ok: boolean }>

      // Key vault (safeStorage encryption). Retrieval returns opaque
      // nexus-vault-ref tokens; plaintext is resolved only in the main process.
      vaultIsAvailable: () => Promise<boolean>
      vaultStore: (slot: string, plaintext: string) => Promise<void>
      vaultRetrieve: (slot: string) => Promise<string>
      vaultDelete: (slot: string) => Promise<void>
      vaultListSlots: () => Promise<string[]>
      vaultStoreMany: (entries: Record<string, string>) => Promise<void>
      vaultRetrieveMany: (slots: string[]) => Promise<Record<string, string>>
      // VTube Studio bridge. Renderer sends companion state only; token
      // storage and WebSocket authentication stay in the main process.
      vtsBridgeConnect: (payload: { port: number }) => Promise<{
        state: 'disconnected' | 'connecting' | 'auth_needed' | 'ready' | 'error'
        modelName: string
        port: number
        error?: string
      }>
      vtsBridgeDisconnect: () => Promise<{
        state: 'disconnected' | 'connecting' | 'auth_needed' | 'ready' | 'error'
        modelName: string
        port: number
        error?: string
      }>
      vtsBridgeStatus: () => Promise<{
        state: 'disconnected' | 'connecting' | 'auth_needed' | 'ready' | 'error'
        modelName: string
        port: number
        error?: string
      }>
      vtsBridgeUpdateInput: (payload: {
        expressionSlot: import('./features/pet/models').PetExpressionSlot
        speechLevel: number
        gazeTarget: import('./features/pet/components/live2d/types').GazeTarget
        isSpeaking: boolean
        isListening: boolean
      }) => Promise<{
        state: 'disconnected' | 'connecting' | 'auth_needed' | 'ready' | 'error'
        modelName: string
        port: number
        error?: string
      }>
      vtsBridgeMigrateLegacyToken: (token: string) => Promise<void>
      subscribeVtsBridgeStatus: (listener: (status: {
        state: 'disconnected' | 'connecting' | 'auth_needed' | 'ready' | 'error'
        modelName: string
        port: number
        error?: string
      }) => void) => () => void

      // Auto-updater (electron-updater + GitHub Releases)
      updaterCheck: () => Promise<{
        ok: boolean
        currentVersion: string
        latestVersion?: string | null
        updateMode?: string | null
        manualDownload?: boolean
        releaseUrl?: string | null
        reason?: string
      }>
      updaterStatus: () => Promise<{
        currentVersion: string
        isPackaged: boolean
        updateMode?: string | null
        last: import('./features/updater/types').UpdaterEvent
      }>
      updaterInstall: () => Promise<boolean>
      subscribeUpdaterEvent: (listener: (event: import('./features/updater/types').UpdaterEvent) => void) => () => void
    }
  }
}

export {}
