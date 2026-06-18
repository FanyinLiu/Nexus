import type {
  DailyMemoryEntry,
  DailyMemoryStore,
  MemoryCategory,
  MemoryItem,
} from '../../types/index.ts'
import type { RelationshipSample } from '../autonomy/stateTimeline.ts'
import { parseMemorySourceRef } from './sourceRefs.ts'

export type MemoryGraphNodeKind =
  | 'category'
  | 'daily'
  | 'day'
  | 'long_term'
  | 'relationship'
  | 'relationship_state'
  | 'source'

export type MemoryGraphEdgeKind =
  | 'belongs_to'
  | 'happened_on'
  | 'related'
  | 'source_ref'

export interface MemoryGraphNode {
  id: string
  kind: MemoryGraphNodeKind
  label: string
  detail?: string
  count: number
  memoryIds: string[]
  dailyEntryIds: string[]
  sourceRef?: string
}

export interface MemoryGraphEdge {
  id: string
  from: string
  to: string
  kind: MemoryGraphEdgeKind
  weight: number
}

export interface MemoryRelationshipTimelineItem {
  id: string
  kind: 'daily' | 'memory' | 'relationship_state'
  title: string
  detail: string
  createdAt: string
  sourceRef?: string
  pinned: boolean
  recallPaused: boolean
  relationship?: {
    daysInteracted: number
    level: RelationshipSample['level']
    score: number
    streak: number
  }
}

export interface MemoryMapViewModel {
  schema: 'nexus.memory-map.v1'
  generatedAt: string
  summary: {
    longTermCount: number
    dailyEntryCount: number
    relationshipInsightCount: number
    relationshipSampleCount: number
    sourceRefCount: number
    openableSourceRefCount: number
    relationshipTimelineSourceRefCount: number
    relationshipTimelineOpenableSourceRefCount: number
    recallPausedCount: number
    pinnedCount: number
  }
  nodes: MemoryGraphNode[]
  edges: MemoryGraphEdge[]
  relationshipTimeline: MemoryRelationshipTimelineItem[]
}

const MAX_TEXT = 96
const MAX_NODES = 120
const MAX_EDGES = 240
const MAX_TIMELINE_ITEMS = 12

function normalizeText(value: string, limit = MAX_TEXT): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= limit ? normalized : `${normalized.slice(0, Math.max(0, limit - 3))}...`
}

function normalizeIso(value: unknown, fallbackIso = new Date().toISOString()): string {
  if (typeof value !== 'string' && typeof value !== 'number') return fallbackIso
  const parsed = typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isFinite(parsed)) return fallbackIso
  return new Date(parsed).toISOString()
}

function flattenDailyStore(input: DailyMemoryStore | readonly DailyMemoryEntry[]): DailyMemoryEntry[] {
  return Array.isArray(input)
    ? [...input]
    : Object.values(input).flat()
}

function sourceKind(sourceRef: string | undefined): string | null {
  const normalized = sourceRef?.replace(/\s+/g, ' ').trim()
  if (!normalized) return null
  const separator = normalized.indexOf(':')
  return separator > 0 ? normalized.slice(0, separator).toLowerCase() : 'unknown'
}

function isOpenableSourceRef(sourceRef: string | undefined): boolean {
  const parsed = parseMemorySourceRef(sourceRef)
  return Boolean(parsed && (parsed.canOpenHistory || parsed.canOpenAutonomy))
}

function isRelationshipInsightMemory(memory: MemoryItem): boolean {
  return memory.importance === 'reflection'
    || memory.kind === 'relationship'
    || memory.category === 'feedback'
    || memory.category === 'manual'
}

function addNode(nodes: Map<string, MemoryGraphNode>, node: MemoryGraphNode): void {
  const existing = nodes.get(node.id)
  if (!existing) {
    nodes.set(node.id, node)
    return
  }

  existing.count += node.count
  existing.memoryIds = [...new Set([...existing.memoryIds, ...node.memoryIds])]
  existing.dailyEntryIds = [...new Set([...existing.dailyEntryIds, ...node.dailyEntryIds])]
}

function addEdge(edges: Map<string, MemoryGraphEdge>, edge: MemoryGraphEdge): void {
  const existing = edges.get(edge.id)
  if (!existing) {
    edges.set(edge.id, edge)
    return
  }

  existing.weight += edge.weight
}

function categoryNodeId(category: MemoryCategory): string {
  return `category:${category}`
}

function dayNodeId(day: string): string {
  return `day:${day}`
}

function memoryNodeKind(memory: MemoryItem): MemoryGraphNodeKind {
  return isRelationshipInsightMemory(memory) ? 'relationship' : 'long_term'
}

