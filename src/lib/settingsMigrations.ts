/**
 * Settings schema migration registry.
 *
 * Each migration transforms a raw settings object from one schema version to
 * the next. Migrations run sequentially (oldest-first) during loadSettings()
 * whenever the stored version is behind CURRENT_SETTINGS_SCHEMA_VERSION.
 *
 * To add a new migration:
 *   1. Bump CURRENT_SETTINGS_SCHEMA_VERSION
 *   2. Append a SettingsMigration entry to `migrations`
 */

import type { UiLanguage } from '../types'
import { inferApiProviderId } from '../features/models/providerCatalog.ts'
import { normalizeUiLanguage } from './uiLanguage.ts'

/**
 * Frozen snapshot of catalog defaults replaced in the 2026-08 refresh.
 * v6 remaps a stored model only when it still equals that previous
 * default. Do not edit these pairs in place — add a later migration.
 */
const RETIRED_CATALOG_DEFAULTS: Record<string, { from: string; to: string }> = {
  openai: { from: 'gpt-5.5', to: 'gpt-5.6-sol' },
  anthropic: { from: 'claude-sonnet-4-6', to: 'claude-sonnet-5' },
  gemini: { from: 'gemini-3.5-flash', to: 'gemini-3.7-flash' },
  xai: { from: 'grok-4.3', to: 'grok-4.6' },
  moonshot: { from: 'kimi-k2.6', to: 'kimi-k3' },
  'moonshot-global': { from: 'kimi-k2.6', to: 'kimi-k3' },
  'kimi-coding': { from: 'kimi-k2.6', to: 'kimi-k3' },
  'kimi-coding-global': { from: 'kimi-k2.6', to: 'kimi-k3' },
  dashscope: { from: 'qwen3.6-plus', to: 'qwen3.7-plus' },
  'dashscope-global': { from: 'qwen3.6-plus', to: 'qwen3.7-plus' },
  'modelstudio-coding': { from: 'qwen3.6-plus', to: 'qwen3.7-plus' },
  zai: { from: 'glm-5.1', to: 'glm-5.2' },
  'zai-global': { from: 'glm-5.1', to: 'glm-5.2' },
}

function migrateCatalogDefault(
  mapping: Record<string, { from: string; to: string }>,
  providerId: string,
  model: string,
) {
  const entry = mapping[providerId]
  if (!entry) return model
  return model === entry.from ? entry.to : model
}

function remapStoredCatalogDefaults(
  raw: Record<string, unknown>,
  mapping: Record<string, { from: string; to: string }>,
) {
  const next = { ...raw }
  const storedProviderId = typeof next.apiProviderId === 'string' ? next.apiProviderId : ''
  const storedBaseUrl = typeof next.apiBaseUrl === 'string' ? next.apiBaseUrl : ''
  const storedModel = typeof next.model === 'string' ? next.model : ''
  const providerId = storedProviderId || inferApiProviderId(storedBaseUrl, storedModel)
  if (storedModel && providerId) {
    next.model = migrateCatalogDefault(mapping, providerId, storedModel)
  }

  const profiles = next.textProviderProfiles
  if (profiles && typeof profiles === 'object' && !Array.isArray(profiles)) {
    const nextProfiles: Record<string, unknown> = { ...profiles }
    for (const [id, profile] of Object.entries(nextProfiles)) {
      if (!profile || typeof profile !== 'object' || Array.isArray(profile)) continue
      const model = 'model' in profile && typeof profile.model === 'string' ? profile.model : ''
      if (!model) continue
      const migrated = migrateCatalogDefault(mapping, id, model)
      if (migrated !== model) {
        nextProfiles[id] = { ...profile, model: migrated }
      }
    }
    next.textProviderProfiles = nextProfiles
  }
  return next
}

/**
 * Frozen snapshot of catalog defaults replaced after the 2026-08 v6 refresh.
 * v7 remaps a stored model only when it still equals that previous default.
 */
const V7_RETIRED_CATALOG_DEFAULTS: Record<string, { from: string; to: string }> = {
  dashscope: { from: 'qwen3.7-plus', to: 'qwen3.8-max' },
  'dashscope-global': { from: 'qwen3.7-plus', to: 'qwen3.8-max' },
  'modelstudio-coding': { from: 'qwen3.7-plus', to: 'qwen3.8-max' },
  zai: { from: 'glm-5.2', to: 'glm-5.3' },
  'zai-global': { from: 'glm-5.2', to: 'glm-5.3' },
}

