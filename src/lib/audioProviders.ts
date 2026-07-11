/**
 * Audio provider query API.
 *
 * Provider data lives in speechProviderCatalog.ts. This module owns derived
 * speech-provider lookups and protocol predicates used by settings and runtime.
 */

import {
  SPEECH_INPUT_PROVIDERS,
  SPEECH_OUTPUT_PROVIDERS,
  getSpeechInputProvider,
  getSpeechOutputProvider,
  type SpeechInputProviderEntry,
  type SpeechOutputProviderEntry,
  type SpeechModelOption,
  type SpeechVoiceOption,
  type SpeechStyleOption,
  type SpeechOutputAdjustmentSupport,
} from './speechProviderCatalog.ts'

// ── Re-export types ──

export type {
  SpeechModelOption,
  SpeechVoiceOption,
  SpeechStyleOption,
  SpeechOutputAdjustmentSupport,
}

export type SpeechInputProviderPreset = {
  id: string
  label: string
  baseUrl: string
  defaultModel: string
  notes: string
}

export type SpeechOutputProviderPreset = {
  id: string
  label: string
  baseUrl: string
  defaultModel: string
  defaultVoice: string
  notes: string
}

// ── Preset arrays (derived from catalog) ──

function toInputPreset(entry: SpeechInputProviderEntry): SpeechInputProviderPreset {
  return { id: entry.id, label: entry.label, baseUrl: entry.baseUrl, defaultModel: entry.defaultModel, notes: entry.notes }
}

function toOutputPreset(entry: SpeechOutputProviderEntry): SpeechOutputProviderPreset {
  return { id: entry.id, label: entry.label, baseUrl: entry.baseUrl, defaultModel: entry.defaultModel, defaultVoice: entry.defaultVoice, notes: entry.notes }
}

export const SPEECH_INPUT_PROVIDER_PRESETS: SpeechInputProviderPreset[] =
  SPEECH_INPUT_PROVIDERS.map(toInputPreset)

export const USER_VISIBLE_SPEECH_INPUT_PROVIDER_PRESETS: SpeechInputProviderPreset[] =
  SPEECH_INPUT_PROVIDERS.filter((p) => !p.hidden).map(toInputPreset)

export const SPEECH_OUTPUT_PROVIDER_PRESETS: SpeechOutputProviderPreset[] =
  SPEECH_OUTPUT_PROVIDERS.map(toOutputPreset)

export const USER_VISIBLE_SPEECH_OUTPUT_PROVIDER_PRESETS: SpeechOutputProviderPreset[] =
  SPEECH_OUTPUT_PROVIDERS.filter((p) => !p.hidden).map(toOutputPreset)

// ── Model & voice option arrays (delegated to catalog entries) ──

export const MINIMAX_TTS_MODEL_OPTIONS: SpeechModelOption[] =
  getSpeechOutputProvider('minimax-tts').modelOptions

export const MINIMAX_FALLBACK_VOICE_OPTIONS: SpeechVoiceOption[] =
  getSpeechOutputProvider('minimax-tts').fallbackVoiceOptions

export const VOLCENGINE_FALLBACK_VOICE_OPTIONS: SpeechVoiceOption[] =
  getSpeechOutputProvider('volcengine-tts').fallbackVoiceOptions

// ── Preset lookup ──

export function getSpeechInputProviderPreset(providerId: string): SpeechInputProviderPreset {
  return toInputPreset(getSpeechInputProvider(providerId))
}

export function getSpeechOutputProviderPreset(providerId: string): SpeechOutputProviderPreset {
  return toOutputPreset(getSpeechOutputProvider(providerId))
}

// ── Model & voice resolution (delegated to catalog) ──

export function getSpeechInputModelOptions(providerId: string): SpeechModelOption[] {
  return getSpeechInputProvider(providerId).modelOptions
}

