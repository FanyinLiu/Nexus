/**
 * Page selection and document-readiness gating for the packaged gaze smoke.
 *
 * A fresh BrowserWindow starts on an opaque `about:blank` document, while the
 * debugger target already reports the URL of the navigation it is about to
 * commit. Evaluating storage against that pre-commit document throws
 * `SecurityError: Access is denied for this document`, which is a startup race
 * and not an app defect. These helpers select the window deterministically and
 * bound how long the pre-commit state may last before it becomes a failure.
 */

const APP_PROTOCOLS = new Set(['http:', 'https:'])
const FILE_PROTOCOL = 'file:'
const PRE_NAVIGATION_PROTOCOLS = new Set(['about:', 'data:', 'chrome-error:'])

/** Bounded budget for the renderer to commit and finish its app document. */
export const APP_DOCUMENT_TIMEOUT_MS = 10_000
/** Poll interval while waiting for the app document. */
export const APP_DOCUMENT_POLL_MS = 200
/** Marks a document that can never become usable, so callers stop retrying. */
export const FATAL_DOCUMENT_CODE = 'PACKAGED_GAZE_FATAL_DOCUMENT'

/**
 * In-page probe: reports the committed document and whether its origin grants
 * storage. Stringified into Runtime.evaluate, so it must stay closure-free.
 */
export const STORAGE_PROBE_EXPRESSION = `(() => {
  const probe = {
    href: String(window.location.href),
    readyState: String(document.readyState),
    view: new URLSearchParams(window.location.search).get('view') ?? '',
    seeded: false,
    storage: 'ok',
    errorName: '',
    errorMessage: '',
  }
  try {
    // Reading length forces the origin check that throws SecurityError on a
    // pre-navigation document; setItem alone would hide it.
    void window.localStorage.length
    probe.seeded = window.sessionStorage.getItem('nexus.modelSetup.dismissedUntilRestart') === '1'
  } catch (error) {
    probe.storage = 'error'
    probe.errorName = String(error?.name ?? '')
    probe.errorMessage = String(error?.message ?? error)
  }
  return probe
})()`

/**
 * Whether a debugger target URL is the pet renderer entry.
 * @param {unknown} url Target URL reported by `/json/list`.
 * @returns {boolean} True for http(s)/file URLs whose `view` query is `pet`.
 */
export function isPetViewUrl(url) {
  if (typeof url !== 'string' || url.length === 0) return false
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== FILE_PROTOCOL && !APP_PROTOCOLS.has(parsed.protocol)) return false
  return (parsed.searchParams.get('view') ?? '').toLowerCase() === 'pet'
}

/**
 * Pick the pet page targets in a deterministic order.
 *
 * The list is sorted by target id so two runs on the same process tree always
 * connect to the same window, and panel/splash/blank targets are dropped
 * instead of being picked first by arrival order.
 * @param {unknown} pages Parsed `/json/list` payload.
 * @returns {Array<Record<string, unknown>>} Attachable pet targets.
 */
export function selectPetPageTargets(pages) {
  const candidates = []
  for (const page of Array.isArray(pages) ? pages : []) {
    if (!page || typeof page !== 'object') continue
    if (page.type !== 'page') continue
    if (typeof page.webSocketDebuggerUrl !== 'string' || page.webSocketDebuggerUrl.length === 0) continue
    if (!isPetViewUrl(page.url)) continue
    candidates.push(page)
  }
  return candidates.sort((a, b) => {
    const byId = String(a.id ?? '').localeCompare(String(b.id ?? ''))
    if (byId !== 0) return byId
    return String(a.url ?? '').localeCompare(String(b.url ?? ''))
  })
}

/**
 * Decide whether a storage probe result may be used.
 *
 * `retry` means the renderer is still on a pre-navigation or still-loading
 * document; `fatal` means the document is real but unusable, so hiding it
 * behind a retry loop would mask a genuine failure.
 * @param {unknown} probe Result of the in-page storage probe, or null.
 * @returns {{ state: 'ready'|'retry'|'fatal', reason: string }} Verdict.
 */
