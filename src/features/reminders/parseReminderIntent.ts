import type { ReminderTask, ReminderTaskAction, ReminderTaskSchedule } from '../../types'
import type { ReminderTaskDraftInput } from './schedule.ts'
import { formatReminderScheduleSummary } from './schedule.ts'
import { extractLikelyWeatherLocation, extractSearchQuery } from '../tools/extractors.ts'
import {
  collapsePunctuationToSpace,
  normalizeIntentText,
  normalizeLookupText,
  stripConversationPrefix,
} from '../intent/preprocess.ts'

type ParsedReminderUpdate = Partial<Pick<ReminderTask, 'title' | 'prompt' | 'speechText' | 'enabled' | 'schedule'>>
type ParsedReminderDraftBase = Omit<ReminderTaskDraftInput, 'schedule'>
type ParsedReminderPromptDraft = Pick<ReminderTaskDraftInput, 'schedule' | 'enabled'> & {
  partialPrompt: string
}

export type ParsedReminderIntent =
  | {
      kind: 'create'
      draft: ReminderTaskDraftInput
    }
  | {
      kind: 'clarify_time'
      draft: ParsedReminderDraftBase
      originalText: string
    }
  | {
      kind: 'clarify_prompt'
      draft: ParsedReminderPromptDraft
      originalText: string
    }
  | {
      kind: 'update'
      targetText: string
      updates: ParsedReminderUpdate
    }
  | {
      kind: 'toggle'
      targetText: string
      enabled: boolean
    }
  | {
      kind: 'remove'
      targetText: string
    }
  | {
      kind: 'list'
    }

const REMINDER_LIST_PATTERN = /(?:提醒列表|提醒清单|任务中心|本地任务|本地自动任务|列出(?:一下)?提醒|看看(?:一下)?提醒|查看(?:一下)?提醒|有哪些提醒|有什么提醒)/u
const REMINDER_REMOVE_PATTERNS = [
  /^(?:请|麻烦|帮我|给我|把|将)?\s*(?:删除|删掉|移除|取消)\s*(.+?)(?:提醒|任务)(?:吧|一下)?$/u,
  /^(?:请|麻烦|帮我|给我|把|将)?\s*(.+?)(?:提醒|任务)(?:删除|删掉|移除|取消)(?:吧|一下)?$/u,
]
const REMINDER_DISABLE_PATTERNS = [
  /^(?:请|麻烦|帮我|给我|把|将)?\s*(?:暂停|关闭|停用|禁用)\s*(.+?)(?:提醒|任务)(?:吧|一下)?$/u,
  /^(?:请|麻烦|帮我|给我|把|将)?\s*(.+?)(?:提醒|任务)(?:暂停|关闭|停用|禁用)(?:吧|一下)?$/u,
]
const REMINDER_ENABLE_PATTERNS = [
  /^(?:请|麻烦|帮我|给我|把|将)?\s*(?:启用|开启|恢复|打开)\s*(.+?)(?:提醒|任务)(?:吧|一下)?$/u,
  /^(?:请|麻烦|帮我|给我|把|将)?\s*(.+?)(?:提醒|任务)(?:启用|开启|恢复|打开)(?:吧|一下)?$/u,
]
const REMINDER_UPDATE_PATTERN = /^(?:请|麻烦|帮我|给我|把|将)?\s*(.+?)(?:提醒|任务)(?:改成|改为|调整为|改到|调整到|换成)\s*(.+)$/u
const REMINDER_CREATE_HINT_PATTERN = /(?:提醒我|提醒一下|通知我|叫我|喊我|告诉我|记得|设个提醒|设置提醒|新增提醒|创建提醒|定个提醒|定时|播报|搜索|搜一下|查一下|查询|总结|汇总|整理|回顾|复盘|归纳|分析|盘点|梳理)/u

