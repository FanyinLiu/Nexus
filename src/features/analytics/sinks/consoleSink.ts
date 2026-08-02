import type { AnalyticsSink } from '../../../types/analytics.ts'

export const consoleSink: AnalyticsSink = async (event) => {
  console.debug('[analytics]', event.name, event.payload ?? {})
}