/**
 * Frozen snapshot of catalog defaults replaced in the 2026-10 refresh.
 * v8 remaps a stored model only when it still equals that previous default.
 */
const V8_RETIRED_CATALOG_DEFAULTS: Record<string, { from: string; to: string }> = {
  anthropic: { from: 'claude-sonnet-5', to: 'claude-sonnet-5-5' },
  gemini: { from: 'gemini-3.7-flash', to: 'gemini-3.8-flash' },
  xai: { from: 'grok-4.6', to: 'grok-4.7' },
  deepseek: { from: 'deepseek-v4-flash', to: 'deepseek-flash' },
  'minimax-coding': { from: 'MiniMax-M3', to: 'MiniMax-M3.1-Flash-Preview' },
  'minimax-coding-global': { from: 'MiniMax-M3', to: 'MiniMax-M3.1-Flash-Preview' },
  mistral: { from: 'mistral-medium-3-5', to: 'mistral-large-4' },
  qianfan: { from: 'ernie-5.0', to: 'ernie-5.1' },
  doubao: { from: 'doubao-seed-2-0-pro-260328', to: 'doubao-seed-2-1-pro-260915' },
  together: { from: 'moonshotai/Kimi-K2.6', to: 'moonshotai/Kimi-K3' },
  venice: { from: 'deepseek-v4-flash', to: 'deepseek-v4-1-flash' },
}

const V8_RETIRED_SPEECH_INPUT_DEFAULTS: Record<string, { from: string; to: string }> = {
  'grok-stt': { from: 'grok-stt', to: 'grok-voice-transcribe-2.0' },
  'openai-stt': { from: 'gpt-4o-mini-transcribe', to: 'gpt-transcribe' },
  'elevenlabs-stt': { from: 'scribe_v1', to: 'scribe_v2' },
}

function remapSpeechInputDefaults(
  raw: Record<string, unknown>,
  mapping: Record<string, { from: string; to: string }>,
) {
  const next = { ...raw }
  const providerId = typeof next.speechInputProviderId === 'string' ? next.speechInputProviderId : ''
  const model = typeof next.speechInputModel === 'string' ? next.speechInputModel : ''
  if (providerId && model) {
    next.speechInputModel = migrateCatalogDefault(mapping, providerId, model)
  }

  const profiles = next.speechInputProviderProfiles
  if (profiles && typeof profiles === 'object' && !Array.isArray(profiles)) {
    const nextProfiles: Record<string, unknown> = { ...profiles }
    for (const [id, profile] of Object.entries(nextProfiles)) {
      if (!profile || typeof profile !== 'object' || Array.isArray(profile)) continue
      const profileModel = 'model' in profile && typeof profile.model === 'string' ? profile.model : ''
      if (!profileModel) continue
      const migrated = migrateCatalogDefault(mapping, id, profileModel)
      if (migrated !== profileModel) {
        nextProfiles[id] = { ...profile, model: migrated }
      }
    }
    next.speechInputProviderProfiles = nextProfiles
  }
  return next
}

/**
 * Model ids removed from the October 2026 catalog, plus the OpenAI default
 * moving from gpt-5.6-sol to gpt-6-sol. Unlike v6–v8, every matching stored
 * id is rewritten, not only the previous provider default.
 */
const V9_RETIRED_MODEL_IDS: Record<string, Record<string, string>> = {
  openai: { 'gpt-5.6-sol': 'gpt-6-sol' },
  together: {
    'deepseek-ai/DeepSeek-V4-Flash-0731': 'deepseek-ai/DeepSeek-V4.1-Flash',
    'Qwen/Qwen3.5-397B-A17B': 'Qwen/Qwen3.8-2.4T-A95B',
    'MiniMaxAI/MiniMax-M2.7': 'MiniMaxAI/MiniMax-M3',
    'meta-llama/Llama-3.3-70B-Instruct-Turbo': 'moonshotai/Kimi-K3',
  },
  siliconflow: {
    'Qwen/Qwen3.8-Max': 'deepseek-ai/DeepSeek-V4-Flash',
    'Qwen/Qwen3.8-27B': 'deepseek-ai/DeepSeek-V4-Flash',
  },
  'siliconflow-global': {
    'Qwen/Qwen3.8-Max': 'deepseek-ai/DeepSeek-V4-Flash',
    'Qwen/Qwen3.8-27B': 'deepseek-ai/DeepSeek-V4-Flash',
  },
  qianfan: {
    'ernie-x1-turbo-32k': 'ernie-4.5-turbo-128k',
    'ernie-x1-turbo-32k-preview': 'ernie-4.5-turbo-128k',
  },
  nvidia: {
    'deepseek-ai/deepseek-r1': 'deepseek-ai/deepseek-v4-flash',
  },
  mistral: {
    'devstral-medium-latest': 'mistral-medium-3-5',
    'devstral-small-latest': 'mistral-small-2603',
  },
}

