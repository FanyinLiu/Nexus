/**
 * Plugin Message Bus — typed pub/sub for inter-plugin communication.
 *
 * Plugins publish messages to topics; other plugins subscribe to receive them.
 * All messages route through the main process — plugins never communicate directly.
 *
 * Topic format: "namespace.event" (e.g. "music.track-changed", "memory.updated")
 */

const TOPIC_PATTERN = /^[\w][\w.-]{0,63}$/
const MAX_SUBSCRIPTIONS_PER_SERVER = 50

/** @type {Map<string, Set<string>>} topic → Set<subscriberServerId> */
const _subscriptions = new Map()

/** @type {Array<{ topic: string, payload: unknown, from: string, timestamp: string }>} */
const _recentMessages = []
const MAX_RECENT = 50

function isValidTopic(topic) {
  return typeof topic === 'string' && TOPIC_PATTERN.test(topic)
}

function countServerSubscriptions(serverId) {
  let count = 0
  for (const subs of _subscriptions.values()) {
    if (subs.has(serverId)) count++
  }
  return count
}

/**
 * Subscribe a server to a topic.
 * @param {string} serverId - MCP server ID (e.g. "plugin:my-plugin")
 * @param {string} topic - Topic pattern (exact match for now)
 * @returns {boolean} Whether the subscription was accepted
 */
export function subscribe(serverId, topic) {
  if (!isValidTopic(topic)) return false
  if (countServerSubscriptions(serverId) >= MAX_SUBSCRIPTIONS_PER_SERVER) return false

  if (!_subscriptions.has(topic)) {
    _subscriptions.set(topic, new Set())
  }
  _subscriptions.get(topic).add(serverId)
  return true
}

/**
 * Unsubscribe a server from a topic.
 */
export function unsubscribe(serverId, topic) {
  const subs = _subscriptions.get(topic)
  if (subs) {
    subs.delete(serverId)
    if (subs.size === 0) _subscriptions.delete(topic)
  }
}

/**
 * Remove all subscriptions for a server (e.g. on plugin stop).
 */
export function unsubscribeAll(serverId) {
  for (const [topic, subs] of _subscriptions) {
    subs.delete(serverId)
    if (subs.size === 0) _subscriptions.delete(topic)
  }
}

/**
 * Publish a message to a topic.
 *
 * NOTE: inter-plugin push delivery is intentionally not wired — there is no
 * transport to forward a message into a subscribing plugin process, and wiring
 * one naively would let any plugin eavesdrop any topic. This records the
 * message for observability only (recent/stats); subscribe()/listSubscriptions()
 * still track interest. Returns 0 because nothing is pushed to subscribers.
 * @param {string} fromServerId - Publishing server ID
 * @param {string} topic - Topic name
 * @param {unknown} payload - Message payload (must be JSON-serializable)
 * @returns {number} Always 0 (no push delivery)
 */
export function publish(fromServerId, topic, payload) {
  if (!isValidTopic(topic)) return 0

  const timestamp = new Date().toISOString()

  _recentMessages.push({ topic, payload, from: fromServerId, timestamp })
  if (_recentMessages.length > MAX_RECENT) {
    _recentMessages.splice(0, _recentMessages.length - MAX_RECENT)
  }

  return 0
}

/**
 * List all current subscriptions.
 */
export function listSubscriptions() {
  const result = {}
  for (const [topic, subs] of _subscriptions) {
    result[topic] = [...subs]
  }
  return result
}

/**
 * Get recent messages (for observability).
 */
export function getRecentMessages(limit = 20) {
  return _recentMessages.slice(-limit)
}

/**
 * Get bus stats.
 */
export function getStats() {
  return {
    topicCount: _subscriptions.size,
    totalSubscriptions: [..._subscriptions.values()].reduce((sum, s) => sum + s.size, 0),
    recentMessageCount: _recentMessages.length,
  }
}
