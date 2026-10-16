/**
 * Hark-style copy for one open loop.
 *
 * Before the due time the line confirms what, when, and where, adds a short
 * prep note, and asks whether to remind the user the night before.
 * After the due time it asks once whether the thing got done.
 * Both are questions. Neither asserts that the user forgot.
 */

import type { ReminderTaskDraftInput } from '../reminders/schedule.ts'
import type { Translator } from '../../types/i18n.ts'
import type { MemoryItem } from '../../types/memory.ts'
import { isNagFreeMemory } from './memoryRules.ts'

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

/** Local date and clock, short enough for a bubble. */
export function formatLoopWhen(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const hour = date.getHours()
  const minute = date.getMinutes()
  const clock = minute === 0 ? `${hour}:00` : `${hour}:${pad(minute)}`
  return `${date.getMonth() + 1}/${date.getDate()} ${clock}`
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
  const when = formatLoopWhen(memory.loopDueAt ?? '')
  const where = memory.loopPlace?.trim() ?? ''
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
      text: t('proactive.loop.check', { what }),
      why,
      offer: null,
      check: { memoryId: memory.id },
    }
  }
  const night = nightBeforeIso(memory.loopDueAt ?? '')
  const placeBit = where ? t('proactive.loop.place', { where }) : ''
  const text = joinSentences([
    t('proactive.loop.preview', { what, when, place: placeBit }),
    t(prepKey(memory)),
    t('proactive.loop.offer'),
  ])
  return {
    phase: 'preview',
    text,
    why,
    offer: night ? { memoryId: memory.id, title: what.slice(0, 80), nightBeforeAt: night } : null,
    check: null,
  }
}

/**
 * Reminder created only after the user accepts the card.
 * If the evening before has already passed, the reminder is one hour before
 * the due time, and only when that is still in the future.
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

/** True when the line is a question and does not claim the user forgot. */
export function outreachAsks(text: string): boolean {
  if (/你忘了|你忘記|you forgot|忘れている|잊어버렸/iu.test(text)) return false
  return /[?？吗嗎か까]/.test(text) || /吗？|嗎？|ですか|할까요/u.test(text)
}
