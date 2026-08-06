/**
 * Companion presence tracker — turns the main-process chat request lifecycle
 * (electron/ipc/chatIpc.js) into the `companionPresence` runtime-state field
 * consumed by the renderer uiV2 surfaces (src/features/uiV2/state.ts).
 *
 * Phase mapping — only signals the main process can observe today:
 *   request start (chat:complete / chat:complete-stream) -> 'thinking'
 *   retry backoff (net.js onRetry)                       -> 'waiting'  (transient failure, attempt parked)
 *   next attempt started (net.js onAttempt)              -> 'thinking'
 *   transport failure or request timeout                 -> 'offline'  (provider unreachable)
 *   HTTP error status / empty or broken answer           -> 'error'    (provider answered, request failed)
 *   user abort (chat:abort-stream)                       -> neutral    (not a failure)
 *   successful completion                                -> 'idle'     (provider proven reachable)
 *
 * 'waiting' covers exactly the bounded backoff between retry attempts:
 * net.js guarantees one onAttempt after every onRetry before any terminal
 * outcome, so each retryWait pairs with exactly one retryResume and the
 * phase cannot stick. 'listening'/'speaking' stay renderer-owned
 * (voiceState); 'online' and 'resting' have no main-process signal.
 *
 * Failure phases are sticky until a later request succeeds — one success
 * proves reachability again. The phase recomputes on every transition and is
 * only republished when it changes, so overlapping requests coalesce into a
 * single in-flight signal.
 */
export function createCompanionPresenceTracker({ publishPresence, getMood, nowIso = () => new Date().toISOString() }) {
  let inFlight = 0
  let waitingRetry = 0
  let lastFailureKind = null
  let lastPublishedPhase = null

  function currentPhase() {
    // A retrying request is still in-flight, so 'waiting' applies only when
    // every in-flight request is parked in retry backoff.
    if (inFlight > 0) return waitingRetry >= inFlight ? 'waiting' : 'thinking'
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
    /**
     * A retryable attempt failed and the request is parked in backoff.
     * `reason` carries net.js's stable retry code ('network_error',
     * 'http_<status>'), never prose and never the request URL.
     */
    retryWait(reason) {
      waitingRetry += 1
      publishCurrentPhase(reason)
    },
    /** The next attempt started; the request left retry backoff. */
    retryResume() {
      waitingRetry = Math.max(0, waitingRetry - 1)
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
