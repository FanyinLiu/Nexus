import { validateIpcPayload } from './schemaValidator.js'
import {
  AUDIO_BASE64_MAX,
  BODY_TEXT_MAX,
  CHAT_MESSAGE_TEXT_MAX,
  PATH_TEXT_MAX,
  SAFE_FILE_EXTENSION_PATTERN,
  SAFE_SKILL_ID_PATTERN,
  SECRET_TEXT_MAX,
  SHORT_TEXT_MAX,
  TEXT_FILE_CONTENT_MAX,
  URL_TEXT_MAX,
  integrationPermissionModeSchema,
  optionalBoolean,
  optionalShortString,
} from './payloadSchemaPrimitives.js'
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

const externalActionPolicyItemSchema = {
  type: 'object',
  optional: true,
  fields: {
    mode: integrationPermissionModeSchema,
    active: { type: 'boolean', optional: true },
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

const integrationInspectSchema = {
  type: 'object',
  fields: {
    mcpServers: {
      type: 'array',
      maxItems: 32,
      items: {
        type: 'object',
        fields: {
          id: { type: 'string', maxLength: SHORT_TEXT_MAX },
          label: { type: 'string', maxLength: SHORT_TEXT_MAX },
          command: { type: 'string', maxLength: PATH_TEXT_MAX },
          args: { type: 'string', maxLength: PATH_TEXT_MAX },
          enabled: { type: 'boolean' },
        },
      },
    },
    minecraftIntegrationEnabled: { type: 'boolean' },
    minecraftServerAddress: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, clamp: true },
    minecraftServerPort: { type: 'number', integer: true, min: 1, max: 65535 },
    minecraftUsername: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, clamp: true },
    factorioIntegrationEnabled: { type: 'boolean' },
    factorioServerAddress: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, clamp: true },
    factorioServerPort: { type: 'number', integer: true, min: 1, max: 65535 },
    factorioUsername: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, clamp: true },
  },
}

const modelDownloadSchema = {
  type: 'object',
  fields: {
    modelId: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false },
  },
}

const fileDialogFilterSchema = {
  type: 'object',
  fields: {
    name: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false, clamp: true },
    extensions: {
      type: 'array',
      maxItems: 32,
      items: {
        type: 'string',
        maxLength: 32,
        trim: true,
        allowEmpty: false,
        pattern: SAFE_FILE_EXTENSION_PATTERN,
      },
    },
  },
}

const textFileSaveSchema = {
  type: 'object',
  fields: {
    title: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false, clamp: true },
    defaultFileName: { type: 'string', maxLength: 255, trim: true, allowEmpty: false, clamp: true },
    content: { type: 'string', maxLength: TEXT_FILE_CONTENT_MAX },
    filters: {
      type: 'array',
      optional: true,
      maxItems: 16,
      items: fileDialogFilterSchema,
    },
  },
}

const textFileOpenSchema = {
  type: 'object',
  fields: {
    title: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false, clamp: true },
    filters: {
      type: 'array',
      optional: true,
      maxItems: 16,
      items: fileDialogFilterSchema,
    },
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

const telegramSendMessageSchema = {
  type: 'object',
  fields: {
    chatId: { type: 'number', integer: true },
    text: { type: 'string', maxLength: BODY_TEXT_MAX, trim: true, allowEmpty: false },
    replyToMessageId: { type: 'number', optional: true, integer: true },
    parseMode: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false },
  },
}

const telegramSendVoiceSchema = {
  type: 'object',
  fields: {
    chatId: { type: 'number', integer: true },
    audioBase64: { type: 'string', maxLength: AUDIO_BASE64_MAX, allowEmpty: false },
    mimeType: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false },
    replyToMessageId: { type: 'number', optional: true, integer: true },
  },
}

