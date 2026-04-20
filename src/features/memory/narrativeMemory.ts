/**
 * Long-term narrative memory — reconstructs timelines and story threads
 * from memory chains (relatedIds) and dream consolidation history.
 *
 * Provides narrative context for the companion's prompt, giving it a sense
 * of shared history with the user beyond individual facts.
 */

import type { MemoryItem } from '../../types'
import { t } from '../../i18n/runtime.ts'

// ── Types ──────────────────────────────────────────────────────��──────────

export interface NarrativeThread {
  id: string
  title: string
  /** Memory IDs in this thread, ordered by creation time. */
  memoryIds: string[]
  /** Summary of the thread (built from member content). */
  summary: string
  /** When this thread's earliest memory was created. */
  startedAt: string
  /** When this thread's latest memory was created/updated. */
  lastUpdatedAt: string
  /** Number of dream cycles that touched this thread. */
  dreamTouchCount: number
}

export interface NarrativeSnapshot {
  threads: NarrativeThread[]
  generatedAt: string
}

const NARRATIVE_STORAGE_KEY = 'nexus:memory:narrative'
const MAX_THREADS = 15
const MIN_CHAIN_LENGTH = 2

// ── Persistence ─────────────────────────────────���─────────────────────────

export function loadNarrative(): NarrativeSnapshot {
  try {
    const raw = localStorage.getItem(NARRATIVE_STORAGE_KEY)
    if (!raw) return { threads: [], generatedAt: '' }
    return JSON.parse(raw)
  } catch {
    return { threads: [], generatedAt: '' }
  }
}

export function saveNarrative(snapshot: NarrativeSnapshot): void {
  localStorage.setItem(NARRATIVE_STORAGE_KEY, JSON.stringify(snapshot))
}

// ── Thread extraction ─────────────────────────────────────────────────────

/**
 * Build a graph from relatedIds and extract connected components as threads.
 */
function extractChains(memories: MemoryItem[]): string[][] {
  const memMap = new Map(memories.map((m) => [m.id, m]))
  const adj = new Map<string, Set<string>>()

  // Build adjacency list from relatedIds (bidirectional)
  for (const mem of memories) {
    if (!mem.relatedIds?.length) continue
    if (!adj.has(mem.id)) adj.set(mem.id, new Set())
    for (const related of mem.relatedIds) {
      if (!memMap.has(related)) continue // skip if related memory is gone
      adj.get(mem.id)!.add(related)
      if (!adj.has(related)) adj.set(related, new Set())
      adj.get(related)!.add(mem.id)
    }
  }

  // BFS to find connected components
  const visited = new Set<string>()
  const components: string[][] = []

  for (const nodeId of adj.keys()) {
    if (visited.has(nodeId)) continue

    const component: string[] = []
    const queue = [nodeId]
    visited.add(nodeId)

    while (queue.length > 0) {
      const current = queue.shift()!
      component.push(current)
      for (const neighbor of adj.get(current) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor)
          queue.push(neighbor)
        }
      }
    }

    if (component.length >= MIN_CHAIN_LENGTH) {
      components.push(component)
    }
  }

  return components
}

/**
 * Build a brief summary from memory contents in a chain.
 */
function buildThreadSummary(memories: MemoryItem[]): string {
  if (memories.length === 0) return ''
  // Concatenate up to 5 memory snippets, truncated
  const snippets = memories
    .slice(0, 5)
    .map((m) => m.content.slice(0, 80))
  return snippets.join(' → ')
}

/**
 * Generate a title from the first and most recent memories.
 */
function buildThreadTitle(memories: MemoryItem[]): string {
  if (memories.length === 0) return t('memory.title.unnamed')
  const first = memories[0]
  // Use the category + first few words
  const prefix = first.category === 'project' ? t('memory.title.project') :
    first.category === 'goal' ? t('memory.title.goal') :
    first.category === 'habit' ? t('memory.title.habit') :
    first.category === 'preference' ? t('memory.title.preference') :
    first.category === 'feedback' ? t('memory.title.feedback') :
    t('memory.title.topic')
  const words = first.content.slice(0, 30).replace(/\s+/g, ' ')
  return `${prefix}: ${words}`
}

// ── Public API ───────────────────────────────��────────────────────────────

/**
 * Rebuild narrative threads from current memories.
 * Call during dream cycles after memory consolidation.
 */
export function rebuildNarrative(
  memories: MemoryItem[],
): NarrativeSnapshot {
  const chains = extractChains(memories)
  const memMap = new Map(memories.map((m) => [m.id, m]))

  // Load previous snapshot to carry over dreamTouchCount per thread
  const prevSnapshot = loadNarrative()
  const prevThreadByKey = new Map<string, NarrativeThread>()
  for (const t of prevSnapshot.threads) {
    // Key by sorted memoryIds to match threads across rebuilds
    prevThreadByKey.set(t.memoryIds.slice().sort().join(','), t)
  }

  const threads: NarrativeThread[] = chains.map((chain) => {
    const members = chain
      .map((id) => memMap.get(id))
      .filter((m): m is MemoryItem => m !== undefined)
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))

    const memIds = members.map((m) => m.id)
    const threadKey = memIds.slice().sort().join(',')
    const prev = prevThreadByKey.get(threadKey)

    return {
      id: prev?.id ?? `thread-${crypto.randomUUID().slice(0, 8)}`,
      title: buildThreadTitle(members),
      memoryIds: memIds,
      summary: buildThreadSummary(members),
      startedAt: members[0]?.createdAt ?? '',
      lastUpdatedAt: members[members.length - 1]?.lastUsedAt ?? members[members.length - 1]?.createdAt ?? '',
      dreamTouchCount: (prev?.dreamTouchCount ?? 0) + 1,
    }
  })

  // Sort by recency, limit
  threads.sort((a, b) => Date.parse(b.lastUpdatedAt) - Date.parse(a.lastUpdatedAt))
  const snapshot: NarrativeSnapshot = {
    threads: threads.slice(0, MAX_THREADS),
    generatedAt: new Date().toISOString(),
  }

  saveNarrative(snapshot)
  return snapshot
}

/**
 * Format narrative threads as prompt context for the companion.
 * Returns a string summarizing shared history, or empty if no threads exist.
 */
export function formatNarrativeForPrompt(maxThreads = 5): string {
  const snapshot = loadNarrative()
  if (snapshot.threads.length === 0) return ''

  const lines = snapshot.threads.slice(0, maxThreads).map((thread) => {
    const age = timeSince(thread.startedAt)
    return `- ${thread.title} (started ${age} ago, ${thread.memoryIds.length} memories): ${thread.summary}`
  })

  return `## Shared experiences\n${lines.join('\n')}`
}

function timeSince(isoDate: string): string {
  const ms = Date.now() - Date.parse(isoDate)
  const days = Math.floor(ms / 86_400_000)
  if (days < 1) return 'today'
  if (days < 7) return `${days} days`
  if (days < 30) return `${Math.floor(days / 7)} weeks`
  return `${Math.floor(days / 30)} months`
}
