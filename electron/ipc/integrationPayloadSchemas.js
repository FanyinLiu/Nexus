// @ts-check
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

/**
 * @typedef {Object} ExternalActionPolicyItemPayload
 * @property {'read-only'|'confirm'|'auto'} mode
 * @property {boolean} [active]
 */

/**
 * @typedef {Object} IntegrationInspectPayload
 * @property {Array<{ id: string, label: string, command: string, args: string, enabled: boolean }>} mcpServers
 * @property {boolean} minecraftIntegrationEnabled
 * @property {string} minecraftServerAddress
 * @property {number} minecraftServerPort
 * @property {string} minecraftUsername
 * @property {boolean} factorioIntegrationEnabled
 * @property {string} factorioServerAddress
 * @property {number} factorioServerPort
 * @property {string} factorioUsername
 */

/**
 * @typedef {Object} TelegramSendMessagePayload
 * @property {number} chatId
 * @property {string} text
 * @property {number} [replyToMessageId]
 * @property {string} [parseMode]
 */

/**
 * @typedef {Object} TelegramSendVoicePayload
 * @property {number} chatId
 * @property {string} audioBase64
 * @property {string} mimeType
 * @property {number} [replyToMessageId]
 */

/**
 * @typedef {Object} DiscordSendMessagePayload
 * @property {string} channelId
 * @property {string} text
 * @property {string} [replyToMessageId]
 */

/**
 * @typedef {Object} DiscordSendVoicePayload
 * @property {string} channelId
 * @property {string} audioBase64
 * @property {string} mimeType
 * @property {string} [replyToMessageId]
 */

/**
 * @typedef {Object} ExternalActionPolicySyncPayload
 * @property {Record<string, ExternalActionPolicyItemPayload | undefined>} policies
 * @property {{ activeWindow?: boolean, clipboard?: boolean, screenshot?: boolean }} [desktopContext]
 * @property {boolean} [toolOpenExternalRequiresConfirmation]
 * @property {string} [uiLanguage]
 */

/**
 * @typedef {Object} GameConnectPayload
 * @property {string} address
 * @property {number} [port]
 * @property {string} [username]
 * @property {string} [password]
 */

const externalActionPolicyItemSchema = {
  type: 'object',
  optional: true,
  unknown: 'reject',
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
  unknown: 'reject',
  fields: {
    chatId: { type: 'number', integer: true },
    text: { type: 'string', maxLength: BODY_TEXT_MAX, trim: true, allowEmpty: false },
    replyToMessageId: { type: 'number', optional: true, integer: true },
    parseMode: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false },
  },
}

const telegramSendVoiceSchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    chatId: { type: 'number', integer: true },
    audioBase64: { type: 'string', maxLength: AUDIO_BASE64_MAX, allowEmpty: false },
    mimeType: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false },
    replyToMessageId: { type: 'number', optional: true, integer: true },
  },
}

const discordSendMessageSchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    channelId: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false },
    text: { type: 'string', maxLength: BODY_TEXT_MAX, trim: true, allowEmpty: false },
    replyToMessageId: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false },
  },
}

const discordSendVoiceSchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    channelId: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false },
    audioBase64: { type: 'string', maxLength: 34_000_000, allowEmpty: false },
    mimeType: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false },
    replyToMessageId: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false },
  },
}

const desktopContextFlagsSchema = {
  type: 'object',
  optional: true,
  unknown: 'reject',
  fields: {
    activeWindow: { type: 'boolean' },
    clipboard: { type: 'boolean' },
    screenshot: { type: 'boolean' },
  },
}

const externalActionPolicySyncSchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    policies: {
      type: 'object',
      unknown: 'reject',
      fields: {
        telegram: externalActionPolicyItemSchema,
        discord: externalActionPolicyItemSchema,
        minecraft: externalActionPolicyItemSchema,
        factorio: externalActionPolicyItemSchema,
        mcp: externalActionPolicyItemSchema,
      },
    },
    desktopContext: desktopContextFlagsSchema,
    toolOpenExternalRequiresConfirmation: { type: 'boolean', optional: true },
    uiLanguage: {
      type: 'enum',
      optional: true,
      values: ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko'],
    },
  },
}

const gameConnectSchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    address: { type: 'string', maxLength: URL_TEXT_MAX },
    port: { type: 'number', optional: true, min: 1, max: 65_535 },
    username: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
    password: { type: 'string', optional: true, maxLength: SECRET_TEXT_MAX },
  },
}

const gameCommandSchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    command: { type: 'string', maxLength: 4_000 },
  },
}

/** @param {unknown} payload @returns {IntegrationInspectPayload} */
export function validateIntegrationInspectPayload(payload) {
  return /** @type {IntegrationInspectPayload} */ (validateIpcPayload('integrations:inspect', payload, integrationInspectSchema))
}

/** @param {unknown} payload @returns {TelegramSendMessagePayload} */
export function validateTelegramSendMessagePayload(payload) {
  return /** @type {TelegramSendMessagePayload} */ (validateIpcPayload('telegram:send-message', payload, telegramSendMessageSchema))
}

/** @param {unknown} payload @returns {TelegramSendVoicePayload} */
export function validateTelegramSendVoicePayload(payload) {
  return /** @type {TelegramSendVoicePayload} */ (validateIpcPayload('telegram:send-voice', payload, telegramSendVoiceSchema))
}

/** @param {unknown} payload @returns {DiscordSendMessagePayload} */
export function validateDiscordSendMessagePayload(payload) {
  return /** @type {DiscordSendMessagePayload} */ (validateIpcPayload('discord:send-message', payload, discordSendMessageSchema))
}

/** @param {unknown} payload @returns {DiscordSendVoicePayload} */
export function validateDiscordSendVoicePayload(payload) {
  return /** @type {DiscordSendVoicePayload} */ (validateIpcPayload('discord:send-voice', payload, discordSendVoiceSchema))
}

/** @param {unknown} payload @returns {ExternalActionPolicySyncPayload} */
export function validateExternalActionPolicySyncPayload(payload) {
  return /** @type {ExternalActionPolicySyncPayload} */ (validateIpcPayload('external-action-policy:sync', payload, externalActionPolicySyncSchema))
}

/**
 * @param {string} channel
 * @param {unknown} payload
 * @returns {GameConnectPayload}
 */
export function validateGameConnectPayload(channel, payload) {
  return /** @type {GameConnectPayload} */ (validateIpcPayload(channel, payload, gameConnectSchema))
}

/**
 * @param {string} channel
 * @param {unknown} payload
 * @returns {{ command: string }}
 */
export function validateGameCommandPayload(channel, payload) {
  return /** @type {{ command: string }} */ (validateIpcPayload(channel, payload, gameCommandSchema))
}
