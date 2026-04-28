import {
  type ReminderTaskDraftInput,
} from '../features/reminders/schedule'
import {
  pickTranslatedUiText,
} from '../lib/uiLanguage'
import type { TranslationKey } from '../types/i18n'
import type {
  DebugConsoleEvent,
  MemorySearchMode,
  ReminderTaskAction,
  ReminderTask,
  ReminderScheduleKind,
  UiLanguage,
  VoicePipelineState,
  VoiceState,
  VoiceTriggerMode,
} from '../types'

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

const REMINDER_SCHEDULE_OPTION_KEY: Record<Exclude<ReminderScheduleKind, 'cron'>, TranslationKey> = {
  at: 'reminder_schedule.at',
  every: 'reminder_schedule.every',
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

export function toDatetimeLocalValue(value: string | null | undefined) {
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

export function fromDatetimeLocalValue(value: string) {
  const normalized = value.trim()
  if (!normalized) {
    return ''
  }

  const timestamp = Date.parse(normalized)
  return Number.isNaN(timestamp) ? '' : new Date(timestamp).toISOString()
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

export type ConsoleEventCluster = {
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
}

type LabeledOption<T> = {
  value: T
  label: string
}

export function getReminderScheduleOptions(uiLanguage: UiLanguage): Array<LabeledOption<ReminderScheduleKind>> {
  return [
    { value: 'at', label: pickTranslatedUiText(uiLanguage, REMINDER_SCHEDULE_OPTION_KEY.at) },
    { value: 'every', label: pickTranslatedUiText(uiLanguage, REMINDER_SCHEDULE_OPTION_KEY.every) },
    { value: 'cron', label: 'Cron' },
  ]
}

export function getReminderTemplatePresets(uiLanguage: UiLanguage): Array<{
  id: string
  label: string
  hint: string
  buildDraft: (now: Date) => ReminderTaskDraftInput
}> {
  const ti = (key: TranslationKey) => pickTranslatedUiText(uiLanguage, key)

  return [
    {
      id: 'hydrate',
      label: ti('reminder_template.hydrate.label'),
      hint: ti('reminder_template.hydrate.hint'),
      buildDraft: (now) => ({
        title: ti('reminder_template.hydrate.title'),
        prompt: ti('reminder_template.hydrate.prompt'),
        speechText: ti('reminder_template.hydrate.speech'),
        action: { kind: 'notice' },
        enabled: true,
        schedule: {
          kind: 'every',
          everyMinutes: 60,
          anchorAt: now.toISOString(),
        },
      }),
    },
    {
      id: 'focus-break',
      label: ti('reminder_template.focus_break.label'),
      hint: ti('reminder_template.focus_break.hint'),
      buildDraft: (now) => ({
        title: ti('reminder_template.focus_break.title'),
        prompt: ti('reminder_template.focus_break.prompt'),
        speechText: ti('reminder_template.focus_break.speech'),
        action: { kind: 'notice' },
        enabled: true,
        schedule: {
          kind: 'every',
          everyMinutes: 50,
          anchorAt: now.toISOString(),
        },
      }),
    },
    {
      id: 'night-wrap',
      label: ti('reminder_template.night_wrap.label'),
      hint: ti('reminder_template.night_wrap.hint'),
      buildDraft: () => ({
        title: ti('reminder_template.night_wrap.title'),
        prompt: ti('reminder_template.night_wrap.prompt'),
        speechText: ti('reminder_template.night_wrap.speech'),
        action: { kind: 'notice' },
        enabled: true,
        schedule: {
          kind: 'cron',
          expression: '0 23 * * *',
        },
      }),
    },
    {
      id: 'weather-brief',
      label: ti('reminder_template.weather_brief.label'),
      hint: ti('reminder_template.weather_brief.hint'),
      buildDraft: () => ({
        title: ti('reminder_template.weather_brief.title'),
        prompt: ti('reminder_template.weather_brief.title'),
        speechText: '',
        action: {
          kind: 'weather',
          location: '',
        },
        enabled: true,
        schedule: {
          kind: 'cron',
          expression: '0 9 * * *',
        },
      }),
    },
    {
      id: 'ai-news',
      label: 'AI News',
      hint: ti('reminder_template.ai_news.hint'),
      buildDraft: () => ({
        title: 'AI News',
        prompt: ti('reminder_template.ai_news.prompt'),
        speechText: '',
        action: {
          // Query stays Chinese because the backend web search expects a
          // Chinese query for this preset; localizing the query itself
          // would change the search behavior for zh users too.
          kind: 'web_search',
          query: 'AI 新闻',
          limit: 5,
        },
        enabled: true,
        schedule: {
          kind: 'cron',
          expression: '0 10 * * *',
        },
      }),
    },
  ]
}

export type ReminderTaskActionKind = ReminderTaskAction['kind']

export type SettingsSectionId =
  | 'console'
  | 'model'
  | 'chat'
  | 'history'
  | 'memory'
  | 'lorebooks'
  | 'letters'
  | 'capsule'
  | 'errands'
  | 'arcs'
  | 'voice'
  | 'window'
  | 'integrations'
  | 'tools'
  | 'autonomy'

const SETTINGS_SECTION_DESCRIPTION_KEY_MAP: Record<SettingsSectionId, Parameters<typeof pickTranslatedUiText>[1]> = {
  console: 'settings.section_desc.console',
  model: 'settings.section_desc.model',
  chat: 'settings.section_desc.chat',
  history: 'settings.section_desc.history',
  memory: 'settings.section_desc.memory',
  // Lorebooks is new in v0.2.7 — reuse the memory key until a dedicated
  // i18n entry lands so existing translations don't fall through to the
  // empty string fallback in pickTranslatedUiText.
  lorebooks: 'settings.section_desc.memory',
  letters: 'settings.section_desc.letters',
  capsule: 'settings.section_desc.capsule',
  errands: 'settings.section_desc.errands',
  arcs: 'settings.section_desc.arcs',
  voice: 'settings.section_desc.voice',
  window: 'settings.section_desc.window',
  integrations: 'settings.section_desc.integrations',
  tools: 'settings.section_desc.tools',
  autonomy: 'settings.section_desc.autonomy',
}

const SETTINGS_SECTION_EYEBROW_KEY_MAP: Record<SettingsSectionId, Parameters<typeof pickTranslatedUiText>[1]> = {
  console: 'settings.section_eyebrow.console',
  model: 'settings.section_eyebrow.model',
  chat: 'settings.section_eyebrow.chat',
  history: 'settings.section_eyebrow.history',
  memory: 'settings.section_eyebrow.memory',
  lorebooks: 'settings.section_eyebrow.memory',
  letters: 'settings.section_eyebrow.memory',
  capsule: 'settings.section_eyebrow.memory',
  errands: 'settings.section_eyebrow.autonomy',
  arcs: 'settings.section_eyebrow.memory',
  voice: 'settings.section_eyebrow.voice',
  window: 'settings.section_eyebrow.window',
  integrations: 'settings.section_eyebrow.integrations',
  tools: 'settings.section_eyebrow.tools',
  autonomy: 'settings.section_eyebrow.autonomy',
}

export type VolcengineCredentialParts = {
  appId: string
  accessToken: string
}

export function getSettingsSectionOptions(uiLanguage: UiLanguage): Array<{
  id: SettingsSectionId
  label: string
}> {
  return [
    { id: 'model', label: pickTranslatedUiText(uiLanguage, 'settings.section.model') },
    { id: 'chat', label: pickTranslatedUiText(uiLanguage, 'settings.section.chat') },
    { id: 'voice', label: pickTranslatedUiText(uiLanguage, 'settings.section.voice') },
    { id: 'memory', label: pickTranslatedUiText(uiLanguage, 'settings.section.memory') },
    { id: 'lorebooks', label: uiLanguage === 'zh-CN' || uiLanguage === 'zh-TW' ? 'Lorebook' : 'Lorebooks' },
    { id: 'letters', label: pickTranslatedUiText(uiLanguage, 'settings.section.letters') },
    { id: 'capsule', label: pickTranslatedUiText(uiLanguage, 'settings.section.capsule') },
    { id: 'errands', label: pickTranslatedUiText(uiLanguage, 'settings.section.errands') },
    { id: 'arcs', label: pickTranslatedUiText(uiLanguage, 'settings.section.arcs') },
    { id: 'window', label: pickTranslatedUiText(uiLanguage, 'settings.section.window') },
    { id: 'tools', label: pickTranslatedUiText(uiLanguage, 'settings.section.tools') },
    { id: 'integrations', label: pickTranslatedUiText(uiLanguage, 'settings.section.integrations') },
    { id: 'history', label: pickTranslatedUiText(uiLanguage, 'settings.section.history') },
    { id: 'autonomy', label: pickTranslatedUiText(uiLanguage, 'settings.section.autonomy') },
    { id: 'console', label: pickTranslatedUiText(uiLanguage, 'settings.section.console') },
  ]
}

export function getSettingsSectionDescription(sectionId: SettingsSectionId, uiLanguage: UiLanguage) {
  return pickTranslatedUiText(uiLanguage, SETTINGS_SECTION_DESCRIPTION_KEY_MAP[sectionId])
}

export function getSettingsSectionEyebrow(sectionId: SettingsSectionId, uiLanguage: UiLanguage) {
  return pickTranslatedUiText(uiLanguage, SETTINGS_SECTION_EYEBROW_KEY_MAP[sectionId])
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
