/**
 * Deterministic open-loop capture and resolution.
 *
 * Commitments such as "I'll send the report Friday" become kind `open_loop`
 * on the same extract path as other memories. A later utterance can close
 * or dismiss them without a model. A clear plan (own words, one date, a
 * clock, and a place when the errand needs one) is ready for a night-before
 * reminder. Anything vaguer stays a loop and waits for a yes.
 */

import { createId } from '../../lib/storage/core.ts'
import type { LoopStatus, MemoryItem } from '../../types/memory.ts'
import { MEMORY_RECORD_SCHEMA_VERSION } from '../../types/memory.ts'
import { isSensitiveMemoryText } from './memoryRules.ts'
import {
  applyClock,
  commitmentSlotKey,
  evidenceFromUtterance,
  findPlace,
  hasExplicitClock,
} from './loopDetails.ts'

const SNOOZE_MS = 4 * 60 * 60 * 1000

const TIME_WORDS = new Set([
  'today', 'tonight', 'tomorrow', 'monday', 'tuesday', 'wednesday', 'thursday',
  'friday', 'saturday', 'sunday', 'next', 'week', 'this',
  '今天', '今晚', '明天', '后天', '下周', '周一', '周二', '周三', '周四', '周五', '周六', '周日', '周天',
  '今日', '明日', '来週', '月曜', '火曜', '水曜', '木曜', '金曜', '土曜', '日曜',
  '오늘', '내일', '모레', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일',
])

const STOP_WORDS = new Set([
  'i', 'me', 'my', 'the', 'a', 'an', 'to', 'on', 'by', 'it', 'this', 'that',
  'you', 'your', 'and', 'or', 'of', 'for', 'is', 'was', 'be', 'do', 'did',
  'have', 'has', 'will', 'll', 'need', 'just', 'about', 'remind', 'dont',
  'don', 'send', 'sent', 'finish', 'finished', 'done',
  '我', '你', '的', '了', '在', '把', '会', '要', '去', '是', '不', '也', '就', '还',
])

const COMPLETION = /(?:已经(?!预约|預約)|完成了|做完了|发出去了|发了|搞定了|不用了|取消了|结束了|\b(?:sent|finished|done|completed|submitted|cancelled|canceled)\b|終わった|送った|電話した|済んだ|終わらせた|끝냈|보냈|끝났|취소했)/iu
const VAGUE_TIME = /(?:过几天|過幾天|这几天|這幾天|找时间|找時間|改天|有空的时候|有空時|哪天|sometime|one of these days)/iu
const SOMEONE_ELSE = /(?:我(?:的)?(?:同事|朋友|室友|老板|老闆|同学|同學)|别人|別人|(?:他|她|他们|她们|他們|她們)(?:说|說|要|会|會|打算|准备|準備|去))/u
const OWN_WITH_THEM = /我(?:要|得|会|會|准备|準備|打算)陪|我和(?:同事|朋友|室友)/u
const HYPOTHETICAL = /(?:如果|要是|假如|倘若|万一|萬一|\bif\b|what if)/iu
const PAST_PLAN = /(?:昨天|昨日|前天|上周|上週|上个?星期|上個?星期|去年|已经去了|已經去了|已经办了|已經辦了|去过了|去過了|办过了|辦過了|\byesterday\b|\blast (?:week|year)\b)/iu
const PLACE_MATTERS = /(?:护照|護照|passport|面试|面試|interview|会议|會議|meeting|大厅|大廳|去办|去辦|预约|預約)/iu

export type PlanClarity = 'clear' | 'ask' | 'none'
const DISMISS = /(?:don'?t remind me|do not remind me|别再?提醒|別再?提醒|不用提醒|不要提醒|提醒しないで|リマインドしない|그만\s*알려|알리지\s*마)/iu
const BARE_DONE = /^(?:done|finished|all done|完成了|做完了|搞定了|終わった|終わったよ|끝냈어|완료)[.!?。]?$/iu
const BARE_SNOOZE = /^(?:later|not now|snooze|稍后|等会|等一下|晚点|あとで|後で|나중에|잠시만)[.!?。]?$/iu
const BARE_DISMISS = /^(?:don'?t remind me(?: about this)?|别提醒我|別提醒我|不用提醒|不要再提醒|提醒しないで|リマインドしないで|그만 알려줘|알리지 마)[.!?。]?$/iu

type DueRule = {
  pattern: RegExp
  resolve: (now: Date, match: RegExpMatchArray) => Date
}

function atLocalHour(now: Date, dayOffset: number): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, 18, 0, 0, 0)
}

