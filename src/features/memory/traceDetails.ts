import type {
  ChatMemoryTrace,
  DailyMemoryEntry,
  DailyMemoryStore,
  MemoryCategory,
  MemoryItem,
} from '../../types'

export type ChatMemoryTraceDetailStatus = 'available' | 'missing'

export type ChatMemoryTraceDetailKind = 'long_term' | 'daily' | 'semantic'

export type ChatMemoryTraceDetailItem = {
  id: string
  kind: ChatMemoryTraceDetailKind
  status: ChatMemoryTraceDetailStatus
  preview?: string
  category?: MemoryCategory
  day?: string
  enabled?: boolean
  role?: DailyMemoryEntry['role']
  source?: DailyMemoryEntry['source'] | MemoryItem['source']
}

export type ChatMemoryTraceDetails = {
  status: ChatMemoryTrace['status']
  searchModeUsed: ChatMemoryTrace['searchModeUsed']
  vectorSearchAvailable: boolean
  longTerm: ChatMemoryTraceDetailItem[]
  daily: ChatMemoryTraceDetailItem[]
  semantic: ChatMemoryTraceDetailItem[]
  missingCount: number
  availableCount: number
}

const MAX_PREVIEW_CHARS = 96

function normalizePreview(content: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim()
  return normalized.length > MAX_PREVIEW_CHARS
    ? `${normalized.slice(0, MAX_PREVIEW_CHARS)}...`
    : normalized
}

function buildDailyEntryIndex(dailyMemories: DailyMemoryStore): Map<string, DailyMemoryEntry> {
  const index = new Map<string, DailyMemoryEntry>()
  for (const entries of Object.values(dailyMemories)) {
    for (const entry of entries) {
      index.set(entry.id, entry)
    }
  }
  return index
}

function resolveLongTermItem(id: string, memoriesById: Map<string, MemoryItem>): ChatMemoryTraceDetailItem {
  const memory = memoriesById.get(id)
  if (!memory) {
    return { id, kind: 'long_term', status: 'missing' }
  }

  return {
    id,
    kind: 'long_term',
    status: 'available',
    preview: normalizePreview(memory.content),
    category: memory.category,
    enabled: memory.enabled !== false,
    source: memory.source,
  }
}

function resolveDailyItem(id: string, dailyById: Map<string, DailyMemoryEntry>): ChatMemoryTraceDetailItem {
  const entry = dailyById.get(id)
  if (!entry) {
    return { id, kind: 'daily', status: 'missing' }
  }

  return {
    id,
    kind: 'daily',
    status: 'available',
    preview: normalizePreview(entry.content),
    day: entry.day,
    role: entry.role,
    source: entry.source,
  }
}

function resolveSemanticItem(
  id: string,
  memoriesById: Map<string, MemoryItem>,
  dailyById: Map<string, DailyMemoryEntry>,
): ChatMemoryTraceDetailItem {
  const memory = memoriesById.get(id)
  if (memory) {
    return {
      id,
      kind: 'semantic',
      status: 'available',
      preview: normalizePreview(memory.content),
      category: memory.category,
      enabled: memory.enabled !== false,
      source: memory.source,
    }
  }

  const entry = dailyById.get(id)
  if (entry) {
    return {
      id,
      kind: 'semantic',
      status: 'available',
      preview: normalizePreview(entry.content),
      day: entry.day,
      role: entry.role,
      source: entry.source,
    }
  }

  return { id, kind: 'semantic', status: 'missing' }
}

export function resolveChatMemoryTraceDetails(input: {
  trace?: ChatMemoryTrace
  memories: MemoryItem[]
  dailyMemories: DailyMemoryStore
}): ChatMemoryTraceDetails | null {
  if (!input.trace) return null

  const memoriesById = new Map(input.memories.map((memory) => [memory.id, memory]))
  const dailyById = buildDailyEntryIndex(input.dailyMemories)

  const longTerm = input.trace.longTermIds.map((id) => resolveLongTermItem(id, memoriesById))
  const daily = input.trace.dailyEntryIds.map((id) => resolveDailyItem(id, dailyById))
  const semantic = input.trace.semanticIds.map((id) => resolveSemanticItem(id, memoriesById, dailyById))
  const allItems = [...longTerm, ...daily, ...semantic]

  return {
    status: input.trace.status,
    searchModeUsed: input.trace.searchModeUsed,
    vectorSearchAvailable: input.trace.vectorSearchAvailable,
    longTerm,
    daily,
    semantic,
    missingCount: allItems.filter((item) => item.status === 'missing').length,
    availableCount: allItems.filter((item) => item.status === 'available').length,
  }
}
