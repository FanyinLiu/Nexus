import {
  pickTranslatedUiText,
} from '../lib/uiLanguage.ts'
import {
  resolveTheme,
} from '../features/themes/registry.ts'
import type { TranslationKey } from '../types/i18n.ts'
import type { ThemeId } from '../types/theme.ts'
import type {
  DebugConsoleEvent,
  ConnectionEvidence,
  DiscoveredModel,
  MemorySearchMode,
  ReminderTask,
  UiLanguage,
  VoicePipelineState,
  VoiceState,
  VoiceTriggerMode,
} from '../types/index.ts'
import type { ConnectionPreflightRepair } from '../features/models/connectionPreflight.ts'

const VOICE_STATE_KEY: Record<VoiceState, TranslationKey> = {
  idle: 'voice_state.idle',
  listening: 'voice_state.listening',
  processing: 'voice_state.processing',
  speaking: 'voice_state.speaking',
}

const DEBUG_EVENT_SOURCE_KEY: Record<DebugConsoleEvent['source'], TranslationKey> = {
  voice: 'debug_event.voice',
  reminder: 'debug_event.reminder',
  scheduler: 'debug_event.scheduler',
  tool: 'debug_event.tool',
  system: 'debug_event.system',
  autonomy: 'debug_event.autonomy',
}

const VOICE_PIPELINE_STEP_KEY: Record<VoicePipelineState['step'], TranslationKey> = {
  idle: 'voice_pipeline.idle',
  listening: 'voice_pipeline.listening',
  transcribing: 'voice_pipeline.transcribing',
  recognized: 'voice_pipeline.recognized',
  sending: 'voice_pipeline.sending',
  manual_confirm: 'voice_pipeline.manual_confirm',
  blocked_busy: 'voice_pipeline.blocked_busy',
  blocked_wake_word: 'voice_pipeline.blocked_wake_word',
  reply_received: 'voice_pipeline.reply_received',
  reply_failed: 'voice_pipeline.reply_failed',
}

const VOICE_TRIGGER_MODE_KEYS: Record<VoiceTriggerMode, { label: TranslationKey; hint: TranslationKey }> = {
  direct_send: { label: 'voice_trigger.direct_send.label', hint: 'voice_trigger.direct_send.hint' },
  wake_word: { label: 'voice_trigger.wake_word.label', hint: 'voice_trigger.wake_word.hint' },
  manual_confirm: { label: 'voice_trigger.manual_confirm.label', hint: 'voice_trigger.manual_confirm.hint' },
}

const MEMORY_SEARCH_MODE_KEYS: Record<MemorySearchMode, { label: TranslationKey; hint: TranslationKey }> = {
  keyword: { label: 'memory_search.keyword.label', hint: 'memory_search.keyword.hint' },
  hybrid: { label: 'memory_search.hybrid.label', hint: 'memory_search.hybrid.hint' },
  vector: { label: 'memory_search.vector.label', hint: 'memory_search.vector.hint' },
}

export type SettingsAppearanceTone = 'black' | 'night' | 'day' | 'warm-day'

const THEME_TONE_BY_ID: Record<ThemeId, SettingsAppearanceTone> = {
  'nexus-default': 'day',
  soft: 'day',
  'high-contrast': 'day',
  editorial: 'day',
  'system-day': 'day',
  'warm-day': 'warm-day',
  'system-black': 'black',
  'system-dark': 'night',
}

function buildAppearanceOption(
  id: ThemeId,
  labelKey: TranslationKey,
  tone: SettingsAppearanceTone,
) {
  const theme = resolveTheme(id)
  return {
    id,
    labelKey,
    tone,
    swatch: {
      surface: theme.tokens.surfaceElevated,
      accent: theme.tokens.accent,
    },
  }
}

export const SETTINGS_APPEARANCE_OPTIONS = [
  buildAppearanceOption('system-black', 'settings.appearance.black', 'black'),
  buildAppearanceOption('system-dark', 'settings.appearance.night', 'night'),
  buildAppearanceOption('system-day', 'settings.appearance.day', 'day'),
  buildAppearanceOption('warm-day', 'settings.appearance.warm_day', 'warm-day'),
]

export function getSettingsThemeTone(themeId: ThemeId): SettingsAppearanceTone {
  return THEME_TONE_BY_ID[themeId] ?? 'night'
}

export function parseNumberInput(value: string, fallback: number) {
  if (value.trim() === '') return fallback

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min
  }

  return Math.min(max, Math.max(min, value))
}

export function formatTtsAdjustmentValue(kind: 'rate' | 'pitch' | 'volume', value: number) {
  if (kind === 'volume') {
    return `${Math.round(clampNumber(value, 0, 1) * 100)}%`
  }

  return `${clampNumber(value, 0.5, 2).toFixed(2)}x`
}

