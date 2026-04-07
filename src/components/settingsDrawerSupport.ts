import {
  type ReminderTaskDraftInput,
} from '../features/reminders/schedule'
import {
  pickTranslatedUiText,
  resolveLocalizedText,
  type LocalizedText,
} from '../lib/uiLanguage'
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

const NONE_COPY: LocalizedText = {
  'zh-CN': '暂无',
  'en-US': 'None',
}

const VOICE_STATE_LABELS: Record<VoiceState, LocalizedText> = {
  idle: {
    'zh-CN': '待命',
    'en-US': 'Idle',
  },
  listening: {
    'zh-CN': '监听中',
    'en-US': 'Listening',
  },
  processing: {
    'zh-CN': '处理中',
    'en-US': 'Processing',
  },
  speaking: {
    'zh-CN': '播报中',
    'en-US': 'Speaking',
  },
}

const DEBUG_EVENT_SOURCE_LABELS: Record<DebugConsoleEvent['source'], LocalizedText> = {
  voice: {
    'zh-CN': '语音链路',
    'en-US': 'Voice',
  },
  reminder: {
    'zh-CN': '本地提醒',
    'en-US': 'Reminder',
  },
  scheduler: {
    'zh-CN': '调度器',
    'en-US': 'Scheduler',
  },
  tool: {
    'zh-CN': '任务执行',
    'en-US': 'Tool',
  },
  system: {
    'zh-CN': '系统',
    'en-US': 'System',
  },
  autonomy: {
    'zh-CN': '自主引擎',
    'en-US': 'Autonomy',
  },
}

const VOICE_PIPELINE_STEP_LABELS: Record<VoicePipelineState['step'], LocalizedText> = {
  idle: {
    'zh-CN': '待命',
    'en-US': 'Idle',
  },
  listening: {
    'zh-CN': '正在听',
    'en-US': 'Listening',
  },
  transcribing: {
    'zh-CN': '转写中',
    'en-US': 'Transcribing',
  },
  recognized: {
    'zh-CN': '已识别',
    'en-US': 'Recognized',
  },
  sending: {
    'zh-CN': '发送中',
    'en-US': 'Sending',
  },
  manual_confirm: {
    'zh-CN': '待确认',
    'en-US': 'Awaiting confirmation',
  },
  blocked_busy: {
    'zh-CN': '繁忙中',
    'en-US': 'Busy',
  },
  blocked_wake_word: {
    'zh-CN': '等待唤醒词',
    'en-US': 'Waiting for wake word',
  },
  reply_received: {
    'zh-CN': '已收到回复',
    'en-US': 'Reply received',
  },
  reply_failed: {
    'zh-CN': '回复失败',
    'en-US': 'Reply failed',
  },
}

const REMINDER_SCHEDULE_OPTION_LABELS: Record<Exclude<ReminderScheduleKind, 'cron'>, LocalizedText> = {
  at: {
    'zh-CN': '一次',
    'en-US': 'One-time',
  },
  every: {
    'zh-CN': '循环',
    'en-US': 'Repeat',
  },
}

const VOICE_TRIGGER_MODE_OPTIONS: Record<VoiceTriggerMode, {
  label: LocalizedText
  hint: LocalizedText
}> = {
  direct_send: {
    label: {
      'zh-CN': '识别后直接发送',
      'en-US': 'Send right after recognition',
    },
    hint: {
      'zh-CN': '识别到完整句子后立刻发送，语音往返延迟最低。',
      'en-US': 'Send the message as soon as a complete sentence is recognized for the lowest latency.',
    },
  },
  wake_word: {
    label: {
      'zh-CN': '命中唤醒词再发送',
      'en-US': 'Send only after wake word',
    },
    hint: {
      'zh-CN': '只有检测到唤醒词时，转写结果才会继续发给模型。',
      'en-US': 'Only transcripts that include a detected wake word will be forwarded to the model.',
    },
  },
  manual_confirm: {
    label: {
      'zh-CN': '只填入输入框',
      'en-US': 'Fill the composer only',
    },
    hint: {
      'zh-CN': '先把识别结果填进输入框，再由你确认是否发送。',
      'en-US': 'Insert the transcript into the composer first, then let you decide whether to send it.',
    },
  },
}

const MEMORY_SEARCH_MODE_OPTIONS: Record<MemorySearchMode, {
  label: LocalizedText
  hint: LocalizedText
}> = {
  keyword: {
    label: {
      'zh-CN': '关键词检索',
      'en-US': 'Keyword search',
    },
    hint: {
      'zh-CN': '基于关键词和近期上下文，速度最快也最稳定。',
      'en-US': 'Uses keywords plus recent context. It is the fastest and most stable mode.',
    },
  },
  hybrid: {
    label: {
      'zh-CN': '混合检索',
      'en-US': 'Hybrid search',
    },
    hint: {
      'zh-CN': '同时结合关键词召回和向量相似度，平衡最好。',
      'en-US': 'Combines keyword recall with embedding similarity for the best balance.',
    },
  },
  vector: {
    label: {
      'zh-CN': '向量检索',
      'en-US': 'Vector search',
    },
    hint: {
      'zh-CN': '更偏向语义相似度，适合回忆表达方式接近的内容。',
      'en-US': 'Prioritizes semantic similarity, which helps recall content with similar meaning.',
    },
  },
}

