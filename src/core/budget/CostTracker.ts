import type { ProviderId } from '../routing/types.ts'
import type { BudgetConfig, BudgetStatus, CostEntry, CostEntryKind } from './types.ts'
import { UsagePricingTable } from './UsagePricing.ts'

export type RecordUsageInput = {
  providerId: ProviderId
  modelId: string
  tier: CostEntry['tier']
  inputTokens: number
  outputTokens: number
  conversationId?: string
  timestamp?: number
}

/**
 * Non-chat usage: TTS / STT / remote embeddings. The caller pre-computes
 * costUsd via features/metering/speechCost.ts since each subtype has a
 * different pricing model. Tier is fixed at 'cheap' — these aren't subject
 * to chat-tier downgrade logic.
 */
export type RecordAuxiliaryInput = {
  kind: Exclude<CostEntryKind, 'chat'>
  providerId: ProviderId
  modelId: string
  units: number
  costUsd: number
  conversationId?: string
  timestamp?: number
}

const MODEL_TIERS = new Set<CostEntry['tier']>(['cheap', 'standard', 'heavy'])
const COST_ENTRY_KINDS = new Set<CostEntryKind>(['chat', 'tts', 'stt', 'embedding'])

function normalizeNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined
}

function normalizeNonNegativeInteger(value: unknown): number {
  const normalized = normalizeNonNegativeNumber(value)
  return normalized === undefined ? 0 : Math.floor(normalized)
}

function normalizeOptionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function normalizeTier(value: unknown): CostEntry['tier'] | null {
  return MODEL_TIERS.has(value as CostEntry['tier'])
    ? value as CostEntry['tier']
    : null
}

function normalizeKind(value: unknown): CostEntryKind {
  return COST_ENTRY_KINDS.has(value as CostEntryKind)
    ? value as CostEntryKind
    : 'chat'
}

function cloneEntry(entry: CostEntry): CostEntry {
  return { ...entry }
}

function cloneConfig(config: BudgetConfig): BudgetConfig {
  return { ...config }
}

export function normalizeBudgetConfig(value: unknown): BudgetConfig {
  if (!value || typeof value !== 'object') return {}
  const raw = value as Partial<BudgetConfig>
  const config: BudgetConfig = {}
  const dailyCapUsd = normalizeNonNegativeNumber(raw.dailyCapUsd)
  if (dailyCapUsd !== undefined) config.dailyCapUsd = dailyCapUsd
  const monthlyCapUsd = normalizeNonNegativeNumber(raw.monthlyCapUsd)
  if (monthlyCapUsd !== undefined) config.monthlyCapUsd = monthlyCapUsd
  const ratio = normalizeNonNegativeNumber(raw.downgradeThresholdRatio)
  if (ratio !== undefined) config.downgradeThresholdRatio = Math.min(1, ratio)
  if (typeof raw.hardStop === 'boolean') config.hardStop = raw.hardStop
  return config
}

export function normalizeCostEntry(value: unknown): CostEntry | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<CostEntry>
  const id = normalizeOptionalText(raw.id)
  const providerId = normalizeOptionalText(raw.providerId)
  const modelId = normalizeOptionalText(raw.modelId)
  const timestamp = normalizeNonNegativeNumber(raw.timestamp)
  const costUsd = normalizeNonNegativeNumber(raw.costUsd)
  const tier = normalizeTier(raw.tier)
  if (!id || !providerId || !modelId || timestamp === undefined || costUsd === undefined || !tier) {
    return null
  }
  const kind = normalizeKind(raw.kind)
  const units = normalizeNonNegativeNumber(raw.units)
  return {
    id,
    timestamp,
    providerId,
    modelId,
    tier: kind === 'chat' ? tier : 'cheap',
    inputTokens: kind === 'chat' ? normalizeNonNegativeInteger(raw.inputTokens) : 0,
    outputTokens: kind === 'chat' ? normalizeNonNegativeInteger(raw.outputTokens) : 0,
    costUsd,
    ...(normalizeOptionalText(raw.conversationId) ? { conversationId: normalizeOptionalText(raw.conversationId) } : {}),
    kind,
    ...(kind !== 'chat' && units !== undefined ? { units } : {}),
  }
}

export function normalizeCostEntries(value: unknown): CostEntry[] {
  if (!Array.isArray(value)) return []
  return value.map(normalizeCostEntry).filter((entry): entry is CostEntry => Boolean(entry))
}

export class CostTracker {
  private readonly entries: CostEntry[] = []
  private readonly pricing: UsagePricingTable
  private config: BudgetConfig

