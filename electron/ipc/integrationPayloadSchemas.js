import { validateIpcPayload } from './schemaValidator.js'
import {
  AUDIO_BASE64_MAX,
  BODY_TEXT_MAX,
  PATH_TEXT_MAX,
  SECRET_TEXT_MAX,
  SHORT_TEXT_MAX,
  URL_TEXT_MAX,
  integrationPermissionModeSchema,
} from './payloadSchemaPrimitives.js'

const externalActionPolicyItemSchema = {
  type: 'object',
  optional: true,
  fields: {
    mode: integrationPermissionModeSchema,
    active: { type: 'boolean', optional: true },
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

export function validateIntegrationInspectPayload(payload) {
  return validateIpcPayload('integrations:inspect', payload, integrationInspectSchema)
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

export function validateGameConnectPayload(channel, payload) {
  return validateIpcPayload(channel, payload, gameConnectSchema)
}

export function validateGameCommandPayload(channel, payload) {
  return validateIpcPayload(channel, payload, gameCommandSchema)
}
