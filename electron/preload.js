const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktopPet', {
  updatePetWindowState: (state) => ipcRenderer.invoke('pet-window:update-state', state),
  getPetWindowState: () => ipcRenderer.invoke('pet-window:get-state'),
  subscribePetWindowState: (listener) => {
    const handler = (_event, state) => listener(state)
    ipcRenderer.on('pet-window:state-changed', handler)
    return () => ipcRenderer.removeListener('pet-window:state-changed', handler)
  },
  dragBy: (delta) => ipcRenderer.invoke('window:drag-by', delta),
  openPanel: (section) => ipcRenderer.invoke('window:open-panel', section),
  openPetMenu: () => ipcRenderer.invoke('window:open-pet-menu'),
  closePanel: () => ipcRenderer.invoke('window:close-panel'),
  getPanelWindowState: () => ipcRenderer.invoke('panel-window:get-state'),
  setPanelWindowState: (state) => ipcRenderer.invoke('panel-window:set-state', state),
  isPanelWindow: () => ipcRenderer.invoke('window:get-view-kind').then((kind) => kind === 'panel'),
  subscribePanelSection: (listener) => {
    const handler = (_event, payload) => listener(payload)
    ipcRenderer.on('panel-section:changed', handler)
    return () => ipcRenderer.removeListener('panel-section:changed', handler)
  },
  subscribePanelWindowState: (listener) => {
    const handler = (_event, payload) => listener(payload)
    ipcRenderer.on('panel-window:state-changed', handler)
    return () => ipcRenderer.removeListener('panel-window:state-changed', handler)
  },
  subscribeRuntimeState: (listener) => {
    const handler = (_event, state) => listener(state)
    ipcRenderer.on('runtime-state:changed', handler)
    return () => ipcRenderer.removeListener('runtime-state:changed', handler)
  },
  getRuntimeState: () => ipcRenderer.invoke('runtime-state:get'),
  heartbeatRuntimeState: (payload) => ipcRenderer.invoke('runtime-state:heartbeat', payload),
  updateRuntimeState: (state) => ipcRenderer.invoke('runtime-state:update', state),
  getLaunchOnStartup: () => ipcRenderer.invoke('app:get-launch-on-startup'),
  setLaunchOnStartup: (value) => ipcRenderer.invoke('app:set-launch-on-startup', value),
  listPetModels: () => ipcRenderer.invoke('pet-model:list'),
  importPetModel: () => ipcRenderer.invoke('pet-model:import'),
  showConfirmDialog: (message) => ipcRenderer.invoke('dialog:confirm', message),
  saveTextFile: (payload) => ipcRenderer.invoke('file:save-text', payload),
  openTextFile: (payload) => ipcRenderer.invoke('file:open-text', payload),
  searchWeb: (payload) => ipcRenderer.invoke('tool:web-search', payload),
  getWeather: (payload) => ipcRenderer.invoke('tool:get-weather', payload),
  openExternalLink: (payload) => ipcRenderer.invoke('tool:open-external', payload),
  completeChat: (payload) => ipcRenderer.invoke('chat:complete', payload),
  completeChatStream: (payload, onDelta) => {
    const requestId = Date.now().toString(36) + Math.random().toString(36).slice(2)
    const handler = (_event, data) => {
      if (data.requestId === requestId) {
        onDelta(data.delta, !!data.done)
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
  testChatConnection: (payload) => ipcRenderer.invoke('chat:test-connection', payload),
  testServiceConnection: (payload) => ipcRenderer.invoke('service:test-connection', payload),
  probeLocalServices: (payload) => ipcRenderer.invoke('doctor:probe-local-services', payload),
  inspectIntegrations: (payload) => ipcRenderer.invoke('integrations:inspect', payload),
  listSpeechVoices: (payload) => ipcRenderer.invoke('audio:list-voices', payload),
  transcribeAudio: (payload) => ipcRenderer.invoke('audio:transcribe', payload),
  synthesizeAudio: (payload) => ipcRenderer.invoke('audio:synthesize', payload),
  ttsStreamStart: (payload) => ipcRenderer.invoke('tts:stream-start', payload),
  ttsStreamPushText: (payload) => ipcRenderer.invoke('tts:stream-push-text', payload),
  ttsStreamFinish: (payload) => ipcRenderer.invoke('tts:stream-finish', payload),
  ttsStreamAbort: (payload) => ipcRenderer.invoke('tts:stream-abort', payload),
  subscribeTtsStream: (listener) => {
    const handler = (_event, payload) => listener(payload)
    ipcRenderer.on('tts:stream-event', handler)
    return () => ipcRenderer.removeListener('tts:stream-event', handler)
  },
  cloneVoice: (payload) => ipcRenderer.invoke('voice:clone', payload),
  getDesktopContext: (request) => ipcRenderer.invoke('desktop-context:get', request),
  getSystemMediaSession: () => ipcRenderer.invoke('media-session:get'),
  controlSystemMediaSession: (payload) => ipcRenderer.invoke('media-session:control', payload),

  // SenseVoice offline ASR (sherpa-onnx OfflineRecognizer)
  sensevoiceStatus: () => ipcRenderer.invoke('sensevoice:status'),
  sensevoiceStart: () => ipcRenderer.invoke('sensevoice:start'),
  sensevoiceFeed: (payload) => ipcRenderer.invoke('sensevoice:feed', payload),
  sensevoiceFinish: () => ipcRenderer.invoke('sensevoice:finish'),
  sensevoiceAbort: () => ipcRenderer.invoke('sensevoice:abort'),
  sensevoiceTranscribe: (payload) => ipcRenderer.invoke('sensevoice:transcribe', payload),

  // Paraformer streaming ASR (sherpa-onnx OnlineRecognizer)
  paraformerStatus: () => ipcRenderer.invoke('paraformer:status'),
  paraformerStart: () => ipcRenderer.invoke('paraformer:start'),
  paraformerFeed: (payload) => ipcRenderer.invoke('paraformer:feed', payload),
  paraformerFinish: () => ipcRenderer.invoke('paraformer:finish'),
  paraformerAbort: () => ipcRenderer.invoke('paraformer:abort'),

  // Sherpa-onnx keyword spotter (wake word)
  kwsStatus: (payload) => ipcRenderer.invoke('kws:status', payload),
  kwsStart: (payload) => ipcRenderer.invoke('kws:start', payload),
  kwsFeed: (payload) => ipcRenderer.invoke('kws:feed', payload),
  kwsStop: () => ipcRenderer.invoke('kws:stop'),

  // MCP stdio client — restricted to main process only (no renderer access)

  // Tencent Cloud Real-Time ASR
  tencentAsrConnect: (payload) => ipcRenderer.invoke('tencent-asr:connect', payload),
  tencentAsrDisconnect: () => ipcRenderer.invoke('tencent-asr:disconnect'),
  tencentAsrFeed: (payload) => ipcRenderer.invoke('tencent-asr:feed', payload),
  tencentAsrFinish: () => ipcRenderer.invoke('tencent-asr:finish'),
  tencentAsrAbort: () => ipcRenderer.invoke('tencent-asr:abort'),
  tencentAsrStatus: () => ipcRenderer.invoke('tencent-asr:status'),
  subscribeTencentAsrResult: (listener) => {
    const handler = (_event, payload) => listener(payload)
    ipcRenderer.on('tencent-asr:result', handler)
    return () => ipcRenderer.removeListener('tencent-asr:result', handler)
  },

  // Minecraft Gateway
  minecraftConnect: (payload) => ipcRenderer.invoke('minecraft:connect', payload),
  minecraftDisconnect: () => ipcRenderer.invoke('minecraft:disconnect'),
  minecraftSendCommand: (payload) => ipcRenderer.invoke('minecraft:send-command', payload),
  minecraftStatus: () => ipcRenderer.invoke('minecraft:status'),
  minecraftGameContext: () => ipcRenderer.invoke('minecraft:game-context'),

  // Factorio RCON
  factorioConnect: (payload) => ipcRenderer.invoke('factorio:connect', payload),
  factorioDisconnect: () => ipcRenderer.invoke('factorio:disconnect'),
  factorioExecute: (payload) => ipcRenderer.invoke('factorio:execute', payload),
  factorioStatus: () => ipcRenderer.invoke('factorio:status'),
  factorioGameContext: () => ipcRenderer.invoke('factorio:game-context'),

  // Telegram Gateway
  telegramConnect: (payload) => ipcRenderer.invoke('telegram:connect', payload),
  telegramDisconnect: () => ipcRenderer.invoke('telegram:disconnect'),
  telegramSendMessage: (payload) => ipcRenderer.invoke('telegram:send-message', payload),
  telegramStatus: () => ipcRenderer.invoke('telegram:status'),
  subscribeTelegramMessage: (listener) => {
    const handler = (_event, msg) => listener(msg)
    ipcRenderer.on('telegram:message', handler)
    return () => ipcRenderer.removeListener('telegram:message', handler)
  },

  // Discord Gateway
  discordConnect: (payload) => ipcRenderer.invoke('discord:connect', payload),
  discordDisconnect: () => ipcRenderer.invoke('discord:disconnect'),
  discordSendMessage: (payload) => ipcRenderer.invoke('discord:send-message', payload),
  discordStatus: () => ipcRenderer.invoke('discord:status'),
  subscribeDiscordMessage: (listener) => {
    const handler = (_event, msg) => listener(msg)
    ipcRenderer.on('discord:message', handler)
    return () => ipcRenderer.removeListener('discord:message', handler)
  },

  // MCP Host (multi-server) — start/stop/restart restricted to main process only
  mcpStatus: (payload) => ipcRenderer.invoke('mcp:status', payload),
  mcpListTools: (payload) => ipcRenderer.invoke('mcp:list-tools', payload),
  mcpCallTool: (payload) => ipcRenderer.invoke('mcp:call-tool', payload),

  // Plugin Host
  pluginScan: () => ipcRenderer.invoke('plugin:scan'),
  pluginList: () => ipcRenderer.invoke('plugin:list'),
  pluginStart: (payload) => ipcRenderer.invoke('plugin:start', payload),
  pluginStop: (payload) => ipcRenderer.invoke('plugin:stop', payload),
  pluginRestart: (payload) => ipcRenderer.invoke('plugin:restart', payload),
  pluginEnable: (payload) => ipcRenderer.invoke('plugin:enable', payload),
  pluginDisable: (payload) => ipcRenderer.invoke('plugin:disable', payload),
  pluginStatus: (payload) => ipcRenderer.invoke('plugin:status', payload),
  pluginDir: () => ipcRenderer.invoke('plugin:dir'),
  pluginApprove: (payload) => ipcRenderer.invoke('plugin:approve', payload),
  pluginRevoke: (payload) => ipcRenderer.invoke('plugin:revoke', payload),

  // Plugin Message Bus
  pluginBusPublish: (payload) => ipcRenderer.invoke('plugin-bus:publish', payload),
  pluginBusSubscribe: (payload) => ipcRenderer.invoke('plugin-bus:subscribe', payload),
  pluginBusUnsubscribe: (payload) => ipcRenderer.invoke('plugin-bus:unsubscribe', payload),
  pluginBusSubscriptions: () => ipcRenderer.invoke('plugin-bus:subscriptions'),
  pluginBusRecent: (payload) => ipcRenderer.invoke('plugin-bus:recent', payload),
  pluginBusStats: () => ipcRenderer.invoke('plugin-bus:stats'),

  // Memory Vector Store
  memoryVectorIndex: (payload) => ipcRenderer.invoke('memory:vector-index', payload),
  memoryVectorIndexBatch: (payload) => ipcRenderer.invoke('memory:vector-index-batch', payload),
  memoryVectorSearch: (payload) => ipcRenderer.invoke('memory:vector-search', payload),
  memoryVectorRemove: (payload) => ipcRenderer.invoke('memory:vector-remove', payload),
  memoryVectorStats: () => ipcRenderer.invoke('memory:vector-stats'),
  memoryKeywordSearch: (payload) => ipcRenderer.invoke('memory:keyword-search', payload),
  memoryHybridSearch: (payload) => ipcRenderer.invoke('memory:hybrid-search', payload),

  // Auto-generated Skills
  skillSave: (payload) => ipcRenderer.invoke('skill:save', payload),
  skillSearch: (payload) => ipcRenderer.invoke('skill:search', payload),
  skillList: () => ipcRenderer.invoke('skill:list'),
  skillGet: (payload) => ipcRenderer.invoke('skill:get', payload),
  skillRemove: (payload) => ipcRenderer.invoke('skill:remove', payload),
  skillMarkUsed: (payload) => ipcRenderer.invoke('skill:mark-used', payload),
  skillStats: () => ipcRenderer.invoke('skill:stats'),

  // Persona (SOUL.md file-based identity)
  personaLoadSoul: () => ipcRenderer.invoke('persona:load-soul'),
  personaLoadMemory: () => ipcRenderer.invoke('persona:load-memory'),
  personaSaveSoul: (payload) => ipcRenderer.invoke('persona:save-soul', payload),
  personaSaveMemory: (payload) => ipcRenderer.invoke('persona:save-memory', payload),
  personaPaths: () => ipcRenderer.invoke('persona:paths'),
  personaOpenDir: () => ipcRenderer.invoke('persona:open-dir'),
  personaInit: (payload) => ipcRenderer.invoke('persona:init', payload),

  // Realtime Voice (OpenAI Realtime API)
  realtimeStart: (payload) => ipcRenderer.invoke('realtime:start', payload),
  realtimeStop: () => ipcRenderer.invoke('realtime:stop'),
  realtimeFeed: (payload) => ipcRenderer.invoke('realtime:feed', payload),
  realtimeInterrupt: () => ipcRenderer.invoke('realtime:interrupt'),
  realtimeSendText: (payload) => ipcRenderer.invoke('realtime:send-text', payload),
  realtimeState: () => ipcRenderer.invoke('realtime:state'),
  subscribeRealtimeEvent: (listener) => {
    const handler = (_event, payload) => listener(payload)
    ipcRenderer.on('realtime:event', handler)
    return () => ipcRenderer.removeListener('realtime:event', handler)
  },

  // Key vault (safeStorage encryption)
  vaultIsAvailable: () => ipcRenderer.invoke('vault:is-available'),
  vaultStore: (slot, plaintext) => ipcRenderer.invoke('vault:store', slot, plaintext),
  vaultRetrieve: (slot) => ipcRenderer.invoke('vault:retrieve', slot),
  vaultDelete: (slot) => ipcRenderer.invoke('vault:delete', slot),
  vaultListSlots: () => ipcRenderer.invoke('vault:list-slots'),
  vaultStoreMany: (entries) => ipcRenderer.invoke('vault:store-many', entries),
  vaultRetrieveMany: (slots) => ipcRenderer.invoke('vault:retrieve-many', slots),
})
