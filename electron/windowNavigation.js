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

/** @param {unknown} token @returns {'panel'|'pet'|'unknown'} */
function canonicalViewRole(token) {
  if (token === 'panel') return 'panel'
  if (token === 'pet') return 'pet'
  return 'unknown'
}

/**
 * `view` hidden in the fragment is the same role bit as `?view=`.
 * A hash with no view token does not declare a role.
 * @param {string} hash
 * @returns {string | null | undefined}
 */
function hashViewToken(hash) {
  if (!hash || hash.length <= 1) return undefined
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  const query = raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : raw
  if (!query.includes('view=')) return undefined
  return new URLSearchParams(query).get('view')
}

/** @param {unknown} rawUrl @returns {Array<'panel'|'pet'|'unknown'> | null} */
function explicitViewRoles(rawUrl) {
  const parsed = parseUrl(rawUrl)
  if (!parsed) return null
  const roles = []
  if (parsed.searchParams.has('view')) {
    roles.push(canonicalViewRole(parsed.searchParams.get('view')))
  }
  const hashView = hashViewToken(parsed.hash)
  if (hashView !== undefined) roles.push(canonicalViewRole(hashView))
  return roles
}

/**
 * In-page section changes (`section=settings`) stay on the same role.
 * Dropping `view`, or putting a different role in the query or hash, does not.
 * @param {unknown} targetUrl
 * @param {unknown} entryUrl
 */
function navigationPreservesViewRole(targetUrl, entryUrl) {
  const entryRoles = explicitViewRoles(entryUrl)
  const targetRoles = explicitViewRoles(targetUrl)
  if (!entryRoles || !targetRoles) return false
  if (entryRoles.length === 0) return targetRoles.length === 0
  const entryRole = entryRoles[0]
  if (entryRoles.some((role) => role !== entryRole)) return false
  if (targetRoles.length === 0) return false
  return targetRoles.every((role) => role === entryRole)
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

/**
 * Same-origin, same-path navigations are allowed only when they keep the
 * window's view role. `will-navigate` does not see `history.replaceState`,
 * so callers also apply this check to in-page URL updates.
 * @param {unknown} targetUrl
 * @param {unknown} rendererEntryUrl
 */
export function isAllowedRendererNavigation(targetUrl, rendererEntryUrl) {
  const target = parseUrl(targetUrl)
  const rendererEntry = parseUrl(rendererEntryUrl)
  if (!target || !rendererEntry) return false

  if (target.protocol !== rendererEntry.protocol) return false
  if (target.username || target.password) return false

  const sameResource = target.protocol === 'file:'
    ? target.pathname === rendererEntry.pathname
    : target.origin === rendererEntry.origin
      && normalizePathname(target.pathname) === normalizePathname(rendererEntry.pathname)
  if (!sameResource) return false
  return navigationPreservesViewRole(targetUrl, rendererEntryUrl)
}

export function normalizeExternalWindowOpenUrl(rawUrl) {
  return normalizeExternalUrl(rawUrl)
}
