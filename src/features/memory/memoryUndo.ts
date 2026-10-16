/**
 * Undo one curation op, or a whole daily run, from the pre-image it stored.
 * Adding a row is undone by removing it. Every other op puts the saved
 * rows back and drops ids that the op created.
 */

import type { MemoryItem, MemoryOpRecord } from '../../types/memory.ts'

/** Restore the rows an op changed. A second call on the restored list is stable. */
export function undoMemoryOp(memories: readonly MemoryItem[], entry: MemoryOpRecord): MemoryItem[] {
  const before = entry.before ?? []
  const beforeIds = new Set(before.map((memory) => memory.id))
  const targets = new Set(entry.targetIds)
  const kept = memories.filter((memory) => !targets.has(memory.id) || beforeIds.has(memory.id))
  const next = kept.map((memory) => {
    const prior = before.find((row) => row.id === memory.id)
    if (!prior) return memory
    // A later edit of the wording is the user's, not part of the op being undone.
    if (memory.userEdited && memory.content !== prior.content) {
      return {
        ...prior,
        content: memory.content,
        userEdited: true,
        ...(memory.pinned === true ? { pinned: true as const } : {}),
        ...(memory.importance ? { importance: memory.importance } : {}),
      }
    }
    return { ...prior }
  })
  for (const row of before) {
    if (!next.some((memory) => memory.id === row.id)) next.push({ ...row })
  }
  return next
}

/** Replace the store with the snapshot taken before a daily run. */
export function undoMemoryRun(snapshot: readonly MemoryItem[]): MemoryItem[] {
  return snapshot.map((memory) => ({ ...memory }))
}