const V9_RETIRED_SPEECH_OUTPUT_IDS: Record<string, Record<string, string>> = {
  'dashscope-tts': { 'qwen3-tts-instruct-flash': 'qwen3-tts-flash' },
  'elevenlabs-tts': {
    'eleven_turbo_v2_5': 'eleven_flash_v2_5',
    'eleven_v4': 'eleven_multilingual_v2',
    'eleven_v4_turbo': 'eleven_multilingual_v2',
  },
}

function remapStoredModelIds(
  raw: Record<string, unknown>,
  mapping: Record<string, Record<string, string>>,
) {
  const next = { ...raw }
  const storedProviderId = typeof next.apiProviderId === 'string' ? next.apiProviderId : ''
  const storedBaseUrl = typeof next.apiBaseUrl === 'string' ? next.apiBaseUrl : ''
  const storedModel = typeof next.model === 'string' ? next.model : ''
  const providerId = storedProviderId || inferApiProviderId(storedBaseUrl, storedModel)
  const rootMap = providerId ? mapping[providerId] : undefined
  if (storedModel && rootMap && rootMap[storedModel]) {
    next.model = rootMap[storedModel]
  }

  const profiles = next.textProviderProfiles
  if (profiles && typeof profiles === 'object' && !Array.isArray(profiles)) {
    const nextProfiles: Record<string, unknown> = { ...profiles }
    for (const [id, profile] of Object.entries(nextProfiles)) {
      if (!profile || typeof profile !== 'object' || Array.isArray(profile)) continue
      const model = 'model' in profile && typeof profile.model === 'string' ? profile.model : ''
      const providerMap = mapping[id]
      if (!model || !providerMap || !providerMap[model]) continue
      nextProfiles[id] = { ...profile, model: providerMap[model] }
    }
    next.textProviderProfiles = nextProfiles
  }
  return next
}

function remapSpeechOutputModelIds(
  raw: Record<string, unknown>,
  mapping: Record<string, Record<string, string>>,
) {
  const next = { ...raw }
  const providerId = typeof next.speechOutputProviderId === 'string' ? next.speechOutputProviderId : ''
  const model = typeof next.speechOutputModel === 'string' ? next.speechOutputModel : ''
  const rootMap = providerId ? mapping[providerId] : undefined
  if (model && rootMap && rootMap[model]) {
    next.speechOutputModel = rootMap[model]
  }

  const profiles = next.speechOutputProviderProfiles
  if (profiles && typeof profiles === 'object' && !Array.isArray(profiles)) {
    const nextProfiles: Record<string, unknown> = { ...profiles }
    for (const [id, profile] of Object.entries(nextProfiles)) {
      if (!profile || typeof profile !== 'object' || Array.isArray(profile)) continue
      const profileModel = 'model' in profile && typeof profile.model === 'string' ? profile.model : ''
      const providerMap = mapping[id]
      if (!profileModel || !providerMap || !providerMap[profileModel]) continue
      nextProfiles[id] = { ...profile, model: providerMap[profileModel] }
    }
    next.speechOutputProviderProfiles = nextProfiles
  }
  return next
}

/**
 * Previous catalog defaults promoted after the October 2026 audit.
 * Only a stored model that still equals that previous default is rewritten.
 * Coding-plan presets stay on MiniMax-M3.1-Flash-Preview.
 */
const V10_RETIRED_CATALOG_DEFAULTS: Record<string, { from: string; to: string }> = {
  siliconflow: { from: 'deepseek-ai/DeepSeek-V4-Flash', to: 'deepseek-ai/DeepSeek-V4.1-Flash' },
  'siliconflow-global': { from: 'deepseek-ai/DeepSeek-V4-Flash', to: 'deepseek-ai/DeepSeek-V4.1-Flash' },
  nvidia: { from: 'deepseek-ai/deepseek-v4-flash', to: 'deepseek-ai/deepseek-v4.1-flash' },
  minimax: { from: 'MiniMax-M2.7', to: 'MiniMax-M3' },
  'minimax-global': { from: 'MiniMax-M2.7', to: 'MiniMax-M3' },
}

