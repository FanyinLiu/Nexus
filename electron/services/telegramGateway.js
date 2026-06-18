/**
 * Telegram Bot API long-polling gateway.
 *
 * Connects to the Telegram Bot API using getUpdates long-polling.
 * Incoming messages from allowed chat IDs are forwarded to the renderer
 * via a callback. The renderer can send replies back through sendMessage.
 */

import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { isAllowedSender } from './allowlistPolicy.js'
import { createPairingManager } from './pairingManager.js'

// Electron's net.fetch when running inside the app; plain global fetch under
// node:test (requiring 'electron' outside the runtime yields the binary path
// string, not the API). This is what makes the gateway loadable in tests.
const require = createRequire(import.meta.url)
let _electronNet = null
let _electronApp = null
try {
  const electron = require('electron')
  if (typeof electron?.net?.fetch === 'function') _electronNet = electron.net
  if (typeof electron?.app?.getPath === 'function') _electronApp = electron.app
} catch {
  // plain node — fall through to global fetch
}
const doFetch = (...args) => (_electronNet ? _electronNet.fetch(...args) : globalThis.fetch(...args))

// Configurable for tests and for users behind networks where
// api.telegram.org needs a reverse proxy.
const TELEGRAM_API_BASE = (process.env.NEXUS_TELEGRAM_API_BASE ?? 'https://api.telegram.org').replace(/\/+$/, '')
const TELEGRAM_OFFSET_STATE_FILE = 'telegram-gateway-offsets.json'

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
// Poll-loop generation token (same pattern as minecraftGateway's connect
// generation): _pollAbort is overwritten every iteration, so disconnect()
// can only abort the LATEST in-flight request — an earlier iteration's
// fetch survives, keeps looping, and the 3s error backoff can even revive
// a loop across a disconnect/connect boundary. Such an orphan loop then
// races the new connection's first poll and can swallow a batch while the
// allowlist is mid-reset (messages silently dropped). Every loop carries
// its generation; bumping the counter strands all older loops for good.
let _pollGeneration = 0
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
let _lastOutboundAt = null
/** @type {string|null} */
let _lastOutboundTarget = null
/** @type {string|null} */
let _lastOutboundKind = null
/** @type {string|null} */
let _lastOutboundError = null

/**
 * @typedef {{ chatId: number, chatTitle: string, fromUser: string, text: string, media: string|null, messageId: number, timestamp: string }} TelegramIncomingMessage
 */

/** @type {((msg: TelegramIncomingMessage) => void)|null} */
let _onMessage = null
/** @type {((request: { senderId: string, name: string, code: string }) => void)|null} */
let _onPairingRequest = null
const _pairing = createPairingManager()

const PAIRING_REPLY = (code) =>
  `Nexus pairing code 配对码: ${code}\n` +
  'Approve this chat in Nexus → Settings → Integrations to start talking.\n' +
  '在 Nexus 的 设置 → 集成 里批准这个对话即可开始聊天（1 小时内有效）。'

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

function recordLastEvent(message) {
  _lastEventAt = String(message?.timestamp ?? new Date().toISOString())
  _lastEventSource = String(message?.chatTitle ?? message?.chatId ?? 'telegram')
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

function getOffsetStatePath() {
  const override = String(process.env.NEXUS_TELEGRAM_GATEWAY_STATE_FILE ?? '').trim()
  if (override) return override
  if (_electronApp) return path.join(_electronApp.getPath('userData'), TELEGRAM_OFFSET_STATE_FILE)
  return ''
}

function getBotTokenStateKey(botToken) {
  return createHash('sha256').update(String(botToken ?? '')).digest('hex').slice(0, 24)
}

async function readOffsetState() {
  const filePath = getOffsetStatePath()
  if (!filePath) return { schemaVersion: 1, bots: {} }
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8'))
    if (parsed && typeof parsed === 'object' && parsed.bots && typeof parsed.bots === 'object') {
      return parsed
    }
  } catch (err) {
    if (err?.code !== 'ENOENT') {
      console.warn('[telegram] failed to read offset state:', err?.message ?? err)
    }
  }
  return { schemaVersion: 1, bots: {} }
}

