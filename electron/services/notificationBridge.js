/**
 * Notification bridge service — RSS polling + webhook HTTP server.
 *
 * Provides a unified notification pipeline for the autonomy subsystem.
 * RSS channels are polled at their configured interval; webhook channels
 * expose a local HTTP endpoint that external tools can POST to.
 *
 * Incoming notifications are forwarded to the renderer via a callback.
 */

import { app, net } from 'electron'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { checkUrlSafetyWithDns } from './urlSafety.js'
import { sanitizeNotificationChannels, WEBHOOK_MAX_BODY_BYTES } from './notificationBridgeUtils.js'

// ── State ────────────────────────────────────────────────────────────────────

/** @type {import('../../src/types/autonomy').NotificationChannel[]} */
let _channels = []

/** @type {Map<string, ReturnType<typeof setInterval>>} */
const _pollTimers = new Map()

/** @type {import('node:http').Server | null} */
let _webhookServer = null

/** @type {boolean} */
let _running = false

/**
 * @typedef {import('../../src/types/autonomy').NotificationMessage} NotificationMessage
 * @typedef {import('../../src/types/autonomy').NotificationChannel} NotificationChannel
 */

/** @type {((msg: NotificationMessage) => void) | null} */
let _onNotification = null

const WEBHOOK_PORT = 47830
const WEBHOOK_TOKEN_FILE = 'notification-webhook-token.txt'
const RSS_MAX_REDIRECTS = 5

/** @type {string} */
let _webhookToken = ''
/** @type {Promise<string> | null} */
let _webhookTokenPromise = null

/**
 * Set a bearer token for webhook authentication.
 * Empty values are ignored; webhook auth should not fall back to open access.
 * @param {string} token
 */
export function setWebhookToken(token) {
  const normalized = String(token ?? '').trim()
  if (normalized) {
    _webhookToken = normalized
  }
}

function getWebhookTokenPath() {
  return path.join(app.getPath('userData'), WEBHOOK_TOKEN_FILE)
}

function createWebhookToken() {
  return `nexus_${randomUUID().replaceAll('-', '')}${randomUUID().replaceAll('-', '')}`
}

async function ensureWebhookToken() {
  if (_webhookToken) return _webhookToken
  if (_webhookTokenPromise) return _webhookTokenPromise

  _webhookTokenPromise = (async () => {
    const tokenPath = getWebhookTokenPath()
    try {
      const stored = (await readFile(tokenPath, 'utf8')).trim()
      if (stored) {
        _webhookToken = stored
        return _webhookToken
      }
    } catch (err) {
      if (err?.code !== 'ENOENT') {
        console.warn('[notification-bridge] failed to read webhook token:', err?.message ?? err)
      }
    }

    const generated = createWebhookToken()
    await mkdir(path.dirname(tokenPath), { recursive: true })
    await writeFile(tokenPath, `${generated}\n`, { encoding: 'utf8', mode: 0o600 })
    _webhookToken = generated
    return _webhookToken
  })().finally(() => {
    _webhookTokenPromise = null
  })

  return _webhookTokenPromise
}

export async function getWebhookInfo() {
  const token = await ensureWebhookToken()
  return {
    url: `http://127.0.0.1:${WEBHOOK_PORT}/webhook`,
    token,
    authHeader: `Bearer ${token}`,
    maxBodyBytes: WEBHOOK_MAX_BODY_BYTES,
  }
}

async function fetchRssWithSafety(rawUrl) {
  let currentUrl = String(rawUrl ?? '').trim()

  for (let redirectCount = 0; redirectCount <= RSS_MAX_REDIRECTS; redirectCount += 1) {
    const safety = await checkUrlSafetyWithDns(currentUrl, { allowHttp: true })
    if (!safety.ok) {
      throw new Error(safety.reason)
    }

    const response = await net.fetch(currentUrl, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'User-Agent': 'Nexus/1.0 Notification Bridge' },
    })

    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return response
    }

    const location = String(response.headers.get('location') ?? '').trim()
    if (!location) {
      throw new Error(`redirect (${response.status}) missing Location header`)
    }

    currentUrl = new URL(location, currentUrl).toString()
  }

  throw new Error(`too many redirects (>${RSS_MAX_REDIRECTS})`)
}

// ── RSS helpers ──────────────────────────────────────────────────────────────

/**
 * Minimal regex-based RSS/Atom item extractor.
 * No external dependencies — good enough for v1.
 *
 * @param {string} xml
 * @returns {Array<{ title: string; description: string; pubDate: string | null; guid: string | null }>}
 */