const REMINDER_TIMELESS_CREATE_HINT_PATTERN = /(?:提醒我|提醒一下|通知我|叫我|喊我|告诉我|记得|设个提醒|设置提醒|新增提醒|创建提醒|定个提醒|定时提醒)/u
const REMINDER_SUSPICIOUS_SHORT_PROMPT_PATTERN = /^(?:喝|吃|看|查|搜|找|去|做|买|拿|打|开|关|发|回|听|问|记|背|读|写|学|装|带|放|收|洗|用)$/u
const REMINDER_REJECTED_FOLLOW_UP_PATTERN = /^(?:好的?|可以|行|嗯|啊|哦|算了|不用了|取消|不是|没事|先这样|先不用|等一下|稍后)$/u
const QUESTION_CONTEXT_PATTERN = /(?:为什么|为啥|怎么没|吗[？?]?$|什么样|怎么样|是不是|有没有|为何|难道|你查完|查完了吗|没有告诉)/u

const DAY_OFFSET_PATTERNS: Array<{ pattern: RegExp; offset: number }> = [
  { pattern: /后天/u, offset: 2 },
  { pattern: /明天|明早|明晚/u, offset: 1 },
  { pattern: /今天|今晚|今早|今晨/u, offset: 0 },
]

const WEEKDAY_MAP: Record<string, number> = {
  '1': 1,
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 0,
  '一': 1,
  '二': 2,
  '三': 3,
  '四': 4,
  '五': 5,
  '六': 6,
  '日': 0,
  '天': 0,
}

const CHINESE_DIGIT_MAP: Record<string, number> = {
  '零': 0,
  '〇': 0,
  '一': 1,
  '二': 2,
  '两': 2,
  '三': 3,
  '四': 4,
  '五': 5,
  '六': 6,
  '七': 7,
  '八': 8,
  '九': 9,
}

function parseChineseNumberToken(token: string) {
  const normalized = String(token ?? '').trim()
  if (!normalized) {
    return Number.NaN
  }

  if (normalized === '半') {
    return 0.5
  }

  if (/^\d+(?:\.\d+)?$/u.test(normalized)) {
    return Number(normalized)
  }

  if (normalized === '十') {
    return 10
  }

  if (normalized.includes('十')) {
    const [left, right] = normalized.split('十', 2)
    const tens = left ? (CHINESE_DIGIT_MAP[left] ?? Number.NaN) : 1
    const ones = right ? (CHINESE_DIGIT_MAP[right] ?? Number.NaN) : 0
    if (Number.isNaN(tens) || Number.isNaN(ones)) {
      return Number.NaN
    }
    return tens * 10 + ones
  }

  return CHINESE_DIGIT_MAP[normalized] ?? Number.NaN
}

function sanitizeTargetText(text: string) {
  return normalizeIntentText(
    stripConversationPrefix(text)
      .replace(/^(?:这个|那个|这条|那条)\s*/u, '')
      .replace(/[的地得]\s*$/u, ''),
  )
}

function buildReminderTitleFromPrompt(prompt: string) {
  const normalized = normalizeIntentText(prompt)
  const firstClause = normalized.split(/[，。！？!?；;]/u)[0]?.trim() ?? ''
  const title = firstClause || normalized
  if (!title) {
    return '新的任务'
  }

  return title.length <= 16 ? title : `${title.slice(0, 15)}…`
}

function isReminderPromptSuspicious(prompt: string) {
  const normalized = normalizeIntentText(prompt)
  if (!normalized) {
    return true
  }

  if (REMINDER_REJECTED_FOLLOW_UP_PATTERN.test(normalized)) {
    return true
  }

  if (normalized.length <= 1) {
    return true
  }

  return REMINDER_SUSPICIOUS_SHORT_PROMPT_PATTERN.test(normalized)
}

function stripReminderWeatherActionPrefix(text: string) {
  return normalizeIntentText(text).replace(
    /^(?:(?:请|麻烦|帮我|给我|替我|自动)\s*)*(?:(?:播报|报一下|报下|报|查询|查一下|查查|查看|看一下|看看|看|获取)\s*)+/u,
    '',
  )
}

