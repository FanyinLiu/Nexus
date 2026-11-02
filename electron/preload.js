const { contextBridge, ipcRenderer } = require('electron')

// The bridge is deliberately untyped at runtime: every method forwards opaque
// renderer payloads to main-process schema validators. These typedefs only give
// the type checker enough shape to infer the forwarding parameters, so payload
// contents stay `unknown` unless preload itself reads a field.
/**
 * Callback registered by a `subscribe*` bridge method.
 * @template [T=unknown]
 * @typedef {(value: T) => void} IpcListener
 */

/**
 * Callback for subscriptions that only signal an event without a payload.
 * @typedef {() => void} IpcVoidListener
 */

/**
 * `ipcRenderer.on` handler shape used by the subscription helpers. The event
 * argument is never read, so `unknown` keeps this independent of Electron types.
 * @template [T=unknown]
 * @typedef {(event: unknown, value: T) => void} IpcEventHandler
 */

/**
 * Receives one incremental delta from `chat:complete-stream`.
 * @typedef {(delta: string, done: boolean, reasoningDelta: string) => void} ChatStreamDeltaHandler
 */

/**
 * Payload pushed on `chat:stream-delta` while a completion streams. `requestId`
 * is what lets a listener ignore deltas from another concurrent stream.
 * @typedef {object} ChatStreamDelta
 * @property {string} requestId
 * @property {string} delta
 * @property {boolean} [done]
 * @property {string} [reasoning_delta]
 */

// The panel owns the model installer UI. The URL token is only a renderer-side
// hint for which bridge surface to expose; main-process capability checks stay
// authoritative.
function isPanelView() {
  try {
    return new URLSearchParams(window.location.search).get('view') === 'panel'
  } catch {
    return false
  }
}

const panelView = isPanelView()