/**
 * 下周 / 来週 is the weekday in the next Monday-based week.
 * On Friday 16 Oct, 下周二 is 20 Oct, not the Tuesday after that.
 */
function nextCalendarWeekday(now: Date, target: number): Date {
  const sinceMonday = (now.getDay() + 6) % 7
  const daysUntilNextMonday = 7 - sinceMonday
  const fromMonday = target === 0 ? 6 : target - 1
  return atLocalHour(now, daysUntilNextMonday + fromMonday)
}

function weekdayDate(now: Date, target: number, mode: 'upcoming' | 'following-week' | 'named-next'): Date {
  if (mode === 'following-week') return nextCalendarWeekday(now, target)
  let delta = (target - now.getDay() + 7) % 7
  if (mode === 'named-next' && delta === 0) {
    delta = 7
  } else if (delta === 0 && now.getHours() >= 18) {
    delta = 7
  }
  return atLocalHour(now, delta)
}

function dayOffsetDate(now: Date, offset: number): Date {
  return atLocalHour(now, offset)
}

const WEEKDAY_NAMED: Array<{ pattern: RegExp; day: number; mode: 'upcoming' | 'following-week' | 'named-next' }> = [
  { pattern: /下(?:个)?(?:周|星期)([一二三四五六日天])/u, day: -1, mode: 'following-week' },
  { pattern: /(?:周|星期)([一二三四五六日天])/u, day: -1, mode: 'upcoming' },
  { pattern: /来週の?(日曜|月曜|火曜|水曜|木曜|金曜|土曜)/u, day: -1, mode: 'following-week' },
  { pattern: /(日曜|月曜|火曜|水曜|木曜|金曜|土曜)/u, day: -1, mode: 'upcoming' },
  { pattern: /다음\s*주\s*(일요일|월요일|화요일|수요일|목요일|금요일|토요일)/u, day: -1, mode: 'following-week' },
  { pattern: /(일요일|월요일|화요일|수요일|목요일|금요일|토요일)/u, day: -1, mode: 'upcoming' },
  { pattern: /next\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/iu, day: -1, mode: 'named-next' },
  { pattern: /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/iu, day: -1, mode: 'upcoming' },
]

const ZH_DAY: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 }
const JA_DAY: Record<string, number> = { 日曜: 0, 月曜: 1, 火曜: 2, 水曜: 3, 木曜: 4, 金曜: 5, 土曜: 6 }
const KO_DAY: Record<string, number> = {
  일요일: 0, 월요일: 1, 화요일: 2, 수요일: 3, 목요일: 4, 금요일: 5, 토요일: 6,
}
const EN_DAY: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
}

function weekdayFromMatch(match: RegExpMatchArray): number | null {
  const token = (match[1] ?? match[0]).toLowerCase()
  if (token in ZH_DAY) return ZH_DAY[token]!
  if (match[1] && match[1] in JA_DAY) return JA_DAY[match[1]]!
  if (match[1] && match[1] in KO_DAY) return KO_DAY[match[1]]!
  if (token in EN_DAY) return EN_DAY[token]!
  for (const [key, day] of Object.entries(JA_DAY)) {
    if (match[0].includes(key)) return day
  }
  for (const [key, day] of Object.entries(KO_DAY)) {
    if (match[0].includes(key)) return day
  }
  return null
}

const OFFSET_RULES: DueRule[] = [
  { pattern: /后天|모레/u, resolve: (now) => dayOffsetDate(now, 2) },
  { pattern: /明天|明日|내일|tomorrow/iu, resolve: (now) => dayOffsetDate(now, 1) },
  { pattern: /今天|今晚|今日|오늘|today|tonight/iu, resolve: (now) => dayOffsetDate(now, 0) },
]

function findDue(text: string, now: Date): { at: string; text: string } | null {
  const hits: Array<{ index: number; at: Date; text: string }> = []
  for (const rule of OFFSET_RULES) {
    const match = rule.pattern.exec(text)
    if (match) hits.push({ index: match.index, at: rule.resolve(now, match), text: match[0] })
  }
  for (const rule of WEEKDAY_NAMED) {
    const match = rule.pattern.exec(text)
    if (!match) continue
    const day = weekdayFromMatch(match)
    if (day === null) continue
    hits.push({ index: match.index, at: weekdayDate(now, day, rule.mode), text: match[0] })
  }
  hits.sort((left, right) => left.index - right.index)
  const best = hits[0]
  if (!best) return null
  const at = hasExplicitClock(text) ? applyClock(text, best.at) : best.at
  return { at: at.toISOString(), text: best.text }
}

