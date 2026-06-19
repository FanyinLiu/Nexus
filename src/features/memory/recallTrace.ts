import type { ChatMemoryTrace, MemoryRecallContext } from '../../types'

const MAX_TRACE_IDS = 24

function normalizeTraceIds(ids: Array<string | undefined>): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const rawId of ids) {
    const id = String(rawId ?? '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    normalized.push(id)
    if (normalized.length >= MAX_TRACE_IDS) break
  }

  return normalized
}

export function buildChatMemoryTrace(input: {
  memoryContext: MemoryRecallContext
  memoryPaused: boolean
}): ChatMemoryTrace {
  if (input.memoryPaused) {
    return {
      status: 'paused',
      searchModeUsed: input.memoryContext.searchModeUsed,
      vectorSearchAvailable: false,
      longTermIds: [],
      dailyEntryIds: [],
      semanticIds: [],
    }
  }

  const longTermIds = normalizeTraceIds(
    input.memoryContext.recalledLongTermIds?.length
      ? input.memoryContext.recalledLongTermIds
      : input.memoryContext.longTerm.map((memory) => memory.id),
  )

  return {
    status: 'active',
    searchModeUsed: input.memoryContext.searchModeUsed,
    vectorSearchAvailable: input.memoryContext.vectorSearchAvailable,
    longTermIds,
    dailyEntryIds: normalizeTraceIds(input.memoryContext.daily.map((entry) => entry.id)),
    semanticIds: normalizeTraceIds(input.memoryContext.semantic.map((match) => match.id)),
  }
}
