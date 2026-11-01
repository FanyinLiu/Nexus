// @ts-check
import { LOCAL_SPEECH_INPUT_PROVIDER_IDS } from '../../shared/voiceModelDownloads.js'
import { validateIpcPayload } from './schemaValidator.js'
import {
  AUDIO_BASE64_MAX,
  BODY_TEXT_MAX,
  SECRET_TEXT_MAX,
  SHORT_TEXT_MAX,
  URL_TEXT_MAX,
} from './payloadSchemaPrimitives.js'

/**
 * @typedef {Object} SpeechVoiceListPayload
 * @property {string} providerId
 * @property {string} baseUrl
 * @property {string} apiKey
 */

/**
 * @typedef {Object} AudioTranscriptionPayload
 * @property {string} providerId
 * @property {string} baseUrl
 * @property {string} apiKey
 * @property {string} [model]
 * @property {string} [traceId]
 * @property {string} [language]
 * @property {string} [hotwords]
 * @property {string} audioBase64
 * @property {string} mimeType
 * @property {string} [fileName]
 */

/**
 * @typedef {Object} AudioSynthesisPayload
 * @property {string} providerId
 * @property {string} baseUrl
 * @property {string} apiKey
 * @property {string} [model]
 * @property {string} [voice]
 * @property {string} [characterId]
 * @property {string} text
 * @property {string} [instructions]
 * @property {string} [language]
 * @property {number} [rate]
 * @property {number} [pitch]
 * @property {number} [volume]
 */

/**
 * @typedef {Object} TtsStreamStartPayload
 * @property {string} requestId
 * @property {string} providerId
 * @property {string} baseUrl
 * @property {string} apiKey
 * @property {string} [model]
 * @property {string} [voice]
 * @property {string} [characterId]
 * @property {string} [instructions]
 * @property {string} [language]
 * @property {number} [rate]
 * @property {number} [pitch]
 * @property {number} [volume]
 */

/**
 * @typedef {Object} TtsSegmentStyle
 * @property {string} [instruction]
 * @property {number} [rate]
 * @property {number} [pitch]
 * @property {string} [emotion]
 * @property {number} [speechTempo]
 */

/**
 * @typedef {Object} VoiceRuntimeSyncPayload
 * @property {boolean} speechInputEnabled
 * @property {string} speechInputProviderId
 * @property {boolean} speechOutputEnabled
 * @property {string} speechOutputProviderId
 */

const modelDownloadSchema = {
  type: 'object',
  fields: {
    modelId: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false },
  },
}

const modelDownloadMissingSchema = {
  type: 'object',
  optional: true,
  default: {},
  fields: {
    // Only the two local listeners. Any other value is rejected so a
    // payload cannot name an arbitrary catalog id.
    speechInputProviderId: {
      type: 'enum',
      optional: true,
      values: [...LOCAL_SPEECH_INPUT_PROVIDER_IDS],
    },
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
    characterId: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
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
    characterId: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX },
    instructions: { type: 'string', optional: true, maxLength: 4_000 },
    language: { type: 'string', optional: true, maxLength: 64 },
    rate: { type: 'number', optional: true, min: 0.25, max: 4 },
    pitch: { type: 'number', optional: true, min: -4, max: 4 },
    volume: { type: 'number', optional: true, min: 0, max: 4 },
  },
}

// Per-sentence emotion style. Bounded tightly so a malformed / hostile
// renderer cannot smuggle a long instruction or an out-of-range pace through
// the stream push channel.
const ttsSegmentStyleSchema = {
  type: 'object',
  optional: true,
  fields: {
    instruction: { type: 'string', optional: true, maxLength: 400, trim: true },
    rate: { type: 'number', optional: true, min: 0.5, max: 2 },
    pitch: { type: 'number', optional: true, min: 0.5, max: 2 },
    emotion: { type: 'string', optional: true, maxLength: SHORT_TEXT_MAX, trim: true },
    speechTempo: { type: 'number', optional: true, min: 0.5, max: 2.5 },
  },
}