function splitSegments(content: string): string[] {
  return content
    .split(/[。！？!?;\n]/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length >= 6)
}

function looksLikeCommitment(text: string): boolean {
  if (COMPLETION.test(text) || DISMISS.test(text)) return false
  const commitment = /(?:\b(?:i'll|i will|i'm going to|i am going to|i need to|i have to|i gotta|i should|i plan to)\b|我(?:要|得|会|将|准备|打算)|回头(?:我)?|提醒我|しなきゃ|する予定|やらなきゃ|해야\s*해|해야지|보낼\s*게|할\s*예정)/iu.test(text)
  const timed = /(?:\b(?:today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week)\b|今天|今晚|明天|后天|下周|周[一二三四五六日天]|星期[一二三四五六日天]|回头|今日|明日|来週|月曜|火曜|水曜|木曜|金曜|土曜|日曜|あとで|後で|오늘|내일|모레|다음\s*주|[월화수목금토일]요일)/iu.test(text)
  const event = /(?:interview|meeting|deadline|appointment|面试|会面|截止|会議|面談|面接|면접|회의|마감)/iu.test(text)
  const task = /(?:\b(?:send|finish|submit|email|book|pay|write)\b|发给|发出|发你|提交|交报告|写完|打电话|看一下|办护照|辦護照|去办|去辦|护照|護照|送る|電話|見ておく|面接|보내|제출)/iu.test(text)
  const vague = VAGUE_TIME.test(text)
  return (commitment && (timed || event || task)) || (event && timed) || (task && (timed || vague))
}

function isSomeoneElsesPlan(text: string): boolean {
  if (OWN_WITH_THEM.test(text)) return false
  return SOMEONE_ELSE.test(text)
}

function placeMatters(text: string): boolean {
  return PLACE_MATTERS.test(text)
}

