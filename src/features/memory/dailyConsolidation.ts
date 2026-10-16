/**
 * Once-a-day reconcile. Idle, screen lock, or the first launch of the
 * local day can start it. Chat in progress and paused memory cannot.
 * The model path is optional; a missing model still refreshes loops.
 */

import type { FocusState } from '../../types/autonomy.ts'
import { isSameLocalDay } from '../../lib/localDate.ts'
import type { DailyMemoryEntry, MemoryItem } from '../../types/memory.ts'
import { absorbLoopFollowUp } from './loopDetails.ts'
import { curateMemories } from './curation.ts'
import { extractMemoriesFromMessage } from './memory.ts'
import { isSensitiveMemoryText } from './memoryRules.ts'
import {
  reconcileExtractedMemories,
  type MemoryReconcileResult,
  type MemoryTextEmbedder,
} from './reconcile.ts'

export const CONSOLIDATION_IDLE_SECONDS = 600

export type ConsolidationTrigger = 'idle' | 'locked' | 'first-launch'

export interface ConsolidationDecision {
  run: boolean
  trigger: ConsolidationTrigger | null
  reason: string
}

export function decideDailyConsolidation(input: {
  nowMs: number
  lastRunAtMs: number | null
  focusState: FocusState
  idleSeconds: number
  memoryPaused: boolean
  chatBusy: boolean
  launching: boolean
}): ConsolidationDecision {
  if (input.memoryPaused) return { run: false, trigger: null, reason: 'paused' }
  if (input.chatBusy) return { run: false, trigger: null, reason: 'chatting' }
  if (input.lastRunAtMs != null && Number.isFinite(input.lastRunAtMs) && isSameLocalDay(input.lastRunAtMs, input.nowMs)) {
    return { run: false, trigger: null, reason: 'already-ran' }
  }
  if (input.focusState === 'locked') return { run: true, trigger: 'locked', reason: 'locked' }
  const settledIdle = input.idleSeconds >= CONSOLIDATION_IDLE_SECONDS
    || input.focusState === 'away'
  if (settledIdle && input.focusState !== 'active') {
    return { run: true, trigger: 'idle', reason: 'idle' }
  }
  if (input.launching) return { run: true, trigger: 'first-launch', reason: 'first-launch' }
  return { run: false, trigger: null, reason: 'waiting' }
}

/**
 * A no-op pass copies the list. Callers must not persist that copy: a brand
 * new empty key is read as prior user data and skips the first-use guide.
 */
export function memoryListReplaced(previous: readonly MemoryItem[], next: readonly MemoryItem[]): boolean {
  if (previous.length !== next.length) return true
  for (let index = 0; index < previous.length; index += 1) {
    if (previous[index] !== next[index]) return true
  }
  return false
}

function diaryCandidates(entries: readonly DailyMemoryEntry[], sinceMs: number | null): MemoryItem[] {
  const fresh = entries.filter((entry) => {
    if (entry.role !== 'user') return false
    const stamp = Date.parse(entry.createdAt)
    if (sinceMs == null || !Number.isFinite(sinceMs)) return true
    return Number.isFinite(stamp) && stamp > sinceMs
  })
  const candidates: MemoryItem[] = []
  for (const entry of fresh) {
    try {
      candidates.push(...extractMemoriesFromMessage({
        id: entry.id,
        role: 'user',
        content: entry.content,
        createdAt: entry.createdAt,
      }))
    } catch {
      // A bad diary row must not abort the day.
    }
  }
  return candidates
}

/**
 * Reconcile diary lines since the watermark, then let loop resolution run
 * inside that reconcile. Never throws. Without `complete`, the fallback
 * dedupe is the whole pass. A global memory pause returns the list as it
 * is: no diary capture and no curation, even if the scheduler already
 * decided to run.
 */
export async function consolidateDailyMemory(input: {
  memories: readonly MemoryItem[]
  diaryEntries: readonly DailyMemoryEntry[]
  sinceMs: number | null
  now?: string
  utterance?: string
  complete?: ((prompt: { system: string; user: string }) => Promise<string | null | undefined>) | null
  embed?: MemoryTextEmbedder
  runId?: string
  memoryPaused?: boolean
}): Promise<MemoryReconcileResult> {
  if (input.memoryPaused) {
    return { memories: [...input.memories], ops: [], decisionSource: 'fallback' }
  }
  const now = input.now ?? new Date().toISOString()
  try {
    const freshEntries = input.diaryEntries.filter((entry) => {
      if (entry.role !== 'user') return false
      const stamp = Date.parse(entry.createdAt)
      if (input.sinceMs == null || !Number.isFinite(input.sinceMs)) return true
      return Number.isFinite(stamp) && stamp > input.sinceMs
    })
    const candidates = diaryCandidates(freshEntries, null).filter((item) => !isSensitiveMemoryText(item.content))
    const utterance = input.utterance ?? freshEntries.map((entry) => entry.content).join('\n')
    if (!candidates.length && !utterance.trim()) {
      return { memories: [...input.memories], ops: [], decisionSource: 'fallback', fallbackReason: 'no-model' }
    }
    const reconciled = await reconcileExtractedMemories({
      existing: input.memories,
      candidates,
      now,
      utterance,
      complete: input.complete,
      embed: input.embed,
    })
    const absorbed = isSensitiveMemoryText(utterance)
      ? { memories: reconciled.memories, ops: [] }
      : absorbLoopFollowUp(reconciled.memories, utterance, now)
    const curated = curateMemories(absorbed.memories, now, input.runId)
    return {
      memories: curated.memories,
      ops: [...reconciled.ops, ...absorbed.ops, ...curated.ops],
      decisionSource: reconciled.decisionSource,
      ...(reconciled.fallbackReason ? { fallbackReason: reconciled.fallbackReason } : {}),
    }
  } catch {
    return {
      memories: [...input.memories],
      ops: [],
      decisionSource: 'fallback',
      fallbackReason: 'model-failed',
    }
  }
}
