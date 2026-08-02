import { useEffect } from 'react'
import { getCoreRuntime } from '../../lib/coreRuntime.ts'
import type { AppSettings } from '../../types'

/**
 * Push the budget-related fields of AppSettings into CostTracker whenever
 * they change. Pulled out of useAppController to keep that hook focused on
 * chat/voice/autonomy composition.
 */
export function useBudgetConfigSync(settings: AppSettings): void {
  useEffect(() => {
    getCoreRuntime().refreshBudgetConfig({
      dailyCapUsd: settings.budgetDailyCapUsd || undefined,
      monthlyCapUsd: settings.budgetMonthlyCapUsd || undefined,
      downgradeThresholdRatio: settings.budgetDowngradeRatio || undefined,
      hardStop: settings.budgetHardStopEnabled,
    })
  }, [
    settings.budgetDailyCapUsd,
    settings.budgetMonthlyCapUsd,
    settings.budgetDowngradeRatio,
    settings.budgetHardStopEnabled,
  ])
}
