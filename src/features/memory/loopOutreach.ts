/**
 * Hark-style copy for one open loop.
 *
 * A clear plan already has a night-before reminder, so the card confirms
 * the date and the place. A plan with a gap still asks before creating one.
 * After the due time the card asks once whether the thing got done.
 * None of these lines asserts that the user forgot.
 */

import type { ReminderTaskDraftInput } from '../reminders/schedule.ts'
import type { Translator } from '../../types/i18n.ts'
import type { MemoryItem } from '../../types/memory.ts'
import { hasExplicitClock } from './loopDetails.ts'
import { isNagFreeMemory } from './memoryRules.ts'
import { loopPlanReading } from './openLoops.ts'

export interface LoopOutreachWhy {
  summary: string
  quote: string
  at: string
  place?: string
  dueText?: string
}

export interface LoopOutreachOffer {
  memoryId: string
  title: string
  nightBeforeAt: string
}

export interface LoopOutreach {
  phase: 'preview' | 'check'
  /** `confirm` means the night-before reminder is already booked. */
  mode: 'confirm' | 'ask'
  text: string
  why: LoopOutreachWhy
  offer: LoopOutreachOffer | null
  /** Set on the post-due ask so the card can offer done / not yet / reschedule. */
  check: { memoryId: string } | null
}

type Translate = Translator

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * Chinese sentences already end on their own punctuation. English ones
 * end on "." and need a space before the next sentence.
 */
function joinSentences(parts: readonly string[]): string {
  return parts.filter(Boolean).reduce((text, part) => {
    if (!text) return part
    const needsSpace = /[.?!]$/.test(text) && !/^\s/u.test(part)
    return `${text}${needsSpace ? ' ' : ''}${part}`
  }, '')
}

function clockLabel(date: Date): string {
  const minute = date.getMinutes()
  const hour = date.getHours()
  return minute === 0 ? `${hour}:00` : `${hour}:${pad(minute)}`
}

/**
 * Locale date for the card. A placeholder 18:00 is not a clock the user
 * named, so the ask path shows the day only.
 */
function formatLoopWhen(iso: string, namedClock: boolean, t: Translate): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const month = date.getMonth() + 1
  const day = date.getDate()
  if (!namedClock) return t('proactive.loop.when_day', { month, day })
  return t('proactive.loop.when', { month, day, clock: clockLabel(date) })
}

function namedClock(memory: MemoryItem): boolean {
  const quotes = [memory.content, ...(memory.evidence ?? []).map((item) => item.quote)]
  return quotes.some((quote) => hasExplicitClock(quote))
}

function prepKey(memory: MemoryItem): 'proactive.loop.prep_passport' | 'proactive.loop.prep_report' | 'proactive.loop.prep_generic' {
  const text = `${memory.slotKey ?? ''} ${memory.content}`
  if (/护照|護照|passport/iu.test(text)) return 'proactive.loop.prep_passport'
  if (/报告|報告|report/iu.test(text)) return 'proactive.loop.prep_report'
  return 'proactive.loop.prep_generic'
}

/** 20:00 local time on the evening before the due timestamp. */
export function nightBeforeIso(dueIso: string): string | null {
  const due = new Date(dueIso)
  if (Number.isNaN(due.getTime())) return null
  const night = new Date(due.getFullYear(), due.getMonth(), due.getDate() - 1, 20, 0, 0, 0)
  return night.toISOString()
}

/**
 * True when the loop already has a night-before reminder booked.
 * The booked state belongs to the reminder, not to how clear the plan
 * reads, so an offer the person accepted still counts as booked.
 */
export function isLoopBooked(memory: MemoryItem): boolean {
  return Boolean(memory.loopReminderTaskId)
}

/**
 * What to say for this loop at `nowMs`.
 * Null when the loop is closed, migrated, or not inside the preview/check window.
 */