  constructor(options?: { pricing?: UsagePricingTable; config?: BudgetConfig }) {
    this.pricing = options?.pricing ?? new UsagePricingTable()
    this.config = normalizeBudgetConfig(options?.config ?? {})
  }

  setConfig(config: BudgetConfig): void {
    this.config = normalizeBudgetConfig(config)
  }

  getConfig(): BudgetConfig {
    return cloneConfig(this.config)
  }

  record(input: RecordUsageInput): CostEntry {
    const providerId = input.providerId.trim()
    const modelId = input.modelId.trim()
    const tier = normalizeTier(input.tier)
    if (!providerId || !modelId || !tier) {
      throw new Error('CostTracker.record requires providerId, modelId and a valid tier')
    }
    const inputTokens = normalizeNonNegativeInteger(input.inputTokens)
    const outputTokens = normalizeNonNegativeInteger(input.outputTokens)
    const costUsd = this.pricing.computeCost(
      providerId,
      modelId,
      inputTokens,
      outputTokens,
    )
    const entry: CostEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: normalizeNonNegativeNumber(input.timestamp) ?? Date.now(),
      providerId,
      modelId,
      tier,
      inputTokens,
      outputTokens,
      costUsd,
      ...(normalizeOptionalText(input.conversationId) ? { conversationId: normalizeOptionalText(input.conversationId) } : {}),
      kind: 'chat',
    }
    this.entries.push(entry)
    return cloneEntry(entry)
  }

  recordAuxiliary(input: RecordAuxiliaryInput): CostEntry {
    const providerId = input.providerId.trim()
    const modelId = input.modelId.trim()
    const kind = normalizeKind(input.kind)
    if (!providerId || !modelId || kind === 'chat') {
      throw new Error('CostTracker.recordAuxiliary requires a non-chat kind, providerId and modelId')
    }
    const entry: CostEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: normalizeNonNegativeNumber(input.timestamp) ?? Date.now(),
      providerId,
      modelId,
      tier: 'cheap',
      inputTokens: 0,
      outputTokens: 0,
      costUsd: normalizeNonNegativeNumber(input.costUsd) ?? 0,
      ...(normalizeOptionalText(input.conversationId) ? { conversationId: normalizeOptionalText(input.conversationId) } : {}),
      kind,
      units: normalizeNonNegativeNumber(input.units) ?? 0,
    }
    this.entries.push(entry)
    return cloneEntry(entry)
  }

  totalForDay(day: Date = new Date()): number {
    const start = startOfDay(day).getTime()
    const end = start + 24 * 60 * 60 * 1000
    return this.sumCostInRange(start, end)
  }

  totalForMonth(day: Date = new Date()): number {
    const start = new Date(day.getFullYear(), day.getMonth(), 1).getTime()
    const end = new Date(day.getFullYear(), day.getMonth() + 1, 1).getTime()
    return this.sumCostInRange(start, end)
  }

  status(now: Date = new Date()): BudgetStatus {
    const dailyUsed = this.totalForDay(now)
    const monthlyUsed = this.totalForMonth(now)
    const { dailyCapUsd, monthlyCapUsd, downgradeThresholdRatio, hardStop } = this.config

    const dailyRatio = dailyCapUsd ? dailyUsed / dailyCapUsd : 0
    const monthlyRatio = monthlyCapUsd ? monthlyUsed / monthlyCapUsd : 0
    const threshold = downgradeThresholdRatio ?? 0.8
    const shouldDowngrade = dailyRatio >= threshold || monthlyRatio >= threshold

    const exceededDaily = dailyCapUsd !== undefined && dailyUsed >= dailyCapUsd
    const exceededMonthly = monthlyCapUsd !== undefined && monthlyUsed >= monthlyCapUsd
    const shouldHardStop = Boolean(hardStop) && (exceededDaily || exceededMonthly)

    return {
      dailyUsedUsd: dailyUsed,
      monthlyUsedUsd: monthlyUsed,
      dailyCapUsd,
      monthlyCapUsd,
      shouldDowngrade,
      shouldHardStop,
    }
  }

  listEntries(): CostEntry[] {
    return this.entries.map(cloneEntry)
  }

  clear(): void {
    this.entries.length = 0
  }

  restore(entries: CostEntry[]): void {
    this.entries.length = 0
    this.entries.push(...normalizeCostEntries(entries).map(cloneEntry))
  }

  private sumCostInRange(startMs: number, endMs: number): number {
    let total = 0
    for (const entry of this.entries) {
      if (entry.timestamp >= startMs && entry.timestamp < endMs) {
        total += entry.costUsd
      }
    }
    return total
  }
}

function startOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}
