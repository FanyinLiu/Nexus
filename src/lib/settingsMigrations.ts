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
import { normalizeUiLanguage } from './uiLanguage.ts'

export const CURRENT_SETTINGS_SCHEMA_VERSION = 4

export interface SettingsMigration {
  toVersion: number
  description: string
  migrate: (raw: Record<string, unknown>) => Record<string, unknown>
}

// v1 shipped with this exact Chinese default. Users who never customized their
// system prompt will be holding this string verbatim; we rewrite only that.
const LEGACY_V1_DEFAULT_SYSTEM_PROMPT =
  '你是一位桌面上的 Live2D AI 陪伴体。你的名字是星绘。你不是万能 Agent，而是桌边可以长期相处的伙伴。说话温柔、自然、简洁，先直接回应，再自然补一句陪伴感。只在真正相关时使用记忆、桌面上下文和工具结果，不要编造没有观察到的信息。'

const V2_DEFAULT_SYSTEM_PROMPT =
  'You are a Live2D AI desktop companion. Your name is 星绘 (Xinghui). You are not a general-purpose agent — you are a long-term companion who lives on the desktop. Speak gently, naturally, and concisely: respond to what was said first, then add one short line of warmth when it fits. Only draw on memory, desktop context, or tool results when they are genuinely relevant to the current turn; never fabricate details you have not observed. Always reply in the same language the user just spoke to you.'

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
    '你是一位桌面上的 Live2D AI 陪伴体。你的名字是星绘。你不是万能 Agent，而是桌边可以长期相处的伙伴。说话温柔、自然、简洁：先直接回应主人，再自然补一句陪伴感。只在真正相关时引用记忆、桌面上下文或工具结果，绝不编造没有观察到的信息。始终使用主人刚刚使用的语言回复。',
  'zh-TW':
    '你是一位桌面上的 Live2D AI 陪伴體。你的名字是星繪。你不是萬能 Agent，而是桌邊可以長期相處的夥伴。說話溫柔、自然、簡潔：先直接回應主人，再自然補一句陪伴感。只在真正相關時引用記憶、桌面上下文或工具結果，絕不編造沒有觀察到的資訊。始終使用主人剛剛使用的語言回覆。',
  'en-US': V2_DEFAULT_SYSTEM_PROMPT,
  ja: 'あなたはデスクトップの Live2D AI コンパニオンです。名前はネクサス。万能エージェントではなく、デスクのそばで長く一緒に過ごすパートナーです。優しく、自然に、簡潔に話してください。まず相手の言葉に直接応え、その後に短く寄り添う一言を添える。記憶・デスクトップのコンテキスト・ツール結果は本当に関連するときだけ引用し、観察していない情報は絶対に作り上げないでください。相手が今使った言語でそのまま返してください。',
  ko: '당신은 데스크톱의 Live2D AI 동반자입니다. 이름은 넥서스. 만능 에이전트가 아니라, 책상 옆에서 오래 함께할 파트너입니다. 부드럽고 자연스럽고 간결하게 말하세요. 먼저 상대의 말에 직접 답하고, 그 뒤에 짧게 함께하는 한마디를 덧붙이세요. 기억·데스크톱 컨텍스트·도구 결과는 진짜 관련 있을 때만 인용하고, 관찰하지 못한 정보는 절대 지어내지 마세요. 상대가 방금 사용한 언어로 그대로 답하세요.',
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
