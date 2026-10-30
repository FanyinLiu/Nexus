/**
 * Renderer bridge to the main-process Smart Turn session.
 *
 * Only host wiring: start/stop the rolling audio buffer and ask for a
 * probability. The model never sees audio outside a voice session the user
 * opened, and the buffer lives in memory in the main process.
 */

import type { SmartTurnProbeResult } from './turnEndController.ts'

/** Begin buffering for one user turn. Safe when the model is not installed. */
export function startDesktopTurnEndSession() {
  const api = window.desktopPet
  if (!api?.turnEndStart) return
  void api.turnEndStart().catch(() => undefined)
}

/** Drop the buffered audio as soon as the turn is over. */
export function stopDesktopTurnEndSession() {
  const api = window.desktopPet
  if (!api?.turnEndStop) return
  void api.turnEndStop().catch(() => undefined)
}

/**
 * Build the controller's probe. The IPC handler never waits for a download or
 * model load, so an unavailable model costs one short round trip.
 */
export function createDesktopTurnEndProbe(): () => Promise<SmartTurnProbeResult> {
  const api = window.desktopPet
  if (!api?.turnEndProbe) {
    return async () => ({ available: false, probability: null, reason: 'missing' })
  }

  return async () => {
    try {
      const result = await api.turnEndProbe!()
      return {
        available: result?.available === true,
        probability: typeof result?.probability === 'number' ? result.probability : null,
        latencyMs: typeof result?.latencyMs === 'number' ? result.latencyMs : null,
        timedOut: result?.timedOut === true,
        reason: result?.reason,
      }
    } catch {
      return { available: false, probability: null, reason: 'error' }
    }
  }
}