function translateCopy(uiLanguage: UiLanguage, copy: LocalizedText) {
  return resolveLocalizedText(uiLanguage, copy)
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
    return translateCopy(uiLanguage, NONE_COPY)
  }

  const localValue = toDatetimeLocalValue(value)
  return localValue ? localValue.replace('T', ' ') : translateCopy(uiLanguage, NONE_COPY)
}

export function formatReminderActionSummary(task: ReminderTask, uiLanguage: UiLanguage = 'zh-CN') {
  if (task.action.kind === 'weather') {
    return task.action.location
      ? translateCopy(uiLanguage, {
          'zh-CN': `天气播报 · ${task.action.location}`,
          'en-US': `Weather brief · ${task.action.location}`,
        })
      : translateCopy(uiLanguage, {
          'zh-CN': '天气播报 · 默认地点',
          'en-US': 'Weather brief · Default location',
        })
  }

  if (task.action.kind === 'web_search') {
    return translateCopy(uiLanguage, {
      'zh-CN': `网页搜索 · ${task.action.query}`,
      'en-US': `Web search · ${task.action.query}`,
    })
  }

  return translateCopy(uiLanguage, {
    'zh-CN': '普通提醒',
    'en-US': 'Standard reminder',
  })
}

export function formatConsoleTimestamp(value: string | undefined, uiLanguage: UiLanguage = 'zh-CN') {
  const timestamp = Date.parse(value ?? '')
  if (Number.isNaN(timestamp)) {
    return translateCopy(uiLanguage, NONE_COPY)
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
  return translateCopy(uiLanguage, VOICE_STATE_LABELS[value])
}

export function formatDebugEventSourceLabel(
  source: DebugConsoleEvent['source'],
  uiLanguage: UiLanguage = 'zh-CN',
) {
  return translateCopy(uiLanguage, DEBUG_EVENT_SOURCE_LABELS[source])
}

export function formatVoicePipelineStepLabel(
  step: VoicePipelineState['step'],
  uiLanguage: UiLanguage = 'zh-CN',
) {
  return translateCopy(uiLanguage, VOICE_PIPELINE_STEP_LABELS[step])
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
    { value: 'at', label: translateCopy(uiLanguage, REMINDER_SCHEDULE_OPTION_LABELS.at) },
    { value: 'every', label: translateCopy(uiLanguage, REMINDER_SCHEDULE_OPTION_LABELS.every) },
    { value: 'cron', label: 'Cron' },
  ]
}

