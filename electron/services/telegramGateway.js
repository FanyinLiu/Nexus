/**
 * Telegram Bot API long-polling gateway.
 *
 * Connects to the Telegram Bot API using getUpdates long-polling.
 * Incoming messages from allowed chat IDs are forwarded to the renderer
 * via a callback. The renderer can send replies back through sendMessage.
 */

import { net } from 'electron'

/** @type {'disconnected'|'connecting'|'connected'|'error'} */
let _state = 'disconnected'
/** @type {string|null} */
let _botToken = null
/** @type {Set<number>} */
let _allowedChatIds = new Set()
/** @type {string|null} */
let _botUsername = null
/** @type {number} */
let _updateOffset = 0
/** @type {boolean} */
let _polling = false
/** @type {AbortController|null} */
let _pollAbort = null
/** @type {string|null} */
let _lastError = null

/**
 * @typedef {{ chatId: number, chatTitle: string, fromUser: string, text: string, messageId: number, timestamp: string }} TelegramIncomingMessage
 */

/** @type {((msg: TelegramIncomingMessage) => void)|null} */
let _onMessage = null

// ── Telegram API helpers ─────────────────────────────────────────────────────

/**
 * @param {string} method
 * @param {Record<string, unknown>} [params]
 * @param {AbortSignal} [signal]
 * @returns {Promise<unknown>}
 */
async function apiCall(method, params, signal) {
  if (!_botToken) throw new Error('Bot token not set')

  const url = `https://api.telegram.org/bot${_botToken}/${method}`
  const body = params ? JSON.stringify(params) : undefined

  const resp = await net.fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body,
    signal,
  })

  const json = await resp.json()
  if (!json.ok) {
    throw new Error(`Telegram API error: ${json.description ?? JSON.stringify(json)}`)
  }
  return json.result
}

// ── Polling loop ─────────────────────────────────────────────────��───────────

async function pollOnce() {
  if (!_polling || !_botToken) return

  _pollAbort = new AbortController()
  const timeout = 30 // long-poll timeout in seconds

  try {
    const updates = /** @type {Array<Record<string, unknown>>} */ (
      await apiCall('getUpdates', {
        offset: _updateOffset,
        timeout,
        allowed_updates: ['message'],
      }, _pollAbort.signal)
    )

    for (const update of updates) {
      const updateId = /** @type {number} */ (update.update_id)
      _updateOffset = updateId + 1

      const message = /** @type {Record<string, unknown>|undefined} */ (update.message)
      if (!message) continue

      const chat = /** @type {Record<string, unknown>} */ (message.chat)
      const chatId = /** @type {number} */ (chat.id)

      // Security: only process messages from allowed chat IDs
      if (_allowedChatIds.size > 0 && !_allowedChatIds.has(chatId)) {
        console.info(`[telegram] Ignoring message from unauthorized chat ${chatId}`)
        continue
      }

      const from = /** @type {Record<string, unknown>|undefined} */ (message.from)
      const text = /** @type {string|undefined} */ (message.text)
      if (!text) continue // Skip non-text messages for now

      const incoming = {
        chatId,
        chatTitle: String(chat.title ?? chat.first_name ?? chatId),
        fromUser: from
          ? String(from.first_name ?? '') + (from.last_name ? ` ${from.last_name}` : '')
          : 'Unknown',
        text,
        messageId: /** @type {number} */ (message.message_id),
        timestamp: new Date(/** @type {number} */ (message.date) * 1000).toISOString(),
      }

      _onMessage?.(incoming)
    }
  } catch (err) {
    if (err?.name === 'AbortError') return // intentional stop
    console.error('[telegram] Poll error:', err.message)
    _lastError = err.message
    // Brief pause before retry to avoid hammering on transient errors
    await new Promise((r) => setTimeout(r, 3000))
  }

  // Schedule next poll
  if (_polling) {
    // Use setImmediate-style to avoid call stack growth
    setTimeout(pollOnce, 0)
  }
}

// ── Public API ───────────────────────────────────────────────────────���───────

/**
 * Connect to Telegram Bot API and start long-polling.
 * @param {string} botToken
 * @param {number[]} allowedChatIds
 */
export async function connect(botToken, allowedChatIds = []) {
  if (_state === 'connected' || _state === 'connecting') {
    await disconnect()
  }

  _state = 'connecting'
  _botToken = botToken.trim()
  _allowedChatIds = new Set(allowedChatIds)
  _lastError = null
  _updateOffset = 0

  try {
    // Verify the token by calling getMe
    const me = /** @type {Record<string, unknown>} */ (await apiCall('getMe'))
    _botUsername = String(me.username ?? '')
    _state = 'connected'
    _polling = true
    console.info(`[telegram] Connected as @${_botUsername}`)
    // Start polling (fire and forget)
    setTimeout(pollOnce, 0)
  } catch (err) {
    _state = 'error'
    _lastError = err.message
    _botToken = null
    throw err
  }
}

export async function disconnect() {
  _polling = false
  _pollAbort?.abort()
  _pollAbort = null
  _state = 'disconnected'
  _botToken = null
  _botUsername = null
  _allowedChatIds.clear()
  _lastError = null
}

/**
 * Send a text message to a Telegram chat.
 * @param {number} chatId
 * @param {string} text
 * @param {{ replyToMessageId?: number, parseMode?: string }} [options]
 */
export async function sendMessage(chatId, text, options = {}) {
  if (_state !== 'connected') throw new Error('Telegram gateway not connected')

  const params = {
    chat_id: chatId,
    text,
  }
  if (options.replyToMessageId) {
    params.reply_parameters = { message_id: options.replyToMessageId }
  }
  if (options.parseMode) {
    params.parse_mode = options.parseMode
  }

  await apiCall('sendMessage', params)
}

export function getStatus() {
  return {
    state: _state,
    botUsername: _botUsername,
    allowedChatIds: [..._allowedChatIds],
    lastError: _lastError,
  }
}

/**
 * Register a callback for incoming messages.
 * @param {((msg: TelegramIncomingMessage) => void)|null} callback
 */
export function onMessage(callback) {
  _onMessage = callback
}