/** Two weekdays, clocks, or halls in one utterance are two plans, so we ask. */
function ambiguousReading(text: string): boolean {
  const days = text.match(/(?:周|星期)[一二三四五六日天]|月曜|火曜|水曜|木曜|金曜|土曜|日曜|(?:일요일|월요일|화요일|수요일|목요일|금요일|토요일)|\b(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/giu)
  const clocks = text.match(/(?:凌晨|早上|上午|中午|下午|晚上|傍晚)?\s*(?:[0-2]?\d|[零〇一二两三兩四五六七八九十]{1,3})\s*(?:点|點|时|時)|\b[0-2]?\d(?::[0-5]\d)?\s*(?:a\.?m\.?|p\.?m\.?)\b/giu)
  const places = text.match(/[\u4e00-\u9fff]{2,12}(?:大厅|大廳|中心|办事处|辦事處|窗口|机场|機場|车站|車站|医院|醫院)/gu)
  return (days?.length ?? 0) > 1 || (clocks?.length ?? 0) > 1 || (places?.length ?? 0) > 1
}

function quotesConflict(quotes: readonly string[]): boolean {
  return quotes.some((quote) => ambiguousReading(quote))
}

/**
 * How sure we are that this sentence is the user's own plan.
 * `clear` can book a night-before reminder. `ask` still becomes a loop.
 * `none` is not stored: someone else, a hypothetical, the past, or no plan.
 */
export function classifyPlanUtterance(text: string, now: Date | string): PlanClarity {
  const value = text.trim()
  if (!value || isSensitiveMemoryText(value)) return 'none'
  if (isSomeoneElsesPlan(value) || HYPOTHETICAL.test(value) || PAST_PLAN.test(value)) return 'none'
  const clock = now instanceof Date ? now : new Date(now)
  const at = Number.isNaN(clock.getTime()) ? new Date() : clock
  if (!looksLikeCommitment(value)) return 'none'
  if (VAGUE_TIME.test(value) || quotesConflict([value])) return 'ask'
  const due = findDue(value, at)
  const namedClock = hasExplicitClock(value)
  const place = findPlace(value)
  if (due && namedClock && (!placeMatters(value) || Boolean(place))) return 'clear'
  return 'ask'
}

/**
 * Reading of a stored loop, including details added in a later turn.
 * The original sentence still has to be the user's own plan. A follow-up
 * can supply the clock and the hall that make it clear.
 */
export function loopPlanReading(memory: MemoryItem): PlanClarity {
  if (memory.kind !== 'open_loop' || memory.migrated === true) return 'none'
  if ((memory.loopStatus ?? 'open') !== 'open') return 'none'
  const content = memory.content.trim()
  if (classifyPlanUtterance(content, memory.createdAt) === 'none') return 'none'
  const quotes = [content, ...(memory.evidence ?? []).map((item) => item.quote)].filter((quote) => quote.trim())
  if (quotesConflict(quotes)) return 'ask'
  if (quotes.some((quote) => VAGUE_TIME.test(quote)) && !quotes.some((quote) => hasExplicitClock(quote))) return 'ask'
  const namedClock = quotes.some((quote) => hasExplicitClock(quote))
  const place = Boolean(memory.loopPlace?.trim()) || quotes.some((quote) => Boolean(findPlace(quote)))
  const matters = quotes.some((quote) => placeMatters(quote))
  const dueOk = Boolean(memory.loopDueAt && Number.isFinite(Date.parse(memory.loopDueAt)))
  if (dueOk && namedClock && (!matters || place)) return 'clear'
  return 'ask'
}

function topicTokens(text: string): string[] {
  const words = text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((token) => (
    token.length >= 3 && !STOP_WORDS.has(token) && !TIME_WORDS.has(token)
  ))
  const grams = [
    ...(text.match(/[\u3400-\u9fff]{2}/gu) ?? []),
    ...(text.match(/[\uac00-\ud7af]{2}/gu) ?? []),
  ]
  const kept = grams.filter((gram) => !TIME_WORDS.has(gram) && !STOP_WORDS.has(gram))
  return [...words, ...kept]
}

function sharesTopic(loopContent: string, utterance: string): boolean {
  const hay = utterance.toLowerCase()
  return topicTokens(loopContent).some((token) => hay.includes(token.toLowerCase()))
}

function isOpenLoop(memory: MemoryItem): boolean {
  return memory.kind === 'open_loop'
    && memory.enabled !== false
    && memory.status !== 'archived'
    && memory.status !== 'superseded'
    && (memory.loopStatus ?? 'open') === 'open'
}

/**
 * Pull commitment segments out of one utterance. Completion and dismiss
 * lines are not new loops; the resolver handles those.
 */
export function extractOpenLoopItems(
  text: string,
  createdAt: string,
  idFor: (prefix: string) => string = createId,
  messageId?: string,
): MemoryItem[] {
  const now = new Date(createdAt)
  const clock = Number.isNaN(now.getTime()) ? new Date() : now
  const stamp = Number.isNaN(now.getTime()) ? new Date().toISOString() : createdAt
  const seen = new Set<string>()
  const items: MemoryItem[] = []
  for (const segment of splitSegments(text)) {
    if (classifyPlanUtterance(segment, clock) === 'none') continue
    const key = segment.toLowerCase().replace(/\s+/g, ' ')
    if (seen.has(key)) continue
    seen.add(key)
    const due = findDue(segment, clock)
    const place = findPlace(segment)
    items.push({
      id: idFor('memory'),
      content: segment,
      category: 'goal',
      kind: 'open_loop',
      enabled: true,
      source: 'chat',
      importance: 'normal',
      schemaVersion: MEMORY_RECORD_SCHEMA_VERSION,
      status: 'active',
      createdAt: stamp,
      updatedAt: stamp,
      loopStatus: 'open',
      slotKey: commitmentSlotKey(segment),
      sourceRef: messageId,
      evidence: [evidenceFromUtterance(segment, stamp, messageId)],
      ...(due ? { loopDueAt: due.at, loopDueText: due.text } : {}),
      ...(place ? { loopPlace: place } : {}),
    })
  }
  return items
}

function sameText(left: string, right: string): boolean {
  return left.toLowerCase().replace(/\s+/g, ' ').trim() === right.toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Upgrade an extracted row when it is a commitment, and append commitments
 * the keyword extractor missed (for example "I'll send the report Friday").
 */
export function attachOpenLoops(items: MemoryItem[], text: string, createdAt: string, messageId?: string): MemoryItem[] {
  const loops = extractOpenLoopItems(text, createdAt, createId, messageId)
  if (!loops.length) return items
  const used = new Set<string>()
  const next = items.map((item) => {
    const loop = loops.find((candidate) => !used.has(candidate.content) && sameText(item.content, candidate.content))
    if (!loop) return item
    used.add(loop.content)
    return {
      ...item,
      kind: 'open_loop' as const,
      category: item.category === 'profile' ? 'goal' as const : item.category,
      loopStatus: 'open' as const,
      slotKey: loop.slotKey ?? item.slotKey,
      evidence: loop.evidence ?? item.evidence,
      sourceRef: loop.sourceRef ?? item.sourceRef,
      ...(loop.loopDueAt ? { loopDueAt: loop.loopDueAt, loopDueText: loop.loopDueText } : {}),
      ...(loop.loopPlace ? { loopPlace: loop.loopPlace } : {}),
    }
  })
  for (const loop of loops) {
    if (used.has(loop.content)) continue
    if (next.some((item) => sameText(item.content, loop.content))) continue
    next.push(loop)
  }
  return next
}

export type LoopChange = { id: string; status: LoopStatus; snoozeUntil?: string }

function patchLoop(memory: MemoryItem, change: LoopChange, nowIso: string): MemoryItem {
  return {
    ...memory,
    updatedAt: nowIso,
    loopStatus: change.status,
    ...(change.status === 'done' || change.status === 'dismissed'
      ? { loopSnoozeUntil: undefined }
      : {}),
    ...(change.snoozeUntil ? { loopSnoozeUntil: change.snoozeUntil, loopStatus: 'open' as const } : {}),
  }
}

function latestSurfacedOpenLoop(memories: readonly MemoryItem[]): MemoryItem | null {
  const open = memories.filter((memory) => isOpenLoop(memory) && memory.loopLastSurfacedAt)
  if (!open.length) return null
  return [...open].sort((left, right) => (
    Date.parse(right.loopLastSurfacedAt ?? '') - Date.parse(left.loopLastSurfacedAt ?? '')
  ))[0] ?? null
}

/**
 * Close, snooze, or dismiss open loops when a later utterance shows the
 * outcome. Topic overlap is required unless the whole message is a short
 * reply to the loop that was just surfaced.
 */
export function resolveOpenLoops(
  memories: readonly MemoryItem[],
  utterance: string,
  nowIso: string,
): { memories: MemoryItem[]; changes: LoopChange[] } {
  const text = utterance.trim()
  if (!text) return { memories: [...memories], changes: [] }
  const nowMs = Date.parse(nowIso)
  const changes: LoopChange[] = []
  const bareDismiss = BARE_DISMISS.test(text)
  const bareDone = BARE_DONE.test(text)
  const bareSnooze = BARE_SNOOZE.test(text)
  const dismiss = DISMISS.test(text)
  const completion = COMPLETION.test(text) || bareDone

  if (bareSnooze || bareDone || bareDismiss) {
    const target = latestSurfacedOpenLoop(memories)
    if (target) {
      if (bareSnooze) {
        const until = new Date((Number.isFinite(nowMs) ? nowMs : Date.now()) + SNOOZE_MS).toISOString()
        changes.push({ id: target.id, status: 'open', snoozeUntil: until })
      } else {
        changes.push({ id: target.id, status: bareDismiss || dismiss ? 'dismissed' : 'done' })
      }
    }
  } else if (dismiss || completion) {
    for (const memory of memories) {
      if (!isOpenLoop(memory)) continue
      if (!sharesTopic(memory.content, text)) continue
      changes.push({ id: memory.id, status: dismiss ? 'dismissed' : 'done' })
    }
  }

  if (!changes.length) return { memories: [...memories], changes: [] }
  const byId = new Map(changes.map((change) => [change.id, change]))
  return {
    memories: memories.map((memory) => {
      const change = byId.get(memory.id)
      return change ? patchLoop(memory, change, nowIso) : memory
    }),
    changes,
  }
}

/** Re-parse a due phrase after the user edits a loop in the memory view. */
export function dueFromText(text: string, nowIso: string): { loopDueAt?: string; loopDueText?: string } {
  const due = findDue(text, new Date(nowIso))
  if (!due) return {}
  return { loopDueAt: due.at, loopDueText: due.text }
}

export function listLoopMemories(memories: readonly MemoryItem[]): MemoryItem[] {
  return memories.filter((memory) => (
    memory.kind === 'open_loop'
    && memory.enabled !== false
    && memory.status !== 'archived'
    && memory.status !== 'superseded'
  ))
}