const ttsStreamPushTextSchema = {
  type: 'object',
  fields: {
    requestId: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false },
    text: { type: 'string', maxLength: BODY_TEXT_MAX, trim: true, allowEmpty: false },
    style: ttsSegmentStyleSchema,
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

const turnEndSessionSchema = {
  type: 'object',
  optional: true,
  default: {},
  fields: {
    sessionId: { type: 'number', optional: true, integer: true, min: 0 },
  },
}

/** @param {unknown} payload @returns {SpeechVoiceListPayload} */
export function validateSpeechVoiceListPayload(payload) {
  return /** @type {SpeechVoiceListPayload} */ (validateIpcPayload('audio:list-voices', payload, speechVoiceListSchema))
}

/** @param {unknown} payload @returns {AudioTranscriptionPayload} */
export function validateAudioTranscriptionPayload(payload) {
  return /** @type {AudioTranscriptionPayload} */ (validateIpcPayload('audio:transcribe', payload, audioTranscriptionSchema))
}

/** @param {unknown} payload @returns {AudioSynthesisPayload} */
export function validateAudioSynthesisPayload(payload) {
  return /** @type {AudioSynthesisPayload} */ (validateIpcPayload('audio:synthesize', payload, audioSynthesisSchema))
}

/** @param {unknown} payload @returns {TtsStreamStartPayload} */
export function validateTtsStreamStartPayload(payload) {
  return /** @type {TtsStreamStartPayload} */ (validateIpcPayload('tts:stream-start', payload, ttsStreamStartSchema))
}

/**
 * @param {unknown} payload
 * @returns {{ requestId: string, text: string, style?: TtsSegmentStyle }}
 */
export function validateTtsStreamPushTextPayload(payload) {
  return /** @type {{ requestId: string, text: string, style?: TtsSegmentStyle }} */ (validateIpcPayload('tts:stream-push-text', payload, ttsStreamPushTextSchema))
}

/** @param {unknown} payload @returns {{ requestId: string }} */
export function validateTtsStreamFinishPayload(payload) {
  return /** @type {{ requestId: string }} */ (validateIpcPayload('tts:stream-finish', payload, requestIdSchema))
}

/** @param {unknown} payload @returns {{ requestId: string }} */
export function validateTtsStreamAbortPayload(payload) {
  return /** @type {{ requestId: string }} */ (validateIpcPayload('tts:stream-abort', payload, requestIdSchema))
}

/** @param {unknown} payload @returns {{ modelId: string }} */
export function validateModelDownloadPayload(payload) {
  return /** @type {{ modelId: string }} */ (validateIpcPayload('models:download', payload, modelDownloadSchema))
}

/** @param {unknown} payload @returns {{ speechInputProviderId?: string }} */
export function validateModelDownloadMissingPayload(payload) {
  return /** @type {{ speechInputProviderId?: string }} */ (validateIpcPayload('models:download-missing', payload, modelDownloadMissingSchema))
}

/**
 * @param {unknown} payload
 * @returns {{ apiKey?: string, appId?: string, secretId?: string, secretKey?: string, engineModelType?: string, hotwordList?: string }}
 */
export function validateTencentAsrConnectPayload(payload) {
  return /** @type {{ apiKey?: string, appId?: string, secretId?: string, secretKey?: string, engineModelType?: string, hotwordList?: string }} */ (
    validateIpcPayload('tencent-asr:connect', payload, tencentAsrConnectSchema)
  )
}

/**
 * @param {string} channel
 * @param {unknown} payload
 * @returns {{ wakeWord?: string }}
 */
export function validateKwsOptionsPayload(channel, payload) {
  return /** @type {{ wakeWord?: string }} */ (validateIpcPayload(channel, payload, kwsOptionsSchema))
}

/**
 * @param {unknown} payload
 * @returns {{ threshold?: number, minSilenceDuration?: number, minSpeechDuration?: number, maxSpeechDuration?: number }}
 */
export function validateVadStartPayload(payload) {
  return /** @type {{ threshold?: number, minSilenceDuration?: number, minSpeechDuration?: number, maxSpeechDuration?: number }} */ (
    validateIpcPayload('vad:start', payload, vadStartSchema)
  )
}

/** @param {unknown} payload @returns {{ sessionId?: number }} */
export function validateTurnEndSessionPayload(payload) {
  return /** @type {{ sessionId?: number }} */ (validateIpcPayload('voice-turn:session', payload, turnEndSessionSchema))
}

/**
 * Validate the compact voice-engine snapshot that drives on-demand sidecar
 * lifecycle in the main process.
 * @param {unknown} payload
 * @returns {VoiceRuntimeSyncPayload}
 */
export function validateVoiceRuntimeSyncPayload(payload) {
  return /** @type {VoiceRuntimeSyncPayload} */ (validateIpcPayload('voice-runtime:sync', payload, voiceRuntimeSyncSchema))
}

const voiceRuntimeSyncSchema = {
  type: 'object',
  unknown: 'reject',
  fields: {
    speechInputEnabled: { type: 'boolean' },
    speechInputProviderId: { type: 'string', maxLength: SHORT_TEXT_MAX },
    speechOutputEnabled: { type: 'boolean' },
    speechOutputProviderId: { type: 'string', maxLength: SHORT_TEXT_MAX },
  },
}

const voiceProfileProbeSchema = {
  type: 'object',
  optional: true,
  default: {},
  fields: {
    benchmark: { type: 'boolean', optional: true, default: false },
  },
}

/** @param {unknown} payload @returns {{ benchmark?: boolean }} */
export function validateVoiceProfileProbePayload(payload) {
  return /** @type {{ benchmark?: boolean }} */ (validateIpcPayload('voice-profile:probe', payload, voiceProfileProbeSchema))
}
