// Keeps the human thread between the evening bracket and the next
// morning. The evening asks what is happening tomorrow; the first reply
// that mentions tomorrow becomes a short quoted topic. The morning then
// prefers that topic over a dated event from the open-loop list.
//
// Pure string/date logic only. Storage and chat wiring live in the hook.

import { isSameLocalDay } from '../../lib/localDate.ts'
import type { ChatMessage } from '../../types/chat.ts'
import type { MemoryItem } from '../../types/memory.ts'

const MAX_TOPIC_CHARS = 80
const EVENING_TOPIC_MAX_AGE_MS = 14 * 60 * 60_000

const TOMORROW_MARKER = /(明天|明早|明日|明儿|明兒|\btomorrow\b|あした|あす|내일)/iu
const LEADING_FILLER = /^(?:嗯|呃|那个|那個|就是|然后|然後|不过|不過|但是|可是|而且|and|but|so|well)\s*[，,]?\s*/iu
const LEADING_DAY_WORD = /^(?:今天|今日|今晚|明天|明日|明早|tomorrow|today|tonight|오늘|내일|あした|あす)\s*[，,]?\s*/iu

function truncateTopic(value: string): string {
  const text = value.replace(/\s+/gu, ' ').trim()
  if (text.length <= MAX_TOPIC_CHARS) return text
  return `${text.slice(0, MAX_TOPIC_CHARS - 1).trimEnd()}…`
}

/** Turn "tomorrow" into "today" because the morning quote is read today. */
function shiftTomorrowToToday(value: string): string {
  return value
    .replace(/\btomorrow(\s+morning)?\b/giu, (match, morning: string | undefined) => {
      const upper = match.startsWith('T')
      if (morning) return upper ? 'This morning' : 'this morning'
      return upper ? 'Today' : 'today'
    })
    .replace(/明天早上|明早|明天早晨/gu, '今天早上')
    .replace(/明天|明日|明儿|明兒/gu, '今天')
    .replace(/あした|あす/gu, '今日')
    .replace(/내일/gu, '오늘')
}

/**
 * Pull the clause that mentions tomorrow from one user message.
 * Returns null when the message says nothing about tomorrow.
 */
export function extractTomorrowTopic(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed || !TOMORROW_MARKER.test(trimmed)) return null

  const clauses = trimmed
    .split(/[。.!！？?；;，,\n]+/u)
    .map((clause) => clause.trim())
    .filter(Boolean)
  const clause = clauses.find((part) => TOMORROW_MARKER.test(part))
  if (!clause) return null

  const topic = truncateTopic(
    shiftTomorrowToToday(clause)
      .replace(LEADING_FILLER, '')
      .replace(/^[「『“"'（(]+|[」』”"'）)]+$/gu, '')
      .replace(/[。！？!?；;，,]+$/u, '')
      .trim(),
  )
  return topic.length > 0 ? topic : null
}

export type EveningTopicPick = { topic: string; atMs: number }

/**
 * Latest user reply after the evening bracket that talks about tomorrow.
 * Scanning backwards means a correction in a later message wins.
 */
export function latestTomorrowTopic(
  messages: readonly Pick<ChatMessage, 'role' | 'content' | 'createdAt'>[],
  afterMs: number,
): EveningTopicPick | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (!message || message.role !== 'user') continue
    const atMs = Date.parse(message.createdAt)
    if (!Number.isFinite(atMs) || atMs <= afterMs) continue
    const topic = extractTomorrowTopic(message.content)
    if (topic) return { topic, atMs }
  }
  return null
}

/** Drop the date words the loop captured so the morning line stays short. */
function shortEventTopic(memory: MemoryItem): string {
  const original = memory.content.trim()
  const dueText = memory.loopDueText?.trim()
  let topic = dueText ? original.replace(dueText, '') : original
  topic = topic.replace(LEADING_DAY_WORD, '').trim()
  return truncateTopic(topic || original)
}

/** A dated event on the local calendar day, used if the evening was quiet. */
export function findTodayEventTopic(memories: readonly MemoryItem[], nowMs: number): string | null {
  for (const memory of memories) {
    if (memory.kind !== 'open_loop') continue
    if (memory.loopKind !== 'event') continue
    if (memory.enabled === false) continue
    if (memory.status === 'archived' || memory.status === 'superseded') continue
    if ((memory.loopStatus ?? 'open') !== 'open') continue
    const dueMs = memory.loopDueAt ? Date.parse(memory.loopDueAt) : Number.NaN
    if (!Number.isFinite(dueMs) || !isSameLocalDay(dueMs, nowMs)) continue
    return shortEventTopic(memory)
  }
  return null
}

export type MorningTopicKind = 'evening' | 'event'
export type MorningTopic = { kind: MorningTopicKind; topic: string }

type EveningTopicState = {
  eveningTopic?: string
  eveningTopicAtMs?: number
}

/**
 * What the morning greeting should call back: last night's tomorrow plan
 * first, then a dated event on today's calendar. Stale evening topics are
 * ignored so a missed morning never repeats an old conversation.
 */
export function morningCallbackTopic(
  state: EveningTopicState,
  memories: readonly MemoryItem[],
  nowMs: number,
): MorningTopic | null {
  const atMs = state.eveningTopicAtMs
  if (
    state.eveningTopic
    && atMs != null
    && atMs <= nowMs
    && nowMs - atMs <= EVENING_TOPIC_MAX_AGE_MS
  ) {
    return { kind: 'evening', topic: state.eveningTopic }
  }
  const event = findTodayEventTopic(memories, nowMs)
  return event ? { kind: 'event', topic: event } : null
}
