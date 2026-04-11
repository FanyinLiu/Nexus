/**
 * Discord Bot gateway.
 *
 * Connects to the Discord Gateway WebSocket to receive MESSAGE_CREATE events.
 * Incoming messages from allowed channel IDs are forwarded to the renderer
 * via a callback. The renderer can send replies back through sendMessage.
 */

import { net } from 'electron'
import WebSocket from 'ws'

/** @type {'disconnected'|'connecting'|'connected'|'error'} */
let _state = 'disconnected'
/** @type {string|null} */
let _botToken = null
/** @type {Set<string>} */
let _allowedChannelIds = new Set()
/** @type {string|null} */
let _botUsername = null
/** @type {string|null} */
let _botId = null
/** @type {WebSocket|null} */
let _ws = null
/** @type {number|null} */
let _heartbeatInterval = null
/** @type {number|null} */
let _heartbeatTimer = null
/** @type {number|null} */
let _jitterTimer = null
/** @type {number|null} */
let _reconnectTimer = null
/** @type {number|null} */
let _lastSequence = null
/** @type {string|null} */
let _sessionId = null
/** @type {string|null} */
let _resumeGatewayUrl = null
/** @type {string|null} Original gateway URL from /gateway/bot — used as fallback when resume URL is invalidated. */
let _originalGatewayUrl = null
/** @type {string|null} */
let _lastError = null
/** @type {boolean} */
let _shouldReconnect = false
let _reconnectAttempt = 0
const MAX_RECONNECT_ATTEMPTS = 10
const RECONNECT_BASE_MS = 2000
const RECONNECT_MAX_MS = 60_000

/**
 * @typedef {{ channelId: string, guildId: string|null, guildName: string|null, channelName: string, fromUser: string, fromUserId: string, text: string, messageId: string, timestamp: string }} DiscordIncomingMessage
 */

/** @type {((msg: DiscordIncomingMessage) => void)|null} */
let _onMessage = null

// ── Discord REST API helpers ────────────────────────────────────────────────

const DISCORD_API_BASE = 'https://discord.com/api/v10'

/**
 * @param {string} path
 * @param {{ method?: string, body?: unknown }} [options]
 * @returns {Promise<unknown>}
 */
