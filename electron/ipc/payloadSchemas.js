import { validateIpcPayload } from './schemaValidator.js'
export {
  validateDesktopContextRequestPayload,
  validateMediaSessionControlPayload,
  validateOpenPanelPayload,
  validatePanelWindowStatePayload,
  validatePetWindowStatePayload,
  validateRuntimeHeartbeatPayload,
  validateRuntimeStateUpdatePayload,
  validateWindowDragPayload,
} from './windowPayloadSchemas.js'

const SHORT_TEXT_MAX = 256
const URL_TEXT_MAX = 2_048
const SECRET_TEXT_MAX = 20_000
const BODY_TEXT_MAX = 20_000
const EXPORT_TEXT_MAX = 5_000_000
const PERSONA_TEXT_MAX = 500_000
const AUDIO_BASE64_MAX = 50_000_000
const PATH_TEXT_MAX = 4_096
const CHAT_MESSAGE_TEXT_MAX = 200_000
const SAFE_SKILL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

const optionalBoolean = { type: 'boolean', optional: true }
const optionalShortString = {
  type: 'string',
  optional: true,
  maxLength: SHORT_TEXT_MAX,
  clamp: true,
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

const chatModelListSchema = {
  type: 'object',
  fields: {
    providerId: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
    baseUrl: { type: 'string', maxLength: URL_TEXT_MAX },
    apiKey: { type: 'string', maxLength: SECRET_TEXT_MAX },
    model: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
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
    quiet: optionalBoolean,
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

const skillIdFieldSchema = {
  type: 'string',
  maxLength: SHORT_TEXT_MAX,
  trim: true,
  allowEmpty: false,
  pattern: SAFE_SKILL_ID_PATTERN,
}

const skillSaveSchema = {
  type: 'object',
  fields: {
    id: skillIdFieldSchema,
    title: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false, clamp: true },
    trigger: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false, clamp: true },
    summary: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false, clamp: true },
    content: { type: 'string', maxLength: BODY_TEXT_MAX, trim: true, allowEmpty: false },
  },
}

const skillSearchSchema = {
  type: 'object',
  fields: {
    query: { type: 'string', maxLength: 2_000, trim: true, allowEmpty: false },
    limit: { type: 'number', optional: true, integer: true, min: 1, max: 20 },
  },
}

const skillIdSchema = {
  type: 'object',
  fields: {
    id: skillIdFieldSchema,
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

const launchOnStartupSchema = {
  type: 'boolean',
  optional: true,
  default: false,
}

const confirmDialogSchema = {
  type: 'string',
  optional: true,
  default: '',
  maxLength: 4_000,
  clamp: true,
}

const petFreeModeSchema = {
  type: 'object',
  optional: true,
  default: {},
  fields: {
    freeMode: { type: 'boolean', optional: true, default: false },
  },
}

const textFileFilterSchema = {
  type: 'object',
  fields: {
    name: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false, clamp: true },
    extensions: {
      type: 'array',
      maxItems: 32,
      items: { type: 'string', maxLength: 32, trim: true, allowEmpty: false, clamp: true },
    },
  },
}

const textFileFiltersSchema = {
  type: 'array',
  optional: true,
  maxItems: 16,
  items: textFileFilterSchema,
}

const textFileSaveSchema = {
  type: 'object',
  optional: true,
  default: {},
  fields: {
    title: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX, trim: true, clamp: true },
    defaultFileName: { type: 'string', optional: true, maxLength: 255, trim: true, clamp: true },
    content: { type: 'string', optional: true, default: '', maxLength: EXPORT_TEXT_MAX },
    filters: textFileFiltersSchema,
  },
}

const textFileOpenSchema = {
  type: 'object',
  optional: true,
  default: {},
  fields: {
    title: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX, trim: true, clamp: true },
    filters: textFileFiltersSchema,
  },
}

const integrationMcpServerSchema = {
  type: 'object',
  fields: {
    id: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX, trim: true, clamp: true },
    label: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX, trim: true, clamp: true },
    command: { type: 'string', optional: true, maxLength: PATH_TEXT_MAX, trim: true, clamp: true },
    args: { type: 'string', optional: true, maxLength: PATH_TEXT_MAX, trim: true, clamp: true },
    enabled: optionalBoolean,
  },
}

const integrationInspectSchema = {
  type: 'object',
  optional: true,
  default: {},
  fields: {
    mcpServers: {
      type: 'array',
      optional: true,
      maxItems: 32,
      items: integrationMcpServerSchema,
    },
    minecraftIntegrationEnabled: optionalBoolean,
    minecraftServerAddress: { type: 'string', optional: true, maxLength: URL_TEXT_MAX, trim: true, clamp: true },
    minecraftServerPort: { type: 'number', optional: true, integer: true, min: 1, max: 65_535 },
    minecraftUsername: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX, trim: true, clamp: true },
    factorioIntegrationEnabled: optionalBoolean,
    factorioServerAddress: { type: 'string', optional: true, maxLength: URL_TEXT_MAX, trim: true, clamp: true },
    factorioServerPort: { type: 'number', optional: true, integer: true, min: 1, max: 65_535 },
    factorioUsername: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX, trim: true, clamp: true },
  },
}

