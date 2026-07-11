import type {
  DailyMemoryEntry,
  MemoryItem,
  MemoryKind,
  MemorySearchMode,
} from '../../types/memory.ts'
import {
  resolveCompanionTransparencyViewModel,
  resolveCompanionTransparencySummary,
  type CompanionTransparencySummary,
  type CompanionTransparencyViewModel,
} from '../context/companionTransparency.ts'
import type { QuietObservationSummary } from '../context/companionAwareness.ts'
import type { CompanionCheckInDecision } from '../context/companionCheckInPolicy.ts'

export type MemoryKindCounts = Record<MemoryKind, number>

export type MemorySettingsSummary = {
  activeLongTermCount: number
  dailyEntryCount: number
  disabledLongTermCount: number
  kindCounts: MemoryKindCounts
  searchMode: MemorySearchMode
}

export type MemoryTransparencySummary = MemorySettingsSummary & {
  automaticCaptureEnabled: boolean
  contextReadEnabled: boolean
  dailyRecallEnabled: boolean
  longTermRecallEnabled: boolean
  memoryPaused: boolean
  semanticRecallEnabled: boolean
  sqliteAuthorityEnabled: false
  storageAuthority: 'renderer-localStorage'
  companionAwareness: CompanionTransparencySummary
  companionAwarenessView: CompanionTransparencyViewModel
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

export function resolveMemoryTransparencySummary(input: {
  activeWindowContextEnabled: boolean
  clipboardContextEnabled: boolean
  companionAwarenessPaused?: boolean
  contextAwarenessEnabled: boolean
  dailyEntries: DailyMemoryEntry[]
  memories: MemoryItem[]
  memoryDailyRecallCount: number
  memoryLongTermRecallCount: number
  memoryPaused: boolean
  memorySemanticRecallCount: number
  companionCheckInDecision?: CompanionCheckInDecision | null
  companionSummary?: QuietObservationSummary | null
  screenContextEnabled: boolean
  searchMode: MemorySearchMode
}): MemoryTransparencySummary {
  const base = resolveMemorySettingsSummary(input)
  const memoryActive = !input.memoryPaused
  const contextReadEnabled = input.contextAwarenessEnabled && (
    input.activeWindowContextEnabled
    || input.clipboardContextEnabled
    || input.screenContextEnabled
  )

  const companionAwareness = resolveCompanionTransparencySummary({
    contextAwarenessEnabled: input.contextAwarenessEnabled,
    companionAwarenessPaused: input.companionAwarenessPaused ?? false,
    activeWindowContextEnabled: input.activeWindowContextEnabled,
    summary: input.companionSummary ?? null,
    checkInDecision: input.companionCheckInDecision ?? null,
  })

  return {
    ...base,
    automaticCaptureEnabled: memoryActive,
    companionAwareness,
    companionAwarenessView: resolveCompanionTransparencyViewModel(companionAwareness),
    contextReadEnabled,
    dailyRecallEnabled: memoryActive && input.memoryDailyRecallCount > 0,
    longTermRecallEnabled: memoryActive && input.memoryLongTermRecallCount > 0,
    memoryPaused: input.memoryPaused,
    semanticRecallEnabled: memoryActive && input.memorySemanticRecallCount > 0 && input.searchMode !== 'keyword',
    sqliteAuthorityEnabled: false,
    storageAuthority: 'renderer-localStorage',
  }
}
