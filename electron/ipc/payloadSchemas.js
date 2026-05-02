import { validateIpcPayload } from './schemaValidator.js'

const SHORT_TEXT_MAX = 256
const URL_TEXT_MAX = 2_048
const SECRET_TEXT_MAX = 20_000
const BODY_TEXT_MAX = 20_000
const AUDIO_BASE64_MAX = 50_000_000
const PATH_TEXT_MAX = 4_096
const WORKSPACE_WRITE_TEXT_MAX = 1_048_576
const CHAT_MESSAGE_TEXT_MAX = 200_000

const optionalBoolean = { type: 'boolean', optional: true }
const optionalShortString = {
  type: 'string',
  optional: true,
  maxLength: SHORT_TEXT_MAX,
  clamp: true,
}

const petWindowStateSchema = {
  type: 'object',
  optional: true,
  default: {},
  fields: {
    isPinned: optionalBoolean,
    clickThrough: optionalBoolean,
    petHotspotActive: optionalBoolean,
  },
}

const panelWindowStateSchema = {
  type: 'object',
  optional: true,
  default: {},
  fields: {
    collapsed: optionalBoolean,
  },
}

const panelSectionSchema = {
  type: 'enum',
  optional: true,
  default: 'chat',
  values: ['chat', 'settings'],
}

const dragDeltaSchema = {
  type: 'object',
  fields: {
    x: { type: 'number', min: -10_000, max: 10_000 },
    y: { type: 'number', min: -10_000, max: 10_000 },
  },
}

const runtimeHeartbeatSchema = {
  type: 'object',
  optional: true,
  default: { view: 'pet' },
  fields: {
    view: {
      type: 'enum',
      optional: true,
      default: 'pet',
      values: ['pet', 'panel'],
    },
  },
}

const runtimeStateUpdateSchema = {
  type: 'object',
  optional: true,
  default: {},
  fields: {
    mood: optionalShortString,
    continuousVoiceActive: optionalBoolean,
    panelSettingsOpen: optionalBoolean,
    voiceState: optionalShortString,
    hearingEngine: optionalShortString,
    hearingPhase: optionalShortString,
    wakewordPhase: optionalShortString,
    wakewordActive: optionalBoolean,
    wakewordAvailable: optionalBoolean,
    wakewordWakeWord: optionalShortString,
    wakewordReason: optionalShortString,
    wakewordLastTriggeredAt: optionalShortString,
    wakewordError: optionalShortString,
    wakewordUpdatedAt: optionalShortString,
    assistantActivity: optionalShortString,
    searchInProgress: optionalBoolean,
    ttsInProgress: optionalBoolean,
    schedulerArmed: optionalBoolean,
    schedulerNextRunAt: optionalShortString,
    activeTaskLabel: optionalShortString,
  },
}

const desktopContextPolicySchema = {
  type: 'object',
  optional: true,
  fields: {
    activeWindow: optionalBoolean,
    clipboard: optionalBoolean,
    screenshot: optionalBoolean,
  },
}

const desktopContextRequestSchema = {
  type: 'object',
  optional: true,
  default: {},
  fields: {
    includeActiveWindow: optionalBoolean,
    includeClipboard: optionalBoolean,
    includeScreenshot: optionalBoolean,
    policy: desktopContextPolicySchema,
  },
}

const mediaSessionControlSchema = {
  type: 'object',
  fields: {
    action: {
      type: 'enum',
      values: ['play', 'pause', 'toggle', 'next', 'previous'],
    },
  },
}

const rendererToolPolicySchema = {
  type: 'object',
  optional: true,
  fields: {
    enabled: optionalBoolean,
    requiresConfirmation: optionalBoolean,
  },
}

const chatToolCallSchema = {
  type: 'object',
  fields: {
    id: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
    type: { type: 'string', optional: true, maxLength: 64 },
    function: {
      type: 'object',
      optional: true,
      fields: {
        name: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
        arguments: { type: 'string', optional: true, maxLength: CHAT_MESSAGE_TEXT_MAX },
      },
    },
  },
}

const chatMessageSchema = {
  type: 'object',
  fields: {
    role: {
      type: 'enum',
      values: ['system', 'user', 'assistant', 'tool'],
    },
    content: { type: 'any' },
    tool_calls: {
      type: 'array',
      optional: true,
      maxItems: 32,
      items: chatToolCallSchema,
    },
    tool_call_id: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
    reasoning_content: {
      type: 'string',
      optional: true,
      maxLength: CHAT_MESSAGE_TEXT_MAX,
      clamp: true,
    },
  },
}

