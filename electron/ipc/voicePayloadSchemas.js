import { validateIpcPayload } from './schemaValidator.js'
import {
  AUDIO_BASE64_MAX,
  BODY_TEXT_MAX,
  SECRET_TEXT_MAX,
  SHORT_TEXT_MAX,
  URL_TEXT_MAX,
} from './payloadSchemaPrimitives.js'

const modelDownloadSchema = {
  type: 'object',
  fields: {
    modelId: { type: 'string', maxLength: SHORT_TEXT_MAX, trim: true, allowEmpty: false },
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

export function validateModelDownloadPayload(payload) {
  return validateIpcPayload('models:download', payload, modelDownloadSchema)
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