export function resolveSpeechInputModel(providerId: string, requestedModel?: string | null): string {
  const normalizedModel = String(requestedModel ?? '').trim()
  const entry = getSpeechInputProvider(providerId)

  if (!normalizedModel) return entry.defaultModel

  if (!entry.modelOptions.length) return normalizedModel

  return entry.modelOptions.some((opt) => opt.value === normalizedModel)
    ? normalizedModel
    : entry.defaultModel
}

export function getSpeechOutputModelOptions(providerId: string): SpeechModelOption[] {
  return getSpeechOutputProvider(providerId).modelOptions
}

export function getFallbackSpeechOutputVoices(providerId: string): SpeechVoiceOption[] {
  return getSpeechOutputProvider(providerId).fallbackVoiceOptions
}

export function getSpeechOutputStyleOptions(providerId: string): SpeechStyleOption[] {
  return getSpeechOutputProvider(providerId).styleOptions
}

export function supportsCustomSpeechOutputVoiceId(providerId: string): boolean {
  return getSpeechOutputProvider(providerId).supportsCustomVoiceId
}

export function isSpeechOutputKeyless(providerId: string): boolean {
  const entry = getSpeechOutputProvider(providerId)
  return entry.kind === 'local' || entry.protocol === 'edge-tts'
}

export function isSpeechInputKeyless(providerId: string): boolean {
  return getSpeechInputProvider(providerId).kind === 'local'
}

export function isSpeechInputLocal(providerId: string): boolean {
  return getSpeechInputProvider(providerId).kind === 'local'
}

// ── Provider type detection (delegated to catalog protocol) ──

export function isBrowserSpeechInputProvider(providerId: string) {
  return providerId === 'browser'
}

export function isSenseVoiceSpeechInputProvider(providerId: string) {
  return getSpeechInputProvider(providerId).protocol === 'sensevoice'
}

export function isParaformerSpeechInputProvider(providerId: string) {
  return getSpeechInputProvider(providerId).protocol === 'paraformer'
}

export function isTencentAsrSpeechInputProvider(providerId: string) {
  return getSpeechInputProvider(providerId).protocol === 'tencent'
}

export function isElevenLabsSpeechProvider(providerId: string) {
  return providerId === 'elevenlabs-stt' || providerId === 'elevenlabs-tts'
}

export function isOpenAiCompatibleSpeechInputProvider(providerId: string) {
  return getSpeechInputProvider(providerId).protocol === 'openai-compatible'
}

export function isOpenAiCompatibleSpeechOutputProvider(providerId: string) {
  return getSpeechOutputProvider(providerId).protocol === 'openai-compatible'
}

export function isVolcengineSpeechInputProvider(providerId: string) {
  return getSpeechInputProvider(providerId).protocol === 'volcengine'
}

export function isVolcengineSpeechOutputProvider(providerId: string) {
  return getSpeechOutputProvider(providerId).protocol === 'volcengine'
}

export function isMiniMaxSpeechOutputProvider(providerId: string) {
  return getSpeechOutputProvider(providerId).protocol === 'minimax'
}

export function isDashScopeSpeechOutputProvider(providerId: string) {
  return getSpeechOutputProvider(providerId).protocol === 'dashscope'
}

export function isEdgeTtsSpeechOutputProvider(providerId: string) {
  return getSpeechOutputProvider(providerId).protocol === 'edge-tts'
}

// ── Capability queries (delegated to catalog) ──

export function getSpeechOutputAdjustmentSupport(providerId: string): SpeechOutputAdjustmentSupport {
  return getSpeechOutputProvider(providerId).adjustmentSupport
}

// ── URL normalization ──

function normalizeHttpBaseUrl(baseUrl: string) {
  return String(baseUrl ?? '').trim().replace(/\/+$/, '')
}

export function normalizeSpeechOutputApiBaseUrl(_providerId: string, baseUrl: string) {
  const normalized = normalizeHttpBaseUrl(baseUrl)
  return normalized
}