function relationshipLevelNodeId(level: RelationshipSample['level']): string {
  return `relationship-state:${level}`
}

function relationshipLevelLabel(level: RelationshipSample['level']): string {
  return level.replace(/_/g, ' ')
}

function buildRelationshipTimeline(
  memories: readonly MemoryItem[],
  dailyEntries: readonly DailyMemoryEntry[],
  relationshipSamples: readonly RelationshipSample[],
) {
  const memoryItems: MemoryRelationshipTimelineItem[] = memories
    .filter(isRelationshipInsightMemory)
    .map((memory) => ({
      id: memory.id,
      kind: 'memory' as const,
      title: memory.importance === 'reflection' ? 'Reflection' : 'Relationship memory',
      detail: normalizeText(memory.content, 140),
      createdAt: normalizeIso(memory.createdAt),
      ...(memory.sourceRef ? { sourceRef: memory.sourceRef } : {}),
      pinned: memory.importance === 'pinned',
      recallPaused: memory.enabled === false,
    }))
  const dailyItems: MemoryRelationshipTimelineItem[] = dailyEntries
    .filter((entry) => /关系|陪伴|记得|remember|together|companion|feel|support/i.test(entry.content))
    .map((entry) => ({
      id: entry.id,
      kind: 'daily' as const,
      title: entry.role === 'user' ? 'User diary signal' : 'Companion diary signal',
      detail: normalizeText(entry.content, 140),
      createdAt: normalizeIso(entry.createdAt),
      ...(entry.sourceRef ? { sourceRef: entry.sourceRef } : {}),
      pinned: false,
      recallPaused: false,
    }))
  const relationshipItems: MemoryRelationshipTimelineItem[] = relationshipSamples
    .map((sample) => ({
      id: `relationship:${sample.ts}`,
      kind: 'relationship_state' as const,
      title: `Relationship state: ${relationshipLevelLabel(sample.level)}`,
      detail: `Score ${sample.score}/100 · ${relationshipLevelLabel(sample.level)} · streak ${sample.streak} · ${sample.daysInteracted} day(s) together`,
      createdAt: normalizeIso(sample.ts),
      pinned: false,
      recallPaused: false,
      relationship: {
        daysInteracted: sample.daysInteracted,
        level: sample.level,
        score: sample.score,
        streak: sample.streak,
      },
    }))

  return [...memoryItems, ...dailyItems, ...relationshipItems]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, MAX_TIMELINE_ITEMS)
}

