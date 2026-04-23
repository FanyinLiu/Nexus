/**
 * Multimodal context metering — tracks token usage and cost across all LLM calls.
 *
 * Token counts are estimated without tiktoken:
 *   English / mixed:  ceil(chars / 3.5)
 *   CJK-heavy text:   ceil(chars / 1.5)   (>30% of chars in CJK ranges)
 *
 * Cost is computed from a built-in pricing table keyed on model-id substrings.
 * All metrics are session-scoped; daily totals are persisted to localStorage.
 */

const METER_STORAGE_KEY_LEGACY = 'nexus:metering:daily'
const METER_STORAGE_PREFIX = 'nexus:metering:day:'

// ── Types ─────────────────────────────────────────────────────────────────

export type MeterSource = 'chat' | 'dream' | 'monologue' | 'skill_distillation' | 'reflection' | 'tool' | 'other'

export interface MeterEntry {
  source: MeterSource
  inputTokens: number
  outputTokens: number
  costUsd: number
  timestamp: string
}

export interface DailyMeterRecord {
  date: string
  totalInputTokens: number
  totalOutputTokens: number
  totalCostUsd: number
  callCount: number
  bySource: Record<MeterSource, { input: number; output: number; calls: number; costUsd: number }>
  /**
   * Per-model accumulation. Keys are the raw modelId strings passed to
   * recordUsage. Optional for backward compatibility — records persisted
   * before this field was added will be missing it; the loader normalises
   * them to an empty object on read.
   */
  byModel?: Record<string, { input: number; output: number; calls: number; costUsd: number }>
}

export interface MeterSnapshot {
  session: {
    totalInputTokens: number
    totalOutputTokens: number
    totalCostUsd: number
    callCount: number
    bySource: Record<string, { input: number; output: number; calls: number; costUsd: number }>
  }
  daily: DailyMeterRecord
}

// ── Token estimation ──────────────────────────────────────────────────────

const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/u

function cjkRatio(text: string): number {
  if (!text) return 0
  let cjk = 0
  for (const ch of text) {
    if (CJK_RE.test(ch)) cjk++
  }
  return cjk / text.length
}

export function estimateTokens(text: string): number {
  if (!text) return 0
  const divisor = cjkRatio(text) > 0.3 ? 1.5 : 3.5
  return Math.ceil(text.length / divisor)
}

// ── Pricing table ─────────────────────────────────────────────────────────
//
// Prices are in USD per 1 million tokens.
// Entries are matched by checking whether the model ID contains the key
// (case-insensitive, longest match wins so "gpt-4o" beats "gpt-4").

interface ModelPrice {
  inputPerM: number
  outputPerM: number
}

const PRICING_TABLE: Array<{ pattern: string; price: ModelPrice }> = [
  // DeepSeek
  { pattern: 'deepseek-chat',        price: { inputPerM: 0.14,  outputPerM: 0.28  } },
  { pattern: 'deepseek-reasoner',    price: { inputPerM: 0.55,  outputPerM: 2.19  } },
  // OpenAI — longest-first; 5.5-pro / 5.5 / 5.4 distinct rates, bare gpt-5 falls back to 5.4 cost
  { pattern: 'gpt-5.5-pro',         price: { inputPerM: 30.00, outputPerM: 180.00 } },
  { pattern: 'gpt-5.5',             price: { inputPerM: 5.00,  outputPerM: 30.00  } },
  { pattern: 'gpt-5.4',             price: { inputPerM: 2.50,  outputPerM: 15.00  } },
  { pattern: 'gpt-5',               price: { inputPerM: 2.50,  outputPerM: 15.00  } },
  { pattern: 'gpt-4o-mini',         price: { inputPerM: 0.15,  outputPerM: 0.60  } },
  { pattern: 'gpt-4o',              price: { inputPerM: 2.50,  outputPerM: 10.00 } },
  { pattern: 'gpt-4-turbo',         price: { inputPerM: 10.00, outputPerM: 30.00 } },
  { pattern: 'gpt-3.5',             price: { inputPerM: 0.50,  outputPerM: 1.50  } },
  // Anthropic Claude — Opus 4.7 (2026-04) cut prices 3x; was $15/$75
  { pattern: 'claude-opus',         price: { inputPerM: 5.00,  outputPerM: 25.00 } },
  { pattern: 'claude-sonnet',       price: { inputPerM: 3.00,  outputPerM: 15.00 } },
  { pattern: 'claude-haiku',        price: { inputPerM: 0.80,  outputPerM: 4.00  } },
  // Google Gemini
  { pattern: 'gemini-1.5-pro',      price: { inputPerM: 3.50,  outputPerM: 10.50 } },
  { pattern: 'gemini-1.5-flash',    price: { inputPerM: 0.075, outputPerM: 0.30  } },
  { pattern: 'gemini-2.0-flash',    price: { inputPerM: 0.10,  outputPerM: 0.40  } },
]