const chatToolDefinitionSchema = {
  type: 'object',
  fields: {
    type: {
      type: 'enum',
      values: ['function'],
    },
    function: {
      type: 'object',
      fields: {
        name: { type: 'string', maxLength: SHORT_TEXT_MAX },
        description: { type: 'string', optional: true, maxLength: 4_000 },
        parameters: { type: 'any', optional: true },
      },
    },
  },
}

const chatCompletionSchema = {
  type: 'object',
  fields: {
    providerId: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
    baseUrl: { type: 'string', maxLength: URL_TEXT_MAX },
    apiKey: { type: 'string', maxLength: SECRET_TEXT_MAX },
    model: { type: 'string', maxLength: SHORT_TEXT_MAX },
    traceId: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
    requestId: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
    messages: {
      type: 'array',
      maxItems: 128,
      items: chatMessageSchema,
    },
    temperature: { type: 'number', optional: true, min: 0, max: 2 },
    maxTokens: { type: 'number', optional: true, min: 1, max: 200_000 },
    tools: {
      type: 'array',
      optional: true,
      maxItems: 64,
      items: chatToolDefinitionSchema,
    },
  },
}

const chatAbortStreamSchema = {
  type: 'object',
  optional: true,
  default: {},
  fields: {
    requestId: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
  },
}

const serviceConnectionTestSchema = {
  type: 'object',
  fields: {
    providerId: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
    baseUrl: { type: 'string', maxLength: URL_TEXT_MAX },
    apiKey: { type: 'string', maxLength: SECRET_TEXT_MAX },
    capability: {
      type: 'enum',
      values: ['text', 'speech-input', 'speech-output'],
    },
    model: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
    voice: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
  },
}

const webSearchRequestSchema = {
  type: 'object',
  fields: {
    query: { type: 'string', maxLength: 2_000 },
    limit: { type: 'number', optional: true, min: 1, max: 20 },
    providerId: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
    baseUrl: { type: 'string', optional: true, maxLength: URL_TEXT_MAX },
    apiKey: { type: 'string', optional: true, maxLength: SECRET_TEXT_MAX },
    displayQuery: { type: 'string', optional: true, maxLength: 2_000 },
    keywords: { type: 'array', optional: true, maxItems: 32, items: optionalShortString },
    candidateQueries: { type: 'array', optional: true, maxItems: 8, items: { type: 'string', maxLength: 2_000 } },
    subject: { type: 'string', optional: true, maxLength: 2_000 },
    facet: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
    matchProfile: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
    strictTerms: { type: 'array', optional: true, maxItems: 32, items: optionalShortString },
    softTerms: { type: 'array', optional: true, maxItems: 32, items: optionalShortString },
    phraseTerms: { type: 'array', optional: true, maxItems: 32, items: optionalShortString },
    fallbackToBing: optionalBoolean,
    policy: rendererToolPolicySchema,
  },
}

const weatherLookupRequestSchema = {
  type: 'object',
  fields: {
    location: { type: 'string', maxLength: SHORT_TEXT_MAX },
    fallbackLocation: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
    policy: rendererToolPolicySchema,
  },
}

const externalLinkRequestSchema = {
  type: 'object',
  fields: {
    url: { type: 'string', maxLength: URL_TEXT_MAX },
    policy: rendererToolPolicySchema,
  },
}

const embeddingArraySchema = {
  type: 'array',
  maxItems: 8_192,
  items: { type: 'number', min: -100, max: 100 },
}

const memoryLayerSchema = { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX }

const memoryIndexSchema = {
  type: 'object',
  fields: {
    id: { type: 'string', maxLength: SHORT_TEXT_MAX },
    content: { type: 'string', maxLength: BODY_TEXT_MAX },
    embedding: embeddingArraySchema,
    layer: memoryLayerSchema,
  },
}

const memoryIndexBatchSchema = {
  type: 'array',
  maxItems: 2_000,
  items: memoryIndexSchema,
}

const memoryVectorSearchSchema = {
  type: 'object',
  fields: {
    queryEmbedding: embeddingArraySchema,
    limit: { type: 'number', optional: true, min: 1, max: 2_000 },
    threshold: { type: 'number', optional: true, min: 0, max: 1 },
    layer: memoryLayerSchema,
  },
}

