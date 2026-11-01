// @ts-check
/**
 * Extensible outlet registry and the delivery router that feeds it.
 *
 * An outlet is just an id plus a handler. The router resolves the decision,
 * dispatches `inbox` first (the durable record and the source of the red dot),
 * then every outlet the decision names.
 *
 * Outlets that are not part of the routing decision — a Telegram/Discord
 * bridge, say — register a `mirror` predicate instead of editing the rules:
 * after the routed outlets they receive every delivery their predicate
 * accepts. That keeps the message model and the six routing rules untouched
 * when a new delivery channel is added. A mirror outlet whose id also appears
 * in the decision is dispatched once, as a routed outlet, and its predicate is
 * skipped.
 *
 * Unknown outlet ids are skipped on purpose. `panel` and `os_notification` are
 * valid router outputs with no outlet in this milestone, and a message routed
 * to one of them still lands in the inbox. A throwing outlet — routed or
 * mirror — is logged once and must not stop the remaining outlets.
 */

import { routeDelivery } from '../../shared/proactiveDelivery.js'

/** @typedef {import('../../shared/proactiveDelivery.js').ProactiveMessage} ProactiveMessage */
/** @typedef {import('../../shared/proactiveDelivery.js').DeliveryContext} DeliveryContext */
/** @typedef {import('../../shared/proactiveDelivery.js').DeliveryDecision} DeliveryDecision */
/** @typedef {import('../../shared/proactiveDelivery.js').ProactiveInboxEntry} ProactiveInboxEntry */
/** @typedef {import('../logger.js').Logger} Logger */

/**
 * Mutable per-delivery record shared between outlets: `inbox` fills it in and
 * `badge` publishes it, so both read one snapshot instead of racing the store.
 *
 * @typedef {object} DeliveryState
 * @property {number} unreadCount
 * @property {ProactiveInboxEntry[]} entries
 * @property {string[]} removedIds
 * @property {boolean} changed
 * @property {boolean} published
 */

/** @typedef {(message: ProactiveMessage, state: DeliveryState) => void | Promise<void>} OutletHandler */

/**
 * @typedef {object} OutletRegistrationOptions
 * @property {(message: ProactiveMessage, decision: DeliveryDecision) => boolean} [mirror]
 */

const OUTLET_ERROR_CODE = 'NEXUS_ERR_PROACTIVE_OUTLET_FAILED'

/**
 * Metadata-only code for the failure log. The message text of an outlet error
 * can embed user content, so only a stable code ever reaches the log line.
 * @param {unknown} error
 * @returns {string}
 */
function outletErrorCode(error) {
  if (error && typeof error === 'object') {
    const code = /** @type {{ code?: unknown }} */ (error).code
    if (typeof code === 'string' && code) return code
  }
  return OUTLET_ERROR_CODE
}

/**
 * @param {{ logger: Logger }} dependencies
 */
export function createProactiveOutletRegistry({ logger }) {
  /** @type {Map<string, OutletHandler>} */
  const handlers = new Map()
  /** @type {Map<string, NonNullable<OutletRegistrationOptions['mirror']>>} */
  const mirrors = new Map()

  /**
   * @param {string} id
   * @param {OutletHandler} handler
   * @param {OutletRegistrationOptions} [options]
   */
  function register(id, handler, options = {}) {
    handlers.set(id, handler)
    if (typeof options.mirror === 'function') mirrors.set(id, options.mirror)
    else mirrors.delete(id)
  }

  /** @param {string} id */
  function has(id) {
    return handlers.has(id)
  }

  /** Registration order, handy for diagnostics and tests. */
  function ids() {
    return [...handlers.keys()]
  }

  /** Ids registered with a mirror predicate, in registration order. */
  function mirrorIds() {
    return [...mirrors.keys()]
  }

  /**
   * @param {string} id
   * @param {ProactiveMessage} message
   * @param {unknown} error
   */
  function logFailure(id, message, error) {
    logger.error(
      `proactive outlet failed outlet=${id} code=${outletErrorCode(error)} id=${message.id}`,
      { source: message.source, status: 'outlet-failed' },
    )
  }

  /**
   * Deliver to one outlet. False means the id is not registered or the outlet
   * threw; callers must keep going either way.
   * @param {string} id
   * @param {ProactiveMessage} message
   * @param {DeliveryState} state
   * @returns {Promise<boolean>}
   */
  async function dispatch(id, message, state) {
    const handler = handlers.get(id)
    if (!handler) return false
    try {
      await handler(message, state)
      return true
    } catch (error) {
      logFailure(id, message, error)
      return false
    }
  }

  /**
   * Whether a mirror outlet wants this delivery. A throwing predicate is a
   * broken outlet, not a failed delivery: it is logged once and skipped.
   * @param {string} id
   * @param {ProactiveMessage} message
   * @param {DeliveryDecision} decision
   * @returns {boolean}
   */
  function matchesMirror(id, message, decision) {
    const predicate = mirrors.get(id)
    if (!predicate) return false
    try {
      return predicate(message, decision) === true
    } catch (error) {
      logFailure(id, message, error)
      return false
    }
  }

  return { register, has, ids, mirrorIds, matchesMirror, dispatch }
}

/**
 * @param {{ outlets: ReturnType<typeof createProactiveOutletRegistry> }} dependencies
 */
export function createProactiveRouter({ outlets }) {
  /**
   * Route, persist and fan out one message.
   * @param {ProactiveMessage} message
   * @param {DeliveryContext} context
   * @returns {Promise<DeliveryDecision>}
   */
  async function deliver(message, context) {
    const decision = routeDelivery(message, context)
    // The inbox write is unconditional: no rule is allowed to drop a message.
    const routedIds = [...new Set(['inbox', ...decision.outlets])]
    /** @type {DeliveryState} */
    const state = { unreadCount: 0, entries: [], removedIds: [], changed: false, published: false }
    for (const id of routedIds) {
      await outlets.dispatch(id, message, state)
    }
    // Mirror outlets sit outside the routing decision, so a new delivery
    // channel never requires touching the model or the rules. They run after
    // the routed outlets to observe the same completed state, and an id that
    // already ran above is never called twice.
    for (const id of outlets.mirrorIds()) {
      if (routedIds.includes(id)) continue
      if (!outlets.matchesMirror(id, message, decision)) continue
      await outlets.dispatch(id, message, state)
    }
    return decision
  }

  return { deliver }
}