function lookupPrice(modelId: string): ModelPrice | null {
  const lower = modelId.toLowerCase()
  let best: { len: number; price: ModelPrice } | null = null
  for (const entry of PRICING_TABLE) {
    if (lower.includes(entry.pattern)) {
      if (!best || entry.pattern.length > best.len) {
        best = { len: entry.pattern.length, price: entry.price }
      }
    }
  }
  return best?.price ?? null
}

export function computeCostUsd(modelId: string, inputTokens: number, outputTokens: number): number {
  const price = lookupPrice(modelId)
  if (!price) return 0
  return (inputTokens / 1_000_000) * price.inputPerM + (outputTokens / 1_000_000) * price.outputPerM
}

// ── Session state ─────────────────────────────────────────────────────────

let _sessionInput = 0
let _sessionOutput = 0
let _sessionCost = 0
let _sessionCalls = 0
const _sessionBySource: Record<string, { input: number; output: number; calls: number; costUsd: number }> = {}

// ── Daily persistence (cached in memory, flushed on mutation) ─────────────

let _dailyCache: DailyMeterRecord | null = null

function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

function dailyStorageKey(date: string): string {
  return `${METER_STORAGE_PREFIX}${date}`
}

function loadDailyRecord(): DailyMeterRecord {
  if (_dailyCache && _dailyCache.date === todayKey()) return _dailyCache
  try {
    // Try new per-day key first
    let raw = localStorage.getItem(dailyStorageKey(todayKey()))
    // Migrate from legacy single-key format
    if (!raw) {
      raw = localStorage.getItem(METER_STORAGE_KEY_LEGACY)
      if (raw) {
        const parsed = JSON.parse(raw) as DailyMeterRecord
        if (parsed.date === todayKey()) {
          localStorage.setItem(dailyStorageKey(todayKey()), raw)
          localStorage.removeItem(METER_STORAGE_KEY_LEGACY)
          _dailyCache = parsed
          if (typeof _dailyCache.totalCostUsd !== 'number') _dailyCache.totalCostUsd = 0
          return _dailyCache
        }
        // Old date — discard legacy key
        localStorage.removeItem(METER_STORAGE_KEY_LEGACY)
      }
    }
    if (!raw) { _dailyCache = createDailyRecord(); return _dailyCache }
    const parsed = JSON.parse(raw) as DailyMeterRecord
    if (parsed.date !== todayKey()) { _dailyCache = createDailyRecord(); return _dailyCache }
    _dailyCache = parsed
    if (typeof _dailyCache.totalCostUsd !== 'number') _dailyCache.totalCostUsd = 0
    if (!_dailyCache.byModel) _dailyCache.byModel = {}
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
    totalCostUsd: 0,
    callCount: 0,
    bySource: {
      chat:               { input: 0, output: 0, calls: 0, costUsd: 0 },
      dream:              { input: 0, output: 0, calls: 0, costUsd: 0 },
      monologue:          { input: 0, output: 0, calls: 0, costUsd: 0 },
      skill_distillation: { input: 0, output: 0, calls: 0, costUsd: 0 },
      reflection:         { input: 0, output: 0, calls: 0, costUsd: 0 },
      tool:               { input: 0, output: 0, calls: 0, costUsd: 0 },
      other:              { input: 0, output: 0, calls: 0, costUsd: 0 },
    },
    byModel: {},
  }
}

function saveDailyRecord(record: DailyMeterRecord): void {
  localStorage.setItem(dailyStorageKey(record.date), JSON.stringify(record))
}

// ── Public API ────────────────────────────────────────────────────────────

export interface RecordUsageOptions {
  /** Model identifier used to look up per-token pricing. Empty = no cost. */
  modelId?: string
}

/**
 * Record a single LLM call's token usage and cost.
 *
 * Pass the full assembled input text (system prompt + all messages + tool
 * schemas concatenated) to get accurate token counts.
 */
