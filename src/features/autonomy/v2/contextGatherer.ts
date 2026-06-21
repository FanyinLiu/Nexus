/**
 * Autonomy Engine V2 — context gatherer.
 *
 * Pure function that takes every signal the engine needs to make a decision
 * and folds them into one structured object. No React, no IPC, no disk reads.
 * Callers are responsible for pulling the input state from wherever it lives
 * (refs, hooks, stores).
 *
 * The shape of `AutonomyContextV2` is the contract the decision LLM prompt
 * builder and persona guardrail both depend on, so small, explicit, and
 * serialisable fields only — anything opaque (functions, Refs, class
 * instances) stays on the outside.
 */

import type {
  AutonomyPhase,
  AutonomyTickState,
  FocusState,
  Goal,
} from '../../../types/autonomy.ts'
import type { ChatMessage } from '../../../types/chat.ts'
import type { MemoryItem } from '../../../types/memory.ts'
import type { ReminderTask } from '../../../types/reminders.ts'
import type { EmotionState } from '../emotionModel.ts'
import {
  type RelationshipLevel,
  type RelationshipState,
  getRelationshipLevel,
} from '../relationshipTracker.ts'
import {
  type ActivityWindow,
  type RhythmProfile,
  getHourlyProbability,
} from '../rhythmLearner.ts'
import {
  classifyActivity,
  isUserDeepFocused,
  type ActivityClass,
} from '../../context/activityClassification.ts'

export {
  classifyActivity,
  isUserDeepFocused,
  type ActivityClass,
} from '../../context/activityClassification.ts'

// ── Context shape ──────────────────────────────────────────────────────────

export interface AutonomyContextV2 {
  // ── Temporal ──
  /** ISO timestamp of the gather call. */
  timestamp: string
  /** 0–23 in local time. */
  hour: number
  /** 0 (Sun) – 6 (Sat) in local time. */
  dayOfWeek: number

  // ── User focus ──
  focusState: FocusState
  /** Foreground window title, if detected. */
  activeWindowTitle: string | null
  /** Coarse classification of the foreground app. */
  activityClass: ActivityClass
  /** True iff heuristic says the user is heads-down. */
  userDeepFocused: boolean
  /** Seconds since the user last interacted with anything. */
  idleSeconds: number
  /** How many consecutive ticks the user has been idle. */
  consecutiveIdleTicks: number

  // ── Engine self-state ──
  phase: AutonomyPhase
  /** ISO timestamp of the last wake. */
  lastWakeAt: string
  /** ISO timestamp of the last sleep entry (null if never slept). */
  lastSleepAt: string | null

  // ── Affective state ──
  emotion: EmotionState
  /** Enum describing the current relationship phase. */
  relationshipLevel: RelationshipLevel
  /** Raw score 0–100. */
  relationshipScore: number
  /** Total number of distinct days with at least one interaction. */
  daysInteracted: number
  /** Consecutive-day interaction streak. */
  streak: number
  /**
   * Sub-dimensional relationship profile (trust / vulnerability /
   * playfulness / intellectual). Absent on fresh / pre-v0.3 state.
   */
  subDimensions?: import('../relationshipDimensions.ts').SubDimensions

  // ── Recent conversation ──
  /** Last N (user, assistant) messages, oldest first. */
  recentMessages: Array<{
    role: 'user' | 'assistant'
    content: string
    at: string
  }>

  // ── Long-term memory highlights ──
  /** Top K memories ranked by importance × recency. */
  topMemories: Array<{
    id: string
    content: string
    category: string
    importanceScore: number
  }>

  // ── Explicit tasks + goals ──
  /** Reminders scheduled to fire within the next hour OR already overdue. */
  nearReminders: Array<{
    id: string
    title: string
    /** ISO nextRunAt (null if not yet computed). */
    nextRunAt: string | null
  }>
  /** In-progress goals (status === 'active'). */
  activeGoals: Array<{
    id: string
    title: string
    progress: number
    deadline: string | null
  }>

  // ── Rhythm learning ──
  /** High / medium / low — is this hour one the user is usually active? */
  activityWindow: ActivityWindow

  // ── Self-reflection ──
  /** The last time this engine spoke proactively. Prevents repetition. */
  lastProactiveUtterance: {
    text: string
    at: string
  } | null
}

export interface ContextGathererInput {
  tickState: AutonomyTickState
  focusState: FocusState
  emotion: EmotionState
  relationship: RelationshipState
  rhythm: RhythmProfile
  recentMessages: ChatMessage[]
  memories: MemoryItem[]
  pendingReminders: ReminderTask[]
  goals: Goal[]
  activeWindowTitle: string | null
  lastProactiveUtterance?: { text: string; at: string } | null
  maxRecentMessages?: number
  maxMemories?: number
  /** Only surface reminders firing within this horizon (ms). Default 1 h. */
  nearReminderHorizonMs?: number
}

// ── Ranking helpers ────────────────────────────────────────────────────────

