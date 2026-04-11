/**
 * Multimodal context metering — tracks token usage and cost across all LLM calls.
 *
 * Counts are estimated from text length (2.5 chars ≈ 1 token for CJK-heavy text,
 * 4 chars for English). Actual token counts would require model-specific
 * tokenizers; this heuristic is sufficient for budgeting.
 *
 * All metrics are session-scoped with daily aggregation persisted to localStorage.
 */

const METER_STORAGE_KEY = 'nexus:metering:daily'
const CHARS_PER_TOKEN_CJK = 2.5
const CHARS_PER_TOKEN_EN = 4

// ── Types ─────────────────────────────────────────────────────────────────

export type MeterSource = 'chat' | 'dream' | 'monologue' | 'skill_distillation' | 'tool' | 'other'

export interface MeterEntry {
  source: MeterSource
  inputTokens: number
  outputTokens: number
  timestamp: string
}

export interface DailyMeterRecord {
  date: string
  totalInputTokens: number
  totalOutputTokens: number
  callCount: number
  bySource: Record<MeterSource, { input: number; output: number; calls: number }>
}

export interface MeterSnapshot {
  session: {
    totalInputTokens: number
    totalOutputTokens: number
    callCount: number
    bySource: Record<string, { input: number; output: number; calls: number }>
  }
  daily: DailyMeterRecord
}

// ── Session state ─────────────────────────────────────────────────────────

let _sessionInput = 0
let _sessionOutput = 0
let _sessionCalls = 0
const _sessionBySource: Record<string, { input: number; output: number; calls: number }> = {}

// ── Token estimation ──────────────────────────────────────────────────────

function hasCjk(text: string): boolean {
  return /[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef]/.test(text)
}

export function estimateTokens(text: string): number {
  if (!text) return 0
  const ratio = hasCjk(text) ? CHARS_PER_TOKEN_CJK : CHARS_PER_TOKEN_EN
  return Math.ceil(text.length / ratio)
}

// ── Daily persistence (cached in memory, flushed on mutation) ─────────────

let _dailyCache: DailyMeterRecord | null = null

function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

function loadDailyRecord(): DailyMeterRecord {
  if (_dailyCache && _dailyCache.date === todayKey()) return _dailyCache
  try {
    const raw = localStorage.getItem(METER_STORAGE_KEY)
    if (!raw) { _dailyCache = createDailyRecord(); return _dailyCache }
    const parsed = JSON.parse(raw) as DailyMeterRecord
    if (parsed.date !== todayKey()) { _dailyCache = createDailyRecord(); return _dailyCache }
    _dailyCache = parsed
    return _dailyCache
  } catch {
    _dailyCache = createDailyRecord()
    return _dailyCache
  }
}

function createDailyRecord(): DailyMeterRecord {
  return {
    date: todayKey(),
    totalInputTokens: 0,
    totalOutputTokens: 0,
    callCount: 0,
    bySource: {
      chat: { input: 0, output: 0, calls: 0 },
      dream: { input: 0, output: 0, calls: 0 },
      monologue: { input: 0, output: 0, calls: 0 },
      skill_distillation: { input: 0, output: 0, calls: 0 },
      tool: { input: 0, output: 0, calls: 0 },
      other: { input: 0, output: 0, calls: 0 },
    },
  }
}

function saveDailyRecord(record: DailyMeterRecord): void {
  localStorage.setItem(METER_STORAGE_KEY, JSON.stringify(record))
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Record a single LLM call's token usage.
 */
export function recordUsage(source: MeterSource, inputText: string, outputText: string): void {
  const inputTokens = estimateTokens(inputText)
  const outputTokens = estimateTokens(outputText)

  // Session accumulation
  _sessionInput += inputTokens
  _sessionOutput += outputTokens
  _sessionCalls++

  if (!_sessionBySource[source]) {
    _sessionBySource[source] = { input: 0, output: 0, calls: 0 }
  }
  _sessionBySource[source].input += inputTokens
  _sessionBySource[source].output += outputTokens
  _sessionBySource[source].calls++

  // Daily persistence
  const daily = loadDailyRecord()
  daily.totalInputTokens += inputTokens
  daily.totalOutputTokens += outputTokens
  daily.callCount++

  if (!daily.bySource[source]) {
    daily.bySource[source] = { input: 0, output: 0, calls: 0 }
  }
  daily.bySource[source].input += inputTokens
  daily.bySource[source].output += outputTokens
  daily.bySource[source].calls++

  saveDailyRecord(daily)
}

/**
 * Get the current metering snapshot (session + daily).
 */
export function getMeterSnapshot(): MeterSnapshot {
  return {
    session: {
      totalInputTokens: _sessionInput,
      totalOutputTokens: _sessionOutput,
      callCount: _sessionCalls,
      bySource: { ..._sessionBySource },
    },
    daily: loadDailyRecord(),
  }
}

/**
 * Check whether daily budget is exceeded.
 * Returns { exceeded: boolean, usage: number, limit: number }
 */
export function checkBudget(dailyTokenLimit: number): { exceeded: boolean; usage: number; limit: number } {
  const daily = loadDailyRecord()
  const usage = daily.totalInputTokens + daily.totalOutputTokens
  return {
    exceeded: dailyTokenLimit > 0 && usage >= dailyTokenLimit,
    usage,
    limit: dailyTokenLimit,
  }
}

/**
 * Reset session counters (e.g. on app restart).
 */
export function resetSession(): void {
  _sessionInput = 0
  _sessionOutput = 0
  _sessionCalls = 0
  for (const key of Object.keys(_sessionBySource)) {
    delete _sessionBySource[key]
  }
}
