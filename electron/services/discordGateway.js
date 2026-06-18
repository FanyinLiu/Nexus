/**
 * Discord Bot gateway.
 *
 * Connects to the Discord Gateway WebSocket to receive MESSAGE_CREATE events.
 * Incoming messages from allowed channel IDs are forwarded to the renderer
 * via a callback. The renderer can send replies back through sendMessage.
 */

import { net } from 'electron'
import WebSocket from 'ws'

import { isAllowedSender } from './allowlistPolicy.js'
import { createPairingManager } from './pairingManager.js'

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
/** @type {string|null} */
let _lastEventAt = null
/** @type {string|null} */
let _lastEventSource = null
/** @type {string|null} */
let _lastEventId = null
/** @type {string|null} */
let _lastSkipReason = null
/** @type {string|null} */
let _lastSkipAt = null
/** @type {string|null} */
let _lastErrorAt = null
/** @type {string|null} */
let _lastReconnectAt = null
/** @type {string|null} */
let _lastReconnectReason = null
/** @type {string|null} */
let _pendingReconnectReason = null
/** @type {string|null} */
let _lastOutboundAt = null
/** @type {string|null} */
let _lastOutboundTarget = null
/** @type {string|null} */
let _lastOutboundKind = null
/** @type {string|null} */
let _lastOutboundError = null
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
/** @type {((request: { senderId: string, name: string, code: string }) => void)|null} */
let _onPairingRequest = null
const _pairing = createPairingManager()

const PAIRING_REPLY = (code) =>
  `Nexus pairing code 配对码: ${code}\n` +
  'Approve this channel in Nexus → Settings → Integrations to start talking.\n' +
  '在 Nexus 的 设置 → 集成 里批准这个频道即可开始聊天（1 小时内有效）。'

function recordLastEvent(message) {
  _lastEventAt = String(message?.timestamp ?? new Date().toISOString())
  _lastEventSource = String(message?.channelName ?? message?.channelId ?? 'discord')
  _lastEventId = String(message?.messageId ?? '')
}

function recordLastSkip(reason) {
  _lastSkipReason = String(reason || 'skipped')
  _lastSkipAt = new Date().toISOString()
}

function recordLastError(message) {
  _lastError = String(message || 'unknown error')
  _lastErrorAt = new Date().toISOString()
}

function recordLastReconnect(reason) {
  _lastReconnectAt = new Date().toISOString()
  _lastReconnectReason = String(reason || 'reconnect')
}

function recordLastOutbound(target, kind) {
  _lastOutboundAt = new Date().toISOString()
  _lastOutboundTarget = String(target ?? '')
  _lastOutboundKind = String(kind || 'message')
  _lastOutboundError = null
}

function recordLastOutboundError(target, kind, error) {
  _lastOutboundAt = new Date().toISOString()
  _lastOutboundTarget = String(target ?? '')
  _lastOutboundKind = String(kind || 'message')
  _lastOutboundError = String(error?.message ?? error ?? 'unknown error')
}

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
      if (!d || typeof d.heartbeat_interval !== 'number') return
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
      _pendingReconnectReason = 'gateway_reconnect_requested'
      _ws?.close(4000, 'Reconnect requested')
      break
    }

    case 9: {
      // Invalid session
      _sessionId = null
      _resumeGatewayUrl = null
      _shouldReconnect = true
      _pendingReconnectReason = 'invalid_session'
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
    if (!data) return
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
    if (!data) return
    // Ignore messages from the bot itself
    if (data.author?.id === _botId) return
    // Ignore bot messages
    if (data.author?.bot) return

    const channelId = data.channel_id
    // Security: only process messages from allowed channel IDs.
    // Deny-by-default: an empty allowlist accepts nobody — but a stranger's
    // FIRST message starts the pairing flow (code sent back, desktop
    // approves). Repeats and overflow stay silent.
    if (!isAllowedSender(_allowedChannelIds, channelId)) {
      const senderName = String(data.author?.username ?? channelId)
      const pairing = _pairing.requestPairing(String(channelId), senderName)
      if (pairing.kind === 'created') {
        console.info(`[discord] Pairing request from channel ${channelId}`)
        _onPairingRequest?.({ senderId: String(channelId), name: senderName, code: pairing.code })
        apiCall(`/channels/${channelId}/messages`, { method: 'POST', body: { content: PAIRING_REPLY(pairing.code) } })
          .then(() => recordLastOutbound(channelId, 'pairing'))
          .catch((err) => {
            recordLastOutboundError(channelId, 'pairing', err)
            console.warn('[discord] pairing reply failed:', err.message)
          })
      }
      recordLastSkip(`unauthorized_sender:${pairing.kind}`)
      return
    }

    const text = data.content
    if (!text) {
      recordLastSkip('unsupported_message_payload')
      return
    } // Skip non-text messages

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

    recordLastEvent(incoming)
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
      try {
        handleGatewayMessage(String(raw))
      } catch (err) {
        // A malformed/unexpected gateway frame must never reach the global
        // uncaughtException handler (which exits the whole app). Drop it.
        console.error('[discord] Dropping malformed gateway frame:', err?.message ?? err)
      }
    })

    ws.on('close', (code, reason) => {
      console.info(`[discord] WebSocket closed: ${code} ${reason}`)
      clearTimers()
      _ws = null

      if (_shouldReconnect && _botToken) {
        _shouldReconnect = false
        _reconnectAttempt++
        const reconnectReason = _pendingReconnectReason ?? `websocket_close:${code}`
        _pendingReconnectReason = null
        recordLastReconnect(reconnectReason)

        if (_reconnectAttempt > MAX_RECONNECT_ATTEMPTS) {
          console.error(`[discord] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) exceeded, giving up`)
          _state = 'error'
          recordLastError('Max reconnect attempts exceeded')
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
              recordLastReconnect(`reconnect_failed:${err.message}`)
              recordLastError(err.message)
            })
          }, backoffMs + jitter)
        }
      } else {
        _state = 'disconnected'
      }
    })

    ws.on('error', (err) => {
      console.error('[discord] WebSocket error:', err.message)
      recordLastError(err.message)
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
  _pendingReconnectReason = null

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
    recordLastError(err.message)
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
  _pendingReconnectReason = null
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

  try {
    await apiCall(`/channels/${channelId}/messages`, { method: 'POST', body })
    recordLastOutbound(channelId, 'text')
  } catch (err) {
    recordLastOutboundError(channelId, 'text', err)
    throw err
  }
}

const DISCORD_AUDIO_EXT_BY_MIME = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
}