export function recordUsage(
  source: MeterSource,
  inputText: string,
  outputText: string,
  options: RecordUsageOptions = {},
): void {
  const inputTokens = estimateTokens(inputText)
  const outputTokens = estimateTokens(outputText)
  const costUsd = options.modelId
    ? computeCostUsd(options.modelId, inputTokens, outputTokens)
    : 0

  // Session accumulation
  _sessionInput += inputTokens
  _sessionOutput += outputTokens
  _sessionCost += costUsd
  _sessionCalls++

  if (!_sessionBySource[source]) {
    _sessionBySource[source] = { input: 0, output: 0, calls: 0, costUsd: 0 }
  }
  _sessionBySource[source].input += inputTokens
  _sessionBySource[source].output += outputTokens
  _sessionBySource[source].calls++
  _sessionBySource[source].costUsd += costUsd

  // Daily persistence
  const daily = loadDailyRecord()
  daily.totalInputTokens += inputTokens
  daily.totalOutputTokens += outputTokens
  daily.totalCostUsd += costUsd
  daily.callCount++

  if (!daily.bySource[source]) {
    daily.bySource[source] = { input: 0, output: 0, calls: 0, costUsd: 0 }
  }
  daily.bySource[source].input += inputTokens
  daily.bySource[source].output += outputTokens
  daily.bySource[source].calls++
  daily.bySource[source].costUsd += costUsd

  if (options.modelId) {
    if (!daily.byModel) daily.byModel = {}
    if (!daily.byModel[options.modelId]) {
      daily.byModel[options.modelId] = { input: 0, output: 0, calls: 0, costUsd: 0 }
    }
    daily.byModel[options.modelId].input += inputTokens
    daily.byModel[options.modelId].output += outputTokens
    daily.byModel[options.modelId].calls++
    daily.byModel[options.modelId].costUsd += costUsd
  }

  saveDailyRecord(daily)
}

// ── Historical range reader ───────────────────────────────────────────────

/**
 * Load the last `days` per-day records (most recent first), skipping days
 * that have no entry. Used by the cost-history panel to draw a bar chart
 * of recent spend.
 */
export function loadDailyRange(days: number): DailyMeterRecord[] {
  if (days <= 0) return []
  const out: DailyMeterRecord[] = []
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)

  for (let i = 0; i < days; i++) {
    const d = new Date(today)
    d.setUTCDate(d.getUTCDate() - i)
    const dateKey = d.toISOString().slice(0, 10)
    try {
      const raw = localStorage.getItem(dailyStorageKey(dateKey))
      if (!raw) continue
      const parsed = JSON.parse(raw) as DailyMeterRecord
      if (typeof parsed.totalCostUsd !== 'number') parsed.totalCostUsd = 0
      if (!parsed.byModel) parsed.byModel = {}
      out.push(parsed)
    } catch {
      // Corrupt entry — skip it rather than fail the whole range read.
    }
  }

  return out
}

/**
 * Get the current metering snapshot (session + daily).
 */
export function getMeterSnapshot(): MeterSnapshot {
  return {
    session: {
      totalInputTokens: _sessionInput,
      totalOutputTokens: _sessionOutput,
      totalCostUsd: _sessionCost,
      callCount: _sessionCalls,
      bySource: { ..._sessionBySource },
    },
    daily: loadDailyRecord(),
  }
}

/**
 * Check whether daily or monthly USD budget is exceeded.
 *
 * Pass limits in USD (0 or undefined = no cap).
 */
export function checkBudget(options: {
  dailyCapUsd?: number
  monthlyCapUsd?: number
}): {
  dailyExceeded: boolean
  monthlyExceeded: boolean
  dailyUsedUsd: number
  monthlyUsedUsd: number
  dailyCapUsd?: number
  monthlyCapUsd?: number
} {
  const daily = loadDailyRecord()
  const dailyUsedUsd = daily.totalCostUsd

  // Monthly: sum all per-day keys that share the current YYYY-MM prefix.
  const monthPrefix = todayKey().slice(0, 7) // "YYYY-MM"
  let monthlyUsedUsd = 0
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key || !key.startsWith(METER_STORAGE_PREFIX)) continue
    const dateStr = key.slice(METER_STORAGE_PREFIX.length)
    if (!dateStr.startsWith(monthPrefix)) continue
    try {
      const record = JSON.parse(localStorage.getItem(key)!) as DailyMeterRecord
      monthlyUsedUsd += record.totalCostUsd || 0
    } catch { /* corrupt entry, skip */ }
  }

  return {
    dailyExceeded: !!options.dailyCapUsd && dailyUsedUsd >= options.dailyCapUsd,
    monthlyExceeded: !!options.monthlyCapUsd && monthlyUsedUsd >= options.monthlyCapUsd,
    dailyUsedUsd,
    monthlyUsedUsd,
    dailyCapUsd: options.dailyCapUsd,
    monthlyCapUsd: options.monthlyCapUsd,
  }
}

/**
 * Reset session counters (e.g. on app restart).
 */
export function resetSession(): void {
  _sessionInput = 0
  _sessionOutput = 0
  _sessionCost = 0
  _sessionCalls = 0
  for (const key of Object.keys(_sessionBySource)) {
    delete _sessionBySource[key]
  }
}

/**
 * Clear the module-scoped daily cache. Exported for tests; production
 * code does not need this — the cache self-invalidates when the date
 * rolls over.
 */
export function __resetDailyCache(): void {
  _dailyCache = null
}
