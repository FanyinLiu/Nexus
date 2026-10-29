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
  commitmentSlotKey,
  evidenceFromUtterance,
  findDue,
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
const PAST_PLAN = /(?:昨天|昨日|前天|上周|上週|上个?星期|上個?星期|去年|已经去了|已經去了|已经办了|已經辦了|去过了|去過了|办过了|辦過了|先週|어제|지난\s*주|작년|\byesterday\b|\blast (?:week|year)\b)/iu
const PLACE_MATTERS = /(?:护照|護照|passport|面试|面試|interview|会议|會議|meeting|大厅|大廳|去办|去辦|预约|預約)/iu

/**
 * Life events that carry a date but do not need a commitment verb.
 * Kept narrow on purpose: a false capture is a nudge the user did not ask for.
 */
const EVENT_NOUN = /(?:面试|面試|考试|考試|体检|體檢|复查|復查|医院|醫院|看病|手术|手術|搬家|出差|旅行|旅游|旅遊|约会|約會|相亲|相親|演示|答辩|答辯|汇报|彙報|演讲|演講|比赛|比賽|生日|婚礼|婚禮|聚会|聚會|开会|開會|会议|會議|面接|試験|病院|検査|引っ越し|出張|デート|プレゼン|発表|誕生日|結婚式|会議|パーティー|면접|시험|병원|검진|이사|출장|여행|데이트|발표|생일|결혼식|회의|파티|\b(?:interview|exam|test|doctor|hospital|checkup|surgery|dentist|appointment|moving|move|trip|travel|flight|date|presentation|birthday|wedding|party|meeting)\b)/iu
const EVENT_QUESTION = /(?:[?？]|(?:吗|嗎|か|까)\s*[。.!！]?$)/u
const EVENT_NEGATION = /(?:不去|沒去|没去|不想去|不用去|不参加|不參加|取消|延期|推迟|推遲|改期|\bnot going\b|\bdidn'?t go\b|\bwon'?t go\b|\bcancel(?:led|ed)?\b|\bpostpon(?:e|ed)\b|\bcall(?:ed)? off\b|キャンセル|中止|行かない|취소|안\s*가)/iu
const EVENT_OTHER = /(?:我(?:的)?(?:同事|朋友|室友|老板|老闆|同学|同學|家人|妈妈|媽媽|爸爸|对象|對象|男友|女友|孩子)|别人|別人|(?:他|她|他们|她们|他們|她們)(?:说|說|要|会|會|打算|准备|準備|去|有)|\b(?:my (?:friend|colleague|coworker|roommate|boss|mom|mum|dad|sister|brother|partner|wife|husband|kid|child)|he|she|they)\b)/iu
/** Preparing for an event is a task, not the event itself. */
const EVENT_PREP = /(?:(?:准备|準備|复习|複習|备考|備考|为了|為了).{0,8}(?:面试|面試|考试|考試|interview|exam)|(?:面试|面試|考试|考試|interview|exam)(?:的)?(?:准备|準備|复习|複習|材料|资料|資料)|prepar(?:e|ing) for (?:an? )?(?:interview|exam)|study(?:ing)? for (?:an? )?(?:interview|exam))/iu

export type EventReading = 'event' | 'skip' | 'none'

export type PlanClarity = 'clear' | 'ask' | 'none'
const DISMISS = /(?:don'?t remind me|do not remind me|别再?提醒|別再?提醒|不用提醒|不要提醒|提醒しないで|リマインドしない|그만\s*알려|알리지\s*마)/iu
const BARE_DONE = /^(?:done|finished|all done|完成了|做完了|搞定了|終わった|終わったよ|끝냈어|완료)[.!?。]?$/iu
const BARE_SNOOZE = /^(?:later|not now|snooze|稍后|等会|等一下|晚点|あとで|後で|나중에|잠시만)[.!?。]?$/iu
const BARE_DISMISS = /^(?:don'?t remind me(?: about this)?|别提醒我|別提醒我|不用提醒|不要再提醒|提醒しないで|リマインドしないで|그만 알려줘|알리지 마)[.!?。]?$/iu

function splitSegments(content: string): string[] {
  return content
    .split(/(?<=[。！？!?;\n])/u)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length >= 4)
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
 * Whether a sentence is the user's own dated event.
 * `skip` is an event-shaped sentence we deliberately do not keep: a question,
 * a negation, someone else's plan, a hypothetical, or the past. It must not
 * fall through to commitment capture.
 */
export function classifyEventUtterance(text: string, now: Date | string): EventReading {
  const value = text.trim()
  if (!value || isSensitiveMemoryText(value)) return 'skip'
  if (!EVENT_NOUN.test(value)) return 'none'
  if (EVENT_PREP.test(value)) return 'none'
  if (HYPOTHETICAL.test(value) || PAST_PLAN.test(value) || EVENT_NEGATION.test(value)) return 'skip'
  if (EVENT_QUESTION.test(value) || EVENT_OTHER.test(value)) return 'skip'
  const clock = now instanceof Date ? now : new Date(now)
  const at = Number.isNaN(clock.getTime()) ? new Date() : clock
  return findDue(value, at) ? 'event' : 'none'
}

/**
 * Reading of a stored loop, including details added in a later turn.
 * The original sentence still has to be the user's own plan. A follow-up
 * can supply the clock and the hall that make it clear.
 */
export function loopPlanReading(memory: MemoryItem): PlanClarity {
  if (memory.kind !== 'open_loop' || memory.migrated === true) return 'none'
  if (memory.loopKind === 'event') return 'none'
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
 * Pull commitment and event segments out of one utterance. Completion and
 * dismiss lines are not new loops; the resolver handles those.
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
  for (const raw of splitSegments(text)) {
    const question = /[?？]\s*$/u.test(raw)
    const segment = raw.replace(/[。！？!?;\n]+$/u, '').trim()
    if (!segment) continue
    const eventReading = question && EVENT_NOUN.test(segment)
      ? 'skip'
      : classifyEventUtterance(segment, clock)
    if (eventReading === 'skip') continue
    const isEvent = eventReading === 'event'
    if (!isEvent && classifyPlanUtterance(segment, clock) === 'none') continue
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
      loopKind: isEvent ? 'event' : 'commitment',
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
      ...(loop.loopKind ? { loopKind: loop.loopKind } : {}),
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

export function listLoopMemories(memories: readonly MemoryItem[]): MemoryItem[] {
  return memories.filter((memory) => (
    memory.kind === 'open_loop'
    && memory.enabled !== false
    && memory.status !== 'archived'
    && memory.status !== 'superseded'
  ))
}
