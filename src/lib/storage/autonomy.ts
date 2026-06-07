import type { Goal, GoalStatus, GoalSubtask } from '../../types'
import {
  AUTONOMY_GOALS_STORAGE_KEY,
  PROACTIVE_AWAY_LAST_FIRED_STORAGE_KEY,
  PROACTIVE_BRACKET_STATE_STORAGE_KEY,
  readJson,
  writeJson,
} from './core.ts'

export type BracketState = {
  lastMorningFiredMs: number | null
  lastEveningFiredMs: number | null
}

const GOAL_STATUSES = new Set<GoalStatus>(['active', 'completed', 'paused', 'abandoned'])
const MAX_AUTONOMY_GOALS = 100
const EMPTY_BRACKET_STATE: BracketState = {
  lastMorningFiredMs: null,
  lastEveningFiredMs: null,
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > 0 ? normalized : null
}

function normalizeOptionalString(value: unknown): string | undefined {
  return normalizeString(value) ?? undefined
}

function normalizeIso(value: unknown, fallback?: string): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return fallback
  const parsed = typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isFinite(parsed)) return fallback
  return new Date(parsed).toISOString()
}

function normalizeProgress(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(100, Math.max(0, Math.round(numeric)))
}

function normalizeGoalStatus(value: unknown): GoalStatus {
  return typeof value === 'string' && GOAL_STATUSES.has(value as GoalStatus)
    ? value as GoalStatus
    : 'active'
}

function normalizeGoalSubtask(raw: unknown): GoalSubtask | null {
  if (!isObject(raw)) return null
  const id = normalizeString(raw.id)
  const title = normalizeString(raw.title)
  if (!id || !title) return null
  return {
    id,
    title,
    done: typeof raw.done === 'boolean' ? raw.done : false,
  }
}

function normalizeGoal(raw: unknown, nowIso: string): Goal | null {
  if (!isObject(raw)) return null
  const id = normalizeString(raw.id)
  const title = normalizeString(raw.title)
  if (!id || !title) return null

  const subtasks = Array.isArray(raw.subtasks)
    ? raw.subtasks.map(normalizeGoalSubtask).filter((item): item is GoalSubtask => Boolean(item))
    : []
  const fallbackProgress = subtasks.length > 0
    ? Math.round((subtasks.filter((item) => item.done).length / subtasks.length) * 100)
    : 0
  const createdAt = normalizeIso(raw.createdAt, nowIso) ?? nowIso
  const updatedAt = normalizeIso(raw.updatedAt, createdAt) ?? createdAt
  const status = normalizeGoalStatus(raw.status)

  const goal: Goal = {
    id,
    title,
    status,
    progress: normalizeProgress(raw.progress, fallbackProgress),
    subtasks,
    createdAt,
    updatedAt,
  }

  const description = normalizeOptionalString(raw.description)
  if (description) goal.description = description

  const deadline = normalizeIso(raw.deadline)
  if (deadline) goal.deadline = deadline

  const completedAt = normalizeIso(raw.completedAt)
  if (status === 'completed' && completedAt) {
    goal.completedAt = completedAt
  }

  return goal
}

function normalizeTimestamp(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : null
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    const numeric = Number(trimmed)
    if (Number.isFinite(numeric) && numeric >= 0) return numeric
    const parsed = Date.parse(trimmed)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
  }
  return null
}

function hasChanged(normalized: unknown, raw: unknown): boolean {
  return JSON.stringify(normalized) !== JSON.stringify(raw)
}

export function normalizeAutonomyGoals(raw: unknown, nowMs = Date.now()): Goal[] {
  if (!Array.isArray(raw)) return []
  const nowIso = new Date(nowMs).toISOString()
  return raw
    .map((item) => normalizeGoal(item, nowIso))
    .filter((item): item is Goal => Boolean(item))
    .slice(0, MAX_AUTONOMY_GOALS)
}

export function loadAutonomyGoals(): Goal[] {
  const raw = readJson<unknown>(AUTONOMY_GOALS_STORAGE_KEY, [])
  const normalized = normalizeAutonomyGoals(raw)
  if (hasChanged(normalized, raw)) {
    writeJson(AUTONOMY_GOALS_STORAGE_KEY, normalized)
  }
  return normalized
}

export function saveAutonomyGoals(goals: Goal[]): void {
  writeJson(AUTONOMY_GOALS_STORAGE_KEY, normalizeAutonomyGoals(goals))
}

export function normalizeBracketState(raw: unknown): BracketState {
  if (!isObject(raw)) return EMPTY_BRACKET_STATE
  return {
    lastMorningFiredMs: normalizeTimestamp(raw.lastMorningFiredMs),
    lastEveningFiredMs: normalizeTimestamp(raw.lastEveningFiredMs),
  }
}

export function loadBracketState(): BracketState {
  const raw = readJson<unknown>(PROACTIVE_BRACKET_STATE_STORAGE_KEY, EMPTY_BRACKET_STATE)
  const normalized = normalizeBracketState(raw)
  if (hasChanged(normalized, raw)) {
    writeJson(PROACTIVE_BRACKET_STATE_STORAGE_KEY, normalized)
  }
  return normalized
}

export function recordBracketFire(state: BracketState, bracket: 'morning' | 'evening', nowMs: number): BracketState {
  const normalized = normalizeBracketState(state)
  const firedAt = normalizeTimestamp(nowMs) ?? Date.now()
  return bracket === 'morning'
    ? { ...normalized, lastMorningFiredMs: firedAt }
    : { ...normalized, lastEveningFiredMs: firedAt }
}

export function normalizeAwayLastFiredMs(raw: unknown): number | null {
  return normalizeTimestamp(raw)
}

export function loadAwayLastFiredMs(): number | null {
  const raw = readJson<unknown>(PROACTIVE_AWAY_LAST_FIRED_STORAGE_KEY, null)
  const normalized = normalizeAwayLastFiredMs(raw)
  if (hasChanged(normalized, raw)) {
    writeJson(PROACTIVE_AWAY_LAST_FIRED_STORAGE_KEY, normalized)
  }
  return normalized
}

export function saveAwayLastFiredMs(nowMs: number): void {
  writeJson(PROACTIVE_AWAY_LAST_FIRED_STORAGE_KEY, normalizeAwayLastFiredMs(nowMs))
}
