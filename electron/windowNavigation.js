import { normalizeExternalUrl } from './tools/toolRegistryUtils.js'

function parseUrl(value) {
  try {
    return new URL(String(value ?? ''))
  } catch {
    return null
  }
}

function normalizePathname(pathname) {
  return pathname || '/'
}

export function isAllowedRendererNavigation(targetUrl, rendererEntryUrl) {
  const target = parseUrl(targetUrl)
  const rendererEntry = parseUrl(rendererEntryUrl)
  if (!target || !rendererEntry) return false

  if (target.protocol !== rendererEntry.protocol) return false
  if (target.username || target.password) return false

  if (target.protocol === 'file:') {
    return target.pathname === rendererEntry.pathname
  }

  return target.origin === rendererEntry.origin
    && normalizePathname(target.pathname) === normalizePathname(rendererEntry.pathname)
}

export function normalizeExternalWindowOpenUrl(rawUrl) {
  return normalizeExternalUrl(rawUrl)
}
