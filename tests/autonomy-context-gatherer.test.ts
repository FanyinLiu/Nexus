import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  classifyActivity,
  gatherAutonomyContext,
  isUserDeepFocused,
  type ContextGathererInput,
} from '../src/features/autonomy/v2/contextGatherer.ts'
import { createDefaultEmotionState } from '../src/features/autonomy/emotionModel.ts'
import { createDefaultRelationshipState } from '../src/features/autonomy/relationshipTracker.ts'
import { createDefaultRhythmProfile } from '../src/features/autonomy/rhythmLearner.ts'
import type { AutonomyTickState } from '../src/types/autonomy'

function baseInput(overrides: Partial<ContextGathererInput> = {}): ContextGathererInput {
  const tickState: AutonomyTickState = {
    phase: 'awake',
    focusState: 'active',
    lastTickAt: '2026-04-19T10:00:00.000Z',
    lastWakeAt: '2026-04-19T09:00:00.000Z',
    lastSleepAt: null,
    tickCount: 10,
    dailyTickCount: 10,
    dailyTickResetDate: '2026-04-19',
    idleSeconds: 0,
    consecutiveIdleTicks: 0,
  }

  return {
    tickState,
    focusState: 'active',
    emotion: createDefaultEmotionState(),
    relationship: createDefaultRelationshipState(),
    rhythm: createDefaultRhythmProfile(),
    recentMessages: [],
    memories: [],
    pendingReminders: [],
    goals: [],
    activeWindowTitle: null,
    ...overrides,
  }
}

// ── Activity classification ─────────────────────────────────────────────────

test('classifyActivity recognises common foreground app signatures', () => {
  assert.equal(classifyActivity('Visual Studio Code - foo.ts'), 'coding')
  assert.equal(classifyActivity('main.py — Cursor'), 'coding')
  assert.equal(classifyActivity('Google Chrome — Stack Overflow'), 'browsing')
  assert.equal(classifyActivity('Spotify — Taylor Swift'), 'media')
  assert.equal(classifyActivity('原神'), 'gaming')
  assert.equal(classifyActivity('微信'), 'communication')
  assert.equal(classifyActivity('Notion — Project Plan'), 'documents')
  assert.equal(classifyActivity('some unknown window'), 'unknown')
  assert.equal(classifyActivity(null), 'unknown')
})

test('classifyActivity prefers specific activity over browser name in title', () => {
  assert.equal(classifyActivity('YouTube - Google Chrome'), 'media')
  assert.equal(classifyActivity('Discord — Mozilla Firefox'), 'communication')
  assert.equal(classifyActivity('Google Docs - Brave'), 'documents')
  assert.equal(classifyActivity('reddit — Google Chrome'), 'browsing')
})

test('isUserDeepFocused respects idle ticks as the soft exit', () => {
  // Coding + active → deep focused
  assert.equal(isUserDeepFocused('coding', 0, 'VS Code'), true)
  // Coding but many idle ticks → left the keyboard, no longer deep focused
  assert.equal(isUserDeepFocused('coding', 5, 'VS Code'), false)
  // Browsing a web IDE counts as coding
  assert.equal(isUserDeepFocused('browsing', 0, 'GitHub Codespace — repo'), true)
  // Plain browsing does not
  assert.equal(isUserDeepFocused('browsing', 0, 'Twitter / Home'), false)
})

// ── gatherAutonomyContext: happy path ───────────────────────────────────────

test('gatherAutonomyContext folds the full input into a structured context', () => {
  const ctx = gatherAutonomyContext(baseInput({
    activeWindowTitle: 'Cursor — autonomy.ts',
    recentMessages: [
      { id: 'm1', role: 'user', content: 'hi', createdAt: '2026-04-19T09:58:00.000Z' },
      { id: 'm2', role: 'assistant', content: 'hello', createdAt: '2026-04-19T09:58:30.000Z' },
    ],
  }))

  assert.equal(ctx.activityClass, 'coding')
  assert.equal(ctx.userDeepFocused, true)
  assert.equal(ctx.recentMessages.length, 2)
  assert.equal(ctx.recentMessages[0].role, 'user')
  assert.equal(ctx.phase, 'awake')
  assert.equal(ctx.emotion.energy, 0.5)
  assert.equal(ctx.relationshipLevel, 'acquaintance') // default score 10 maps to this band // default score 10
  assert.equal(ctx.activityWindow, 'low') // no rhythm data yet
})

test('gatherAutonomyContext trims messages + drops system-role entries', () => {
  const messages = Array.from({ length: 12 }, (_, i) => ({
    id: `m${i}`,
    role: i % 3 === 0 ? 'system' : (i % 2 === 0 ? 'user' : 'assistant'),
    content: `msg ${i}`,
    createdAt: new Date(2026, 3, 19, 10, i).toISOString(),
  }))

  // @ts-expect-error narrow role union is fine for this shape
  const ctx = gatherAutonomyContext(baseInput({ recentMessages: messages, maxRecentMessages: 4 }))
  assert.equal(ctx.recentMessages.length, 4)
  for (const m of ctx.recentMessages) {
    assert.notEqual(m.role, 'system')
  }
})