export function classifyStorageProbe(probe) {
  if (!probe || typeof probe !== 'object') {
    return { state: 'retry', reason: 'no document probe result (renderer has no app execution context yet)' }
  }
  const href = typeof probe.href === 'string' ? probe.href : ''
  const readyState = typeof probe.readyState === 'string' ? probe.readyState : ''
  const view = typeof probe.view === 'string' ? probe.view.toLowerCase() : ''

  if (probe.storage === 'error') {
    const name = typeof probe.errorName === 'string' ? probe.errorName : ''
    const message = typeof probe.errorMessage === 'string' ? probe.errorMessage : ''
    if (name === 'SecurityError') {
      return { state: 'retry', reason: `storage denied on ${href || '<unknown document>'}: ${name}: ${message}` }
    }
    return { state: 'fatal', reason: `storage unavailable on ${href || '<unknown document>'}: ${name || 'Error'}: ${message}` }
  }
  if (probe.storage !== 'ok') {
    return { state: 'retry', reason: `incomplete document probe on ${href || '<unknown document>'}` }
  }

  if (href === '') {
    return { state: 'retry', reason: 'renderer document has no URL yet' }
  }
  let protocol
  try {
    protocol = new URL(href).protocol
  } catch {
    return { state: 'retry', reason: `renderer document URL is not parseable yet: ${href}` }
  }
  if (PRE_NAVIGATION_PROTOCOLS.has(protocol)) {
    return { state: 'retry', reason: `renderer still on pre-navigation document: ${href}` }
  }
  if (protocol !== FILE_PROTOCOL && !APP_PROTOCOLS.has(protocol)) {
    return { state: 'fatal', reason: `renderer document is not the app entry: ${href}` }
  }
  if (view !== 'pet') {
    return { state: 'fatal', reason: `connected to the wrong renderer view (${view || 'none'}) at ${href}` }
  }
  if (readyState === 'loading') {
    return { state: 'retry', reason: `app document still parsing: ${href}` }
  }
  return { state: 'ready', reason: `app document ready: ${href}` }
}

/**
 * Whether a Runtime.evaluate failure is navigation churn worth retrying.
 * Only execution-context replacement or a replaced target qualifies; every
 * other error stays a hard failure.
 * @param {unknown} message Error message from the CDP evaluation.
 * @returns {boolean} True when the document swap is expected to settle.
 */
export function shouldRetryEvaluateError(message) {
  if (typeof message !== 'string') return false
  return /Execution context was destroyed|Cannot find (default )?context|Inspected target navigated|Target closed|Session closed|Cannot find context with specified id/i.test(message)
}

/**
 * Whether a thrown storage error is the pre-commit `SecurityError`.
 * Matches the DOMException alone — quota or serialization failures must not
 * be retried, they are real storage failures.
 * @param {unknown} message Error message from the CDP evaluation.
 * @returns {boolean} True for the opaque-document storage SecurityError.
 */
export function isStorageSecurityError(message) {
  if (typeof message !== 'string') return false
  return /SecurityError/i.test(message) && /(local|session)Storage/i.test(message)
}

function fatalDocumentError(message, cause) {
  return Object.assign(new Error(message, { cause }), { code: FATAL_DOCUMENT_CODE })
}

function defaultSleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

/**
 * Wait until the attached renderer exposes the committed, storage-capable app
 * document. The pre-commit `SecurityError` and context swaps are retried
 * within the timeout; a document that is definitively wrong fails immediately.
 * @param {{
 *   evaluate: (expression: string) => Promise<unknown>,
 *   requireSeeded?: boolean,
 *   sleep?: (ms: number) => Promise<unknown>,
 *   now?: () => number,
 *   timeoutMs?: number,
 *   pollMs?: number,
 * }} options Injected CDP evaluate plus tunable clock for tests.
 * @returns {Promise<{ state: 'ready', reason: string }>} Verdict once ready.
 */
export async function waitForAppDocument({
  evaluate,
  requireSeeded = false,
  sleep = defaultSleep,
  now = Date.now,
  timeoutMs = APP_DOCUMENT_TIMEOUT_MS,
  pollMs = APP_DOCUMENT_POLL_MS,
}) {
  const started = now()
  let lastReason = 'no probe attempt'
  while (now() - started < timeoutMs) {
    let probe
    try {
      probe = await evaluate(STORAGE_PROBE_EXPRESSION)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!shouldRetryEvaluateError(message)) {
        throw fatalDocumentError(`packaged pet page is not scriptable: ${message}`, error)
      }
      lastReason = message
      await sleep(pollMs)
      continue
    }
    const verdict = classifyStorageProbe(probe)
    if (verdict.state === 'ready') {
      if (requireSeeded && probe.seeded !== true) {
        lastReason = `waiting for the reloaded document to run the smoke seed: ${probe.href}`
        await sleep(pollMs)
        continue
      }
      return verdict
    }
    if (verdict.state === 'fatal') throw fatalDocumentError(verdict.reason)
    lastReason = verdict.reason
    await sleep(pollMs)
  }
  throw new Error(
    `packaged pet page did not expose a loaded, storage-capable app document within ${timeoutMs}ms: ${lastReason}`,
  )
}
