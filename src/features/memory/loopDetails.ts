/**
 * Place, clock, due date, and slot details on an open loop.
 *
 * A later turn that only adds a hall or a clock updates the loop the user
 * already started. It does not invent a second commitment. The due words
 * live here too, so a follow-up can read a new day without going through
 * the capture path.
 */

import { localDayKey } from '../../lib/localDate.ts'
import type { LoopKind, MemoryEvidence, MemoryItem, MemoryOpRecord } from '../../types/memory.ts'
import { isSensitiveMemoryText } from './memoryRules.ts'

const ZH_DIGIT: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
}

const CLOCK_ZH = /(凌晨|早上|上午|中午|下午|晚上|傍晚)?\s*([0-2]?\d|[零〇一二两三兩四五六七八九十]{1,3})\s*(?:点|點|时|時)(?:\s*([0-5]?\d|半|一刻))?/u
const CLOCK_EN = /\b([0-2]?\d)(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b/iu

const PLACE_ZH = /((?:[\u4e00-\u9fff]{2,8}的)?[\u4e00-\u9fff]{2,12}(?:大厅|大廳|中心|办事处|辦事處|窗口|机场|機場|车站|車站|医院|醫院))/u

const KNOWN_SLOTS: Array<[RegExp, string]> = [
  [/护照|護照|passport/iu, 'loop.passport'],
  [/报告|報告|report/iu, 'loop.report'],
  [/面试|面試|interview|面接|면접/iu, 'loop.interview'],
  [/会议|會議|meeting|会議|회의/iu, 'loop.meeting'],
  [/考试|考試|exam|試験|시험/iu, 'loop.exam'],
  [/医院|醫院|复查|復查|体检|體檢|doctor|hospital|checkup|病院|検査|병원|검진/iu, 'loop.doctor'],
  [/搬家|moving|move\s+house|引っ越し|이사/iu, 'loop.move'],
  [/出差|旅行|旅游|旅遊|business\s+trip|\btrip\b|\btravel\b|flight|出張|여행/iu, 'loop.trip'],
  [/\bdate\b|约会|約會|デート|데이트/iu, 'loop.date'],
  [/演示|答辩|答辯|presentation|defen[cs]e|発表|プレゼン|발표/iu, 'loop.presentation'],
  [/生日|birthday|誕生日|생일/iu, 'loop.birthday'],
  [/婚礼|婚禮|wedding|結婚式|결혼식/iu, 'loop.wedding'],
  [/聚会|聚會|\bparty\b|パーティー|파티/iu, 'loop.party'],
]

function parseZhNumber(token: string): number | null {
  if (/^\d{1,2}$/.test(token)) {
    const value = Number(token)
    return value >= 0 && value <= 24 ? value : null
  }
  if (token === '十') return 10
  if (token.startsWith('十') && token.length === 2) return 10 + (ZH_DIGIT[token[1]!] ?? 0)
  if (token.length === 1) return ZH_DIGIT[token] ?? null
  if (token.length === 2 && token[1] === '十') return (ZH_DIGIT[token[0]!] ?? 0) * 10
  if (token.length === 3 && token[1] === '十') {
    return (ZH_DIGIT[token[0]!] ?? 0) * 10 + (ZH_DIGIT[token[2]!] ?? 0)
  }
  return null
}

function shiftPeriod(hour: number, period: string | undefined): number {
  if (!period) return hour
  if (/凌晨/u.test(period)) return hour === 12 ? 0 : hour
  if (/早上|上午/u.test(period)) return hour === 12 ? 0 : hour
  if (/中午/u.test(period)) return hour < 11 ? hour + 12 : hour
  if (/下午|晚上|傍晚/u.test(period)) {
    if (hour < 12) return hour + 12
    return hour
  }
  return hour
}

/** True when the utterance names an hour, not only a day. */
export function hasExplicitClock(text: string): boolean {
  return CLOCK_ZH.test(text) || CLOCK_EN.test(text)
}

/**
 * Write an explicit clock onto a due date. With no clock, the date is unchanged
 * so a bare weekday keeps the 18:00 placeholder.
 */
export function applyClock(text: string, due: Date): Date {
  const next = new Date(due.getTime())
  const zh = CLOCK_ZH.exec(text)
  const en = CLOCK_EN.exec(text)
  if (zh && (!en || zh.index <= en.index)) {
    const hour = parseZhNumber(zh[2] ?? '')
    if (hour === null) return next
    let minute = 0
    if (zh[3] === '半') minute = 30
    else if (zh[3] === '一刻') minute = 15
    else if (zh[3] && /^\d+$/.test(zh[3])) minute = Number(zh[3])
    const shifted = shiftPeriod(hour, zh[1])
    next.setHours(Math.min(23, Math.max(0, shifted)), Math.min(59, Math.max(0, minute)), 0, 0)
    return next
  }
  if (en) {
    let hour = Number(en[1])
    const minute = en[2] ? Number(en[2]) : 0
    const pm = /p/i.test(en[3] ?? '')
    if (pm && hour < 12) hour += 12
    if (!pm && hour === 12) hour = 0
    next.setHours(hour, minute, 0, 0)
  }
  return next
}

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

/** End of the named week (Sunday 18:00), so "next week" is fully behind us. */
function endOfWeekDate(now: Date, weekOffset: number): Date {
  const sinceMonday = (now.getDay() + 6) % 7
  const daysToSunday = 6 - sinceMonday + weekOffset * 7
  return atLocalHour(now, daysToSunday)
}

/** Last day of the named month, so a month-only plan is not read as day one. */
function endOfMonthDate(now: Date, monthOffset: number): Date {
  return new Date(now.getFullYear(), now.getMonth() + monthOffset + 1, 0, 18, 0, 0, 0)
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

/**
 * Week- and month-only phrases. They are used only when no precise day was
 * named, so "下周三" still wins over the broader "下周".
 */
const COARSE_RULES: DueRule[] = [
  { pattern: /这个月|這個月|本月|今月|이번\s*달|this month/iu, resolve: (now) => endOfMonthDate(now, 0) },
  { pattern: /下个月|下個月|下月|来月|來月|다음\s*달|next month/iu, resolve: (now) => endOfMonthDate(now, 1) },
  { pattern: /这周|這週|本周|今週|이번\s*주|this week/iu, resolve: (now) => endOfWeekDate(now, 0) },
  { pattern: /下周|下週|下个星期|下個星期|来週|來週|다음\s*주|next week/iu, resolve: (now) => endOfWeekDate(now, 1) },
]

/**
 * The day the words name, with the clock they carry. The first day phrase
 * in the text wins, and a clock anywhere in the text sets the hour.
 */
export function findDue(text: string, now: Date): { at: string; text: string } | null {
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
  if (!hits.length) {
    for (const rule of COARSE_RULES) {
      const match = rule.pattern.exec(text)
      if (match) hits.push({ index: match.index, at: rule.resolve(now, match), text: match[0] })
    }
  }
  hits.sort((left, right) => left.index - right.index)
  const best = hits[0]
  if (!best) return null
  const at = hasExplicitClock(text) ? applyClock(text, best.at) : best.at
  return { at: at.toISOString(), text: best.text }
}

/** Re-parse a due phrase after the user edits a loop in the memory view. */
export function dueFromText(text: string, nowIso: string): { loopDueAt?: string; loopDueText?: string } {
  const due = findDue(text, new Date(nowIso))
  if (!due) return {}
  return { loopDueAt: due.at, loopDueText: due.text }
}

/** A full day after the event, so the ask lands after it is over. */
export const EVENT_FOLLOW_UP_DELAY_MS = 24 * 60 * 60 * 1000

/** The moment a post-event check becomes appropriate. NaN without a due time. */
export function eventFollowUpMs(dueIso: string | undefined): number {
  if (!dueIso) return Number.NaN
  const due = Date.parse(dueIso)
  return Number.isFinite(due) ? due + EVENT_FOLLOW_UP_DELAY_MS : Number.NaN
}

/** Legacy rows have no loopKind, so they stay commitments. */
export function loopKindOf(memory: Pick<MemoryItem, 'loopKind'>): LoopKind {
  return memory.loopKind === 'event' ? 'event' : 'commitment'
}

const PLACE_LEAD = /^(?:我|已经|已|选择了|选了|约了|去了|到了|在|去|到|下(?:周|星期)|明[天日]|后[天日]|今[天晚日]|今晚|上午|下午|晚上|早上|凌晨|中午|傍晚|(?:周|星期)[一二三四五六日天]|[零〇一二两三兩四五六七八九十0-9]{1,3}(?:点|點|时|時)(?:半|一刻|[0-9]{1,2})?)/u

/** Drop the clock and the verb that the hall pattern swallowed. */
function trimPlaceLead(value: string): string {
  let place = value.replace(/的/gu, '')
  for (let guard = 0; guard < 8 && place.length > 2 && PLACE_LEAD.test(place); guard += 1) {
    place = place.replace(PLACE_LEAD, '')
  }
  return place.trim()
}

/** A hall, center, or station the user named. Leading verbs and 的 are dropped. */
export function findPlace(text: string): string | undefined {
  const match = PLACE_ZH.exec(text)
  if (!match?.[1]) return undefined
  const stripped = trimPlaceLead(match[1])
  const place = stripped.length >= 2 ? stripped : match[1].replace(/的/gu, '').trim()
  return place.length >= 2 ? place.slice(0, 40) : undefined
}

/** Stable key so "办护照" and a later passport detail share one loop. */
export function commitmentSlotKey(text: string): string {
  for (const [pattern, key] of KNOWN_SLOTS) {
    if (pattern.test(text)) return key
  }
  const grams = text.match(/[\u3400-\u9fff]{2}/gu) ?? []
  const words = text.toLowerCase().match(/[a-z]{4,}/gu) ?? []
  const token = [...grams, ...words].find((item) => item.length >= 2)
  return `loop.${(token ?? 'task').slice(0, 24)}`
}

/** One evidence row. The quote is the user's words, not a paraphrase. */
export function evidenceFromUtterance(text: string, at: string, messageId?: string): MemoryEvidence {
  const stamp = Number.isFinite(Date.parse(at)) ? new Date(at).toISOString() : new Date().toISOString()
  return {
    quote: text.trim().slice(0, 240),
    at: stamp,
    day: localDayKey(Date.parse(stamp)),
    ...(messageId ? { messageId } : {}),
  }
}

/** Newest first, capped at five. Identical quotes are not repeated. */
export function appendEvidence(existing: readonly MemoryEvidence[] | undefined, next: MemoryEvidence): MemoryEvidence[] {
  const quote = next.quote.trim()
  if (!quote) return existing ? [...existing] : []
  const rest = (existing ?? []).filter((item) => item.quote.trim() !== quote)
  return [next, ...rest].slice(0, 5)
}

function isOpen(memory: MemoryItem): boolean {
  return memory.kind === 'open_loop'
    && memory.enabled !== false
    && memory.status !== 'archived'
    && memory.status !== 'superseded'
    && (memory.loopStatus ?? 'open') === 'open'
    && memory.migrated !== true
}

function stampUpdate(
  memory: MemoryItem,
  nowIso: string,
  quote: string,
  messageRef: string,
  index: number,
): MemoryOpRecord {
  return {
    id: `memory-op-absorb-${index}-${Date.parse(nowIso) || index}`,
    at: nowIso,
    actor: 'turn',
    op: 'UPDATE',
    targetIds: [memory.id],
    reason: 'loop-detail',
    evidenceQuote: quote.slice(0, 240),
    messageRef: messageRef.slice(0, 120),
    before: [{ ...memory }],
  }
}

const STATEMENT_BREAK = /[。！？!?;\n]/u

/**
 * The statement of a follow-up that moves the due date. A turn can hold
 * several sentences, and only the one that names a clock is about the
 * time. A statement that repeats the loop's own words is not a move.
 */
function dueStatement(text: string, target: MemoryItem): string {
  const own = target.content.trim()
  for (const part of text.split(STATEMENT_BREAK)) {
    const statement = part.trim()
    if (!statement || statement === own) continue
    if (!hasExplicitClock(statement)) continue
    return statement
  }
  return ''
}

export interface LoopAbsorbResult {
  memories: MemoryItem[]
  ops: MemoryOpRecord[]
}

/**
 * Fold a follow-up into the open loop it belongs to.
 * A new topic becomes its own loop later; this function only updates.
 */
export function absorbLoopFollowUp(
  memories: readonly MemoryItem[],
  utterance: string,
  nowIso: string,
  messageId?: string,
  slotsOf?: (text: string) => string,
): LoopAbsorbResult {
  const text = utterance.trim()
  if (!text || isSensitiveMemoryText(text)) return { memories: [...memories], ops: [] }
  const slotOf = slotsOf ?? commitmentSlotKey
  const place = findPlace(text)
  const clock = hasExplicitClock(text)
  const slot = slotOf(text)
  const open = memories.filter(isOpen)
  const known = KNOWN_SLOTS.some(([pattern]) => pattern.test(text))
  const target = known
    ? open.find((memory) => memory.slotKey === slot)
    : open.length === 1 ? open[0] : undefined
  if (!target) return { memories: [...memories], ops: [] }
  if (!place && !clock && !known) return { memories: [...memories], ops: [] }
  // A follow-up may name a new day without naming a clock or a hall.
  const spoken = dueStatement(text, target)
  const spokenDue = spoken ? dueFromText(spoken, nowIso) : {}
  if (!place && !clock && !spokenDue.loopDueAt) return { memories: [...memories], ops: [] }

  let dueAt = target.loopDueAt
  let dueText = target.loopDueText
  if (spokenDue.loopDueAt) {
    // The follow-up names a day, so it replaces the stored one and the
    // words that go with it.
    dueAt = spokenDue.loopDueAt
    dueText = spokenDue.loopDueText
  } else if (clock && dueAt) {
    dueAt = applyClock(text, new Date(dueAt)).toISOString()
  }
  const evidence = appendEvidence(
    target.evidence,
    evidenceFromUtterance(text, nowIso, messageId),
  )
  const messageRef = messageId || evidence[0]?.messageId || target.id
  const nextMemory: MemoryItem = {
    ...target,
    updatedAt: nowIso,
    slotKey: target.slotKey ?? (known ? slot : target.slotKey),
    ...(place ? { loopPlace: place } : {}),
    ...(dueAt ? { loopDueAt: dueAt } : {}),
    ...(dueText ? { loopDueText: dueText } : {}),
    evidence,
  }
  const changed = nextMemory.loopPlace !== target.loopPlace
    || nextMemory.loopDueAt !== target.loopDueAt
    || nextMemory.loopDueText !== target.loopDueText
    || (nextMemory.evidence?.length ?? 0) !== (target.evidence?.length ?? 0)
  if (!changed) return { memories: [...memories], ops: [] }
  return {
    memories: memories.map((memory) => (memory.id === target.id ? nextMemory : memory)),
    ops: [stampUpdate(target, nowIso, text, messageRef, 0)],
  }
}