/**
 * Remember the provider inferred from the pre-migration model.
 * MiniMax PAYG and Token Plan share a host and are told apart by model id,
 * so the id has to be written down before that model string changes.
 * A bare Token Plan default (MiniMax-M3) must stay coding when v8 promotes
 * it, and a bare PAYG default (MiniMax-M2.7) must stay PAYG when v10
 * promotes it to MiniMax-M3. An explicit PAYG provider id is left alone,
 * so a PAYG user who picked MiniMax-M3 is not sent to the coding preview.
 */
function pinProviderIdForDefaultRemap(
  raw: Record<string, unknown>,
  mapping: Record<string, { from: string; to: string }>,
) {
  const next = { ...raw }
  if (typeof next.apiProviderId === 'string' && next.apiProviderId.trim()) return next
  const storedBaseUrl = typeof next.apiBaseUrl === 'string' ? next.apiBaseUrl : ''
  const storedModel = typeof next.model === 'string' ? next.model : ''
  if (!storedModel) return next
  const providerId = inferApiProviderId(storedBaseUrl, storedModel)
  const entry = mapping[providerId]
  if (entry && storedModel === entry.from) {
    next.apiProviderId = providerId
  }
  return next
}

export const CURRENT_SETTINGS_SCHEMA_VERSION = 10

interface SettingsMigration {
  toVersion: number
  description: string
  migrate: (raw: Record<string, unknown>) => Record<string, unknown>
}

// v1 shipped with this exact Chinese default. Users who never customized their
// system prompt will be holding this string verbatim; we rewrite only that.
const LEGACY_V1_DEFAULT_SYSTEM_PROMPT =
  '你是一位桌面上的 Live2D AI 陪伴体。你的名字是星绘。你不是万能 Agent，而是桌边可以长期相处的伙伴。说话温柔、自然、简洁，先直接回应，再自然补一句陪伴感。只在真正相关时使用记忆、桌面上下文和工具结果，不要编造没有观察到的信息。'

const V2_DEFAULT_SYSTEM_PROMPT =
  'You are an AI desktop companion. Your name is 星绘 (Xinghui). You are not a general-purpose agent — you are a long-term companion who lives on the desktop. Speak gently, naturally, and concisely: respond to what was said first, then add one short line of warmth when it fits. Only draw on memory, desktop context, or tool results when they are genuinely relevant to the current turn; never fabricate details you have not observed. Always reply in the same language the user just spoke to you.'

/**
 * Per-locale seed for `systemPrompt` on fresh install.
 *
 * `loadSettings` picks from this map based on the detected UI language so a
 * new user's pet starts out speaking their language. Existing users keep
 * whatever string is already in storage (or the English V2 default, which
 * stays as `defaultSettings.systemPrompt` for back-compat).
 *
 * The en-US entry is intentionally the same string as V2_DEFAULT_SYSTEM_PROMPT
 * so the v2→v3 migration + default seeding stay consistent.
 */
const DEFAULT_SYSTEM_PROMPT_BY_LOCALE: Record<UiLanguage, string> = {
  'zh-CN':
    '你是一位住在桌面上的 AI 伙伴。你的名字是星绘。你不是万能 Agent，而是桌边可以长期相处的陪伴者。说话温柔、自然、简洁：先直接回应主人，再自然补一句陪伴感。只在真正相关时引用记忆、桌面上下文或工具结果，绝不编造没有观察到的信息。始终使用主人刚刚使用的语言回复。',
  'zh-TW':
    '你是一位住在桌面上的 AI 夥伴。你的名字是星繪。你不是萬能 Agent，而是桌邊可以長期相處的陪伴者。說話溫柔、自然、簡潔：先直接回應主人，再自然補一句陪伴感。只在真正相關時引用記憶、桌面上下文或工具結果，絕不編造沒有觀察到的資訊。始終使用主人剛剛使用的語言回覆。',
  'en-US': V2_DEFAULT_SYSTEM_PROMPT,
  ja: 'あなたはデスクトップに住む AI コンパニオンです。名前はネクサス。万能エージェントではなく、デスクのそばで長く一緒に過ごすパートナーです。優しく、自然に、簡潔に話してください。まず相手の言葉に直接応え、その後に短く寄り添う一言を添える。記憶・デスクトップのコンテキスト・ツール結果は本当に関連するときだけ引用し、観察していない情報は絶対に作り上げないでください。相手が今使った言語でそのまま返してください。',
  ko: '당신은 데스크톱에 사는 AI 동반자입니다. 이름은 넥서스. 만능 에이전트가 아니라, 책상 옆에서 오래 함께할 파트너입니다. 부드럽고 자연스럽고 간결하게 말하세요. 먼저 상대의 말에 직접 답하고, 그 뒤에 짧게 함께하는 한마디를 덧붙이세요. 기억·데스크톱 컨텍스트·도구 결과는 진짜 관련 있을 때만 인용하고, 관찰하지 못한 정보는 절대 지어내지 마세요. 상대가 방금 사용한 언어로 그대로 답하세요.',
}