function deriveReminderAction(prompt: string): ReminderTaskAction {
  const normalized = normalizeIntentText(prompt)
  if (/(?:天气|气温|温度|下雨|降雨|天气播报|天气预报)/u.test(normalized)) {
    return {
      kind: 'weather',
      location: extractLikelyWeatherLocation(stripReminderWeatherActionPrefix(normalized)),
    }
  }

  if (/(?:搜索|搜一下|查一下|查询|找一下|网页|新闻|资讯|歌词|百科)/u.test(normalized)) {
    const query = extractSearchQuery(normalized) || normalized
    return {
      kind: 'web_search',
      query,
      limit: 5,
    }
  }

  if (/(?:总结|汇总|整理|回顾|复盘|归纳|分析|列出|盘点|梳理)/u.test(normalized)) {
    return {
      kind: 'chat_action',
      instruction: normalized,
    }
  }

  return {
    kind: 'notice',
  }
}

function buildReminderDraftBaseFromPrompt(prompt: string): ParsedReminderDraftBase {
  return {
    title: buildReminderTitleFromPrompt(prompt),
    prompt,
    action: deriveReminderAction(prompt),
    enabled: true,
  }
}

export function buildReminderDraftFromPrompt(prompt: string, schedule: ReminderTaskSchedule): ReminderTaskDraftInput {
  return {
    ...buildReminderDraftBaseFromPrompt(prompt),
    schedule,
  }
}

function parseReminderTimeParts(text: string) {
  const match = normalizeIntentText(text).match(
    /(后天|明天|今天|今晚|今早|今晨|明早|明晚)?\s*(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里)?\s*([零〇一二两三四五六七八九十\d]{1,3})\s*点(?:\s*(半|[零〇一二两三四五六七八九十\d]{1,3})\s*(?:分)?)?/u,
  )
  if (!match) {
    return null
  }

  const hour = parseChineseNumberToken(match[3] ?? '')
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) {
    return null
  }

  let minute = 0
  if (match[4] === '半') {
    minute = 30
  } else if (match[4]) {
    minute = parseChineseNumberToken(match[4])
  }

  if (!Number.isFinite(minute) || minute < 0 || minute > 59) {
    return null
  }

  const prefix = `${match[1] ?? ''}${match[2] ?? ''}`
  let normalizedHour = hour

  if (/(?:下午|傍晚|晚上|夜里|今晚|明晚)/u.test(prefix) && normalizedHour < 12) {
    normalizedHour += 12
  } else if (/中午/u.test(prefix) && normalizedHour < 11) {
    normalizedHour += 12
  } else if (/凌晨/u.test(prefix) && normalizedHour === 12) {
    normalizedHour = 0
  }

  const explicitDayOffset = DAY_OFFSET_PATTERNS.find((entry) => entry.pattern.test(prefix))?.offset

  return {
    matchedText: match[0],
    hour: normalizedHour,
    minute,
    explicitDayOffset,
  }
}

function buildOneOffAtSchedule(hour: number, minute: number, now: Date, explicitDayOffset?: number) {
  const target = new Date(now)
  target.setSeconds(0, 0)
  if (explicitDayOffset) {
    target.setDate(target.getDate() + explicitDayOffset)
  }
  target.setHours(hour, minute, 0, 0)

  if (!Number.isFinite(explicitDayOffset ?? Number.NaN) && target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1)
  }

  return target.toISOString()
}

function parseAfterDurationSchedule(text: string, now: Date) {
  const match = normalizeIntentText(text).match(/([零〇一二两三四五六七八九十半\d]{1,3})\s*(分钟|小时|天)(?:后|之后|以后)/u)
  if (!match) {
    return null
  }

  const amount = parseChineseNumberToken(match[1] ?? '')
  if (!Number.isFinite(amount) || amount <= 0) {
    return null
  }

  const multiplier = match[2] === '分钟'
    ? 60_000
    : match[2] === '小时'
      ? 60 * 60_000
      : 24 * 60 * 60_000

  return {
    matchedText: match[0],
    schedule: {
      kind: 'at',
      at: new Date(now.getTime() + amount * multiplier).toISOString(),
    } satisfies ReminderTaskSchedule,
  }
}

