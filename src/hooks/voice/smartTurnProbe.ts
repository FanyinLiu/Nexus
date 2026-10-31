/**
 * Renderer bridge to the main-process Smart Turn session.
 *
 * Only host wiring: start/stop the rolling audio buffer and ask for a
 * probability. The model never sees audio outside a voice session the user
 * opened, and the buffer lives in memory in the main process.
 */

import type { SmartTurnProbeResult } from './turnEndController.ts'
import { createLogger } from '../../lib/logger.ts'

const log = createLogger('voice.turn-end')

/** A session id, or the start promise still resolving it. */
export type TurnEndSessionRef = number | Promise<number | null> | null | undefined

async function resolveSessionId(session: TurnEndSessionRef): Promise<number | null> {
  try {
    const value = await session
    return typeof value === 'number' ? value : null
  } catch {
    log.debug('turn-end session id resolution failed', { errorPresent: true })
    return null
  }
}

/**
 * Begin buffering for one user turn. Resolves to the generation that must be
 * carried by every probe/stop for this turn; null means the bridge is absent.
 */
export function startDesktopTurnEndSession(): Promise<number | null> {
  const api = window.desktopPet
  if (!api?.turnEndStart) return Promise.resolve(null)
  return api.turnEndStart()
    .then((result) => (typeof result?.sessionId === 'number' ? result.sessionId : null))
    .catch(() => {
      log.debug('turn-end session start failed', { errorPresent: true })
      return null
    })
}

/** Drop the buffered audio as soon as the turn is over; stale ids are ignored. */
export function stopDesktopTurnEndSession(session?: TurnEndSessionRef) {
  const api = window.desktopPet
  if (!api?.turnEndStop) return
  if (session === null) return
  void resolveSessionId(session).then((sessionId) => {
    const payload = sessionId === null ? undefined : { sessionId }
    void api.turnEndStop!(payload).catch(() => { log.debug('turn-end session stop failed', { errorPresent: true }) })
  })
}

/**
 * Build the controller's probe. The IPC handler never waits for a download or
 * model load, so an unavailable model costs one short round trip. Results
 * from an older generation are marked stale and never reach the controller.
 */
export function createDesktopTurnEndProbe(
  session?: TurnEndSessionRef,
): () => Promise<SmartTurnProbeResult> {
  const api = window.desktopPet
  if (!api?.turnEndProbe) {
    return async () => ({ available: false, probability: null, reason: 'missing' })
  }

  return async () => {
    const sessionId = await resolveSessionId(session)
    const payload = sessionId === null ? undefined : { sessionId }
    try {
      const result = await api.turnEndProbe!(payload)
      if (result?.stale === true) {
        return {
          available: false,
          probability: null,
          reason: 'inactive',
          stale: true,
          sessionId: result.sessionId,
        }
      }
      if (
        sessionId !== null
        && typeof result?.sessionId === 'number'
        && result.sessionId !== sessionId
      ) {
        return { available: false, probability: null, reason: 'inactive', stale: true }
      }
      return {
        available: result?.available === true,
        probability: typeof result?.probability === 'number' ? result.probability : null,
        latencyMs: typeof result?.latencyMs === 'number' ? result.latencyMs : null,
        timedOut: result?.timedOut === true,
        reason: result?.reason,
        sessionId: typeof result?.sessionId === 'number' ? result.sessionId : sessionId ?? undefined,
      }
    } catch {
      return { available: false, probability: null, reason: 'error' }
    }
  }
}
