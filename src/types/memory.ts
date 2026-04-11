import type { ChatRole } from './chat'

export type MemoryCategory =
  | 'profile'
  | 'preference'
  | 'goal'
  | 'habit'
  | 'manual'
  | 'feedback'
  | 'project'
  | 'reference'

export type MemoryImportance = 'low' | 'normal' | 'high' | 'pinned'

export interface MemoryItem {
  id: string
  content: string
  category: MemoryCategory
  source: string
  createdAt: string
  lastUsedAt?: string
  importance?: MemoryImportance
  /** Continuous importance score (0–1+). Decays daily, boosted on recall. */
  importanceScore?: number
  /** How many times this memory has been recalled into prompt context. */
  recallCount?: number
  /** ISO timestamp of the most recent recall. */
  lastRecalledAt?: string
  /** IDs of semantically related memories (cross-session linking). */
  relatedIds?: string[]
}

export interface DailyMemoryEntry {
  id: string
  day: string
  role: Exclude<ChatRole, 'system'>
  content: string
  source: 'chat' | 'voice'
  createdAt: string
}

export type DailyMemoryStore = Record<string, DailyMemoryEntry[]>

export type MemorySearchMode = 'keyword' | 'hybrid' | 'vector'

export interface MemorySemanticMatch {
  id: string
  layer: 'long_term' | 'daily'
  content: string
  score: number
}

export interface MemoryRecallContext {
  longTerm: MemoryItem[]
  daily: DailyMemoryEntry[]
  semantic: MemorySemanticMatch[]
  searchModeUsed: MemorySearchMode
  vectorSearchAvailable: boolean
  /** IDs of long-term memories that were selected for prompt injection (for recall feedback). */
  recalledLongTermIds?: string[]
}

// ── Semantic Clustering ───────────────────────────────────────────────────

export interface MemoryCluster {
  id: string
  label: string
  memberIds: string[]
  centroidContent: string
  createdAt: string
  updatedAt: string
}

// ── Memory Archive ────────────────────────────────────────────────────────

export interface ArchivedMemory {
  id: string
  content: string
  category: MemoryCategory
  source: string
  createdAt: string
  archivedAt: string
  finalScore: number
  importance?: MemoryImportance
  clusterId?: string
}
