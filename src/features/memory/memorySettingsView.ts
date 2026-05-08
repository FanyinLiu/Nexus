import type {
  DailyMemoryEntry,
  MemoryItem,
  MemoryKind,
  MemorySearchMode,
} from '../../types/memory.ts'

export type MemoryKindCounts = Record<MemoryKind, number>

export type MemorySettingsSummary = {
  activeLongTermCount: number
  dailyEntryCount: number
  disabledLongTermCount: number
  kindCounts: MemoryKindCounts
  searchMode: MemorySearchMode
}

const EMPTY_KIND_COUNTS: MemoryKindCounts = {
  preference: 0,
  fact: 0,
  relationship: 0,
  knowledge: 0,
}

export function countMemoryKinds(memories: MemoryItem[]): MemoryKindCounts {
  const counts = { ...EMPTY_KIND_COUNTS }

  for (const memory of memories) {
    if (memory.enabled === false) continue
    counts[memory.kind ?? 'fact'] += 1
  }

  return counts
}

export function resolveMemorySettingsSummary(input: {
  dailyEntries: DailyMemoryEntry[]
  memories: MemoryItem[]
  searchMode: MemorySearchMode
}): MemorySettingsSummary {
  return {
    activeLongTermCount: input.memories.filter((memory) => memory.enabled !== false).length,
    dailyEntryCount: input.dailyEntries.length,
    disabledLongTermCount: input.memories.filter((memory) => memory.enabled === false).length,
    kindCounts: countMemoryKinds(input.memories),
    searchMode: input.searchMode,
  }
}
