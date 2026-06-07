import { checkUrlSafety } from './urlSafety.js'

export const MIN_RSS_INTERVAL_MINUTES = 5
export const MAX_RSS_INTERVAL_MINUTES = 24 * 60
export const DEFAULT_RSS_INTERVAL_MINUTES = 30
export const WEBHOOK_MAX_BODY_BYTES = 64 * 1024
export const WEBHOOK_MAX_BODY_CHARS = 500
export const WEBHOOK_MAX_TITLE_CHARS = 160
export const WEBHOOK_MAX_META_CHARS = 120
export const NOTIFICATION_SUMMARY_MAX_CHARS = 150
export const WEBHOOK_MAX_SUMMARY_CHARS = 180

const WEBHOOK_MESSAGE_KINDS = new Set(['message', 'chat', 'chat_message'])

const HIGH_PRIORITY_PATTERNS = [
  /urgent/i,
  /important/i,
  /asap/i,
  /\bnow\b/i,
  /立即\b/i,
  /紧急\b/i,
  /重要\b/i,
  /\b(1[0-9]\s*hour|today|before|deadline)\b/i,
]

const CRITICAL_PRIORITY_PATTERNS = [
  /critical/i,
  /critical urgency/i,
  /火警/i,
  /立刻\b/i,
  /马上/i,
  /\b(alert|emergency)\b/i,
]

function collapseWhitespace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function clampText(value, maxChars) {
  const text = collapseWhitespace(value)
  return text.length <= maxChars ? text : `${text.slice(0, Math.max(0, maxChars - 3))}...`
}

export function inferNotificationPriority(message) {
  const haystack = [
    message?.title,
    message?.sender,
    message?.body,
    message?.sourceName,
    message?.sourceId,
  ]
    .map(collapseWhitespace)
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  if (CRITICAL_PRIORITY_PATTERNS.some((pattern) => pattern.test(haystack))) return 'critical'
  if (HIGH_PRIORITY_PATTERNS.some((pattern) => pattern.test(haystack))) return 'high'
  return 'normal'
}

export function summarizeNotificationMessagePayload(message) {
  if (!message || typeof message !== 'object') {
    return { summary: '', importance: 'normal' }
  }

  const title = clampText(message.title, WEBHOOK_MAX_SUMMARY_CHARS)
  const body = clampText(message.body, NOTIFICATION_SUMMARY_MAX_CHARS)
  const sender = clampText(message.sender || message.sourceName || 'Unknown', 48)
  const tail = body || 'No message preview'
  const combined = `${title ? `${title} - ` : ''}${sender}: ${tail}`
  return {
    summary: clampText(combined, 200),
    importance: inferNotificationPriority(message),
  }
}

function coerceFiniteNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function coerceWebhookString(value) {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function normalizeWebhookString(value, maxChars) {
  return coerceWebhookString(value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars)
}

function pickWebhookString(payload, keys, maxChars) {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) continue
    const value = normalizeWebhookString(payload[key], maxChars)
    if (value) return value
  }
  return ''
}

export function normalizeRssIntervalMinutes(value) {
  const minutes = coerceFiniteNumber(value)
  const normalized = minutes === null
    ? DEFAULT_RSS_INTERVAL_MINUTES
    : Math.floor(minutes)
  return Math.min(
    MAX_RSS_INTERVAL_MINUTES,
    Math.max(MIN_RSS_INTERVAL_MINUTES, normalized),
  )
}

function resolveRssIntervalMinutes(raw, config) {
  const channelMinutes = coerceFiniteNumber(raw?.checkIntervalMinutes)
  if (channelMinutes !== null) return normalizeRssIntervalMinutes(channelMinutes)

  const configSeconds = coerceFiniteNumber(config?.intervalSec)
  if (configSeconds !== null) {
    return normalizeRssIntervalMinutes(Math.ceil(configSeconds / 60))
  }

  return DEFAULT_RSS_INTERVAL_MINUTES
}