function toDatetimeLocalValue(value: string | null | undefined) {
  const timestamp = Date.parse(String(value ?? ''))
  if (Number.isNaN(timestamp)) {
    return ''
  }

  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')

  return `${year}-${month}-${day}T${hours}:${minutes}`
}

function resolveUiLocale(uiLanguage: UiLanguage) {
  switch (uiLanguage) {
    case 'en-US':
      return 'en-US'
    case 'zh-TW':
      return 'zh-TW'
    case 'ja':
      return 'ja-JP'
    case 'ko':
      return 'ko-KR'
    case 'zh-CN':
    default:
      return 'zh-CN'
  }
}

export function formatReminderCenterNextLabel(value: string | undefined, uiLanguage: UiLanguage = 'zh-CN') {
  if (!value) {
    return pickTranslatedUiText(uiLanguage, 'common.none')
  }

  const localValue = toDatetimeLocalValue(value)
  return localValue ? localValue.replace('T', ' ') : pickTranslatedUiText(uiLanguage, 'common.none')
}

export function formatReminderActionSummary(task: ReminderTask, uiLanguage: UiLanguage = 'zh-CN') {
  if (task.action.kind === 'weather') {
    return task.action.location
      ? pickTranslatedUiText(uiLanguage, 'reminder_action.weather_with_location', { location: task.action.location })
      : pickTranslatedUiText(uiLanguage, 'reminder_action.weather_default')
  }

  if (task.action.kind === 'web_search') {
    return pickTranslatedUiText(uiLanguage, 'reminder_action.web_search_with_query', { query: task.action.query })
  }

  return pickTranslatedUiText(uiLanguage, 'reminder_action.notice')
}

export function formatConsoleTimestamp(value: string | undefined, uiLanguage: UiLanguage = 'zh-CN') {
  const timestamp = Date.parse(value ?? '')
  if (Number.isNaN(timestamp)) {
    return pickTranslatedUiText(uiLanguage, 'common.none')
  }

  return new Intl.DateTimeFormat(resolveUiLocale(uiLanguage), {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestamp))
}

export function formatVoiceStateLabel(value: VoiceState, uiLanguage: UiLanguage = 'zh-CN') {
  return pickTranslatedUiText(uiLanguage, VOICE_STATE_KEY[value])
}

export function formatDebugEventSourceLabel(
  source: DebugConsoleEvent['source'],
  uiLanguage: UiLanguage = 'zh-CN',
) {
  return pickTranslatedUiText(uiLanguage, DEBUG_EVENT_SOURCE_KEY[source])
}

export function formatVoicePipelineStepLabel(
  step: VoicePipelineState['step'],
  uiLanguage: UiLanguage = 'zh-CN',
) {
  return pickTranslatedUiText(uiLanguage, VOICE_PIPELINE_STEP_KEY[step])
}

type ConsoleEventCluster = {
  id: string
  source: DebugConsoleEvent['source']
  tone: DebugConsoleEvent['tone']
  title: string
  detail: string
  createdAt: string
  count: number
}

export function buildConsoleEventClusters(events: DebugConsoleEvent[]) {
  const clusters: Array<ConsoleEventCluster & { groupKey: string }> = []

  for (const event of events) {
    const groupKey = event.relatedTaskId
      ? `${event.source}:${event.relatedTaskId}`
      : event.source
    const lastCluster = clusters[clusters.length - 1]
    const eventTime = Date.parse(event.createdAt)
    const lastClusterTime = Date.parse(lastCluster?.createdAt ?? '')
    const canMerge = (
      lastCluster
      && lastCluster.groupKey === groupKey
      && Number.isFinite(eventTime)
      && Number.isFinite(lastClusterTime)
      && Math.abs(lastClusterTime - eventTime) <= 90_000
    )

    if (canMerge) {
      lastCluster.count += 1
      continue
    }

    clusters.push({
      id: event.id,
      groupKey,
      source: event.source,
      tone: event.tone,
      title: event.title,
      detail: event.detail,
      createdAt: event.createdAt,
      count: 1,
    })
  }

  return clusters
}

export type ConnectionResult = {
  ok: boolean
  message: string
  messageKey?: string
  messageParams?: Record<string, string | number | boolean | null | undefined>
  recommendation?: string
  recommendationKey?: string
  status?: import('../types/model').ProviderHealthStatus
  code?: import('../types/model').ModelConnectionErrorCode
  repair?: ConnectionPreflightRepair
  discoveredModels?: DiscoveredModel[]
  checkedAt?: string
  evidence?: ConnectionEvidence
}

const SETTINGS_SECTION_IDS = [
  'console',
  'model',
  'chat',
  'history',
  'letters',
  'memory',
  'lorebooks',
  'voice',
  'window',
  'integrations',
  'tools',
  'autonomy',
] as const

export type SettingsSectionId = typeof SETTINGS_SECTION_IDS[number]