function parseRssItems(xml) {
  const items = []

  // RSS 2.0 <item> elements
  const itemRegex = /<item[\s>]([\s\S]*?)<\/item>/gi
  let match
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1]
    items.push({
      title: extractTag(block, 'title'),
      description: extractTag(block, 'description') || extractTag(block, 'content:encoded'),
      pubDate: extractTag(block, 'pubDate') || extractTag(block, 'dc:date'),
      guid: extractTag(block, 'guid') || extractTag(block, 'link'),
    })
  }

  // Atom <entry> elements (fallback if no RSS items found)
  if (items.length === 0) {
    const entryRegex = /<entry[\s>]([\s\S]*?)<\/entry>/gi
    while ((match = entryRegex.exec(xml)) !== null) {
      const block = match[1]
      items.push({
        title: extractTag(block, 'title'),
        description: extractTag(block, 'summary') || extractTag(block, 'content'),
        pubDate: extractTag(block, 'published') || extractTag(block, 'updated'),
        guid: extractAtomLink(block) || extractTag(block, 'id'),
      })
    }
  }

  return items
}

/**
 * @param {string} xml
 * @param {string} tag
 * @returns {string}
 */
function extractTag(xml, tag) {
  // Handle CDATA: <tag><![CDATA[...]]></tag>
  const cdataRe = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i')
  const cdataMatch = cdataRe.exec(xml)
  if (cdataMatch) return cdataMatch[1].trim()

  // Plain text content
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i')
  const m = re.exec(xml)
  return m ? decodeXmlEntities(m[1].trim()) : ''
}

/**
 * Extract href from Atom <link rel="alternate" .../>
 * @param {string} xml
 * @returns {string}
 */
