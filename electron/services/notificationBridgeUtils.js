import { checkUrlSafety } from './urlSafety.js'

export const MIN_RSS_INTERVAL_MINUTES = 5
export const MAX_RSS_INTERVAL_MINUTES = 24 * 60
export const DEFAULT_RSS_INTERVAL_MINUTES = 30
export const WEBHOOK_MAX_BODY_BYTES = 64 * 1024

function coerceFiniteNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
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