export function isSettingsSectionId(value: string | null | undefined): value is SettingsSectionId {
  return SETTINGS_SECTION_IDS.includes(value as SettingsSectionId)
}

export type SettingsSectionOptionGroupId =
  | 'appearanceExperience'
  | 'companionBehavior'
  | 'maintenance'
  | 'memoryContext'
  | 'modelConnections'

type SettingsSectionLabelKey = Parameters<typeof pickTranslatedUiText>[1]

export const SETTINGS_SECTION_OPTION_DEFINITIONS = [
  { id: 'model', groupId: 'modelConnections', labelKey: 'settings.section.model' },
  { id: 'window', groupId: 'companionBehavior', labelKey: 'settings.section.window' },
  { id: 'chat', groupId: 'appearanceExperience', labelKey: 'settings.section.chat' },
  { id: 'console', groupId: 'maintenance', labelKey: 'settings.section.console' },
  { id: 'history', groupId: 'maintenance', labelKey: 'settings.section.history' },
  { id: 'letters', groupId: 'appearanceExperience', labelKey: 'settings.section.letters' },
  { id: 'voice', groupId: 'companionBehavior', labelKey: 'settings.section.voice' },
  { id: 'memory', groupId: 'memoryContext', labelKey: 'settings.section.memory' },
  { id: 'lorebooks', groupId: 'memoryContext', labelKey: 'settings.lorebooks.title' },
  { id: 'integrations', groupId: 'modelConnections', labelKey: 'settings.section_eyebrow.integrations' },
  { id: 'autonomy', groupId: 'companionBehavior', labelKey: 'settings.section.autonomy' },
  { id: 'tools', groupId: 'modelConnections', labelKey: 'settings.section.tools' },
] as const satisfies ReadonlyArray<{
  groupId: SettingsSectionOptionGroupId
  id: SettingsSectionId
  labelKey: SettingsSectionLabelKey
}>

export type VolcengineCredentialParts = {
  appId: string
  accessToken: string
}

export function getSettingsSectionOptions(uiLanguage: UiLanguage): Array<{
  groupId: SettingsSectionOptionGroupId
  id: SettingsSectionId
  label: string
}> {
  return SETTINGS_SECTION_OPTION_DEFINITIONS.map((section) => ({
    groupId: section.groupId,
    id: section.id,
    label: pickTranslatedUiText(uiLanguage, section.labelKey),
  }))
}

export function normalizeSettingsSectionId(sectionId: SettingsSectionId): SettingsSectionId {
  return sectionId
}

export function parseVolcengineCredentialParts(value: string): VolcengineCredentialParts {
  const normalized = String(value ?? '').trim()
  if (!normalized) {
    return {
      appId: '',
      accessToken: '',
    }
  }

  const directMatch = normalized.match(/^\s*([0-9]{6,})\s*[:：|]\s*(.+?)\s*$/s)
  if (directMatch) {
    return {
      appId: directMatch[1].trim(),
      accessToken: directMatch[2].trim(),
    }
  }

  const appIdMatch = normalized.match(/(?:app[\s_-]*id|appid)\s*[:：]\s*([0-9]{6,})/i)
  const accessTokenMatch = normalized.match(/(?:access[\s_-]*token|token)\s*[:：]\s*([A-Za-z0-9._\-+/=]+)/i)

  return {
    appId: appIdMatch?.[1]?.trim() ?? '',
    accessToken: accessTokenMatch?.[1]?.trim() ?? (!appIdMatch ? normalized : ''),
  }
}

export function buildVolcengineCredential(parts: VolcengineCredentialParts) {
  const appId = parts.appId.trim()
  const accessToken = parts.accessToken.trim()

  if (!appId && !accessToken) return ''
  if (!appId) return accessToken
  if (!accessToken) return appId

  return `${appId}:${accessToken}`
}

export function getVoiceTriggerModeOptions(uiLanguage: UiLanguage): Array<{
  value: VoiceTriggerMode
  label: string
  hint: string
}> {
  return (['direct_send', 'wake_word', 'manual_confirm'] as VoiceTriggerMode[]).map((value) => ({
    value,
    label: pickTranslatedUiText(uiLanguage, VOICE_TRIGGER_MODE_KEYS[value].label),
    hint: pickTranslatedUiText(uiLanguage, VOICE_TRIGGER_MODE_KEYS[value].hint),
  }))
}

export function getMemorySearchModeOptions(uiLanguage: UiLanguage): Array<{
  value: MemorySearchMode
  label: string
  hint: string
}> {
  return (['keyword', 'hybrid', 'vector'] as MemorySearchMode[]).map((value) => ({
    value,
    label: pickTranslatedUiText(uiLanguage, MEMORY_SEARCH_MODE_KEYS[value].label),
    hint: pickTranslatedUiText(uiLanguage, MEMORY_SEARCH_MODE_KEYS[value].hint),
  }))
}