async function apiCall(path, options = {}) {
  if (!_botToken) throw new Error('Bot token not set')

  const url = `${DISCORD_API_BASE}${path}`
  const body = options.body ? JSON.stringify(options.body) : undefined

  const resp = await net.fetch(url, {
    method: options.method ?? (body ? 'POST' : 'GET'),
    headers: {
      Authorization: `Bot ${_botToken}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body,
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`Discord API ${resp.status}: ${text}`)
  }

  if (resp.status === 204) return null
  return resp.json()
}

// ── Gateway WebSocket ───────────────────────────────────────────────────────

function clearTimers() {
  if (_heartbeatTimer) {
    clearInterval(_heartbeatTimer)
    _heartbeatTimer = null
  }
  if (_jitterTimer) {
    clearTimeout(_jitterTimer)
    _jitterTimer = null
  }
  if (_reconnectTimer) {
    clearTimeout(_reconnectTimer)
    _reconnectTimer = null
  }
}

function sendHeartbeat() {
  if (_ws?.readyState === WebSocket.OPEN) {
    _ws.send(JSON.stringify({ op: 1, d: _lastSequence }))
  }
}

function sendIdentify() {
  if (!_ws || !_botToken) return

  _ws.send(JSON.stringify({
    op: 2,
    d: {
      token: _botToken,
      intents: (1 << 9) | (1 << 15), // GUILD_MESSAGES | MESSAGE_CONTENT
      properties: {
        os: 'windows',
        browser: 'nexus',
        device: 'nexus',
      },
    },
  }))
}

function sendResume() {
  if (!_ws || !_botToken || !_sessionId) return

  _ws.send(JSON.stringify({
    op: 6,
    d: {
      token: _botToken,
      session_id: _sessionId,
      seq: _lastSequence,
    },
  }))
}

function handleGatewayMessage(raw) {
  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    return
  }

  const { op, t, s, d } = payload

  if (s != null) _lastSequence = s

  switch (op) {
    case 10: {
      // Hello — start heartbeating
      _heartbeatInterval = d.heartbeat_interval
      clearTimers()
      // Send first heartbeat after jitter
      _jitterTimer = setTimeout(() => {
        _jitterTimer = null
        sendHeartbeat()
      }, Math.floor(_heartbeatInterval * Math.random()))
      _heartbeatTimer = setInterval(sendHeartbeat, _heartbeatInterval)

      // Identify or resume
      if (_sessionId && _resumeGatewayUrl) {
        sendResume()
      } else {
        sendIdentify()
      }
      break
    }

    case 11: {
      // Heartbeat ACK — connection is healthy
      break
    }

    case 1: {
      // Server requests heartbeat
      sendHeartbeat()
      break
    }

    case 7: {
      // Reconnect requested
      _shouldReconnect = true
      _ws?.close(4000, 'Reconnect requested')
      break
    }

    case 9: {
      // Invalid session
      _sessionId = null
      _resumeGatewayUrl = null
      _shouldReconnect = true
      _reconnectTimer = setTimeout(() => {
        _reconnectTimer = null
        _ws?.close(4000, 'Invalid session')
      }, 1000 + Math.random() * 4000)
      break
    }

    case 0: {
      // Dispatch event
      handleDispatch(t, d)
      break
    }
  }
}

function handleDispatch(eventName, data) {
  if (eventName === 'READY') {
    _state = 'connected'
    _reconnectAttempt = 0
    _sessionId = data.session_id
    _resumeGatewayUrl = data.resume_gateway_url
    _botId = data.user?.id ?? null
    _botUsername = data.user?.username ?? null
    console.info(`[discord] Connected as ${_botUsername}#${data.user?.discriminator ?? '0'}`)
    return
  }

  if (eventName === 'RESUMED') {
    _state = 'connected'
    _reconnectAttempt = 0
    console.info('[discord] Session resumed')
    return
  }

  if (eventName === 'MESSAGE_CREATE') {
    // Ignore messages from the bot itself
    if (data.author?.id === _botId) return
    // Ignore bot messages
    if (data.author?.bot) return

    const channelId = data.channel_id
    // Security: only process messages from allowed channel IDs
    if (_allowedChannelIds.size > 0 && !_allowedChannelIds.has(channelId)) {
      return
    }

    const text = data.content
    if (!text) return // Skip non-text messages

    /** @type {DiscordIncomingMessage} */
    const incoming = {
      channelId,
      guildId: data.guild_id ?? null,
      guildName: null, // Could be resolved from cache but keep it simple
      channelName: channelId,
      fromUser: data.author?.global_name ?? data.author?.username ?? 'Unknown',
      fromUserId: data.author?.id ?? '',
      text,
      messageId: data.id,
      timestamp: data.timestamp ?? new Date().toISOString(),
    }

    _onMessage?.(incoming)
  }
}

async function connectGateway(gatewayUrl) {
  return new Promise((resolve, reject) => {
    const wsUrl = `${gatewayUrl}/?v=10&encoding=json`
    const ws = new WebSocket(wsUrl)

    ws.on('open', () => {
      _ws = ws
      resolve()
    })

    ws.on('message', (raw) => {
      handleGatewayMessage(String(raw))
    })

    ws.on('close', (code, reason) => {
      console.info(`[discord] WebSocket closed: ${code} ${reason}`)
      clearTimers()
      _ws = null

      if (_shouldReconnect && _botToken) {
        _shouldReconnect = false
        _reconnectAttempt++

        if (_reconnectAttempt > MAX_RECONNECT_ATTEMPTS) {
          console.error(`[discord] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) exceeded, giving up`)
          _state = 'error'
          _lastError = 'Max reconnect attempts exceeded'
          _reconnectAttempt = 0
        } else {
          const backoffMs = Math.min(RECONNECT_BASE_MS * (2 ** (_reconnectAttempt - 1)), RECONNECT_MAX_MS)
          const jitter = Math.floor(Math.random() * 1000)
          const url = _resumeGatewayUrl ?? _originalGatewayUrl ?? gatewayUrl
          console.info(`[discord] Reconnecting in ${backoffMs + jitter}ms (attempt ${_reconnectAttempt}/${MAX_RECONNECT_ATTEMPTS})...`)
          _reconnectTimer = setTimeout(() => {
            _reconnectTimer = null
            connectGateway(url).catch((err) => {
              console.error('[discord] Reconnect failed:', err.message)
              _state = 'error'
              _lastError = err.message
            })
          }, backoffMs + jitter)
        }
      } else {
        _state = 'disconnected'
      }
    })

    ws.on('error', (err) => {
      console.error('[discord] WebSocket error:', err.message)
      _lastError = err.message
      reject(err)
    })
  })
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Connect to Discord Gateway and start listening for messages.
 * @param {string} botToken
 * @param {string[]} allowedChannelIds
 */
export async function connect(botToken, allowedChannelIds = []) {
  if (_state === 'connected' || _state === 'connecting') {
    await disconnect()
  }

  _state = 'connecting'
  _botToken = botToken.trim()
  _allowedChannelIds = new Set(allowedChannelIds.map(String).filter(Boolean))
  _lastError = null
  _lastSequence = null
  _sessionId = null
  _resumeGatewayUrl = null
  _shouldReconnect = true

  try {
    // Get the gateway URL
    const gatewayInfo = /** @type {Record<string, unknown>} */ (
      await apiCall('/gateway/bot')
    )
    const gatewayUrl = String(gatewayInfo.url ?? 'wss://gateway.discord.gg')
    _originalGatewayUrl = gatewayUrl
    await connectGateway(gatewayUrl)
  } catch (err) {
    _state = 'error'
    _lastError = err.message
    _botToken = null
    _shouldReconnect = false
    throw err
  }
}

export async function disconnect() {
  _shouldReconnect = false
  _reconnectAttempt = 0
  clearTimers()
  if (_ws) {
    _ws.close(1000, 'Client disconnect')
    _ws = null
  }
  _state = 'disconnected'
  _botToken = null
  _botUsername = null
  _botId = null
  _allowedChannelIds.clear()
  _lastError = null
  _sessionId = null
  _resumeGatewayUrl = null
  _originalGatewayUrl = null
  _lastSequence = null
}

/**
 * Send a text message to a Discord channel.
 * @param {string} channelId
 * @param {string} text
 * @param {{ replyToMessageId?: string }} [options]
 */
export async function sendMessage(channelId, text, options = {}) {
  if (_state !== 'connected') throw new Error('Discord gateway not connected')

  const body = { content: text }
  if (options.replyToMessageId) {
    body.message_reference = { message_id: options.replyToMessageId }
  }

  await apiCall(`/channels/${channelId}/messages`, { method: 'POST', body })
}

export function getStatus() {
  return {
    state: _state,
    botUsername: _botUsername,
    allowedChannelIds: [..._allowedChannelIds],
    lastError: _lastError,
  }
}

/**
 * Register a callback for incoming messages.
 * @param {((msg: DiscordIncomingMessage) => void)|null} callback
 */
export function onMessage(callback) {
  _onMessage = callback
}
