/**
 * Companion presence tracker — turns the main-process chat request lifecycle
 * (electron/ipc/chatIpc.js) into the `companionPresence` runtime-state field
 * consumed by the renderer uiV2 surfaces (src/features/uiV2/state.ts).
 *
 * Phase mapping — only signals the main process can observe today:
 *   request start (chat:complete / chat:complete-stream) -> 'thinking'
 *   transport failure or request timeout                 -> 'offline'  (provider unreachable)
 *   HTTP error status / empty or broken answer           -> 'error'    (provider answered, request failed)
 *   user abort (chat:abort-stream)                       -> neutral    (not a failure)
 *   successful completion                                -> 'idle'     (provider proven reachable)
 *
 * 'waiting' is never emitted: the main process has no request queue, and the
 * sub-second retry backoff inside net.js has no "attempt resumed" hook to
 * clear the phase against, so an in-flight retry honestly stays 'thinking'.
 * 'listening'/'speaking' stay renderer-owned (voiceState); 'online' and
 * 'resting' have no main-process signal either.
 *
 * Failure phases are sticky until a later request succeeds — one success
 * proves reachability again. The phase recomputes on every transition and is
 * only republished when it changes, so overlapping requests coalesce into a
 * single in-flight signal.
 */
export function createCompanionPresenceTracker({ publishPresence, getMood, nowIso = () => new Date().toISOString() }) {
  let inFlight = 0
  let lastFailureKind = null
  let lastPublishedPhase = null

  function currentPhase() {
    if (inFlight > 0) return 'thinking'
    if (lastFailureKind) return lastFailureKind
    return 'idle'
  }

  function publishCurrentPhase(reason) {
    const phase = currentPhase()
    if (phase === lastPublishedPhase && !reason) return
    lastPublishedPhase = phase
    publishPresence({
      phase,
      mood: getMood(),
      ...(reason ? { reason } : {}),
      updatedAt: nowIso(),
    })
  }

  return {
    /** A provider request started; presence becomes 'thinking'. */
    begin() {
      inFlight += 1
      publishCurrentPhase()
    },
    /** The request produced a complete answer; clears any sticky failure. */
    succeed() {
      inFlight = Math.max(0, inFlight - 1)
      lastFailureKind = null
      publishCurrentPhase()
    },
    /**
     * The request failed terminally. `kind` is 'offline' for transport
     * failures/timeouts and 'error' for answered-but-failed requests;
     * `reason` carries the stable NEXUS_ERR_CHAT_* code, never prose.
     */
    fail(kind, reason) {
      inFlight = Math.max(0, inFlight - 1)
      lastFailureKind = kind === 'offline' ? 'offline' : 'error'
      publishCurrentPhase(reason)
    },
    /** A user-initiated abort wound the request down without a failure. */
    cancel() {
      inFlight = Math.max(0, inFlight - 1)
      publishCurrentPhase()
    },
  }
}
