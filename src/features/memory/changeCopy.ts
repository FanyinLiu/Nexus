/**
 * Plain names for memory rows and op-log lines.
 *
 * The settings page must not show op codes, reasons, or storage ids.
 * A topic token is translated by the caller; everything else is a short clip
 * of what the user actually said.
 */

import type { MemoryItem, MemoryOpRecord } from '../../types/memory.ts'

const EDITED_SUFFIX = /\s*[（(]\s*(?:改过|已编辑|edited)\s*[）)]\s*$/iu

export type MemoryTopic = 'passport' | 'report' | 'interview' | 'meeting'

export type MemoryChangeKey =
  | 'memory.change.done'
  | 'memory.change.later'
  | 'memory.change.moved'
  | 'memory.change.detail'
  | 'memory.change.added'
  | 'memory.change.merged'
  | 'memory.change.replaced'
  | 'memory.change.removed'
  | 'memory.change.undone'
  | 'memory.change.updated'
  | 'memory.change.cancelled'
  | 'memory.change.dismissed'
  | 'memory.change.deleted'

/** Drop a trailing "edited" marker so the row can show a tag instead. */
export function displayMemoryText(content: string): string {
  const cleaned = content.replace(EDITED_SUFFIX, '').trim()
  return cleaned || content.trim()
}

/** Known commitments get a short topic. Unknown text stays custom. */
export function memoryTopicToken(text: string): MemoryTopic | null {
  const source = displayMemoryText(text)
  if (/护照|護照|passport/iu.test(source)) return 'passport'
  if (/报告|報告|report/iu.test(source)) return 'report'
  if (/面试|面試|interview/iu.test(source)) return 'interview'
  if (/会议|會議|meeting/iu.test(source)) return 'meeting'
  return null
}

/** First clause, short enough for a card title or a change sentence. */
export function plainMemoryName(content: string): string {
  const text = displayMemoryText(content)
  const clause = text.split(/[，,。.!！？?\n]/u)[0]?.trim() || text
  return clause.slice(0, 18)
}

/**
 * Which sentence to show for one op. The reason string is only a lookup key
 * and is never returned.
 */
export function memoryChangeKey(entry: MemoryOpRecord): MemoryChangeKey {
  if (entry.reason === 'user-deleted') return 'memory.change.deleted'
  if (entry.op === 'UNDO') return 'memory.change.undone'
  if (entry.op === 'ADD') return 'memory.change.added'
  if (entry.op === 'MERGE') return 'memory.change.merged'
  if (entry.op === 'SUPERSEDE') return 'memory.change.replaced'
  if (entry.op === 'DELETE') return 'memory.change.removed'
  if (entry.reason === 'loop-done') return 'memory.change.done'
  if (entry.reason === 'loop-later') return 'memory.change.later'
  if (entry.reason === 'loop-moved') return 'memory.change.moved'
  if (entry.reason === 'loop-detail') return 'memory.change.detail'
  if (entry.reason === 'loop-cancel') return 'memory.change.cancelled'
  if (entry.reason === 'loop-dismissed') return 'memory.change.dismissed'
  return 'memory.change.updated'
}

/** Wording the sentence should quote: the row before the op, then the live row. */
export function memoryChangeSource(entry: MemoryOpRecord, memories: readonly MemoryItem[]): string {
  const prior = entry.before?.find((row) => row.content.trim())
  if (prior) return prior.content
  const live = memories.find((row) => entry.targetIds.includes(row.id) && row.content.trim())
  if (live) return live.content
  return ''
}

/**
 * Month and day for a portrait card. `template` is the locale string,
 * for example `{month}月{day}日`, so the card does not show `10.20.26`.
 */
export function formatPortraitDate(iso: string | null, template: string): string {
  if (!iso || !template) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return template
    .replaceAll('{month}', String(date.getMonth() + 1))
    .replaceAll('{day}', String(date.getDate()))
}

/** Local month/day for a change row, such as 10/16. */
export function memoryChangeDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getMonth() + 1}/${date.getDate()}`
}
