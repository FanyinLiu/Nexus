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

function summarizeUrlShape(rawUrl) {
  const inputLength = typeof rawUrl === 'string' ? rawUrl.length : String(rawUrl ?? '').length
  const parsed = parseUrl(rawUrl)

  if (!parsed) {
    return {
      inputLength,
      parsed: false,
    }
  }

  return {
    inputLength,
    parsed: true,
    protocol: parsed.protocol.replace(/:$/, ''),
    hostnamePresent: Boolean(parsed.hostname),
    hostnameLength: parsed.hostname.length,
    pathnameLength: parsed.pathname.length,
    searchPresent: Boolean(parsed.search),
    searchLength: parsed.search.length,
    hashPresent: Boolean(parsed.hash),
    hashLength: parsed.hash.length,
  }
}

export function summarizeWindowNavigationUrlForLog(rawUrl) {
  return summarizeUrlShape(rawUrl)
}

export function summarizeWindowNavigationErrorForLog(error) {
  const message = error instanceof Error
    ? (error.message || error.name || '')
    : String(error ?? '')
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    messageLength: message.length,
  }
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