async function loadPersistedUpdateOffset(botToken) {
  if (!botToken) return 0
  const state = await readOffsetState()
  const key = getBotTokenStateKey(botToken)
  const offset = Number(state.bots?.[key]?.updateOffset)
  return Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0
}

async function persistUpdateOffset(botToken, updateOffset) {
  const filePath = getOffsetStatePath()
  if (!filePath || !botToken || !Number.isFinite(updateOffset) || updateOffset <= 0) return

  try {
    const state = await readOffsetState()
    const key = getBotTokenStateKey(botToken)
    const current = Number(state.bots?.[key]?.updateOffset)
    const nextOffset = Math.max(
      Number.isFinite(current) ? Math.floor(current) : 0,
      Math.floor(updateOffset),
    )
    const nextState = {
      schemaVersion: 1,
      bots: {
        ...(state.bots ?? {}),
        [key]: {
          updateOffset: nextOffset,
          updatedAt: new Date().toISOString(),
        },
      },
    }
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, `${JSON.stringify(nextState, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  } catch (err) {
    console.warn('[telegram] failed to persist update offset:', err?.message ?? err)
  }
}

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

async function pollOnce(generation) {
  if (generation !== _pollGeneration || !_polling || !_botToken) return

  const pollBotToken = _botToken
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

    let nextUpdateOffset = _updateOffset
    for (const update of updates) {
      const updateId = Number(update.update_id)
      if (Number.isFinite(updateId)) {
        nextUpdateOffset = Math.max(nextUpdateOffset, Math.floor(updateId) + 1)
      }
    }
    if (nextUpdateOffset > _updateOffset) {
      _updateOffset = nextUpdateOffset
      await persistUpdateOffset(pollBotToken, _updateOffset)
    }

    for (const update of updates) {
      const message = /** @type {Record<string, unknown>|undefined} */ (update.message)
      if (!message) continue

      const chat = /** @type {Record<string, unknown>} */ (message.chat)
      const chatId = /** @type {number} */ (chat.id)

      // Security: only process messages from allowed chat IDs.
      // Deny-by-default: an empty allowlist accepts nobody — but a stranger's
      // FIRST message starts the pairing flow (code sent back, desktop
      // approves). Repeats and overflow stay silent.
      if (!isAllowedSender(_allowedChatIds, chatId)) {
        const fromUnauthorized = /** @type {Record<string, unknown>|undefined} */ (message.from)
        const senderName = fromUnauthorized
          ? String(fromUnauthorized.first_name ?? '') + (fromUnauthorized.last_name ? ` ${fromUnauthorized.last_name}` : '')
          : String(chat.title ?? chatId)
        const pairing = _pairing.requestPairing(String(chatId), senderName)
        if (pairing.kind === 'created') {
          console.info(`[telegram] Pairing request from chat ${chatId}`)
          _onPairingRequest?.({ senderId: String(chatId), name: senderName, code: pairing.code })
          try {
            await apiCall('sendMessage', { chat_id: chatId, text: PAIRING_REPLY(pairing.code) })
            recordLastOutbound(chatId, 'pairing')
          } catch (err) {
            recordLastOutboundError(chatId, 'pairing', err)
            console.warn('[telegram] pairing reply failed:', err.message)
          }
        } else {
          console.info(`[telegram] Ignoring message from unauthorized chat ${chatId} (pairing ${pairing.kind})`)
        }
        recordLastSkip(`unauthorized_sender:${pairing.kind}`)
        continue
      }

      const from = /** @type {Record<string, unknown>|undefined} */ (message.from)
      const text = /** @type {string|undefined} */ (message.text)
      const media = text ? null : detectMediaKind(message)
      if (!text && !media) {
        recordLastSkip('unsupported_message_payload')
        continue
      } // Skip service/unsupported messages

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
            recordLastSkip(`voice_download_failed:${err.message}`)
          }
        }
      }

      recordLastEvent(incoming)
      _onMessage?.(incoming)
    }
  } catch (err) {
    if (err?.name === 'AbortError') return // intentional stop
    if (generation !== _pollGeneration) return // stale loop — stand down
    console.error('[telegram] Poll error:', err.message)
    recordLastError(err.message)
    // Brief pause before retry to avoid hammering on transient errors
    await new Promise((r) => setTimeout(r, 3000))
  }

  // Schedule next poll — only if this loop is still the current generation
  // (the backoff above may have slept across a disconnect/reconnect).
  if (_polling && generation === _pollGeneration) {
    // Use setImmediate-style to avoid call stack growth
    setTimeout(() => pollOnce(generation), 0)
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
  _updateOffset = Math.max(_updateOffset, await loadPersistedUpdateOffset(_botToken))

  try {
    // Verify the token by calling getMe
    const me = /** @type {Record<string, unknown>} */ (await apiCall('getMe'))
    _botUsername = String(me.username ?? '')
    _state = 'connected'
    _polling = true
    _pollGeneration += 1
    console.info(`[telegram] Connected as @${_botUsername}`)
    // Start polling (fire and forget)
    const generation = _pollGeneration
    setTimeout(() => pollOnce(generation), 0)
  } catch (err) {
    _state = 'error'
    recordLastError(err.message)
    _botToken = null
    throw err
  }
}

export async function disconnect() {
  _polling = false
  _pollGeneration += 1 // strand every live poll loop, not just the abortable one
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

  try {
    await apiCall('sendMessage', params)
    recordLastOutbound(chatId, 'text')
  } catch (err) {
    recordLastOutboundError(chatId, 'text', err)
    throw err
  }
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
  if (!ext) {
    const error = new Error(`Telegram voice notes do not support ${mimeType}`)
    recordLastOutboundError(chatId, 'voice', error)
    throw error
  }

  const form = new FormData()
  form.append('chat_id', String(chatId))
  if (options.replyToMessageId) {
    form.append('reply_parameters', JSON.stringify({ message_id: options.replyToMessageId }))
  }
  form.append('voice', new Blob([audio], { type: mimeType }), `voice-reply.${ext}`)

  try {
    const resp = await doFetch(`${TELEGRAM_API_BASE}/bot${_botToken}/sendVoice`, {
      method: 'POST',
      body: form,
    })
    const json = await resp.json()
    if (!json.ok) {
      throw new Error(`Telegram API error: ${json.description ?? JSON.stringify(json)}`)
    }
    recordLastOutbound(chatId, 'voice')
  } catch (err) {
    recordLastOutboundError(chatId, 'voice', err)
    throw err
  }
}

export function getStatus() {
  return {
    state: _state,
    botUsername: _botUsername,
    allowedChatIds: [..._allowedChatIds],
    lastError: _lastError,
    lastEventAt: _lastEventAt,
    lastEventSource: _lastEventSource,
    lastEventId: _lastEventId,
    lastSkipReason: _lastSkipReason,
    lastSkipAt: _lastSkipAt,
    lastErrorAt: _lastErrorAt,
    lastOutboundAt: _lastOutboundAt,
    lastOutboundTarget: _lastOutboundTarget,
    lastOutboundKind: _lastOutboundKind,
    lastOutboundError: _lastOutboundError,
    // Diagnostic: the next getUpdates offset. Confirms batches and lets
    // tests assert offset retention without racing the poll loop.
    updateOffset: _updateOffset,
  }
}

/**
 * Register a callback for incoming messages.
 * @param {((msg: TelegramIncomingMessage) => void)|null} callback
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