contextBridge.exposeInMainWorld('desktopPet', {
  updatePetWindowState: /** @param {unknown} state */ (state) => ipcRenderer.invoke('pet-window:update-state', state),
  getPetWindowState: () => ipcRenderer.invoke('pet-window:get-state'),
  setPetFreeMode: /** @param {boolean} freeMode */ (freeMode) => ipcRenderer.invoke('pet-window:set-free-mode', { freeMode }),
  subscribePetWindowState: /** @param {IpcListener} listener */ (listener) => {
    /** @type {IpcEventHandler} */
    const handler = (_event, state) => listener(state)
    ipcRenderer.on('pet-window:state-changed', handler)
    return () => ipcRenderer.removeListener('pet-window:state-changed', handler)
  },
  dragBy: /** @param {{ x: number, y: number }} delta */ (delta) => ipcRenderer.invoke('window:drag-by', delta),
  openPanel: /** @param {unknown} section */ (section) => ipcRenderer.invoke('window:open-panel', section),
  requestModelSetup: /** @param {unknown} options */ (options) => ipcRenderer.invoke('window:request-model-setup', options),
  claimModelSetupReminder: /** @param {unknown} options */ (options) => ipcRenderer.invoke('window:claim-model-setup-reminder', options),
  ...(panelView ? {
    consumeModelSetupRequest: () => ipcRenderer.invoke('window:consume-model-setup-request'),
    declineModelSetup: () => ipcRenderer.invoke('window:decline-model-setup'),
    subscribeModelSetupRequest: /** @param {IpcVoidListener} listener */ (listener) => {
      const handler = () => listener()
      ipcRenderer.on('models:setup-requested', handler)
      return () => ipcRenderer.removeListener('models:setup-requested', handler)
    },
  } : {}),
  getPanelSection: () => ipcRenderer.invoke('window:get-panel-section'),
  openPetMenu: () => ipcRenderer.invoke('window:open-pet-menu'),
  closePanel: () => ipcRenderer.invoke('window:close-panel'),
  closeSettings: () => ipcRenderer.invoke('window:close-settings'),
  setSystemVibrancy: /** @param {boolean} enabled */ (enabled) => ipcRenderer.invoke('window:set-system-vibrancy', { enabled: enabled === true }),
  getPanelWindowState: () => ipcRenderer.invoke('panel-window:get-state'),
  setPanelWindowState: /** @param {unknown} state */ (state) => ipcRenderer.invoke('panel-window:set-state', state),
  isPanelWindow: () => ipcRenderer.invoke('window:get-view-kind').then((kind) => kind === 'panel'),
  subscribePanelSection: /** @param {IpcListener} listener */ (listener) => {
    /** @type {IpcEventHandler} */
    const handler = (_event, payload) => listener(payload)
    ipcRenderer.on('panel-section:changed', handler)
    return () => ipcRenderer.removeListener('panel-section:changed', handler)
  },
  subscribeSettingsReturnFocus: /** @param {IpcVoidListener} listener */ (listener) => {
    const handler = () => listener()
    ipcRenderer.on('settings:return-focus', handler)
    return () => ipcRenderer.removeListener('settings:return-focus', handler)
  },
  subscribePanelWindowState: /** @param {IpcListener} listener */ (listener) => {
    /** @type {IpcEventHandler} */
    const handler = (_event, payload) => listener(payload)
    ipcRenderer.on('panel-window:state-changed', handler)
    return () => ipcRenderer.removeListener('panel-window:state-changed', handler)
  },
  subscribeRuntimeState: /** @param {IpcListener} listener */ (listener) => {
    /** @type {IpcEventHandler} */
    const handler = (_event, state) => listener(state)
    ipcRenderer.on('runtime-state:changed', handler)
    return () => ipcRenderer.removeListener('runtime-state:changed', handler)
  },
  getRuntimeState: () => ipcRenderer.invoke('runtime-state:get'),
  heartbeatRuntimeState: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('runtime-state:heartbeat', payload),
  updateRuntimeState: /** @param {unknown} state */ (state) => ipcRenderer.invoke('runtime-state:update', state),
  getLaunchOnStartup: () => ipcRenderer.invoke('app:get-launch-on-startup'),
  setLaunchOnStartup: /** @param {boolean} value */ (value) => ipcRenderer.invoke('app:set-launch-on-startup', value),
  getPlatformProfile: () => ipcRenderer.invoke('app:get-platform-profile'),
  getSystemIdleTime: () => ipcRenderer.invoke('app:get-system-idle-time'),
  subscribePowerEvents: /** @param {IpcListener} listener */ (listener) => {
    /** @type {IpcEventHandler} */
    const handler = (_event, payload) => listener(payload)
    ipcRenderer.on('app:power-event', handler)
    return () => ipcRenderer.removeListener('app:power-event', handler)
  },
  listPetModels: () => ipcRenderer.invoke('pet-model:list'),
  subscribePetModelLibraryChanged: /** @param {IpcVoidListener} listener */ (listener) => {
    const handler = () => listener()
    ipcRenderer.on('pet-model:library-changed', handler)
    return () => ipcRenderer.removeListener('pet-model:library-changed', handler)
  },
  importPetModel: () => ipcRenderer.invoke('pet-model:import'),
  showConfirmDialog: /** @param {string} message */ (message) => ipcRenderer.invoke('dialog:confirm', message),
  saveTextFile: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('file:save-text', payload),
  openTextFile: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('file:open-text', payload),
  searchWeb: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('tool:web-search', payload),
  getWeather: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('tool:get-weather', payload),
  openExternalLink: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('tool:open-external', payload),
  completeChat: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('chat:complete', payload),
  completeChatStream: /**
   * @param {Record<string, unknown>} payload
   * @param {ChatStreamDeltaHandler} onDelta
   */ (payload, onDelta) => {
    // L6: cryptographically random ID instead of Date.now+Math.random.
    // Math.random collisions are astronomically unlikely but not impossible
    // when two streams open in the same ms — randomUUID gives us 122 bits
    // of entropy with no realistic collision risk. Falls back to the old
    // pattern if randomUUID isn't available (very old runtimes).
    const requestId = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2)
    /** @type {IpcEventHandler<ChatStreamDelta>} */
    const handler = (_event, data) => {
      if (data.requestId === requestId) {
        // Third arg carries the incremental reasoning_content fragment for
        // thinking-mode models (DeepSeek-R1, QwQ, …). Existing callers that
        // ignore it keep working unchanged; UI that wants to show the trace
        // can read it. The full trace is also returned on the resolved promise.
        onDelta(data.delta, !!data.done, data.reasoning_delta || '')
      }
    }
    ipcRenderer.on('chat:stream-delta', handler)
    const streamPromise = ipcRenderer.invoke('chat:complete-stream', { ...payload, requestId }).finally(() => {
      ipcRenderer.removeListener('chat:stream-delta', handler)
    })
    return Object.assign(streamPromise, {
      abort: () => ipcRenderer.invoke('chat:abort-stream', { requestId }),
    })
  },
  testChatConnection: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('chat:test-connection', payload),
  listChatModels: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('chat:list-models', payload),
  testServiceConnection: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('service:test-connection', payload),
  probeLocalServices: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('doctor:probe-local-services', payload),
  inspectIntegrations: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('integrations:inspect', payload),
  listSpeechVoices: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('audio:list-voices', payload),
  transcribeAudio: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('audio:transcribe', payload),
  synthesizeAudio: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('audio:synthesize', payload),
  ttsStreamStart: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('tts:stream-start', payload),
  ttsStreamPushText: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('tts:stream-push-text', payload),
  ttsStreamFinish: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('tts:stream-finish', payload),
  ttsStreamAbort: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('tts:stream-abort', payload),
  subscribeTtsStream: /** @param {IpcListener} listener */ (listener) => {
    /** @type {IpcEventHandler} */
    const handler = (_event, payload) => listener(payload)
    ipcRenderer.on('tts:stream-event', handler)
    return () => ipcRenderer.removeListener('tts:stream-event', handler)
  },
  getDesktopContext: /** @param {unknown} request */ (request) => ipcRenderer.invoke('desktop-context:get', request),
  getSystemMediaSession: () => ipcRenderer.invoke('media-session:get'),
  controlSystemMediaSession: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('media-session:control', payload),

  // Model manager (first-launch setup wizard)
  modelsGetInventory: () => ipcRenderer.invoke('models:inventory'),
  modelsDownload: /** @param {string} modelId */ (modelId) => ipcRenderer.invoke('models:download', { modelId }),
  modelsDownloadMissing: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('models:download-missing', payload),
  modelsNetworkProbe: () => ipcRenderer.invoke('models:network-probe'),
  voiceProfileProbe: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('voice-profile:probe', payload ?? {}),
  subscribeModelsProgress: /** @param {IpcListener} listener */ (listener) => {
    /** @type {IpcEventHandler} */
    const handler = (_event, payload) => listener(payload)
    ipcRenderer.on('models:download-progress', handler)
    return () => ipcRenderer.removeListener('models:download-progress', handler)
  },

  // SenseVoice offline ASR (sherpa-onnx OfflineRecognizer)
  sensevoiceStatus: () => ipcRenderer.invoke('sensevoice:status'),
  sensevoiceStart: () => ipcRenderer.invoke('sensevoice:start'),
  sensevoiceFeed: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('sensevoice:feed', payload),
  sensevoiceFinish: () => ipcRenderer.invoke('sensevoice:finish'),
  sensevoiceAbort: () => ipcRenderer.invoke('sensevoice:abort'),
  sensevoiceTranscribe: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('sensevoice:transcribe', payload),

  // Paraformer streaming ASR (sherpa-onnx OnlineRecognizer)
  paraformerStatus: () => ipcRenderer.invoke('paraformer:status'),
  paraformerStart: () => ipcRenderer.invoke('paraformer:start'),
  paraformerFeed: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('paraformer:feed', payload),
  paraformerFinish: () => ipcRenderer.invoke('paraformer:finish'),
  paraformerAbort: () => ipcRenderer.invoke('paraformer:abort'),

  // Sherpa-onnx keyword spotter (wake word)
  kwsStatus: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('kws:status', payload),
  kwsStart: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('kws:start', payload),
  kwsFeed: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('kws:feed', payload),
  kwsStop: () => ipcRenderer.invoke('kws:stop'),

  // Sherpa-onnx Silero VAD (main-process, shares audio frames with KWS)
  vadStatus: () => ipcRenderer.invoke('vad:status'),
  vadStart: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('vad:start', payload),
  vadFeed: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('vad:feed', payload),
  vadFlush: () => ipcRenderer.invoke('vad:flush'),
  vadStop: () => ipcRenderer.invoke('vad:stop'),

  // Smart Turn v3 end-of-turn probe over the session's in-memory audio ring
  turnEndStart: () => ipcRenderer.invoke('voice-turn:start'),
  turnEndProbe: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('voice-turn:probe', payload),
  turnEndStop: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('voice-turn:stop', payload),

  // Tencent Cloud Real-Time ASR
  tencentAsrConnect: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('tencent-asr:connect', payload),
  tencentAsrDisconnect: () => ipcRenderer.invoke('tencent-asr:disconnect'),
  tencentAsrFeed: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('tencent-asr:feed', payload),
  tencentAsrFinish: () => ipcRenderer.invoke('tencent-asr:finish'),
  tencentAsrAbort: () => ipcRenderer.invoke('tencent-asr:abort'),
  tencentAsrStatus: () => ipcRenderer.invoke('tencent-asr:status'),
  subscribeTencentAsrResult: /** @param {IpcListener} listener */ (listener) => {
    /** @type {IpcEventHandler} */
    const handler = (_event, payload) => listener(payload)
    ipcRenderer.on('tencent-asr:result', handler)
    return () => ipcRenderer.removeListener('tencent-asr:result', handler)
  },

  // Minecraft Gateway
  minecraftConnect: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('minecraft:connect', payload),
  minecraftDisconnect: () => ipcRenderer.invoke('minecraft:disconnect'),
  minecraftSendCommand: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('minecraft:send-command', payload),
  minecraftStatus: () => ipcRenderer.invoke('minecraft:status'),
  minecraftGameContext: () => ipcRenderer.invoke('minecraft:game-context'),

  // Factorio RCON
  factorioConnect: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('factorio:connect', payload),
  factorioDisconnect: () => ipcRenderer.invoke('factorio:disconnect'),
  factorioExecute: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('factorio:execute', payload),
  factorioStatus: () => ipcRenderer.invoke('factorio:status'),
  factorioGameContext: () => ipcRenderer.invoke('factorio:game-context'),

  // Telegram Gateway
  telegramConnect: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('telegram:connect', payload),
  telegramDisconnect: () => ipcRenderer.invoke('telegram:disconnect'),
  telegramSendMessage: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('telegram:send-message', payload),
  telegramSendVoice: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('telegram:send-voice', payload),
  telegramPairingList: () => ipcRenderer.invoke('telegram:pairing-list'),
  telegramPairingResolve: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('telegram:pairing-resolve', payload),
  subscribeTelegramPairing: /** @param {IpcListener} listener */ (listener) => {
    /** @type {IpcEventHandler} */
    const handler = (_event, request) => listener(request)
    ipcRenderer.on('telegram:pairing-request', handler)
    return () => ipcRenderer.removeListener('telegram:pairing-request', handler)
  },
  telegramStatus: () => ipcRenderer.invoke('telegram:status'),
  subscribeTelegramMessage: /** @param {IpcListener} listener */ (listener) => {
    /** @type {IpcEventHandler} */
    const handler = (_event, msg) => listener(msg)
    ipcRenderer.on('telegram:message', handler)
    return () => ipcRenderer.removeListener('telegram:message', handler)
  },

  // Discord Gateway
  discordConnect: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('discord:connect', payload),
  discordDisconnect: () => ipcRenderer.invoke('discord:disconnect'),
  discordSendMessage: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('discord:send-message', payload),
  discordSendVoice: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('discord:send-voice', payload),
  discordPairingList: () => ipcRenderer.invoke('discord:pairing-list'),
  discordPairingResolve: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('discord:pairing-resolve', payload),
  subscribeDiscordPairing: /** @param {IpcListener} listener */ (listener) => {
    /** @type {IpcEventHandler} */
    const handler = (_event, request) => listener(request)
    ipcRenderer.on('discord:pairing-request', handler)
    return () => ipcRenderer.removeListener('discord:pairing-request', handler)
  },
  discordStatus: () => ipcRenderer.invoke('discord:status'),
  subscribeDiscordMessage: /** @param {IpcListener} listener */ (listener) => {
    /** @type {IpcEventHandler} */
    const handler = (_event, msg) => listener(msg)
    ipcRenderer.on('discord:message', handler)
    return () => ipcRenderer.removeListener('discord:message', handler)
  },

  // MCP Host (multi-server) — start/stop/restart restricted to main process only
  mcpStatus: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('mcp:status', payload),
  mcpListTools: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('mcp:list-tools', payload),
  mcpCallTool: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('mcp:call-tool', payload),
  mcpSyncServers: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('mcp:sync-servers', payload),

  // External action permission policy
  externalActionPolicyGet: () => ipcRenderer.invoke('external-action-policy:get'),
  externalActionPolicySync: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('external-action-policy:sync', payload),

  // On-demand local voice sidecars (engine ids + switches only)
  voiceRuntimeSync: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('voice-runtime:sync', payload),

  // Main-process local data foundation. Renderer storage remains authoritative in M4.
  localDataStatus: () => ipcRenderer.invoke('local-data:status'),
  localDataMirrorOnboarding: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('local-data:mirror-onboarding', payload),
  localDataChatMigrationStatus: () => ipcRenderer.invoke('local-data:chat-migration-status'),
  localDataReadChatSessions: () => ipcRenderer.invoke('local-data:chat-sessions-read'),
  localDataMirrorChatSession: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('local-data:chat-session-mirror', payload),
  localDataCompareChatSessions: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('local-data:chat-comparison-preview', payload),
  localDataApplyChatMigration: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('local-data:chat-migration-apply', payload),
  localDataRollbackChatMigration: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('local-data:chat-migration-rollback', payload),
  localDataMemoryMigrationStatus: () => ipcRenderer.invoke('local-data:memory-migration-status'),
  localDataReadMemory: () => ipcRenderer.invoke('local-data:memory-read'),
  localDataApplyMemoryMigration: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('local-data:memory-migration-apply', payload),
  localDataRollbackMemoryMigration: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('local-data:memory-migration-rollback', payload),
  localDataCompanionMigrationStatus: () => ipcRenderer.invoke('local-data:companion-migration-status'),
  localDataReadCompanion: () => ipcRenderer.invoke('local-data:companion-read'),
  localDataCompareCompanion: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('local-data:companion-comparison-preview', payload),
  localDataMirrorCompanionDataset: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('local-data:companion-dataset-mirror', payload),
  localDataApplyCompanionMigration: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('local-data:companion-migration-apply', payload),
  localDataRollbackCompanionMigration: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('local-data:companion-migration-rollback', payload),

  // Plugin Host
  pluginScan: () => ipcRenderer.invoke('plugin:scan'),
  pluginList: () => ipcRenderer.invoke('plugin:list'),
  pluginStart: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('plugin:start', payload),
  pluginStop: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('plugin:stop', payload),
  pluginRestart: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('plugin:restart', payload),
  pluginEnable: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('plugin:enable', payload),
  pluginDisable: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('plugin:disable', payload),
  pluginStatus: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('plugin:status', payload),
  pluginDir: () => ipcRenderer.invoke('plugin:dir'),
  pluginApprove: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('plugin:approve', payload),
  pluginRevoke: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('plugin:revoke', payload),

  // Plugin Message Bus
  pluginBusPublish: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('plugin-bus:publish', payload),
  pluginBusSubscribe: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('plugin-bus:subscribe', payload),
  pluginBusUnsubscribe: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('plugin-bus:unsubscribe', payload),
  pluginBusSubscriptions: () => ipcRenderer.invoke('plugin-bus:subscriptions'),
  pluginBusRecent: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('plugin-bus:recent', payload),
  pluginBusStats: () => ipcRenderer.invoke('plugin-bus:stats'),

  // Memory Vector Store
  memoryVectorIndex: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('memory:vector-index', payload),
  memoryVectorIndexBatch: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('memory:vector-index-batch', payload),
  memoryVectorSearch: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('memory:vector-search', payload),
  memoryVectorRemove: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('memory:vector-remove', payload),
  memoryVectorClear: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('memory:clear-user-data', payload),
  memoryClearUserData: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('memory:clear-user-data', payload),
  memoryVectorStats: () => ipcRenderer.invoke('memory:vector-stats'),
  memoryKeywordSearch: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('memory:keyword-search', payload),
  memoryHybridSearch: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('memory:hybrid-search', payload),
  memoryOllamaEmbed: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('memory:ollama-embed', payload),
  memoryOllamaDetect: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('memory:ollama-detect', payload),

  // Long-term memory file store (userData/memory/long-term-memory.json)
  memoryLongTermLoad: () => ipcRenderer.invoke('memory:long-term-load'),
  memoryLongTermSave: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('memory:long-term-save', payload),
  memoryLongTermClear: () => ipcRenderer.invoke('memory:long-term-clear'),
  /** Session-level localStorage clear used by the memory reset procedure. */
  memoryResetLocalStorage: () => ipcRenderer.invoke('memory:reset-local-storage'),
  /** Main-process quit handshake: flush the debounced memory write, then ack. */
  onMemoryFlushRequest: /** @param {IpcVoidListener} listener */ (listener) => {
    const handler = () => listener()
    ipcRenderer.on('memory:flush-request', handler)
    return () => ipcRenderer.removeListener('memory:flush-request', handler)
  },
  memoryFlushComplete: () => ipcRenderer.invoke('memory:flush-complete'),

  // Auto-generated Skills
  skillSave: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('skill:save', payload),
  skillSearch: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('skill:search', payload),
  skillList: () => ipcRenderer.invoke('skill:list'),
  skillGet: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('skill:get', payload),
  skillRemove: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('skill:remove', payload),
  skillMarkUsed: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('skill:mark-used', payload),
  skillStats: () => ipcRenderer.invoke('skill:stats'),

  // Persona (SOUL.md file-based identity)
  personaLoadSoul: () => ipcRenderer.invoke('persona:load-soul'),
  personaLoadMemory: () => ipcRenderer.invoke('persona:load-memory'),
  personaSaveSoul: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('persona:save-soul', payload),
  personaSaveMemory: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('persona:save-memory', payload),
  personaSaveStyle: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('persona:save-style', payload),
  personaPaths: () => ipcRenderer.invoke('persona:paths'),
  personaOpenDir: () => ipcRenderer.invoke('persona:open-dir'),
  personaInit: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('persona:init', payload),

  // v2 per-profile persona (userData/personas/<id>/soul.md + style.json + ...)
  personaLoadProfile: /** @param {string} profileId */ (profileId) => ipcRenderer.invoke('persona:load-profile', { profileId }),
  personaProfileDir: /** @param {string} profileId */ (profileId) => ipcRenderer.invoke('persona:profile-dir', { profileId }),
  personaImportCard: () => ipcRenderer.invoke('persona:import-card'),

  // Auto-updater (electron-updater + GitHub Releases)
  updaterCheck: () => ipcRenderer.invoke('updater:check'),
  updaterStatus: () => ipcRenderer.invoke('updater:status'),
  updaterInstall: () => ipcRenderer.invoke('updater:install'),
  subscribeUpdaterEvent: /** @param {IpcListener} listener */ (listener) => {
    /** @type {IpcEventHandler} */
    const handler = (_event, payload) => listener(payload)
    ipcRenderer.on('updater:event', handler)
    return () => ipcRenderer.removeListener('updater:event', handler)
  },

  // Notification bridge (RSS + webhook)
  getNotificationChannels: () => ipcRenderer.invoke('notification:get-channels'),
  getNotificationWebhookInfo: () => ipcRenderer.invoke('notification:webhook-info'),
  setNotificationChannels: /** @param {unknown} channels */ (channels) => ipcRenderer.invoke('notification:set-channels', channels),
  startNotificationBridge: () => ipcRenderer.invoke('notification:start'),
  stopNotificationBridge: () => ipcRenderer.invoke('notification:stop'),
  notificationWatcherSet: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('notification:watcher-set', payload),
  notificationWatcherStatus: () => ipcRenderer.invoke('notification:watcher-status'),
  subscribeNotificationWatcherStatus: /** @param {IpcListener} listener */ (listener) => {
    /** @type {IpcEventHandler} */
    const handler = (_event, status) => listener(status)
    ipcRenderer.on('notification:watcher-status', handler)
    return () => ipcRenderer.removeListener('notification:watcher-status', handler)
  },
  subscribeNotifications: /** @param {IpcListener} listener */ (listener) => {
    /** @type {IpcEventHandler} */
    const handler = (_event, msg) => listener(msg)
    ipcRenderer.on('notification:incoming', handler)
    return () => ipcRenderer.removeListener('notification:incoming', handler)
  },

  // Proactive OS-level notification ("[name] 在想你")
  showProactiveNotification: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('proactive:show-notification', payload),

  // Key vault (safeStorage encryption). Retrieval returns opaque refs;
  // plaintext secret values stay in main-process handlers. Arguments are
  // wrapped into object payloads so the main-process schema validation
  // (electron/ipc/vaultPayloadSchemas.js) can reject unknown fields.
  vaultIsAvailable: () => ipcRenderer.invoke('vault:is-available'),
  vaultStore: /** @param {string} slot @param {string} plaintext */ (slot, plaintext) => ipcRenderer.invoke('vault:store', { slot, plaintext }),
  /** @param {string} slot */
  vaultRetrieve: (slot) => ipcRenderer.invoke('vault:retrieve', { slot }),
  vaultDelete: /** @param {string} slot */ (slot) => ipcRenderer.invoke('vault:delete', { slot }),
  vaultListSlots: () => ipcRenderer.invoke('vault:list-slots'),
  vaultStoreMany: /** @param {Record<string, string>} entries */ (entries) => ipcRenderer.invoke('vault:store-many', {
    entries: Object.entries(entries).map(([slot, plaintext]) => ({ slot, plaintext })),
  }),
  /** @param {string[]} slots */
  vaultRetrieveMany: (slots) => ipcRenderer.invoke('vault:retrieve-many', { slots }),

  // VTube Studio bridge. The renderer sends companion state only; VTS
  // WebSocket authentication and token persistence stay in the main process.
  vtsBridgeConnect: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('vts-bridge:connect', payload),
  vtsBridgeDisconnect: () => ipcRenderer.invoke('vts-bridge:disconnect'),
  vtsBridgeStatus: () => ipcRenderer.invoke('vts-bridge:status'),
  vtsBridgeUpdateInput: /** @param {unknown} payload */ (payload) => ipcRenderer.invoke('vts-bridge:update-input', payload),
  vtsBridgeMigrateLegacyToken: /** @param {string} token */ (token) => ipcRenderer.invoke('vts-bridge:migrate-legacy-token', { token }),
  subscribeVtsBridgeStatus: /** @param {IpcListener} listener */ (listener) => {
    /** @type {IpcEventHandler} */
    const handler = (_event, status) => listener(status)
    ipcRenderer.on('vts-bridge:status', handler)
    return () => ipcRenderer.removeListener('vts-bridge:status', handler)
  },

  // Adaptive desktop presence. Gaze samples are relative to this window.
  // Typing events are aggregate only — the main process never sends key codes.
  setDesktopPresencePreferences: /** @param {unknown} preferences */ (preferences) => ipcRenderer.invoke('desktop-presence:set-preferences', preferences),
  getDesktopTypingStatus: () => ipcRenderer.invoke('desktop-presence:get-typing-status'),
  openDesktopTypingPermission: () => ipcRenderer.invoke('desktop-presence:open-typing-permission'),
  subscribeDesktopGaze: /** @param {IpcListener} listener */ (listener) => {
    /** @type {IpcEventHandler} */
    const handler = (_event, sample) => listener(sample)
    ipcRenderer.on('desktop-presence:gaze', handler)
    return () => ipcRenderer.removeListener('desktop-presence:gaze', handler)
  },
  subscribeDesktopTyping: /** @param {IpcListener} listener */ (listener) => {
    /** @type {IpcEventHandler} */
    const handler = (_event, signal) => listener(signal)
    ipcRenderer.on('desktop-presence:typing', handler)
    return () => ipcRenderer.removeListener('desktop-presence:typing', handler)
  },
  subscribeDesktopTypingStatus: /** @param {IpcListener} listener */ (listener) => {
    /** @type {IpcEventHandler} */
    const handler = (_event, status) => listener(status)
    ipcRenderer.on('desktop-presence:typing-status', handler)
    return () => ipcRenderer.removeListener('desktop-presence:typing-status', handler)
  },
})