const memoryKeywordSearchSchema = {
  type: 'object',
  fields: {
    query: { type: 'string', maxLength: 2_000 },
    limit: { type: 'number', optional: true, min: 1, max: 2_000 },
    threshold: { type: 'number', optional: true, min: 0, max: 1 },
    layer: memoryLayerSchema,
  },
}

const memoryHybridSearchSchema = {
  type: 'object',
  fields: {
    queryEmbedding: embeddingArraySchema,
    queryText: { type: 'string', maxLength: 2_000 },
    limit: { type: 'number', optional: true, min: 1, max: 2_000 },
    threshold: { type: 'number', optional: true, min: 0, max: 1 },
    layer: memoryLayerSchema,
  },
}

const memoryRemoveSchema = {
  type: 'object',
  optional: true,
  default: {},
  fields: {
    id: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
    ids: {
      type: 'array',
      optional: true,
      maxItems: 1_000,
      items: { type: 'string', maxLength: SHORT_TEXT_MAX },
    },
  },
}

const workspaceRootSchema = {
  type: 'object',
  optional: true,
  default: {},
  fields: {
    root: { type: 'string', optional: true, maxLength: PATH_TEXT_MAX },
  },
}

const workspacePathSchema = {
  type: 'object',
  fields: {
    path: { type: 'string', maxLength: PATH_TEXT_MAX },
  },
}

const workspaceWriteSchema = {
  type: 'object',
  fields: {
    path: { type: 'string', maxLength: PATH_TEXT_MAX },
    content: { type: 'string', maxLength: WORKSPACE_WRITE_TEXT_MAX },
  },
}

const workspaceEditSchema = {
  type: 'object',
  fields: {
    path: { type: 'string', maxLength: PATH_TEXT_MAX },
    oldString: { type: 'string', maxLength: WORKSPACE_WRITE_TEXT_MAX },
    newString: { type: 'string', maxLength: WORKSPACE_WRITE_TEXT_MAX },
  },
}

const workspaceGlobSchema = {
  type: 'object',
  fields: {
    pattern: { type: 'string', maxLength: 1_000 },
  },
}

const workspaceGrepSchema = {
  type: 'object',
  fields: {
    query: { type: 'string', maxLength: 1_000 },
    caseSensitive: optionalBoolean,
    maxResults: { type: 'number', optional: true, min: 1, max: 200 },
  },
}

const mcpIdSchema = {
  type: 'object',
  optional: true,
  default: {},
  fields: {
    id: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
  },
}

const mcpCallToolSchema = {
  type: 'object',
  fields: {
    serverId: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
    name: { type: 'string', maxLength: SHORT_TEXT_MAX },
    arguments: { type: 'any', optional: true },
  },
}

const mcpSyncServersSchema = {
  type: 'object',
  optional: true,
  default: { servers: [] },
  fields: {
    servers: {
      type: 'array',
      optional: true,
      default: [],
      maxItems: 32,
      items: {
        type: 'object',
        fields: {
          id: { type: 'string', maxLength: SHORT_TEXT_MAX },
          label: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
          command: { type: 'string', maxLength: PATH_TEXT_MAX },
          args: { type: 'string', optional: true, maxLength: PATH_TEXT_MAX },
          enabled: { type: 'boolean' },
        },
      },
    },
  },
}

const pluginIdSchema = {
  type: 'object',
  fields: {
    id: { type: 'string', maxLength: SHORT_TEXT_MAX },
  },
}

const pluginBusTopicSchema = {
  type: 'object',
  fields: {
    serverId: { type: 'string', maxLength: SHORT_TEXT_MAX },
    topic: { type: 'string', maxLength: SHORT_TEXT_MAX },
    data: { type: 'any', optional: true },
  },
}

const pluginBusRecentSchema = {
  type: 'object',
  optional: true,
  default: {},
  fields: {
    limit: { type: 'number', optional: true, min: 1, max: 200 },
  },
}

const gameConnectSchema = {
  type: 'object',
  fields: {
    address: { type: 'string', maxLength: URL_TEXT_MAX },
    port: { type: 'number', optional: true, min: 1, max: 65_535 },
    username: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
    password: { type: 'string', optional: true, maxLength: SECRET_TEXT_MAX },
  },
}