function extractAtomLink(xml) {
  const m = /<link[^>]*rel\s*=\s*["']alternate["'][^>]*href\s*=\s*["']([^"']+)["']/i.exec(xml)
    || /<link[^>]*href\s*=\s*["']([^"']+)["'][^>]*rel\s*=\s*["']alternate["']/i.exec(xml)
    || /<link[^>]*href\s*=\s*["']([^"']+)["']/i.exec(xml)
  return m ? m[1] : ''
}

/**
 * @param {string} str
 * @returns {string}
 */
function decodeXmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
}

/**
 * Strip HTML tags for a cleaner notification body.
 * @param {string} html
 * @returns {string}
 */
function stripHtml(html) {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

// ── RSS polling ──────────────────────────────────────────────────────────────

/**
 * Fetch + parse a single RSS channel and emit new items.
 * @param {NotificationChannel} channel
 */
async function pollRssChannel(channel) {
  const feedUrl = channel.config.url
  if (!feedUrl) {
    console.warn(`[notification-bridge] RSS channel "${channel.name}" has no URL`)
    return
  }

  try {
    const resp = await fetchRssWithSafety(feedUrl)

    if (!resp.ok) {
      console.warn(`[notification-bridge] RSS fetch failed for "${channel.name}": ${resp.status}`)
      return
    }

    const xml = await resp.text()
    const items = parseRssItems(xml)

    const lastChecked = channel.lastCheckedAt ? new Date(channel.lastCheckedAt).getTime() : 0
    const now = new Date().toISOString()

    for (const item of items) {
      // Skip items older than lastCheckedAt
      if (item.pubDate) {
        const pubTime = new Date(item.pubDate).getTime()
        if (!isNaN(pubTime) && pubTime <= lastChecked) continue
      } else if (lastChecked > 0) {
        // No pubDate and we've already checked before — skip to avoid duplicates
        continue
      }

      const body = item.description ? stripHtml(item.description) : ''

      /** @type {NotificationMessage} */
      const message = {
        id: randomUUID().slice(0, 12),
        channelId: channel.id,
        channelName: channel.name,
        title: item.title || '(no title)',
        body: body.slice(0, 500),
        receivedAt: now,
        read: false,
      }

      _onNotification?.(message)
    }

    // Update lastCheckedAt on the stored channel
    channel.lastCheckedAt = now
  } catch (err) {
    console.error(`[notification-bridge] RSS poll error for "${channel.name}":`, err?.message ?? err)
  }
}

/**
 * Start periodic polling for a single RSS channel.
 * @param {NotificationChannel} channel
 */
function startRssTimer(channel) {
  stopRssTimer(channel.id)

  if (!channel.enabled || channel.kind !== 'rss') return

  const intervalMs = channel.checkIntervalMinutes * 60_000

  // Immediate first poll
  pollRssChannel(channel).catch(() => {})

  const timer = setInterval(() => {
    pollRssChannel(channel).catch(() => {})
  }, intervalMs)

  _pollTimers.set(channel.id, timer)
}

/**
 * @param {string} channelId
 */
function stopRssTimer(channelId) {
  const timer = _pollTimers.get(channelId)
  if (timer) {
    clearInterval(timer)
    _pollTimers.delete(channelId)
  }
}

function stopAllRssTimers() {
  for (const [id] of _pollTimers) {
    stopRssTimer(id)
  }
}

// ── Webhook server ───────────────────────────────────────────────────────────

function startWebhookServer() {
  if (_webhookServer) return

  _webhookServer = createServer((req, res) => {
    // CORS headers — restrict to localhost only
    res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const authHeader = String(req.headers.authorization ?? '')
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
    if (!_webhookToken || token !== _webhookToken) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Unauthorized' }))
      return
    }

    if (req.method !== 'POST' || req.url !== '/webhook') {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Not found. POST to /webhook' }))
      return
    }

    let body = ''
    let bodyBytes = 0
    let bodyTooLarge = false

    req.on('data', (chunk) => {
      if (bodyTooLarge) return
      bodyBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk))
      if (bodyBytes > WEBHOOK_MAX_BODY_BYTES) {
        bodyTooLarge = true
        res.writeHead(413, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Request body too large' }))
        req.destroy()
        return
      }
      body += chunk
    })
    req.on('end', () => {
      if (bodyTooLarge) return
      try {
        const payload = JSON.parse(body)
        const title = String(payload.title ?? '')
        const msgBody = String(payload.body ?? '')
        const source = String(payload.source ?? 'webhook')

        if (!title && !msgBody) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'title or body required' }))
          return
        }

        // Find the first enabled webhook channel, or create a synthetic reference
        const webhookChannel = _channels.find((ch) => ch.kind === 'webhook' && ch.enabled)

        /** @type {NotificationMessage} */
        const message = {
          id: randomUUID().slice(0, 12),
          channelId: webhookChannel?.id ?? 'webhook',
          channelName: webhookChannel?.name ?? source,
          title: title || source,
          body: msgBody.slice(0, 500),
          receivedAt: new Date().toISOString(),
          read: false,
        }

        _onNotification?.(message)

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, id: message.id }))
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Invalid JSON body' }))
      }
    })
  })

  _webhookServer.on('error', (err) => {
    console.error(`[notification-bridge] Webhook server error:`, err?.message ?? err)
    _webhookServer = null
  })

  _webhookServer.listen(WEBHOOK_PORT, '127.0.0.1', () => {
    console.info(`[notification-bridge] Webhook server listening on http://127.0.0.1:${WEBHOOK_PORT}/webhook`)
  })
}

function stopWebhookServer() {
  if (_webhookServer) {
    _webhookServer.close()
    _webhookServer = null
    console.info('[notification-bridge] Webhook server stopped')
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Register a callback for incoming notifications from any channel.
 * @param {((msg: NotificationMessage) => void) | null} callback
 */
export function onNotification(callback) {
  _onNotification = callback
}

/** @returns {NotificationChannel[]} */
export function getChannels() {
  return _channels
}

/**
 * Replace the channel list and restart polling timers.
 * @param {NotificationChannel[]} channels
 */
export function setChannels(channels) {
  _channels = sanitizeNotificationChannels(Array.isArray(channels) ? channels : [])

  // Restart all RSS timers if the bridge is running
  if (_running) {
    stopAllRssTimers()
    for (const ch of _channels) {
      if (ch.kind === 'rss' && ch.enabled) {
        startRssTimer(ch)
      }
    }
  }
}

/** Start the bridge (RSS polling + webhook server). */
export async function start() {
  if (_running) return
  await ensureWebhookToken()
  _running = true

  // Start RSS polling for all enabled RSS channels
  for (const ch of _channels) {
    if (ch.kind === 'rss' && ch.enabled) {
      startRssTimer(ch)
    }
  }

  // Start webhook server if any webhook channel exists (or always, for flexibility)
  startWebhookServer()

  console.info(`[notification-bridge] Started — ${_channels.length} channel(s)`)
}

/** Stop the bridge (polling + webhook server). */
export function stop() {
  if (!_running) return
  _running = false

  stopAllRssTimers()
  stopWebhookServer()

  console.info('[notification-bridge] Stopped')
}
