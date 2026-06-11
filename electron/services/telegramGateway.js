/**
 * Telegram Bot API long-polling gateway.
 *
 * Connects to the Telegram Bot API using getUpdates long-polling.
 * Incoming messages from allowed chat IDs are forwarded to the renderer
 * via a callback. The renderer can send replies back through sendMessage.
 */

import { createRequire } from 'node:module'

import { isAllowedSender } from './allowlistPolicy.js'

// Electron's net.fetch when running inside the app; plain global fetch under
// node:test (requiring 'electron' outside the runtime yields the binary path
// string, not the API). This is what makes the gateway loadable in tests.
const require = createRequire(import.meta.url)
let _electronNet = null
try {
  const electron = require('electron')
  if (typeof electron?.net?.fetch === 'function') _electronNet = electron.net
} catch {
  // plain node — fall through to global fetch
}
const doFetch = (...args) => (_electronNet ? _electronNet.fetch(...args) : globalThis.fetch(...args))

// Configurable for tests and for users behind networks where
// api.telegram.org needs a reverse proxy.
const TELEGRAM_API_BASE = (process.env.NEXUS_TELEGRAM_API_BASE ?? 'https://api.telegram.org').replace(/\/+$/, '')

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
 * @typedef {{ chatId: number, chatTitle: string, fromUser: string, text: string, media: string|null, messageId: number, timestamp: string }} TelegramIncomingMessage
 */

/** @type {((msg: TelegramIncomingMessage) => void)|null} */
let _onMessage = null

// Non-text message payload keys we recognise, in priority order. A message that
// carries one of these (and no text) is forwarded as a generic media message.
const MEDIA_KINDS = [
  'photo', 'video', 'animation', 'sticker', 'voice', 'audio',
  'document', 'video_note', 'location', 'venue', 'contact', 'poll', 'dice',
]

/**
 * @param {Record<string, unknown>} message
 * @returns {string|null} the media kind, or null for service/unsupported messages
 */
// Telegram voice notes are tiny (~1 MB/min of Opus); anything bigger than
// this is not a voice note worth transcribing inline.
const VOICE_DOWNLOAD_MAX_BYTES = 15 * 1024 * 1024

function detectMediaKind(message) {
  for (const kind of MEDIA_KINDS) {
    if (message[kind] != null) return kind
  }
  return null
}

// ── Telegram API helpers ─────────────────────────────────────────────────────

/**
 * @param {string} method
 * @param {Record<string, unknown>} [params]
 * @param {AbortSignal} [signal]
 * @returns {Promise<unknown>}
 */
async function apiCall(method, params, signal) {
  if (!_botToken) throw new Error('Bot token not set')

  const url = `${TELEGRAM_API_BASE}/bot${_botToken}/${method}`
  const body = params ? JSON.stringify(params) : undefined

  const resp = await doFetch(url, {
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

      // Security: only process messages from allowed chat IDs.
      // Deny-by-default: an empty allowlist accepts nobody.
      if (!isAllowedSender(_allowedChatIds, chatId)) {
        console.info(`[telegram] Ignoring message from unauthorized chat ${chatId}`)
        continue
      }

      const from = /** @type {Record<string, unknown>|undefined} */ (message.from)
      const text = /** @type {string|undefined} */ (message.text)
      const media = text ? null : detectMediaKind(message)
      if (!text && !media) continue // Skip service/unsupported messages

      const incoming = {
        chatId,
        chatTitle: String(chat.title ?? chat.first_name ?? chatId),
        fromUser: from
          ? String(from.first_name ?? '') + (from.last_name ? ` ${from.last_name}` : '')
          : 'Unknown',
        text: text ?? '',
        media,
        messageId: /** @type {number} */ (message.message_id),
        timestamp: new Date(/** @type {number} */ (message.date) * 1000).toISOString(),
        voiceBase64: /** @type {string|null} */ (null),
        voiceMimeType: /** @type {string|null} */ (null),
      }

      if (media === 'voice') {
        // Fetch the voice note so the renderer can transcribe it into the
        // companion chat. Best-effort: a failed download degrades to the
        // announce-only behaviour the bridge always had for media.
        const voice = /** @type {Record<string, unknown>|undefined} */ (message.voice)
        const fileSize = Number(voice?.file_size ?? 0)
        if (voice?.file_id && fileSize > 0 && fileSize <= VOICE_DOWNLOAD_MAX_BYTES) {
          try {
            const file = /** @type {Record<string, unknown>} */ (
              await apiCall('getFile', { file_id: voice.file_id })
            )
            if (file?.file_path) {
              const resp = await doFetch(`${TELEGRAM_API_BASE}/file/bot${_botToken}/${file.file_path}`)
              if (resp.ok) {
                incoming.voiceBase64 = Buffer.from(await resp.arrayBuffer()).toString('base64')
                incoming.voiceMimeType = String(voice.mime_type ?? 'audio/ogg')
              }
            }
          } catch (err) {
            console.warn('[telegram] voice download failed:', err.message)
          }
        }
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
  // _updateOffset is intentionally NOT reset here: resetting it to 0 made
  // every reconnect replay the previous unconfirmed getUpdates batch, so a
  // flaky network turned old messages into duplicate companion turns. The
  // offset only advances (line ~102), which is exactly Telegram's contract.

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

/** Container formats Telegram renders as a voice bubble (Bot API sendVoice). */
const TELEGRAM_VOICE_EXT_BY_MIME = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
}

/**
 * Send a voice note to a Telegram chat. Telegram only renders OGG/Opus,
 * MP3 and M4A uploads as voice bubbles; callers must pre-filter other
 * containers (this throws for them so a bug can't silently send garbage).
 * @param {number} chatId
 * @param {Buffer} audio
 * @param {string} mimeType
 * @param {{ replyToMessageId?: number }} [options]
 */
export async function sendVoice(chatId, audio, mimeType, options = {}) {
  if (_state !== 'connected') throw new Error('Telegram gateway not connected')

  const ext = TELEGRAM_VOICE_EXT_BY_MIME[String(mimeType).toLowerCase().split(';')[0].trim()]
  if (!ext) throw new Error(`Telegram voice notes do not support ${mimeType}`)

  const form = new FormData()
  form.append('chat_id', String(chatId))
  if (options.replyToMessageId) {
    form.append('reply_parameters', JSON.stringify({ message_id: options.replyToMessageId }))
  }
  form.append('voice', new Blob([audio], { type: mimeType }), `voice-reply.${ext}`)

  const resp = await doFetch(`${TELEGRAM_API_BASE}/bot${_botToken}/sendVoice`, {
    method: 'POST',
    body: form,
  })
  const json = await resp.json()
  if (!json.ok) {
    throw new Error(`Telegram API error: ${json.description ?? JSON.stringify(json)}`)
  }
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