/**
 * Send an audio file to a Discord channel as a playable attachment.
 * (A true voice-message bubble would additionally need OGG/Opus plus the
 * IS_VOICE_MESSAGE flag with waveform metadata — a plain attachment plays
 * inline in every client and accepts any common container.)
 * @param {string} channelId
 * @param {Buffer} audio
 * @param {string} mimeType
 * @param {{ replyToMessageId?: string }} [options]
 */
export async function sendAudioAttachment(channelId, audio, mimeType, options = {}) {
  if (_state !== 'connected') throw new Error('Discord gateway not connected')

  const ext = DISCORD_AUDIO_EXT_BY_MIME[String(mimeType).toLowerCase().split(';')[0].trim()] ?? 'mp3'
  const fileName = `voice-reply.${ext}`

  const payload = { attachments: [{ id: 0, filename: fileName }] }
  if (options.replyToMessageId) {
    payload.message_reference = { message_id: options.replyToMessageId }
  }

  const form = new FormData()
  form.append('payload_json', JSON.stringify(payload))
  form.append('files[0]', new Blob([audio], { type: mimeType }), fileName)

  try {
    const resp = await net.fetch(`${DISCORD_API_BASE}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${_botToken}` },
      body: form,
    })
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new Error(`Discord API ${resp.status}: ${text}`)
    }
    recordLastOutbound(channelId, 'audio')
  } catch (err) {
    recordLastOutboundError(channelId, 'audio', err)
    throw err
  }
}

export function getStatus() {
  return {
    state: _state,
    botUsername: _botUsername,
    allowedChannelIds: [..._allowedChannelIds],
    lastError: _lastError,
    lastEventAt: _lastEventAt,
    lastEventSource: _lastEventSource,
    lastEventId: _lastEventId,
    lastSkipReason: _lastSkipReason,
    lastSkipAt: _lastSkipAt,
    lastErrorAt: _lastErrorAt,
    lastReconnectAt: _lastReconnectAt,
    lastReconnectReason: _lastReconnectReason,
    reconnectAttempt: _reconnectAttempt,
    lastOutboundAt: _lastOutboundAt,
    lastOutboundTarget: _lastOutboundTarget,
    lastOutboundKind: _lastOutboundKind,
    lastOutboundError: _lastOutboundError,
  }
}

/**
 * Register a callback for incoming messages.
 * @param {((msg: DiscordIncomingMessage) => void)|null} callback
 */
export function onMessage(callback) {
  _onMessage = callback
}

/** @param {((request: { senderId: string, name: string, code: string }) => void)|null} cb */
export function onPairingRequest(cb) {
  _onPairingRequest = cb
}

export function listPairingRequests() {
  return _pairing.list()
}

/** @param {string} senderId */
export function resolvePairingRequest(senderId) {
  return _pairing.resolve(senderId)
}
