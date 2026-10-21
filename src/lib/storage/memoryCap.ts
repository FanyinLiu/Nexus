/**
 * Active-set cap for long-term memories.
 *
 * The cap prefers stale, low-importance, and already-inactive rows.
 * Pinned, manual, and user-confirmed rows are not eligible, so a full
 * store cannot drop them to make room.
 */

import type { MemoryItem } from '../../types/memory.ts'

/** How many non-protected long-term memories the active store keeps. */
export const MAX_LONG_TERM_MEMORIES = 500

/**
 * True when automatic cap eviction and rewrite must leave the row in place.
 * Manual source counts as user-confirmed even on rows written before that flag existed.
 */
export function isProtectedMemory(memory: MemoryItem): boolean {
  return memory.importance === 'pinned'
    || memory.pinned === true
    || memory.userEdited === true
    || memory.userConfirmed === true
    || memory.source === 'manual'
    || (memory.kind === 'open_loop' && (memory.loopStatus ?? 'open') === 'open')
}

function keepScore(memory: MemoryItem): number {
  const statusRank = memory.status === 'archived' ? 0 : memory.status === 'superseded' ? 1 : 2
  const importanceRank = memory.importance === 'high'
    ? 4
    : memory.importance === 'reflection'
      ? 3
      : memory.importance === 'low'
        ? 1
        : 2
  const stamp = Date.parse(memory.updatedAt ?? memory.lastUsedAt ?? memory.createdAt)
  const recency = Number.isFinite(stamp) ? stamp : 0
  return statusRank * 1e15 + importanceRank * 1e13 + recency
}

/**
 * Split a memory list into the rows that stay active and the rows the cap
 * releases. Kept rows stay in their input order. Nothing is archived here.
 */
export function applyLongTermMemoryCap(
  memories: readonly MemoryItem[],
  cap = MAX_LONG_TERM_MEMORIES,
): { kept: MemoryItem[]; evicted: MemoryItem[] } {
  const limit = Number.isFinite(cap) ? Math.max(0, Math.floor(cap)) : MAX_LONG_TERM_MEMORIES
  if (memories.length <= limit) {
    return { kept: [...memories], evicted: [] }
  }

  const protectedIds = new Set<string>()
  const evictable: Array<{ memory: MemoryItem; index: number }> = []
  memories.forEach((memory, index) => {
    if (isProtectedMemory(memory)) protectedIds.add(memory.id)
    else evictable.push({ memory, index })
  })

  const room = Math.max(0, limit - protectedIds.size)
  const ranked = [...evictable].sort((left, right) => {
    const score = keepScore(right.memory) - keepScore(left.memory)
    return score === 0 ? left.index - right.index : score
  })
  const keepEvictableIds = new Set(ranked.slice(0, room).map((item) => item.memory.id))
  const kept: MemoryItem[] = []
  const evicted: MemoryItem[] = []
  for (const memory of memories) {
    if (protectedIds.has(memory.id) || keepEvictableIds.has(memory.id)) kept.push(memory)
    else evicted.push(memory)
  }
  return { kept, evicted }
}