function parseEverySchedule(text: string, now: Date) {
  const normalized = normalizeIntentText(text)
  if (/(?:每天|每日|每周)/u.test(normalized)) {
    return null
  }

  const specialHourlyMatch = normalized.match(/每\s*小时/u)
  if (specialHourlyMatch) {
    return {
      matchedText: specialHourlyMatch[0],
      schedule: {
        kind: 'every',
        everyMinutes: 60,
        anchorAt: now.toISOString(),
      } satisfies ReminderTaskSchedule,
    }
  }

  const match = normalized.match(/每\s*([零〇一二两三四五六七八九十半\d]{1,3})\s*(分钟|小时|天)/u)
  if (!match) {
    return null
  }

  const amount = parseChineseNumberToken(match[1] ?? '')
  if (!Number.isFinite(amount) || amount <= 0) {
    return null
  }

  const everyMinutes = match[2] === '分钟'
    ? Math.round(amount)
    : match[2] === '小时'
      ? Math.round(amount * 60)
      : Math.round(amount * 24 * 60)

  if (!Number.isFinite(everyMinutes) || everyMinutes <= 0) {
    return null
  }

  return {
    matchedText: match[0],
    schedule: {
      kind: 'every',
      everyMinutes,
      anchorAt: now.toISOString(),
    } satisfies ReminderTaskSchedule,
  }
}

function parseDailySchedule(text: string) {
  const normalized = normalizeIntentText(text)
  if (!/(?:每天|每日)/u.test(normalized)) {
    return null
  }

  const time = parseReminderTimeParts(normalized)
  if (!time) {
    return null
  }

  return {
    matchedText: `${normalized.match(/(?:每天|每日)/u)?.[0] ?? ''}${time.matchedText}`,
    schedule: {
      kind: 'cron',
      expression: `${time.minute} ${time.hour} * * *`,
    } satisfies ReminderTaskSchedule,
  }
}

function parseWeeklySchedule(text: string) {
  const normalized = normalizeIntentText(text)
  const weeklyMatch = normalized.match(/每周([一二三四五六日天1-7])/u)
  if (!weeklyMatch) {
    return null
  }

  const weekday = WEEKDAY_MAP[weeklyMatch[1] ?? '']
  if (weekday === undefined) {
    return null
  }

  const time = parseReminderTimeParts(normalized)
  if (!time) {
    return null
  }

  return {
    matchedText: `${weeklyMatch[0]} ${time.matchedText}`.trim(),
    schedule: {
      kind: 'cron',
      expression: `${time.minute} ${time.hour} * * ${weekday}`,
    } satisfies ReminderTaskSchedule,
  }
}

function parseOneOffClockSchedule(text: string, now: Date) {
  const time = parseReminderTimeParts(text)
  if (!time) {
    return null
  }

  return {
    matchedText: time.matchedText,
    schedule: {
      kind: 'at',
      at: buildOneOffAtSchedule(time.hour, time.minute, now, time.explicitDayOffset),
    } satisfies ReminderTaskSchedule,
  }
}

function extractReminderSchedule(text: string, now: Date) {
  return (
    parseAfterDurationSchedule(text, now)
    || parseWeeklySchedule(text)
    || parseDailySchedule(text)
    || parseEverySchedule(text, now)
    || parseOneOffClockSchedule(text, now)
  )
}

export function parseReminderScheduleOnly(text: string, now = new Date()) {
  const normalized = stripConversationPrefix(text)
  if (!normalized) {
    return null
  }

  return extractReminderSchedule(normalized, now)?.schedule ?? null
}

