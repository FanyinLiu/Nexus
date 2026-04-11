/**
 * Audio provider API — re-exports and compatibility layer.
 *
 * All provider data now lives in providerCatalog.ts. This module preserves the
 * existing public API so consumers don't need to change. New code should import
 * directly from providerCatalog.ts when it only needs catalog queries.
 */

import {
  SPEECH_INPUT_PROVIDERS,
  SPEECH_OUTPUT_PROVIDERS,
  VOICE_CLONE_PROVIDERS,
  getSpeechInputProvider,
  getSpeechOutputProvider,
  type SpeechInputProviderEntry,
  type SpeechOutputProviderEntry,
  type VoiceCloneProviderEntry,
  type SpeechModelOption,
  type SpeechVoiceOption,
  type SpeechOutputAdjustmentSupport,
} from './providerCatalog.ts'

// ── Re-export types ──

export type {
  SpeechModelOption,
  SpeechVoiceOption,
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

export type VoiceCloneProviderPreset = {
  id: string
  label: string
  baseUrl: string
  notes: string
}

// ── Preset arrays (derived from catalog) ──

function toInputPreset(entry: SpeechInputProviderEntry): SpeechInputProviderPreset {
  return { id: entry.id, label: entry.label, baseUrl: entry.baseUrl, defaultModel: entry.defaultModel, notes: entry.notes }
}

function toOutputPreset(entry: SpeechOutputProviderEntry): SpeechOutputProviderPreset {
  return { id: entry.id, label: entry.label, baseUrl: entry.baseUrl, defaultModel: entry.defaultModel, defaultVoice: entry.defaultVoice, notes: entry.notes }
}

function toClonePreset(entry: VoiceCloneProviderEntry): VoiceCloneProviderPreset {
  return { id: entry.id, label: entry.label, baseUrl: entry.baseUrl, notes: entry.notes }
}

export const SPEECH_INPUT_PROVIDER_PRESETS: SpeechInputProviderPreset[] =
  SPEECH_INPUT_PROVIDERS.map(toInputPreset)

export const USER_VISIBLE_SPEECH_INPUT_PROVIDER_PRESETS: SpeechInputProviderPreset[] =
  SPEECH_INPUT_PROVIDERS.filter((p) => !p.hidden).map(toInputPreset)

export const SPEECH_OUTPUT_PROVIDER_PRESETS: SpeechOutputProviderPreset[] =
  SPEECH_OUTPUT_PROVIDERS.map(toOutputPreset)

export const USER_VISIBLE_SPEECH_OUTPUT_PROVIDER_PRESETS: SpeechOutputProviderPreset[] =
  SPEECH_OUTPUT_PROVIDERS.filter((p) => !p.hidden).map(toOutputPreset)

export const VOICE_CLONE_PROVIDER_PRESETS: VoiceCloneProviderPreset[] =
  VOICE_CLONE_PROVIDERS.map(toClonePreset)

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

export function getVoiceCloneProviderPreset(providerId: string): VoiceCloneProviderPreset {
  const found = VOICE_CLONE_PROVIDERS.find((p) => p.id === providerId)
  return toClonePreset(found ?? VOICE_CLONE_PROVIDERS[0])
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


export function isVoiceCloneDisabled(providerId: string) {
  return providerId === 'none'
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