const personaContentSchema = {
  type: 'object',
  optional: true,
  default: {},
  fields: {
    content: { type: 'string', optional: true, default: '', maxLength: PERSONA_TEXT_MAX },
  },
}

const personaInitSchema = {
  type: 'object',
  optional: true,
  default: {},
  fields: {
    defaultSoul: { type: 'string', optional: true, default: '', maxLength: PERSONA_TEXT_MAX },
  },
}

const personaProfileIdSchema = {
  type: 'object',
  fields: {
    profileId: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false },
  },
}

const codexPetGalleryInputSchema = {
  type: 'string',
  maxLength: URL_TEXT_MAX,
  trim: true,
  allowEmpty: false,
}

const codexPetGalleryListSchema = {
  type: 'object',
  optional: true,
  default: {},
  fields: {
    query: { type: 'string', optional: true, default: '', maxLength: 2_000, trim: true, clamp: true },
    limit: { type: 'number', optional: true, integer: true, min: 1, max: 50 },
  },
}

const creatorKitCreateSchema = {
  type: 'object',
  optional: true,
  default: {},
  fields: {
    id: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX, trim: true, clamp: true },
    displayName: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX, trim: true, clamp: true },
    description: { type: 'string', optional: true, maxLength: BODY_TEXT_MAX, trim: true, clamp: true },
    concept: { type: 'string', optional: true, maxLength: BODY_TEXT_MAX, trim: true, clamp: true },
    styleNotes: { type: 'string', optional: true, maxLength: BODY_TEXT_MAX, trim: true, clamp: true },
  },
}

const creatorKitOptionalDirectorySchema = {
  type: 'object',
  optional: true,
  default: {},
  fields: {
    kitDirectory: { type: 'string', optional: true, maxLength: PATH_TEXT_MAX, trim: true, clamp: true },
  },
}

const creatorKitInstallSchema = {
  type: 'object',
  fields: {
    kitDirectory: { type: 'string', maxLength: PATH_TEXT_MAX, trim: true, allowEmpty: false, clamp: true },
    manifestPath: { type: 'string', maxLength: PATH_TEXT_MAX, trim: true, allowEmpty: false, clamp: true },
  },
}

const creatorKitOpenPathSchema = {
  type: 'object',
  fields: {
    kitDirectory: { type: 'string', maxLength: PATH_TEXT_MAX, trim: true, allowEmpty: false, clamp: true },
    targetPath: { type: 'string', maxLength: PATH_TEXT_MAX, trim: true, allowEmpty: false, clamp: true },
    mode: { type: 'enum', optional: true, default: 'open', values: ['open', 'reveal'] },
  },
}

const notificationWatcherSetSchema = {
  type: 'object',
  optional: true,
  default: {},
  fields: {
    enabled: { type: 'boolean', optional: true, default: false },
    appsPattern: { type: 'string', optional: true, default: '', maxLength: 2_000, trim: true, clamp: true },
  },
}

const proactiveNotificationSchema = {
  type: 'object',
  fields: {
    title: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, clamp: true },
    body: { type: 'string', maxLength: 4_000, trim: true, clamp: true },
  },
}

const kwsOptionsSchema = {
  type: 'object',
  optional: true,
  default: {},
  fields: {
    wakeWord: { type: 'string', optional: true, maxLength: 64, trim: true, clamp: true },
  },
}

const vadStartSchema = {
  type: 'object',
  optional: true,
  default: {},
  fields: {
    threshold: { type: 'number', optional: true, min: 0, max: 1 },
    minSilenceDuration: { type: 'number', optional: true, min: 0, max: 60 },
    minSpeechDuration: { type: 'number', optional: true, min: 0, max: 60 },
    maxSpeechDuration: { type: 'number', optional: true, min: 0.1, max: 600 },
  },
}

const modelDownloadSchema = {
  type: 'object',
  fields: {
    modelId: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false, clamp: true },
  },
}

const ttsStreamStartSchema = {
  type: 'object',
  fields: {
    requestId: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false },
    providerId: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false },
    baseUrl: { type: 'string', optional: true, default: '', maxLength: URL_TEXT_MAX, trim: true, clamp: true },
    apiKey: { type: 'string', optional: true, default: '', maxLength: SECRET_TEXT_MAX },
    model: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX, trim: true, clamp: true },
    voice: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX, trim: true, clamp: true },
    instructions: { type: 'string', optional: true, maxLength: 4_000, clamp: true },
    language: { type: 'string', optional: true, maxLength: 64, trim: true, clamp: true },
    rate: { type: 'number', optional: true, min: 0.25, max: 4 },
    pitch: { type: 'number', optional: true, min: -4, max: 4 },
    volume: { type: 'number', optional: true, min: 0, max: 4 },
  },
}

