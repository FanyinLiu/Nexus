import {
  normalizeBudgetConfig,
  normalizeCostEntries,
} from '../../core/budget/CostTracker.ts'
import type { BudgetConfig, CostEntry } from '../../core/budget/types.ts'
import {
  BUDGET_CONFIG_STORAGE_KEY,
  COST_ENTRIES_STORAGE_KEY,
  readJson,
  writeJson,
  writeJsonDebounced,
} from './core.ts'

const MAX_STORED_ENTRIES = 2000

function capStoredEntries(entries: CostEntry[]): CostEntry[] {
  return entries.length > MAX_STORED_ENTRIES
    ? entries.slice(entries.length - MAX_STORED_ENTRIES)
    : entries
}

export function loadCostEntries(): CostEntry[] {
  const raw = readJson<unknown>(COST_ENTRIES_STORAGE_KEY, [])
  const normalized = capStoredEntries(normalizeCostEntries(raw))
  if (JSON.stringify(raw) !== JSON.stringify(normalized)) {
    writeJson(COST_ENTRIES_STORAGE_KEY, normalized)
  }
  return normalized
}

export function persistCostEntries(entries: CostEntry[]): void {
  writeJsonDebounced(COST_ENTRIES_STORAGE_KEY, capStoredEntries(normalizeCostEntries(entries)), 800)
}

export function loadBudgetConfig(): BudgetConfig {
  const raw = readJson<unknown>(BUDGET_CONFIG_STORAGE_KEY, {})
  const normalized = normalizeBudgetConfig(raw)
  if (JSON.stringify(raw) !== JSON.stringify(normalized)) {
    writeJson(BUDGET_CONFIG_STORAGE_KEY, normalized)
  }
  return normalized
}

export function persistBudgetConfig(config: BudgetConfig): void {
  writeJson(BUDGET_CONFIG_STORAGE_KEY, normalizeBudgetConfig(config))
}