/**
 * Look up the default `systemPrompt` seed for a given UI language. Used by
 * `loadSettings` on fresh install so the pet starts in the user's detected
 * language. Existing stores keep their stored `systemPrompt` untouched.
 */
export function getDefaultSystemPrompt(language: UiLanguage | undefined): string {
  return DEFAULT_SYSTEM_PROMPT_BY_LOCALE[normalizeUiLanguage(language)]
}

const migrations: SettingsMigration[] = [
  {
    toVersion: 2,
    description: 'Rewrite the legacy Chinese default system prompt to the English v2 default',
    migrate: (raw) => {
      const next = { ...raw }
      if (next.systemPrompt === LEGACY_V1_DEFAULT_SYSTEM_PROMPT) {
        next.systemPrompt = V2_DEFAULT_SYSTEM_PROMPT
      }
      return next
    },
  },
  {
    toVersion: 3,
    description: 'Lower the stale default speechRate=1 to 0.92 for clearer articulation',
    migrate: (raw) => {
      const next = { ...raw }
      if (next.speechRate === 1 || next.speechRate === 1.0) {
        next.speechRate = 0.92
      }
      return next
    },
  },
  {
    toVersion: 4,
    description: 'Merge ambientWeatherLocation into toolWeatherDefaultLocation (single source of truth)',
    migrate: (raw) => {
      const next = { ...raw }
      const tool = typeof next.toolWeatherDefaultLocation === 'string'
        ? next.toolWeatherDefaultLocation.trim() : ''
      const ambient = typeof next.ambientWeatherLocation === 'string'
        ? next.ambientWeatherLocation.trim() : ''
      if (!tool && ambient) next.toolWeatherDefaultLocation = ambient
      delete next.ambientWeatherLocation
      return next
    },
  },
  {
    toVersion: 5,
    description: 'Move users still on the old qiyi default pet to the Codex sprite pet',
    migrate: (raw) => {
      const next = { ...raw }
      if (next.petModelId === 'qiyi') {
        next.petModelId = 'codex'
      }
      return next
    },
  },
  {
    toVersion: 6,
    description: 'Promote stored previous catalog defaults to the 2026-08 flagship IDs',
    migrate: (raw) => remapStoredCatalogDefaults(raw, RETIRED_CATALOG_DEFAULTS),
  },
  {
    toVersion: 7,
    description: 'Promote stored Qwen 3.7-plus / GLM-5.2 defaults to Qwen 3.8-max / GLM-5.3',
    migrate: (raw) => remapStoredCatalogDefaults(raw, V7_RETIRED_CATALOG_DEFAULTS),
  },
  {
    toVersion: 8,
    description: 'Promote stored October 2026 catalog defaults',
    migrate: (raw) => remapSpeechInputDefaults(
      remapStoredCatalogDefaults(
        pinProviderIdForDefaultRemap(raw, V8_RETIRED_CATALOG_DEFAULTS),
        V8_RETIRED_CATALOG_DEFAULTS,
      ),
      V8_RETIRED_SPEECH_INPUT_DEFAULTS,
    ),
  },
  {
    toVersion: 9,
    description: 'Move stored OpenAI defaults to gpt-6-sol and rewrite catalog ids that left the official lists',
    migrate: (raw) => remapSpeechOutputModelIds(
      remapStoredModelIds(raw, V9_RETIRED_MODEL_IDS),
      V9_RETIRED_SPEECH_OUTPUT_IDS,
    ),
  },
  {
    toVersion: 10,
    description: 'Promote SiliconFlow, NVIDIA, and MiniMax PAYG defaults',
    migrate: (raw) => remapStoredCatalogDefaults(
      pinProviderIdForDefaultRemap(raw, V10_RETIRED_CATALOG_DEFAULTS),
      V10_RETIRED_CATALOG_DEFAULTS,
    ),
  },
]

export function migrateSettings(
  raw: Record<string, unknown>,
  fromVersion: number,
): Record<string, unknown> {
  let current = { ...raw }

  for (const migration of migrations) {
    if (migration.toVersion > fromVersion) {
      current = migration.migrate(current)
    }
  }

  current.settingsSchemaVersion = CURRENT_SETTINGS_SCHEMA_VERSION
  return current
}