const discordSendMessageSchema = {
  type: 'object',
  fields: {
    channelId: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false },
    text: { type: 'string', maxLength: BODY_TEXT_MAX, trim: true, allowEmpty: false },
    replyToMessageId: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false },
  },
}

const discordSendVoiceSchema = {
  type: 'object',
  fields: {
    channelId: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false },
    audioBase64: { type: 'string', maxLength: 34_000_000, allowEmpty: false },
    mimeType: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false },
    replyToMessageId: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false },
  },
}

const externalActionPolicySyncSchema = {
  type: 'object',
  fields: {
    policies: {
      type: 'object',
      fields: {
        telegram: externalActionPolicyItemSchema,
        discord: externalActionPolicyItemSchema,
        minecraft: externalActionPolicyItemSchema,
        factorio: externalActionPolicyItemSchema,
        mcp: externalActionPolicyItemSchema,
      },
    },
  },
}

const localDataOnboardingStateSchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    completedAt: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false },
    firstConversationAt: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false },
    firstConversationElapsedMs: { type: 'number', optional: true, integer: true, min: 0, max: 86_400_000 },
  },
}

const localDataOnboardingMirrorSchema = {
  type: 'object',
  optional: true,
  default: {},
  unknown: 'reject',
  fields: {
    state: {
      ...localDataOnboardingStateSchema,
      optional: true,
    },
  },
}

const localDataChatMigrationMessageSchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    id: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false },
    role: { type: 'enum', values: ['user', 'assistant', 'system'] },
    content: { type: 'string', maxLength: CHAT_MESSAGE_TEXT_MAX, allowEmpty: false },
    createdAt: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false },
    tone: { type: 'enum', optional: true, values: ['neutral', 'error'] },
    reasoning_content: { type: 'string', optional: true, maxLength: CHAT_MESSAGE_TEXT_MAX },
    toolResult: { type: 'any', optional: true },
  },
}

const localDataChatMigrationSessionSchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    id: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false },
    startedAt: { type: 'number', min: 0 },
    lastActiveAt: { type: 'number', min: 0 },
    title: { type: 'string', optional: true, maxLength: 80, trim: true, clamp: true },
    messages: {
      type: 'array',
      maxItems: 500,
      items: localDataChatMigrationMessageSchema,
    },
  },
}

const localDataChatMigrationPackageSchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    schemaVersion: { type: 'number', integer: true, min: 1, max: 1 },
    createdAt: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false },
    source: {
      type: 'object',
      unknown: 'reject',
      fields: {
        sessionsKeyPresent: { type: 'boolean' },
        legacyFlatChatKeyPresent: { type: 'boolean' },
        legacyFlatChatUsed: { type: 'boolean' },
      },
    },
    dryRunReport: { type: 'any', optional: true },
    sessions: {
      type: 'array',
      maxItems: 30,
      items: localDataChatMigrationSessionSchema,
    },
  },
}

const localDataChatMigrationApplySchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    confirmed: { type: 'boolean' },
    migrationPackage: localDataChatMigrationPackageSchema,
  },
}

const localDataChatMigrationRollbackSchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    confirmed: { type: 'boolean' },
  },
}

const localDataChatRuntimeMirrorSchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    confirmed: { type: 'boolean' },
    session: localDataChatMigrationSessionSchema,
  },
}

const localDataChatComparisonSessionSchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    id: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false },
    startedAt: { type: 'number', min: 0 },
    lastActiveAt: { type: 'number', min: 0 },
    messageCount: { type: 'number', integer: true, min: 0, max: 500 },
    payloadBytes: { type: 'number', integer: true, min: 0, max: 20_000_000 },
  },
}

const localDataChatComparisonSourceSchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    schemaVersion: { type: 'number', integer: true, min: 1, max: 1 },
    generatedAt: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false },
    source: {
      type: 'object',
      unknown: 'reject',
      fields: {
        sessionsKeyPresent: { type: 'boolean' },
        legacyFlatChatKeyPresent: { type: 'boolean' },
        legacyFlatChatUsed: { type: 'boolean' },
      },
    },
    sessions: {
      type: 'array',
      maxItems: 30,
      items: localDataChatComparisonSessionSchema,
    },
  },
}

const localDataChatComparisonSchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    confirmed: { type: 'boolean' },
    source: localDataChatComparisonSourceSchema,
  },
}

const petModelGalleryImportSchema = {
  type: 'string',
  maxLength: URL_TEXT_MAX,
  trim: true,
  allowEmpty: false,
}

const petModelGalleryListSchema = {
  type: 'object',
  optional: true,
  default: {},
  fields: {
    query: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX, trim: true, clamp: true },
    limit: { type: 'number', optional: true, integer: true, min: 1, max: 100 },
  },
}

const petModelCreatorKitCreateSchema = {
  type: 'object',
  optional: true,
  default: {},
  fields: {
    id: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX, trim: true, clamp: true },
    displayName: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX, trim: true, clamp: true },
    concept: { type: 'string', optional: true, maxLength: 2_000, trim: true, clamp: true },
    description: { type: 'string', optional: true, maxLength: 2_000, trim: true, clamp: true },
    styleNotes: { type: 'string', optional: true, maxLength: 2_000, trim: true, clamp: true },
  },
}

const petModelCreatorKitOptionalPathSchema = {
  type: 'object',
  optional: true,
  default: {},
  fields: {
    kitDirectory: { type: 'string', optional: true, maxLength: PATH_TEXT_MAX, trim: true, clamp: true },
  },
}

const petModelCreatorKitInstallSchema = {
  type: 'object',
  fields: {
    kitDirectory: { type: 'string', maxLength: PATH_TEXT_MAX, trim: true, allowEmpty: false },
    manifestPath: { type: 'string', maxLength: PATH_TEXT_MAX, trim: true, allowEmpty: false },
  },
}

const petModelCreatorKitOpenPathSchema = {
  type: 'object',
  fields: {
    kitDirectory: { type: 'string', maxLength: PATH_TEXT_MAX, trim: true, allowEmpty: false },
    targetPath: { type: 'string', maxLength: PATH_TEXT_MAX, trim: true, allowEmpty: false },
    mode: { type: 'enum', optional: true, values: ['open', 'reveal'] },
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

const requestIdSchema = {
  type: 'object',
  fields: {
    requestId: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false },
  },
}

const ttsStreamStartSchema = {
  type: 'object',
  fields: {
    requestId: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false },
    providerId: { type: 'string', maxLength: SHORT_TEXT_MAX },
    baseUrl: { type: 'string', maxLength: URL_TEXT_MAX },
    apiKey: { type: 'string', maxLength: SECRET_TEXT_MAX },
    model: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
    voice: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
    instructions: { type: 'string', optional: true, maxLength: 4_000 },
    language: { type: 'string', optional: true, maxLength: 64 },
    rate: { type: 'number', optional: true, min: 0.25, max: 4 },
    pitch: { type: 'number', optional: true, min: -4, max: 4 },
    volume: { type: 'number', optional: true, min: 0, max: 4 },
  },
}

const ttsStreamPushTextSchema = {
  type: 'object',
  fields: {
    requestId: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false },
    text: { type: 'string', maxLength: BODY_TEXT_MAX, trim: true, allowEmpty: false },
  },
}