function rankMemoryByImportanceAndRecency(memory: MemoryItem, nowMs: number): number {
  const base = memory.importanceScore ?? (memory.importance === 'pinned' ? 1.5
    : memory.importance === 'high' ? 1.2
    : memory.importance === 'normal' ? 1.0
    : 0.7)

  // Recency bonus: memories recalled recently (or created recently) outrank
  // stale ones. Decays gently over 30 days.
  const lastTouchIso = memory.lastRecalledAt ?? memory.lastUsedAt ?? memory.createdAt
  const lastTouchMs = Date.parse(lastTouchIso)
  if (!Number.isFinite(lastTouchMs)) return base

  const ageDays = (nowMs - lastTouchMs) / 86_400_000
  const recencyMultiplier = Math.max(0.4, 1 - ageDays / 30)
  return base * recencyMultiplier
}

/**
 * Map a 0–1 probability to high/medium/low. Mirrors the classifyCurrentWindow
 * thresholds in rhythmLearner.ts so v2 and legacy agree on the boundary but
 * v2 can pass an explicit hour (tests, replay, future "what about in 2 h?"
 * calls) instead of hard-coding `new Date().getHours()`.
 */
function probabilityToWindow(prob: number): ActivityWindow {
  if (prob >= 0.6) return 'high'
  if (prob >= 0.25) return 'medium'
  return 'low'
}

function takeTop<T>(items: T[], rank: (x: T) => number, limit: number): T[] {
  if (items.length <= limit) return [...items].sort((a, b) => rank(b) - rank(a))
  // Partial sort: don't pay O(n log n) just to throw most of it away.
  return [...items]
    .map((item) => ({ item, score: rank(item) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ item }) => item)
}

// ── Main entry point ──────────────────────────────────────────────────────

export function gatherAutonomyContext(input: ContextGathererInput): AutonomyContextV2 {
  const maxRecent = input.maxRecentMessages ?? 6
  const maxMemories = input.maxMemories ?? 5
  const reminderHorizon = input.nearReminderHorizonMs ?? 3_600_000

  const now = new Date()
  const nowMs = now.getTime()

  // ── Activity classification ──
  const activityClass = classifyActivity(input.activeWindowTitle)
  const userDeepFocused = isUserDeepFocused(
    activityClass,
    input.tickState.consecutiveIdleTicks,
    input.activeWindowTitle,
  )

  // ── Recent messages: last N non-system, oldest first ──
  const recentMessages = input.recentMessages
    .filter((m): m is ChatMessage & { role: 'user' | 'assistant' } =>
      m.role === 'user' || m.role === 'assistant',
    )
    .slice(-maxRecent)
    .map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : '',
      at: m.createdAt,
    }))

  // ── Memory highlights ──
  const topMemories = takeTop(
    input.memories,
    (m) => rankMemoryByImportanceAndRecency(m, nowMs),
    maxMemories,
  ).map((m) => ({
    id: m.id,
    content: m.content,
    category: m.category,
    importanceScore: m.importanceScore ?? 1,
  }))

  // ── Reminders firing soon ──
  const nearReminders = input.pendingReminders
    .filter((r) => r.enabled !== false)
    .filter((r) => {
      if (!r.nextRunAt) return false
      const due = Date.parse(r.nextRunAt)
      if (!Number.isFinite(due)) return false
      return due - nowMs <= reminderHorizon
    })
    .sort((a, b) => Date.parse(a.nextRunAt!) - Date.parse(b.nextRunAt!))
    .map((r) => ({
      id: r.id,
      title: r.title,
      nextRunAt: r.nextRunAt ?? null,
    }))

  // ── Active goals only (status: 'active') ──
  const activeGoals = input.goals
    .filter((g) => g.status === 'active')
    .sort((a, b) => {
      // Goals with deadlines come first, closest deadline first.
      const aDue = a.deadline ? Date.parse(a.deadline) : Number.POSITIVE_INFINITY
      const bDue = b.deadline ? Date.parse(b.deadline) : Number.POSITIVE_INFINITY
      return aDue - bDue
    })
    .map((g) => ({
      id: g.id,
      title: g.title,
      progress: g.progress,
      deadline: g.deadline ?? null,
    }))

  return {
    timestamp: now.toISOString(),
    hour: now.getHours(),
    dayOfWeek: now.getDay(),

    focusState: input.focusState,
    activeWindowTitle: input.activeWindowTitle,
    activityClass,
    userDeepFocused,
    idleSeconds: input.tickState.idleSeconds,
    consecutiveIdleTicks: input.tickState.consecutiveIdleTicks,

    phase: input.tickState.phase,
    lastWakeAt: input.tickState.lastWakeAt,
    lastSleepAt: input.tickState.lastSleepAt,

    emotion: input.emotion,
    relationshipLevel: getRelationshipLevel(input.relationship),
    relationshipScore: input.relationship.score,
    daysInteracted: input.relationship.totalDaysInteracted,
    streak: input.relationship.streak,
    subDimensions: input.relationship.subDimensions,

    recentMessages,
    topMemories,
    nearReminders,
    activeGoals,

    activityWindow: probabilityToWindow(getHourlyProbability(input.rhythm, now.getHours())),

    lastProactiveUtterance: input.lastProactiveUtterance ?? null,
  }
}