export function buildLoopOutreach(memory: MemoryItem, nowMs: number, t: Translate): LoopOutreach | null {
  if (memory.kind !== 'open_loop') return null
  if ((memory.loopStatus ?? 'open') !== 'open') return null
  if (isNagFreeMemory(memory)) return null
  const dueMs = memory.loopDueAt ? Date.parse(memory.loopDueAt) : Number.NaN
  if (!Number.isFinite(dueMs)) return null
  const quote = memory.evidence?.[0]?.quote || memory.content
  const where = memory.loopPlace?.trim() ?? ''
  const when = formatLoopWhen(memory.loopDueAt ?? '', namedClock(memory), t)
  const what = memory.content.trim()
  const why: LoopOutreachWhy = {
    summary: what,
    quote,
    at: memory.evidence?.[0]?.at || memory.createdAt,
    ...(where ? { place: where } : {}),
    ...(memory.loopDueText ? { dueText: memory.loopDueText } : {}),
  }
  if (nowMs >= dueMs) {
    if (memory.loopCheckAskedAt) return null
    return {
      phase: 'check',
      mode: 'ask',
      text: t('proactive.loop.check', { what }),
      why,
      offer: null,
      check: { memoryId: memory.id },
    }
  }
  const night = nightBeforeIso(memory.loopDueAt ?? '')
  const offer = night ? { memoryId: memory.id, title: what.slice(0, 80), nightBeforeAt: night } : null
  const booked = isLoopBooked(memory)
  if (booked) {
    const text = where
      ? t('proactive.loop.confirmed', { when, where })
      : t('proactive.loop.confirmed_no_place', { when })
    return { phase: 'preview', mode: 'confirm', text, why, offer, check: null }
  }
  const placeBit = where ? t('proactive.loop.place', { where }) : ''
  const text = joinSentences([
    t('proactive.loop.preview', { what, when, place: placeBit }),
    t(prepKey(memory)),
    t('proactive.loop.offer'),
  ])
  return { phase: 'preview', mode: 'ask', text, why, offer, check: null }
}

/**
 * Night-before reminder for a clear plan, or the reminder created when the
 * user accepts an ask card. If that evening has already passed, the reminder
 * is one hour before the due time, and only when that is still in the future.
 */
export function loopReminderDraft(memory: MemoryItem, nowMs: number): ReminderTaskDraftInput | null {
  if (!memory.loopDueAt) return null
  const dueMs = Date.parse(memory.loopDueAt)
  if (!Number.isFinite(dueMs) || dueMs <= nowMs) return null
  const nightMs = Date.parse(nightBeforeIso(memory.loopDueAt) ?? '')
  let atMs = nightMs
  if (!Number.isFinite(atMs) || atMs <= nowMs) atMs = dueMs - 60 * 60 * 1000
  if (atMs <= nowMs) return null
  const title = memory.content.trim().slice(0, 80)
  const where = memory.loopPlace ? ` ${memory.loopPlace}` : ''
  return {
    title,
    prompt: `${title}${where}`,
    speechText: title,
    action: { kind: 'notice' },
    enabled: true,
    schedule: { kind: 'at', at: new Date(atMs).toISOString() },
  }
}

export interface ClearPlanReminderDraft {
  memoryId: string
  draft: ReminderTaskDraftInput
}

/**
 * Drafts for clear plans that do not have a reminder yet.
 * A second call is empty once `loopReminderTaskId` is set.
 */
export function clearPlanReminderDrafts(memories: readonly MemoryItem[], nowMs: number): ClearPlanReminderDraft[] {
  const drafts: ClearPlanReminderDraft[] = []
  for (const memory of memories) {
    if (isLoopBooked(memory)) continue
    if (loopPlanReading(memory) !== 'clear') continue
    const draft = loopReminderDraft(memory, nowMs)
    if (!draft) continue
    drafts.push({ memoryId: memory.id, draft })
  }
  return drafts
}

/**
 * Create the night-before reminder for each clear plan and stamp its id.
 * Returns the same array when there is nothing new to book.
 */
export function bookClearPlanReminders(
  memories: readonly MemoryItem[],
  nowMs: number,
  create: (draft: ReminderTaskDraftInput) => { id: string } | null | undefined,
): MemoryItem[] {
  const drafts = clearPlanReminderDrafts(memories, nowMs)
  if (!drafts.length) return memories as MemoryItem[]
  const ids = new Map<string, string>()
  for (const item of drafts) {
    const created = create(item.draft)
    if (created?.id) ids.set(item.memoryId, created.id)
  }
  if (!ids.size) return memories as MemoryItem[]
  const stamp = new Date(nowMs).toISOString()
  return memories.map((memory) => {
    const taskId = ids.get(memory.id)
    return taskId ? { ...memory, loopReminderTaskId: taskId, updatedAt: stamp } : memory
  })
}

/** True when the line is a question and does not claim the user forgot. */
export function outreachAsks(text: string): boolean {
  if (/你忘了|你忘記|you forgot|忘れている|잊어버렸/iu.test(text)) return false
  return /[?？吗嗎か까]/.test(text) || /吗？|嗎？|ですか|할까요/u.test(text)
}
