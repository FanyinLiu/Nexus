// @ts-nocheck
import { createLogger } from '../logger.js'
import { mainT } from '../mainMessages.js'
import { checkUrlSafety } from '../services/urlSafety.js'

const log = createLogger('tools.registry')

export function normalizeExternalUrl(rawUrl) {
  const trimmed = String(rawUrl ?? '').trim()
  if (!trimmed) {
    throw new Error(mainT('tool.linkEmpty'))
  }

  const normalized = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`
  const targetUrl = new URL(normalized)

  if (!['http:', 'https:'].includes(targetUrl.protocol)) {
    throw new Error(mainT('tool.linkProtocol'))
  }

  const safety = checkUrlSafety(targetUrl.toString(), { allowHttp: true })
  if (!safety.ok) {
    log.warn(`unsafe link rejected: ${safety.reason}`)
    throw new Error(mainT('tool.linkUnsafe'))
  }

  return targetUrl.toString()
}