const kwsOptionsSchema = {
  type: 'object',
  optional: true,
  default: {},
  fields: {
    wakeWord: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX, trim: true, clamp: true },
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
    maxSpeechDuration: { type: 'number', optional: true, min: 0.1, max: 300 },
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

export function validateTtsStreamStartPayload(payload) {
  return validateIpcPayload('tts:stream-start', payload, ttsStreamStartSchema)
}

export function validateTtsStreamPushTextPayload(payload) {
  return validateIpcPayload('tts:stream-push-text', payload, ttsStreamPushTextSchema)
}

export function validateTtsStreamFinishPayload(payload) {
  return validateIpcPayload('tts:stream-finish', payload, requestIdSchema)
}

export function validateTtsStreamAbortPayload(payload) {
  return validateIpcPayload('tts:stream-abort', payload, requestIdSchema)
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

export function validateIntegrationInspectPayload(payload) {
  return validateIpcPayload('integrations:inspect', payload, integrationInspectSchema)
}

export function validateModelDownloadPayload(payload) {
  return validateIpcPayload('models:download', payload, modelDownloadSchema)
}

export function validateTextFileSavePayload(payload) {
  return validateIpcPayload('file:save-text', payload, textFileSaveSchema)
}

export function validateTextFileOpenPayload(payload) {
  return validateIpcPayload('file:open-text', payload, textFileOpenSchema)
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

export function validateTelegramSendMessagePayload(payload) {
  return validateIpcPayload('telegram:send-message', payload, telegramSendMessageSchema)
}

export function validateTelegramSendVoicePayload(payload) {
  return validateIpcPayload('telegram:send-voice', payload, telegramSendVoiceSchema)
}

export function validateDiscordSendMessagePayload(payload) {
  return validateIpcPayload('discord:send-message', payload, discordSendMessageSchema)
}

export function validateDiscordSendVoicePayload(payload) {
  return validateIpcPayload('discord:send-voice', payload, discordSendVoiceSchema)
}

export function validateExternalActionPolicySyncPayload(payload) {
  return validateIpcPayload('external-action-policy:sync', payload, externalActionPolicySyncSchema)
}

export function validateLocalDataOnboardingMirrorPayload(payload) {
  return validateIpcPayload('local-data:mirror-onboarding', payload, localDataOnboardingMirrorSchema)
}

export function validateLocalDataChatMigrationApplyPayload(payload) {
  return validateIpcPayload('local-data:chat-migration-apply', payload, localDataChatMigrationApplySchema)
}

export function validateLocalDataChatMigrationRollbackPayload(payload) {
  return validateIpcPayload('local-data:chat-migration-rollback', payload, localDataChatMigrationRollbackSchema)
}

export function validateLocalDataChatRuntimeMirrorPayload(payload) {
  return validateIpcPayload('local-data:chat-session-mirror', payload, localDataChatRuntimeMirrorSchema)
}

export function validateLocalDataChatComparisonPayload(payload) {
  return validateIpcPayload('local-data:chat-comparison-preview', payload, localDataChatComparisonSchema)
}

export function validatePetModelGalleryImportPayload(payload) {
  return validateIpcPayload('pet-model:import-codex-gallery', payload, petModelGalleryImportSchema)
}

export function validatePetModelGalleryListPayload(payload) {
  return validateIpcPayload('pet-model:list-codex-gallery', payload, petModelGalleryListSchema)
}

export function validatePetModelCreatorKitCreatePayload(payload) {
  return validateIpcPayload('pet-model:create-creator-kit', payload, petModelCreatorKitCreateSchema)
}

export function validatePetModelCreatorKitOptionalPathPayload(channel, payload) {
  return validateIpcPayload(channel, payload, petModelCreatorKitOptionalPathSchema)
}

export function validatePetModelCreatorKitInstallPayload(payload) {
  return validateIpcPayload('pet-model:install-creator-kit-codex', payload, petModelCreatorKitInstallSchema)
}

export function validatePetModelCreatorKitOpenPathPayload(payload) {
  return validateIpcPayload('pet-model:open-creator-kit-path', payload, petModelCreatorKitOpenPathSchema)
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

export function validateKwsOptionsPayload(channel, payload) {
  return validateIpcPayload(channel, payload, kwsOptionsSchema)
}

export function validateVadStartPayload(payload) {
  return validateIpcPayload('vad:start', payload, vadStartSchema)
}
