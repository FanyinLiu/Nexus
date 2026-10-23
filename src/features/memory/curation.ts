/**
 * Deterministic daily cleanup that does not wait on a model.
 *
 * Duplicate slot facts are superseded, resolved loops are archived, and a
 * due date that no longer matches the words the user used is repaired
 * from the day they said it. Pinned and edited rows are skipped.
 */

import type { MemoryItem, MemoryOpRecord } from '../../types/memory.ts'
import { dueFromText, hasExplicitClock } from './loopDetails.ts'
import { destructiveOpCap, isUserOwnedMemory, isUserProtectedMemory } from './memoryRules.ts'

const CITY_ZH = /我(?:现在|已|已经)?(?:住在|搬到|搬去)([^，。,.\s]{1,16})/u
const CITY_EN = /\bI (?:now )?live in ([A-Za-z][A-Za-z ]{1,24})|\bI moved to ([A-Za-z][A-Za-z ]{1,24})/iu

function active(memory: MemoryItem): boolean {
  return memory.enabled !== false && memory.status !== 'archived' && memory.status !== 'superseded'
}

/** City named in a move or "I live in" sentence. Empty when it is not a city fact. */
export function cityValue(text: string): string | null {
  const zh = CITY_ZH.exec(text)
  if (zh?.[1]) return zh[1].replace(/了$/u, '').trim() || null
  const en = CITY_EN.exec(text)
  const value = (en?.[1] || en?.[2] || '').trim()
  return value || null
}

function stamp(memory: MemoryItem): MemoryItem {
  const city = cityValue(memory.content)
  if (!city) return memory
  if (memory.slotKey === 'user.home.city') return memory
  return { ...memory, slotKey: 'user.home.city' }
}

function sameDay(leftIso: string, rightIso: string): boolean {
  const left = new Date(leftIso)
  const right = new Date(rightIso)
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate()
}

/**
 * The day the due phrase was said. The newest evidence that repeats the
 * phrase is the day the person last named it; older words fall back to
 * the day the loop was created.
 */
function duePhraseDay(memory: MemoryItem): string {
  const phrase = memory.loopDueText
  if (phrase) {
    for (const item of memory.evidence ?? []) {
      if (item.quote.includes(phrase)) return item.at
    }
  }
  return memory.createdAt
}

/** Every word the person used about this loop, the first line included. */
function loopQuotes(memory: MemoryItem): string[] {
  return [memory.content, ...(memory.evidence ?? []).map((item) => item.quote)]
}

/**
 * Re-read the due phrase against the day it was said.
 * A clock the user added later is kept when the calendar day still matches.
 */
export function repairLoopDue(memory: MemoryItem): MemoryItem {
  if (memory.kind !== 'open_loop' || !memory.loopDueText || !memory.loopDueAt) return memory
  if (isUserOwnedMemory(memory)) return memory
  const parsed = dueFromText(`${memory.loopDueText} ${memory.content}`, duePhraseDay(memory))
  if (!parsed.loopDueAt) return memory
  const namedClock = loopQuotes(memory).some((quote) => hasExplicitClock(quote))
  if (sameDay(parsed.loopDueAt, memory.loopDueAt)) {
    if (namedClock) return memory
    return memory.loopDueAt === parsed.loopDueAt ? memory : { ...memory, loopDueAt: parsed.loopDueAt }
  }
  const stored = new Date(memory.loopDueAt)
  const next = new Date(parsed.loopDueAt)
  if (namedClock) {
    next.setHours(stored.getHours(), stored.getMinutes(), 0, 0)
  }
  const loopDueAt = next.toISOString()
  if (loopDueAt === memory.loopDueAt) return memory
  return { ...memory, loopDueAt }
}

function op(index: number, now: string, name: MemoryOpRecord['op'], targets: MemoryItem[], reason: string, runId?: string): MemoryOpRecord {
  const quote = targets.map((item) => item.evidence?.[0]?.quote || item.content).join(' ').slice(0, 240)
  const messageRef = targets[0]?.evidence?.[0]?.messageId || targets[0]?.sourceRef || targets[0]?.id || 'curation'
  return {
    id: `memory-op-curation-${index}-${Date.parse(now) || index}`,
    at: now,
    actor: 'dream',
    op: name,
    targetIds: targets.map((item) => item.id),
    reason,
    evidenceQuote: quote,
    messageRef,
    before: targets.map((item) => ({ ...item })),
    ...(runId ? { runId } : {}),
  }
}

/**
 * Merge same-city replacements, archive finished loops, and fix due dates.
 * Stops without writing when the destructive count would pass the cap.
 */
export function curateMemories(
  memories: readonly MemoryItem[],
  now: string,
  runId?: string,
): { memories: MemoryItem[]; ops: MemoryOpRecord[] } {
  let next = memories.map(stamp)
  const ops: MemoryOpRecord[] = []
  const plannedDestructive: string[] = []

  const cities = next.filter((memory) => active(memory) && memory.slotKey === 'user.home.city' && !isUserProtectedMemory(memory))
  const newestCity = [...cities].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0]
  if (newestCity) {
    for (const older of cities) {
      if (older.id === newestCity.id) continue
      if (cityValue(older.content) === cityValue(newestCity.content)) continue
      plannedDestructive.push(older.id)
    }
  }
  for (const memory of next) {
    if (!active(memory) || isUserProtectedMemory(memory)) continue
    if (memory.kind === 'open_loop' && (memory.loopStatus === 'done' || memory.loopStatus === 'dismissed')) {
      plannedDestructive.push(memory.id)
    }
  }
  const uniqueDestructive = new Set(plannedDestructive)
  const activeCount = next.filter(active).length
  if (uniqueDestructive.size > destructiveOpCap(activeCount)) {
    return { memories: next, ops: [] }
  }

  if (newestCity) {
    for (const older of cities) {
      if (older.id === newestCity.id) continue
      if (cityValue(older.content) === cityValue(newestCity.content)) continue
      next = next.map((memory) => (
        memory.id === older.id
          ? {
            ...memory,
            status: 'superseded',
            supersededBy: newestCity.id,
            supersededAt: now,
            supersededPending: false,
            statusReason: 'city-changed',
            updatedAt: now,
          }
          : memory
      ))
      ops.push(op(ops.length, now, 'SUPERSEDE', [older, newestCity], 'city-changed', runId))
    }
  }

  next = next.map((memory) => {
    if (!active(memory) || isUserProtectedMemory(memory)) return memory
    if (memory.kind !== 'open_loop') return memory
    if (memory.loopStatus !== 'done' && memory.loopStatus !== 'dismissed') return memory
    ops.push(op(ops.length, now, 'DELETE', [memory], 'loop-resolved', runId))
    return {
      ...memory,
      status: 'archived',
      statusReason: 'loop-resolved',
      updatedAt: now,
    }
  })

  next = next.map((memory) => {
    const repaired = repairLoopDue(memory)
    if (repaired.loopDueAt === memory.loopDueAt) return repaired
    ops.push(op(ops.length, now, 'UPDATE', [memory], 'stale-date', runId))
    return { ...repaired, updatedAt: now }
  })

  return { memories: next, ops }
}
