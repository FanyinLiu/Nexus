import type { AnalyticsSink } from '../../../types/analytics'

export function createRemoteSink(endpoint: string): AnalyticsSink {
  return async (event) => {
    if (!endpoint) {
      return
    }

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
      })
      if (!res.ok) {
        // Drop the event silently; analytics must never break the caller.
        console.warn(`[analytics:remoteSink] endpoint responded ${res.status}`)
      }
    } catch (err) {
      // Network / abort / serialization errors must not surface as unhandled rejections.
      console.warn('[analytics:remoteSink] send failed:', err instanceof Error ? err.message : err)
    }
  }
}