const gameCommandSchema = {
  type: 'object',
  fields: {
    command: { type: 'string', maxLength: 4_000 },
  },
}

const tencentAsrConnectSchema = {
  type: 'object',
  optional: true,
  default: {},
  fields: {
    apiKey: { type: 'string', optional: true, maxLength: SECRET_TEXT_MAX },
    appId: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
    secretId: { type: 'string', optional: true, maxLength: SECRET_TEXT_MAX },
    secretKey: { type: 'string', optional: true, maxLength: SECRET_TEXT_MAX },
    engineModelType: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
    hotwordList: { type: 'string', optional: true, maxLength: BODY_TEXT_MAX },
  },
}

const realtimeStartSchema = {
  type: 'object',
  optional: true,
  default: {},
  unknown: 'preserve',
  fields: {
    providerId: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
    baseUrl: { type: 'string', optional: true, maxLength: URL_TEXT_MAX },
    apiKey: { type: 'string', optional: true, maxLength: SECRET_TEXT_MAX },
    model: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
    voice: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
  },
}

const realtimeSendTextSchema = {
  type: 'object',
  fields: {
    text: { type: 'string', maxLength: BODY_TEXT_MAX },
  },
}

const speechVoiceListSchema = {
  type: 'object',
  fields: {
    providerId: { type: 'string', maxLength: SHORT_TEXT_MAX },
    baseUrl: { type: 'string', maxLength: URL_TEXT_MAX },
    apiKey: { type: 'string', maxLength: SECRET_TEXT_MAX },
  },
}

const audioTranscriptionSchema = {
  type: 'object',
  fields: {
    providerId: { type: 'string', maxLength: SHORT_TEXT_MAX },
    baseUrl: { type: 'string', maxLength: URL_TEXT_MAX },
    apiKey: { type: 'string', maxLength: SECRET_TEXT_MAX },
    model: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
    traceId: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
    language: { type: 'string', optional: true, maxLength: 64 },
    hotwords: { type: 'string', optional: true, maxLength: 10_000 },
    audioBase64: { type: 'string', maxLength: AUDIO_BASE64_MAX },
    mimeType: { type: 'string', maxLength: SHORT_TEXT_MAX },
    fileName: { type: 'string', optional: true, maxLength: 255 },
  },
}

const audioSynthesisSchema = {
  type: 'object',
  fields: {
    providerId: { type: 'string', maxLength: SHORT_TEXT_MAX },
    baseUrl: { type: 'string', maxLength: URL_TEXT_MAX },
    apiKey: { type: 'string', maxLength: SECRET_TEXT_MAX },
    model: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
    voice: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
    text: { type: 'string', maxLength: BODY_TEXT_MAX },
    instructions: { type: 'string', optional: true, maxLength: 4_000 },
    language: { type: 'string', optional: true, maxLength: 64 },
    rate: { type: 'number', optional: true, min: 0.25, max: 4 },
    pitch: { type: 'number', optional: true, min: -4, max: 4 },
    volume: { type: 'number', optional: true, min: 0, max: 4 },
  },
}

export function validatePetWindowStatePayload(payload) {
  return validateIpcPayload('pet-window:update-state', payload, petWindowStateSchema)
}

export function validatePanelWindowStatePayload(payload) {
  return validateIpcPayload('panel-window:set-state', payload, panelWindowStateSchema)
}

export function validateOpenPanelPayload(payload) {
  return validateIpcPayload('window:open-panel', payload, panelSectionSchema)
}

export function validateWindowDragPayload(payload) {
  return validateIpcPayload('window:drag-by', payload, dragDeltaSchema)
}

export function validateRuntimeHeartbeatPayload(payload) {
  return validateIpcPayload('runtime-state:heartbeat', payload, runtimeHeartbeatSchema)
}

export function validateRuntimeStateUpdatePayload(payload) {
  return validateIpcPayload('runtime-state:update', payload, runtimeStateUpdateSchema)
}

export function validateDesktopContextRequestPayload(payload) {
  return validateIpcPayload('desktop-context:get', payload, desktopContextRequestSchema)
}

export function validateMediaSessionControlPayload(payload) {
  return validateIpcPayload('media-session:control', payload, mediaSessionControlSchema)
}

export function validateSpeechVoiceListPayload(payload) {
  return validateIpcPayload('audio:list-voices', payload, speechVoiceListSchema)
}