function sanitizeReminderPrompt(text: string) {
  return normalizeIntentText(
    collapsePunctuationToSpace(
      stripConversationPrefix(text)
        .replace(/^(?:在|于|到|到了|到时候|时候)\s*/u, '')
        .replace(/^(?:提醒我|提醒一下|通知我|叫我|喊我|告诉我|记得)\s*/u, '')
        .replace(/^(?:帮我|给我|请你)\s*/u, ''),
    )
      .replace(/^(?:去|要|一下)\s*/u, '')
      .replace(/[的地得]\s*$/u, ''),
  )
}

function extractReminderPrompt(text: string, matchedScheduleText = '') {
  const normalized = normalizeIntentText(text)
  const directMatch = normalized.match(/(?:提醒我|提醒一下|通知我|叫我|喊我|告诉我|记得)\s*(.+)$/u)
  if (directMatch?.[1]) {
    return sanitizeReminderPrompt(directMatch[1])
  }

  const stripped = normalizeIntentText(
    normalized
      .replace(matchedScheduleText, ' ')
      .replace(/^(?:新增提醒|创建提醒|设个提醒|设置提醒|定个提醒|定时提醒)\s*/u, ''),
  )

  return sanitizeReminderPrompt(stripped)
}

function mergeReminderPromptFragments(partialPrompt: string, followUpPrompt: string) {
  const normalizedPartial = sanitizeReminderPrompt(partialPrompt)
  const normalizedFollowUp = sanitizeReminderPrompt(followUpPrompt)
  if (!normalizedPartial) {
    return normalizedFollowUp
  }

  if (!normalizedFollowUp) {
    return ''
  }

  if (normalizedFollowUp.startsWith(normalizedPartial) || normalizedFollowUp.includes(normalizedPartial)) {
    return normalizedFollowUp
  }

  return normalizeIntentText(`${normalizedPartial}${normalizedFollowUp}`)
}

export function parseReminderPromptOnly(text: string, partialPrompt = '') {
  const normalized = sanitizeReminderPrompt(text)
  if (!normalized || REMINDER_REJECTED_FOLLOW_UP_PATTERN.test(normalized)) {
    return null
  }

  const mergedPrompt = partialPrompt
    ? mergeReminderPromptFragments(partialPrompt, normalized)
    : normalized
  if (mergedPrompt && !isReminderPromptSuspicious(mergedPrompt)) {
    return mergedPrompt
  }

  return isReminderPromptSuspicious(normalized) ? null : normalized
}

function parseTargetWithPatterns(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) {
      const targetText = sanitizeTargetText(match[1])
      if (targetText) {
        return targetText
      }
    }
  }

  return ''
}