export function normalizeWebhookPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, error: 'JSON object body required' }
  }

  const rawKind = pickWebhookString(payload, ['kind', 'type'], 32).toLowerCase()
  const kind = WEBHOOK_MESSAGE_KINDS.has(rawKind) ? 'message' : 'notification'
  const sourceName = pickWebhookString(
    payload,
    ['sourceName', 'source', 'app', 'application'],
    WEBHOOK_MAX_META_CHARS,
  ) || 'webhook'
  const sourceId = pickWebhookString(payload, ['sourceId'], WEBHOOK_MAX_META_CHARS) || sourceName
  const title = pickWebhookString(
    payload,
    ['title', 'conversationTitle', 'chatTitle', 'roomName', 'channelName'],
    WEBHOOK_MAX_TITLE_CHARS,
  )
  const body = pickWebhookString(payload, ['body', 'text', 'message'], WEBHOOK_MAX_BODY_CHARS)

  if (!title && !body) {
    return { ok: false, error: 'title or body required' }
  }

  if (kind !== 'message') {
    const summary = summarizeNotificationMessagePayload({
      title: title || sourceName,
      body,
      sender: '',
      sourceName,
      sourceId,
    })
    return {
      ok: true,
      message: {
        kind,
        sourceId,
        sourceName,
        title: title || sourceName,
        body,
        summary: summary.summary,
        importance: summary.importance,
      },
    }
  }

  const sender = pickWebhookString(
    payload,
    ['sender', 'fromUser', 'from', 'author'],
    WEBHOOK_MAX_META_CHARS,
  )
  const conversationId = pickWebhookString(
    payload,
    ['conversationId', 'chatId', 'roomId', 'channelId', 'threadId'],
    WEBHOOK_MAX_META_CHARS,
  ) || title || sourceId
  const messageId = pickWebhookString(
    payload,
    ['messageId', 'id', 'eventId'],
    WEBHOOK_MAX_META_CHARS,
  )
  const summary = summarizeNotificationMessagePayload({
    title: title || sender || sourceName,
    body,
    sender,
    sourceName,
    sourceId,
  })

  return {
    ok: true,
    message: {
      kind,
      sourceId,
      sourceName,
      conversationId,
      messageId,
      sender,
      title: title || sender || sourceName,
      body,
      summary: summary.summary,
      importance: summary.importance,
    },
  }
}

/**
 * Per-channel input validation. Drops items that don't match the expected
 * shape; clamps RSS polling intervals; refuses RSS URLs that fail the SSRF
 * guard. Logs each rejection so the user can see why something disappeared.
 */
export function sanitizeNotificationChannels(channels) {
  const out = []
  for (const raw of channels) {
    if (!raw || typeof raw !== 'object') continue

    const kind = raw.kind === 'rss' || raw.kind === 'webhook' ? raw.kind : null
    if (!kind) {
      console.warn('[notification-bridge] dropped channel: invalid kind', raw?.kind)
      continue
    }

    const id = String(raw.id ?? '').trim()
    const name = String(raw.name ?? '').trim()
    const enabled = Boolean(raw.enabled)
    if (!id || !name) {
      console.warn('[notification-bridge] dropped channel: missing id/name')
      continue
    }

    const config = raw.config && typeof raw.config === 'object' ? raw.config : {}

    if (kind === 'rss') {
      const url = String(config.url ?? '').trim()
      const safety = checkUrlSafety(url)
      if (!safety.ok) {
        console.warn(`[notification-bridge] dropped RSS channel "${name}": ${safety.reason}`)
        continue
      }

      const checkIntervalMinutes = resolveRssIntervalMinutes(raw, config)
      out.push({
        ...raw,
        id,
        name,
        kind,
        enabled,
        checkIntervalMinutes,
        config: {
          ...config,
          url,
          intervalSec: checkIntervalMinutes * 60,
        },
      })
    } else {
      // webhook: nothing to fetch from the renderer's URL; the local server
      // accepts inbound POSTs only. No SSRF risk; just keep the entry.
      out.push({ ...raw, id, name, kind, enabled, config })
    }
  }
  return out
}