test('gatherAutonomyContext ranks memories by importance × recency', () => {
  const now = Date.now()
  const nowIso = new Date(now).toISOString()
  const oldIso = new Date(now - 60 * 86_400_000).toISOString() // 60 days ago

  const memories = [
    {
      id: 'a', content: 'pinned + fresh', category: 'profile' as const,
      source: 'chat', createdAt: nowIso, importance: 'pinned' as const,
      importanceScore: 1.5,
    },
    {
      id: 'b', content: 'normal + fresh', category: 'preference' as const,
      source: 'chat', createdAt: nowIso, importance: 'normal' as const,
      importanceScore: 1.0,
    },
    {
      id: 'c', content: 'pinned but ancient', category: 'profile' as const,
      source: 'chat', createdAt: oldIso, importance: 'pinned' as const,
      importanceScore: 1.5,
    },
    {
      id: 'd', content: 'low + ancient', category: 'feedback' as const,
      source: 'chat', createdAt: oldIso, importance: 'low' as const,
      importanceScore: 0.4,
    },
  ]

  const ctx = gatherAutonomyContext(baseInput({ memories, maxMemories: 3 }))
  assert.equal(ctx.topMemories.length, 3)
  // pinned+fresh should be on top
  assert.equal(ctx.topMemories[0].id, 'a')
  // low+ancient should be excluded
  assert.ok(ctx.topMemories.every((m) => m.id !== 'd'))
})

test('gatherAutonomyContext surfaces reminders inside the horizon + skips disabled ones', () => {
  const now = Date.now()
  const nowIso = new Date(now).toISOString()
  const reminders = [
    {
      id: 'r1', title: 'soon', prompt: '', action: { kind: 'speak' as const, text: '' },
      enabled: true, createdAt: nowIso, updatedAt: nowIso,
      schedule: { kind: 'once' as const },
      nextRunAt: new Date(now + 10 * 60_000).toISOString(), // +10 min
    },
    {
      id: 'r2', title: 'far', prompt: '', action: { kind: 'speak' as const, text: '' },
      enabled: true, createdAt: nowIso, updatedAt: nowIso,
      schedule: { kind: 'once' as const },
      nextRunAt: new Date(now + 3 * 60 * 60_000).toISOString(), // +3 h (outside 1h horizon)
    },
    {
      id: 'r3', title: 'disabled', prompt: '', action: { kind: 'speak' as const, text: '' },
      enabled: false, createdAt: nowIso, updatedAt: nowIso,
      schedule: { kind: 'once' as const },
      nextRunAt: new Date(now + 5 * 60_000).toISOString(),
    },
    {
      id: 'r4', title: 'no schedule', prompt: '', action: { kind: 'speak' as const, text: '' },
      enabled: true, createdAt: nowIso, updatedAt: nowIso,
      schedule: { kind: 'once' as const },
    },
  ]

  const ctx = gatherAutonomyContext(baseInput({ pendingReminders: reminders }))
  assert.deepEqual(ctx.nearReminders.map((r) => r.id), ['r1'])
})

test('gatherAutonomyContext orders active goals by nearest deadline', () => {
  const goals = [
    {
      id: 'g1', title: 'no deadline', status: 'active' as const, progress: 10,
      subtasks: [], createdAt: '', updatedAt: '',
    },
    {
      id: 'g2', title: 'tomorrow', status: 'active' as const, progress: 40,
      subtasks: [], deadline: '2026-04-20T00:00:00.000Z',
      createdAt: '', updatedAt: '',
    },
    {
      id: 'g3', title: 'next month', status: 'active' as const, progress: 5,
      subtasks: [], deadline: '2026-05-19T00:00:00.000Z',
      createdAt: '', updatedAt: '',
    },
    {
      id: 'g4', title: 'completed', status: 'completed' as const, progress: 100,
      subtasks: [], createdAt: '', updatedAt: '',
    },
  ]
  const ctx = gatherAutonomyContext(baseInput({ goals }))
  // completed excluded; tomorrow first; no-deadline last
  assert.deepEqual(ctx.activeGoals.map((g) => g.id), ['g2', 'g3', 'g1'])
})

// ── Degenerate cases ─────────────────────────────────────────────────────────

test('gatherAutonomyContext handles a brand-new user with empty everything', () => {
  const ctx = gatherAutonomyContext(baseInput())
  assert.equal(ctx.recentMessages.length, 0)
  assert.equal(ctx.topMemories.length, 0)
  assert.equal(ctx.nearReminders.length, 0)
  assert.equal(ctx.activeGoals.length, 0)
  assert.equal(ctx.activityClass, 'unknown')
  assert.equal(ctx.userDeepFocused, false)
  assert.equal(ctx.relationshipLevel, 'acquaintance') // default score 10 maps to this band
  assert.equal(ctx.lastProactiveUtterance, null)
})

test('gatherAutonomyContext preserves lastProactiveUtterance when supplied', () => {
  const utterance = { text: '早上好呀', at: '2026-04-19T07:30:00.000Z' }
  const ctx = gatherAutonomyContext(baseInput({ lastProactiveUtterance: utterance }))
  assert.deepEqual(ctx.lastProactiveUtterance, utterance)
})