export function parseReminderIntent(text: string, now = new Date()): ParsedReminderIntent | null {
  const normalized = stripConversationPrefix(text)
  if (!normalized) {
    return null
  }

  if (QUESTION_CONTEXT_PATTERN.test(normalized)) {
    return null
  }

  if (REMINDER_LIST_PATTERN.test(normalized)) {
    return {
      kind: 'list',
    }
  }

  const updateMatch = normalized.match(REMINDER_UPDATE_PATTERN)
  if (updateMatch?.[1] && updateMatch?.[2]) {
    const targetText = sanitizeTargetText(updateMatch[1])
    const remainder = updateMatch[2]
    const scheduleInfo = extractReminderSchedule(remainder, now)
    const prompt = extractReminderPrompt(remainder, scheduleInfo?.matchedText ?? '')
    const updates: ParsedReminderUpdate = {}

    if (scheduleInfo) {
      updates.schedule = scheduleInfo.schedule
    }

    if (prompt) {
      updates.prompt = prompt
    }

    if (targetText && Object.keys(updates).length) {
      return {
        kind: 'update',
        targetText,
        updates,
      }
    }
  }

  const removeTarget = parseTargetWithPatterns(normalized, REMINDER_REMOVE_PATTERNS)
  if (removeTarget) {
    return {
      kind: 'remove',
      targetText: removeTarget,
    }
  }

  const disableTarget = parseTargetWithPatterns(normalized, REMINDER_DISABLE_PATTERNS)
  if (disableTarget) {
    return {
      kind: 'toggle',
      targetText: disableTarget,
      enabled: false,
    }
  }

  const enableTarget = parseTargetWithPatterns(normalized, REMINDER_ENABLE_PATTERNS)
  if (enableTarget) {
    return {
      kind: 'toggle',
      targetText: enableTarget,
      enabled: true,
    }
  }

  const scheduleInfo = extractReminderSchedule(normalized, now)
  if (!scheduleInfo) {
    if (!REMINDER_TIMELESS_CREATE_HINT_PATTERN.test(normalized)) {
      return null
    }

    const prompt = extractReminderPrompt(normalized)
    if (!prompt) {
      return null
    }

    return {
      kind: 'clarify_time',
      draft: buildReminderDraftBaseFromPrompt(prompt),
      originalText: normalized,
    }
  }

  if (!REMINDER_CREATE_HINT_PATTERN.test(normalized)) {
    return null
  }

  const prompt = extractReminderPrompt(normalized, scheduleInfo.matchedText)
  if (!prompt) {
    return null
  }

  if (isReminderPromptSuspicious(prompt)) {
    return {
      kind: 'clarify_prompt',
      draft: {
        schedule: scheduleInfo.schedule,
        enabled: true,
        partialPrompt: prompt,
      },
      originalText: normalized,
    }
  }

  return {
    kind: 'create',
    draft: buildReminderDraftFromPrompt(prompt, scheduleInfo.schedule),
  }
}

export function findBestReminderTaskMatch(tasks: ReminderTask[], targetText: string) {
  const normalizedTarget = normalizeLookupText(
    sanitizeTargetText(targetText).replace(/(?:提醒|任务)$/u, ''),
  )

  if (!normalizedTarget) {
    return tasks.length === 1 ? tasks[0] : null
  }

  const ranked = tasks
    .map((task) => {
      const title = normalizeLookupText(task.title)
      const prompt = normalizeLookupText(task.prompt)
      let score = 0

      if (title === normalizedTarget) score += 10
      if (prompt === normalizedTarget) score += 8
      if (title.includes(normalizedTarget)) score += 6
      if (prompt.includes(normalizedTarget)) score += 4
      if (normalizedTarget.includes(title) && title) score += 3
      if (normalizedTarget.includes(prompt) && prompt) score += 2
      if (task.enabled) score += 0.5

      return {
        task,
        score,
      }
    })
    .sort((left, right) => right.score - left.score)

  return ranked[0]?.score ? ranked[0].task : null
}

function formatReminderNextRun(nextRunAt?: string) {
  const timestamp = Date.parse(nextRunAt ?? '')
  if (Number.isNaN(timestamp)) {
    return '未安排'
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

function formatReminderActionSummary(action: ReminderTask['action']) {
  if (action.kind === 'weather') {
    return action.location ? `天气播报(${action.location})` : '天气播报(默认地点)'
  }

  if (action.kind === 'web_search') {
    return `网页搜索(${action.query})`
  }

  if (action.kind === 'chat_action') {
    const preview = action.instruction.length > 12
      ? `${action.instruction.slice(0, 11)}…`
      : action.instruction
    return `智能动作(${preview})`
  }

  return '普通提醒'
}

export function buildReminderTaskDigest(tasks: ReminderTask[], limit = 6) {
  if (!tasks.length) {
    return '本地自动任务中心里还没有任务。'
  }

  return [
    '本地自动任务中心',
    ...tasks.slice(0, limit).map((task, index) => (
      `${index + 1}. ${task.title} · ${formatReminderActionSummary(task.action)} · ${formatReminderScheduleSummary(task)} · ${task.enabled ? '启用中' : '已暂停'} · 下次 ${formatReminderNextRun(task.nextRunAt)}`
    )),
  ].join('\n')
}
