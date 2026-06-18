import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildMemoryMapViewModel } from '../src/features/memory/memoryMap.ts'
import type { RelationshipSample } from '../src/features/autonomy/stateTimeline.ts'
import type { DailyMemoryStore, MemoryItem } from '../src/types/index.ts'

test('buildMemoryMapViewModel derives graph nodes, source edges, and relationship timeline without storage changes', () => {
  const memories: MemoryItem[] = [
    {
      id: 'm1',
      content: '我喜欢安静一点的陪伴方式。',
      category: 'preference',
      source: 'chat',
      kind: 'relationship',
      sourceRef: 'chat:turn-1',
      createdAt: '2026-06-16T10:00:00Z',
      importance: 'pinned',
      relatedIds: ['m2'],
    },
    {
      id: 'm2',
      content: 'Prefer concise answers during work blocks.',
      category: 'habit',
      source: 'voice',
      sourceRef: 'voice:turn-2',
      createdAt: '2026-06-16T11:00:00Z',
      enabled: false,
    },
  ]
  const daily: DailyMemoryStore = {
    '2026-06-16': [
      {
        id: 'd1',
        day: '2026-06-16',
        role: 'user',
        content: '今天希望你记得我们一起把陪伴体验调轻一点。',
        source: 'chat',
        sourceRef: 'chat:turn-3',
        createdAt: '2026-06-16T12:00:00Z',
      },
    ],
  }

  const view = buildMemoryMapViewModel(memories, daily, '2026-06-17T00:00:00Z')
  const nodeIds = new Set(view.nodes.map((node) => node.id))
  const edgeKinds = new Set(view.edges.map((edge) => edge.kind))

  assert.equal(view.schema, 'nexus.memory-map.v1')
  assert.equal(view.generatedAt, '2026-06-17T00:00:00.000Z')
  assert.equal(view.summary.longTermCount, 2)
  assert.equal(view.summary.dailyEntryCount, 1)
  assert.equal(view.summary.relationshipInsightCount, 1)
  assert.equal(view.summary.sourceRefCount, 3)
  assert.equal(view.summary.openableSourceRefCount, 3)
  assert.equal(view.summary.relationshipTimelineSourceRefCount, 2)
  assert.equal(view.summary.relationshipTimelineOpenableSourceRefCount, 2)
  assert.equal(view.summary.pinnedCount, 1)
  assert.equal(view.summary.recallPausedCount, 1)
  assert.equal(nodeIds.has('memory:m1'), true)
  assert.equal(nodeIds.has('category:preference'), true)
  assert.equal(nodeIds.has('source:chat'), true)
  assert.equal(nodeIds.has('day:2026-06-16'), true)
  assert.equal(edgeKinds.has('belongs_to'), true)
  assert.equal(edgeKinds.has('source_ref'), true)
  assert.equal(edgeKinds.has('related'), true)
  assert.equal(edgeKinds.has('happened_on'), true)
  assert.equal(view.relationshipTimeline.length, 2)
  assert.equal(view.relationshipTimeline[0]?.id, 'd1')
  assert.equal(view.relationshipTimeline.some((item) => item.pinned), true)
})

test('buildMemoryMapViewModel includes relationship state samples as derived timeline nodes', () => {
  const samples: RelationshipSample[] = [
    {
      ts: '2026-06-15T10:00:00Z',
      score: 32,
      level: 'friend',
      streak: 2,
      daysInteracted: 6,
    },
    {
      ts: '2026-06-16T10:00:00Z',
      score: 56,
      level: 'close_friend',
      streak: 3,
      daysInteracted: 7,
    },
  ]

  const view = buildMemoryMapViewModel([], [], samples, '2026-06-17T00:00:00Z')
  const nodeIds = new Set(view.nodes.map((node) => node.id))
  const edgeIds = new Set(view.edges.map((edge) => edge.id))

  assert.equal(view.generatedAt, '2026-06-17T00:00:00.000Z')
  assert.equal(view.summary.relationshipSampleCount, 2)
  assert.equal(nodeIds.has('relationship:2026-06-16T10:00:00Z'), true)
  assert.equal(nodeIds.has('relationship-state:close_friend'), true)
  assert.equal(nodeIds.has('day:2026-06-16'), true)
  assert.equal(edgeIds.has('relationship:2026-06-16T10:00:00Z->relationship-state:close_friend:belongs_to'), true)
  assert.equal(view.relationshipTimeline[0]?.kind, 'relationship_state')
  assert.equal(view.relationshipTimeline[0]?.relationship?.level, 'close_friend')
  assert.equal(view.relationshipTimeline[0]?.relationship?.score, 56)
})

test('buildMemoryMapViewModel separates text-only source refs from openable source refs', () => {
  const memories: MemoryItem[] = [
    {
      id: 'm1',
      content: 'A relationship note with an imported source.',
      category: 'manual',
      source: 'chat',
      kind: 'relationship',
      sourceRef: 'import:legacy-note',
      createdAt: '2026-06-16T10:00:00Z',
    },
    {
      id: 'm2',
      content: 'A chat-backed preference.',
      category: 'preference',
      source: 'chat',
      sourceRef: 'chat:turn-2',
      createdAt: '2026-06-16T11:00:00Z',
    },
  ]

  const view = buildMemoryMapViewModel(memories, [], '2026-06-17T00:00:00Z')

  assert.equal(view.summary.sourceRefCount, 2)
  assert.equal(view.summary.openableSourceRefCount, 1)
  assert.equal(view.summary.relationshipTimelineSourceRefCount, 1)
  assert.equal(view.summary.relationshipTimelineOpenableSourceRefCount, 0)
})