export function validateAudioTranscriptionPayload(payload) {
  return validateIpcPayload('audio:transcribe', payload, audioTranscriptionSchema)
}

export function validateAudioSynthesisPayload(payload) {
  return validateIpcPayload('audio:synthesize', payload, audioSynthesisSchema)
}

export function validateChatCompletionPayload(channel, payload) {
  return validateIpcPayload(channel, payload, chatCompletionSchema)
}

export function validateChatAbortStreamPayload(payload) {
  return validateIpcPayload('chat:abort-stream', payload, chatAbortStreamSchema)
}

export function validateServiceConnectionTestPayload(payload) {
  return validateIpcPayload('service:test-connection', payload, serviceConnectionTestSchema)
}

export function validateWebSearchToolPayload(payload) {
  return validateIpcPayload('tool:web-search', payload, webSearchRequestSchema)
}

export function validateWeatherToolPayload(payload) {
  return validateIpcPayload('tool:get-weather', payload, weatherLookupRequestSchema)
}

export function validateExternalLinkToolPayload(payload) {
  return validateIpcPayload('tool:open-external', payload, externalLinkRequestSchema)
}

export function validateMemoryVectorIndexPayload(payload) {
  return validateIpcPayload('memory:vector-index', payload, memoryIndexSchema)
}

export function validateMemoryVectorIndexBatchPayload(payload) {
  return validateIpcPayload('memory:vector-index-batch', payload, memoryIndexBatchSchema)
}

export function validateMemoryVectorSearchPayload(payload) {
  return validateIpcPayload('memory:vector-search', payload, memoryVectorSearchSchema)
}

export function validateMemoryKeywordSearchPayload(payload) {
  return validateIpcPayload('memory:keyword-search', payload, memoryKeywordSearchSchema)
}

export function validateMemoryHybridSearchPayload(payload) {
  return validateIpcPayload('memory:hybrid-search', payload, memoryHybridSearchSchema)
}

export function validateMemoryRemovePayload(payload) {
  return validateIpcPayload('memory:vector-remove', payload, memoryRemoveSchema)
}

export function validateWorkspaceRootPayload(payload) {
  return validateIpcPayload('workspace:set-root', payload, workspaceRootSchema)
}

export function validateWorkspacePathPayload(channel, payload) {
  return validateIpcPayload(channel, payload, workspacePathSchema)
}

export function validateWorkspaceWritePayload(payload) {
  return validateIpcPayload('workspace:write', payload, workspaceWriteSchema)
}

export function validateWorkspaceEditPayload(payload) {
  return validateIpcPayload('workspace:edit', payload, workspaceEditSchema)
}

export function validateWorkspaceGlobPayload(payload) {
  return validateIpcPayload('workspace:glob', payload, workspaceGlobSchema)
}

export function validateWorkspaceGrepPayload(payload) {
  return validateIpcPayload('workspace:grep', payload, workspaceGrepSchema)
}

export function validateMcpIdPayload(channel, payload) {
  return validateIpcPayload(channel, payload, mcpIdSchema)
}

export function validateMcpCallToolPayload(payload) {
  return validateIpcPayload('mcp:call-tool', payload, mcpCallToolSchema)
}

export function validateMcpSyncServersPayload(payload) {
  return validateIpcPayload('mcp:sync-servers', payload, mcpSyncServersSchema)
}

export function validatePluginIdPayload(channel, payload) {
  return validateIpcPayload(channel, payload, pluginIdSchema)
}

export function validatePluginBusTopicPayload(channel, payload) {
  return validateIpcPayload(channel, payload, pluginBusTopicSchema)
}

export function validatePluginBusRecentPayload(payload) {
  return validateIpcPayload('plugin-bus:recent', payload, pluginBusRecentSchema)
}

export function validateGameConnectPayload(channel, payload) {
  return validateIpcPayload(channel, payload, gameConnectSchema)
}

export function validateGameCommandPayload(channel, payload) {
  return validateIpcPayload(channel, payload, gameCommandSchema)
}

export function validateTencentAsrConnectPayload(payload) {
  return validateIpcPayload('tencent-asr:connect', payload, tencentAsrConnectSchema)
}

export function validateRealtimeStartPayload(payload) {
  return validateIpcPayload('realtime:start', payload, realtimeStartSchema)
}

export function validateRealtimeSendTextPayload(payload) {
  return validateIpcPayload('realtime:send-text', payload, realtimeSendTextSchema)
}