export function getReminderTemplatePresets(uiLanguage: UiLanguage): Array<{
  id: string
  label: string
  hint: string
  buildDraft: (now: Date) => ReminderTaskDraftInput
}> {
  const t = (copy: LocalizedText) => translateCopy(uiLanguage, copy)

  return [
    {
      id: 'hydrate',
      label: t({
        'zh-CN': '每小时喝水',
        'en-US': 'Hourly hydration',
      }),
      hint: t({
        'zh-CN': '每 60 分钟提醒补水',
        'en-US': 'Remind me to hydrate every 60 minutes',
      }),
      buildDraft: (now) => ({
        title: t({
          'zh-CN': '喝水提醒',
          'en-US': 'Hydration reminder',
        }),
        prompt: t({
          'zh-CN': '先喝点水，顺便活动一下肩颈。',
          'en-US': 'Drink some water and relax your shoulders for a moment.',
        }),
        speechText: t({
          'zh-CN': '主人，记得喝水休息一下。',
          'en-US': 'Time to drink some water and take a short break.',
        }),
        action: {
          kind: 'notice',
        },
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
      label: t({
        'zh-CN': '专注休息',
        'en-US': 'Focus break',
      }),
      hint: t({
        'zh-CN': '每 50 分钟提醒站起来',
        'en-US': 'Remind me to stand up every 50 minutes',
      }),
      buildDraft: (now) => ({
        title: t({
          'zh-CN': '专注休息',
          'en-US': 'Focus break',
        }),
        prompt: t({
          'zh-CN': '该起来活动一下了，走两步再继续。',
          'en-US': 'Time to get up, move a little, and then continue.',
        }),
        speechText: t({
          'zh-CN': '主人，已经专注一阵子了，起来活动一下吧。',
          'en-US': 'You have been focused for a while. Let us stand up and move a little.',
        }),
        action: {
          kind: 'notice',
        },
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
      label: t({
        'zh-CN': '晚间收尾',
        'en-US': 'Night wrap-up',
      }),
      hint: t({
        'zh-CN': '每天 23:00 提醒休息',
        'en-US': 'Remind me to wind down at 23:00 every day',
      }),
      buildDraft: () => ({
        title: t({
          'zh-CN': '晚间收尾',
          'en-US': 'Night wrap-up',
        }),
        prompt: t({
          'zh-CN': '可以准备收尾了，记得放松眼睛，早点休息。',
          'en-US': 'You can start wrapping up for the day. Relax your eyes and rest early.',
        }),
        speechText: t({
          'zh-CN': '主人，今天差不多可以收尾了，别忘了早点休息。',
          'en-US': 'It is almost time to wrap up for today. Do not forget to rest early.',
        }),
        action: {
          kind: 'notice',
        },
        enabled: true,
        schedule: {
          kind: 'cron',
          expression: '0 23 * * *',
        },
      }),
    },
    {
      id: 'weather-brief',
      label: t({
        'zh-CN': '早间天气播报',
        'en-US': 'Morning weather brief',
      }),
      hint: t({
        'zh-CN': '每天 09:00 自动查询默认地点天气',
        'en-US': 'Check the default weather at 09:00 every day',
      }),
      buildDraft: () => ({
        title: t({
          'zh-CN': '早间天气播报',
          'en-US': 'Morning weather brief',
        }),
        prompt: t({
          'zh-CN': '早间天气播报',
          'en-US': 'Morning weather brief',
        }),
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
      hint: t({
        'zh-CN': '每天 10:00 自动搜索 AI 新闻',
        'en-US': 'Search AI news at 10:00 every day',
      }),
      buildDraft: () => ({
        title: 'AI News',
        prompt: t({
          'zh-CN': '搜索 AI 新闻',
          'en-US': 'Search AI news',
        }),
        speechText: '',
        action: {
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
  | 'voice'
  | 'window'
  | 'integrations'
  | 'autonomy'

const SETTINGS_SECTION_DESCRIPTION_KEY_MAP: Record<SettingsSectionId, Parameters<typeof pickTranslatedUiText>[1]> = {
  console: 'settings.section_desc.console',
  model: 'settings.section_desc.model',
  chat: 'settings.section_desc.chat',
  history: 'settings.section_desc.history',
  memory: 'settings.section_desc.memory',
  voice: 'settings.section_desc.voice',
  window: 'settings.section_desc.window',
  integrations: 'settings.section_desc.integrations',
  autonomy: 'settings.section_desc.autonomy',
}

const SETTINGS_SECTION_EYEBROW_KEY_MAP: Record<SettingsSectionId, Parameters<typeof pickTranslatedUiText>[1]> = {
  console: 'settings.section_eyebrow.console',
  model: 'settings.section_eyebrow.model',
  chat: 'settings.section_eyebrow.chat',
  history: 'settings.section_eyebrow.history',
  memory: 'settings.section_eyebrow.memory',
  voice: 'settings.section_eyebrow.voice',
  window: 'settings.section_eyebrow.window',
  integrations: 'settings.section_eyebrow.integrations',
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
    { id: 'window', label: pickTranslatedUiText(uiLanguage, 'settings.section.window') },
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
  return [
    {
      value: 'direct_send',
      label: translateCopy(uiLanguage, VOICE_TRIGGER_MODE_OPTIONS.direct_send.label),
      hint: translateCopy(uiLanguage, VOICE_TRIGGER_MODE_OPTIONS.direct_send.hint),
    },
    {
      value: 'wake_word',
      label: translateCopy(uiLanguage, VOICE_TRIGGER_MODE_OPTIONS.wake_word.label),
      hint: translateCopy(uiLanguage, VOICE_TRIGGER_MODE_OPTIONS.wake_word.hint),
    },
    {
      value: 'manual_confirm',
      label: translateCopy(uiLanguage, VOICE_TRIGGER_MODE_OPTIONS.manual_confirm.label),
      hint: translateCopy(uiLanguage, VOICE_TRIGGER_MODE_OPTIONS.manual_confirm.hint),
    },
  ]
}

export function getMemorySearchModeOptions(uiLanguage: UiLanguage): Array<{
  value: MemorySearchMode
  label: string
  hint: string
}> {
  return [
    {
      value: 'keyword',
      label: translateCopy(uiLanguage, MEMORY_SEARCH_MODE_OPTIONS.keyword.label),
      hint: translateCopy(uiLanguage, MEMORY_SEARCH_MODE_OPTIONS.keyword.hint),
    },
    {
      value: 'hybrid',
      label: translateCopy(uiLanguage, MEMORY_SEARCH_MODE_OPTIONS.hybrid.label),
      hint: translateCopy(uiLanguage, MEMORY_SEARCH_MODE_OPTIONS.hybrid.hint),
    },
    {
      value: 'vector',
      label: translateCopy(uiLanguage, MEMORY_SEARCH_MODE_OPTIONS.vector.label),
      hint: translateCopy(uiLanguage, MEMORY_SEARCH_MODE_OPTIONS.vector.hint),
    },
  ]
}
