/**
 * Window-level capability policy for renderer IPC.
 *
 * The preload bridge remains shared for compatibility, but high-impact
 * operations are only meaningful from the panel/settings surface. Unknown
 * channels stay shared until they are explicitly classified here so adding a
 * low-risk channel does not silently become a breaking change.
 *
 * The privilege bit is the capability bound to a webContents when its
 * BrowserWindow is created. The live URL is not a capability source:
 * `history.replaceState(?view=panel)` must not promote a pet window.
 */

const PANEL_ONLY_PATTERNS = Object.freeze([
  /^discord:(?:connect|send-)/,
  /^factorio:(?:connect|execute)$/,
  /^file:/,
  /^external-action-policy:sync$/,
  /^integrations:inspect$/,
  /^local-data:chat-(?:comparison-preview|migration-(?:apply|rollback)|session-mirror|sessions-read)$/,
  /^local-data:memory-(?:read|migration-(?:apply|rollback))$/,
  /^local-data:companion-(?:read|comparison-preview|dataset-mirror|migration-(?:apply|rollback))$/,
  /^mcp:(?:call-tool|sync-servers)$/,
  /^minecraft:(?:connect|send-command)$/,
  /^models:download$/,
  /^notification:(?:set-channels|start)$/,
  /^pet-model:import$/,
  /^plugin:(?:approve|disable|enable|restart|revoke|start|stop)$/,
  /^plugin-bus:(?:publish|subscribe|unsubscribe)$/,
  /^persona:(?:save-|open-dir$|init$|import-card$|profile-dir$)/,
  /^skill:/,
  /^telegram:(?:connect|send-)/,
  /^tool:open-external$/,
  /^updater:install$/,
  /^vault:/,
  /^vts-bridge:migrate-legacy-token$/,
  /^models:setup-requested$/,
  /^window:consume-model-setup-request$/,
])

const EXPLICIT_SHARED_HIGH_IMPACT_CHANNELS = Object.freeze(new Set([
  // Desktop awareness is consumed by the pet runtime so it remains shared.
  'desktop-context:get',
]))

// Shared between panel and pet, but only for a window bound at creation time.
// The pending request is a one-shot hand-off, so an unbound webContents (which
// our own windows never are) must not be able to arm it.
const BOUND_WINDOW_ONLY_CHANNELS = Object.freeze(new Set([
  'window:request-model-setup',
]))

// WeakMap keys have to be objects, so the webContents object is the identity
// key. The id map covers lookups that only have the numeric id and is cleared
// with the object entry on destroy (ids are not a valid WeakMap key).
const capabilitiesByContents = new WeakMap()
const capabilitiesById = new Map()

/** @param {unknown} viewKind @returns {'panel'|'pet'|'unknown'} */
function normalizeBoundViewKind(viewKind) {
  if (viewKind === 'panel' || viewKind === 'pet') return viewKind
  return 'unknown'
}

/** @param {object} webContents @returns {number | null} */
function webContentsId(webContents) {
  const id = /** @type {{ id?: unknown }} */ (webContents).id
  return typeof id === 'number' ? id : null
}

/**
 * Record the privilege of a BrowserWindow's webContents at creation time.
 * Later URL edits do not change it.
 * @param {object | null | undefined} webContents
 * @param {unknown} viewKind
 */
export function bindWindowCapability(webContents, viewKind) {
  if (!webContents || typeof webContents !== 'object') return
  const kind = normalizeBoundViewKind(viewKind)
  const id = webContentsId(webContents)
  capabilitiesByContents.set(webContents, { kind, id })
  if (id !== null) capabilitiesById.set(id, kind)
}

/**
 * Drop a creation-time binding. Safe to call after the webContents is destroyed
 * because the id was stored on bind and is not read back from the object.
 * @param {object | null | undefined} webContents
 */
export function unbindWindowCapability(webContents) {
  if (!webContents || typeof webContents !== 'object') return
  const bound = capabilitiesByContents.get(webContents)
  capabilitiesByContents.delete(webContents)
  if (bound && typeof bound.id === 'number') capabilitiesById.delete(bound.id)
}

/**
 * @param {object | null | undefined} webContents
 * @returns {'panel'|'pet'|'unknown'}
 */
export function getBoundWindowCapability(webContents) {
  if (!webContents || typeof webContents !== 'object') return 'unknown'
  const bound = capabilitiesByContents.get(webContents)
  if (bound) return bound.kind
  const id = webContentsId(webContents)
  if (id !== null && capabilitiesById.has(id)) {
    return capabilitiesById.get(id)
  }
  return 'unknown'
}

/**
 * Reject a channel the bound window is not allowed to call.
 * The decision reads the creation-time binding only, so a rewritten `?view=`
 * on the live document URL cannot widen it.
 * @param {object | null | undefined} webContents
 * @param {unknown} channel
 */
export function assertBoundWindowChannelAllowed(webContents, channel) {
  const viewKind = getBoundWindowCapability(webContents)
  if (!isWindowChannelAllowed(channel, viewKind)) {
    const capability = getRequiredWindowCapability(channel)
    throw new Error(`IPC rejected: ${capability} capability is unavailable to ${viewKind} window`)
  }
}

/**
 * Classify a URL's `view` token. This is not the privilege bit; callers that
 * decide IPC access must use the creation-time binding.
 * @param {unknown} ownerUrl
 * @returns {'panel'|'pet'|'unknown'}
 */
export function getRendererViewKind(ownerUrl) {
  try {
    const url = new URL(String(ownerUrl ?? ''))
    const view = url.searchParams.get('view')
    if (view === 'panel') return 'panel'
    if (view === 'pet') return 'pet'
  } catch {
    // An unparseable owner URL is handled as the least-privileged view.
  }
  return 'unknown'
}

/** @param {unknown} channel @returns {'panel'|'shared'} */
export function getRequiredWindowCapability(channel) {
  const value = typeof channel === 'string' ? channel : ''
  return PANEL_ONLY_PATTERNS.some((pattern) => pattern.test(value)) ? 'panel' : 'shared'
}

/** @param {unknown} channel */
export function isWindowCapabilityClassified(channel) {
  const value = typeof channel === 'string' ? channel : ''
  return getRequiredWindowCapability(value) === 'panel'
    || EXPLICIT_SHARED_HIGH_IMPACT_CHANNELS.has(value)
}

/**
 * @param {unknown} channel
 * @param {unknown} viewKind
 */
export function isWindowChannelAllowed(channel, viewKind) {
  const required = getRequiredWindowCapability(channel)
  const kind = viewKind === 'panel' || viewKind === 'pet' || viewKind === 'unknown'
    ? viewKind
    : 'unknown'
  if (kind === 'unknown' && BOUND_WINDOW_ONLY_CHANNELS.has(String(channel ?? ''))) return false
  return WINDOW_CAPABILITY_MATRIX[kind][required] === true
}

export const WINDOW_CAPABILITY_MATRIX = Object.freeze({
  panel: Object.freeze({ panel: true, shared: true }),
  pet: Object.freeze({ panel: false, shared: true }),
  unknown: Object.freeze({ panel: false, shared: true }),
})