export function buildMemoryMapViewModel(
  memoriesInput: readonly MemoryItem[],
  dailyInput: DailyMemoryStore | readonly DailyMemoryEntry[],
  relationshipInputOrGeneratedAt: readonly RelationshipSample[] | string = [],
  generatedAt = new Date().toISOString(),
): MemoryMapViewModel {
  const memories = [...memoriesInput]
  const dailyEntries = flattenDailyStore(dailyInput)
  const relationshipSamples = typeof relationshipInputOrGeneratedAt === 'string'
    ? []
    : [...relationshipInputOrGeneratedAt]
  const reportGeneratedAt = typeof relationshipInputOrGeneratedAt === 'string'
    ? relationshipInputOrGeneratedAt
    : generatedAt
  const nodes = new Map<string, MemoryGraphNode>()
  const edges = new Map<string, MemoryGraphEdge>()

  for (const memory of memories) {
    const memoryId = `memory:${memory.id}`
    addNode(nodes, {
      id: memoryId,
      kind: memoryNodeKind(memory),
      label: normalizeText(memory.content),
      detail: memory.source,
      count: 1,
      memoryIds: [memory.id],
      dailyEntryIds: [],
      ...(memory.sourceRef ? { sourceRef: memory.sourceRef } : {}),
    })

    const categoryId = categoryNodeId(memory.category)
    addNode(nodes, {
      id: categoryId,
      kind: 'category',
      label: memory.category,
      count: 1,
      memoryIds: [memory.id],
      dailyEntryIds: [],
    })
    addEdge(edges, {
      id: `${memoryId}->${categoryId}:belongs_to`,
      from: memoryId,
      to: categoryId,
      kind: 'belongs_to',
      weight: 1,
    })

    const kind = sourceKind(memory.sourceRef)
    if (kind) {
      const sourceId = `source:${kind}`
      addNode(nodes, {
        id: sourceId,
        kind: 'source',
        label: kind,
        count: 1,
        memoryIds: [memory.id],
        dailyEntryIds: [],
      })
      addEdge(edges, {
        id: `${memoryId}->${sourceId}:source_ref`,
        from: memoryId,
        to: sourceId,
        kind: 'source_ref',
        weight: 1,
      })
    }

    for (const relatedId of memory.relatedIds ?? []) {
      if (!relatedId || relatedId === memory.id) continue
      addEdge(edges, {
        id: [memory.id, relatedId].sort().join('<->'),
        from: memoryId,
        to: `memory:${relatedId}`,
        kind: 'related',
        weight: 1,
      })
    }
  }

  for (const entry of dailyEntries) {
    const entryId = `daily:${entry.id}`
    const dayId = dayNodeId(entry.day)
    addNode(nodes, {
      id: entryId,
      kind: 'daily',
      label: normalizeText(entry.content),
      detail: entry.role,
      count: 1,
      memoryIds: [],
      dailyEntryIds: [entry.id],
      ...(entry.sourceRef ? { sourceRef: entry.sourceRef } : {}),
    })
    addNode(nodes, {
      id: dayId,
      kind: 'day',
      label: entry.day,
      count: 1,
      memoryIds: [],
      dailyEntryIds: [entry.id],
    })
    addEdge(edges, {
      id: `${entryId}->${dayId}:happened_on`,
      from: entryId,
      to: dayId,
      kind: 'happened_on',
      weight: 1,
    })

    const kind = sourceKind(entry.sourceRef)
    if (kind) {
      const sourceId = `source:${kind}`
      addNode(nodes, {
        id: sourceId,
        kind: 'source',
        label: kind,
        count: 1,
        memoryIds: [],
        dailyEntryIds: [entry.id],
      })
      addEdge(edges, {
        id: `${entryId}->${sourceId}:source_ref`,
        from: entryId,
        to: sourceId,
        kind: 'source_ref',
        weight: 1,
      })
    }
  }

  for (const sample of relationshipSamples) {
    const sampleId = `relationship:${sample.ts}`
    const day = normalizeIso(sample.ts).slice(0, 10)
    const dayId = dayNodeId(day)
    const levelId = relationshipLevelNodeId(sample.level)

    addNode(nodes, {
      id: sampleId,
      kind: 'relationship_state',
      label: `${relationshipLevelLabel(sample.level)} · ${sample.score}/100`,
      detail: `streak=${sample.streak}; days=${sample.daysInteracted}`,
      count: 1,
      memoryIds: [],
      dailyEntryIds: [],
    })
    addNode(nodes, {
      id: levelId,
      kind: 'relationship_state',
      label: relationshipLevelLabel(sample.level),
      detail: 'relationship level',
      count: 1,
      memoryIds: [],
      dailyEntryIds: [],
    })
    addNode(nodes, {
      id: dayId,
      kind: 'day',
      label: day,
      count: 1,
      memoryIds: [],
      dailyEntryIds: [],
    })
    addEdge(edges, {
      id: `${sampleId}->${levelId}:belongs_to`,
      from: sampleId,
      to: levelId,
      kind: 'belongs_to',
      weight: 1,
    })
    addEdge(edges, {
      id: `${sampleId}->${dayId}:happened_on`,
      from: sampleId,
      to: dayId,
      kind: 'happened_on',
      weight: 1,
    })
  }

  const sourceRefCount = memories.filter((memory) => Boolean(memory.sourceRef)).length
    + dailyEntries.filter((entry) => Boolean(entry.sourceRef)).length
  const openableSourceRefCount = memories.filter((memory) => isOpenableSourceRef(memory.sourceRef)).length
    + dailyEntries.filter((entry) => isOpenableSourceRef(entry.sourceRef)).length
  const relationshipTimeline = buildRelationshipTimeline(memories, dailyEntries, relationshipSamples)
  const relationshipTimelineSourceRefCount = relationshipTimeline.filter((item) => Boolean(item.sourceRef)).length
  const relationshipTimelineOpenableSourceRefCount = relationshipTimeline.filter((item) => (
    isOpenableSourceRef(item.sourceRef)
  )).length

  return {
    schema: 'nexus.memory-map.v1',
    generatedAt: normalizeIso(reportGeneratedAt),
    summary: {
      longTermCount: memories.length,
      dailyEntryCount: dailyEntries.length,
      relationshipInsightCount: memories.filter(isRelationshipInsightMemory).length,
      relationshipSampleCount: relationshipSamples.length,
      sourceRefCount,
      openableSourceRefCount,
      relationshipTimelineSourceRefCount,
      relationshipTimelineOpenableSourceRefCount,
      recallPausedCount: memories.filter((memory) => memory.enabled === false).length,
      pinnedCount: memories.filter((memory) => memory.importance === 'pinned').length,
    },
    nodes: [...nodes.values()].slice(0, MAX_NODES),
    edges: [...edges.values()].slice(0, MAX_EDGES),
    relationshipTimeline,
  }
}