const ttsStreamPushTextSchema = {
  type: 'object',
  fields: {
    requestId: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false },
    text: { type: 'string', optional: true, default: '', maxLength: BODY_TEXT_MAX },
  },
}

const ttsStreamRequestIdSchema = {
  type: 'object',
  fields: {
    requestId: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false },
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

export function validateChatModelListPayload(payload) {
  return validateIpcPayload('chat:list-models', payload, chatModelListSchema)
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

export function validateSkillSavePayload(payload) {
  return validateIpcPayload('skill:save', payload, skillSaveSchema)
}

export function validateSkillSearchPayload(payload) {
  return validateIpcPayload('skill:search', payload, skillSearchSchema)
}

export function validateSkillIdPayload(channel, payload) {
  return validateIpcPayload(channel, payload, skillIdSchema)
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

export function validateLaunchOnStartupPayload(payload) {
  return validateIpcPayload('app:set-launch-on-startup', payload, launchOnStartupSchema)
}

export function validateConfirmDialogPayload(payload) {
  return validateIpcPayload('dialog:confirm', payload, confirmDialogSchema)
}

export function validatePetFreeModePayload(payload) {
  return { freeMode: false, ...validateIpcPayload('pet-window:set-free-mode', payload, petFreeModeSchema) }
}

export function validateTextFileSavePayload(payload) {
  return validateIpcPayload('file:save-text', payload, textFileSaveSchema)
}

export function validateTextFileOpenPayload(payload) {
  return validateIpcPayload('file:open-text', payload, textFileOpenSchema)
}

export function validateIntegrationInspectPayload(payload) {
  return validateIpcPayload('integrations:inspect', payload, integrationInspectSchema)
}

export function validatePersonaContentPayload(channel, payload) {
  return { content: '', ...validateIpcPayload(channel, payload, personaContentSchema) }
}

export function validatePersonaInitPayload(payload) {
  return { defaultSoul: '', ...validateIpcPayload('persona:init', payload, personaInitSchema) }
}

export function validatePersonaProfileIdPayload(channel, payload) {
  return validateIpcPayload(channel, payload, personaProfileIdSchema)
}

export function validateCodexPetGalleryInputPayload(payload) {
  return validateIpcPayload('pet-model:import-codex-gallery', payload, codexPetGalleryInputSchema)
}

export function validateCodexPetGalleryListPayload(payload) {
  return validateIpcPayload('pet-model:list-codex-gallery', payload, codexPetGalleryListSchema)
}

export function validateCreatorKitCreatePayload(payload) {
  return validateIpcPayload('pet-model:create-creator-kit', payload, creatorKitCreateSchema)
}

export function validateCreatorKitOptionalDirectoryPayload(channel, payload) {
  return validateIpcPayload(channel, payload, creatorKitOptionalDirectorySchema)
}

export function validateCreatorKitInstallPayload(payload) {
  return validateIpcPayload('pet-model:install-creator-kit-codex', payload, creatorKitInstallSchema)
}

export function validateCreatorKitOpenPathPayload(payload) {
  return validateIpcPayload('pet-model:open-creator-kit-path', payload, creatorKitOpenPathSchema)
}

export function validateNotificationWatcherSetPayload(payload) {
  return {
    enabled: false,
    appsPattern: '',
    ...validateIpcPayload('notification:watcher-set', payload, notificationWatcherSetSchema),
  }
}

export function validateProactiveNotificationPayload(payload) {
  return validateIpcPayload('proactive:show-notification', payload, proactiveNotificationSchema)
}

export function validateKwsOptionsPayload(channel, payload) {
  return validateIpcPayload(channel, payload, kwsOptionsSchema)
}

export function validateVadStartPayload(payload) {
  return validateIpcPayload('vad:start', payload, vadStartSchema)
}

export function validateModelDownloadPayload(payload) {
  return validateIpcPayload('models:download', payload, modelDownloadSchema)
}

export function validateTtsStreamStartPayload(payload) {
  return validateIpcPayload('tts:stream-start', payload, ttsStreamStartSchema)
}

export function validateTtsStreamPushTextPayload(payload) {
  return validateIpcPayload('tts:stream-push-text', payload, ttsStreamPushTextSchema)
}

export function validateTtsStreamRequestIdPayload(channel, payload) {
  return validateIpcPayload(channel, payload, ttsStreamRequestIdSchema)
}
