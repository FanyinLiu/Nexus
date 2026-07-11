/**
 * Window-level capability policy for renderer IPC.
 *
 * The preload bridge remains shared for compatibility, but high-impact
 * operations are only meaningful from the panel/settings surface. Unknown
 * channels stay shared until they are explicitly classified here so adding a
 * low-risk channel does not silently become a breaking change.
 */

const PANEL_ONLY_PATTERNS = Object.freeze([
  /^discord:send-/,
  /^factorio:execute$/,
  /^file:/,
  /^external-action-policy:sync$/,
  /^local-data:chat-(?:comparison-preview|migration-(?:apply|rollback)|session-mirror|sessions-read)$/,
  /^local-data:memory-(?:read|migration-(?:apply|rollback))$/,
  /^local-data:companion-(?:read|comparison-preview|dataset-mirror|migration-(?:apply|rollback))$/,
  /^mcp:(?:call-tool|sync-servers)$/,
  /^minecraft:send-command$/,
  /^pet-model:(?:assemble-creator-kit|create-(?:creator-kit|from-image)|import(?:-codex-gallery)?|install-creator-kit-codex|open-creator-kit-path)$/,
  /^plugin:(?:approve|disable|enable|restart|revoke|start|stop)$/,
  /^plugin-bus:(?:publish|subscribe|unsubscribe)$/,
  /^persona:/,
  /^skill:/,
  /^telegram:send-/,
  /^tool:open-external$/,
  /^vault:/,
  /^vts-bridge:migrate-legacy-token$/,
])

const EXPLICIT_SHARED_HIGH_IMPACT_CHANNELS = Object.freeze(new Set([
  // Desktop awareness is consumed by the pet runtime so it remains shared.
  'desktop-context:get',
]))

/** @param {unknown} ownerUrl @returns {'panel'|'pet'|'unknown'} */
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
  if (required === 'shared') return true
  return viewKind === required
}

export const WINDOW_CAPABILITY_MATRIX = Object.freeze({
  panel: Object.freeze({ panel: true, shared: true }),
  pet: Object.freeze({ panel: false, shared: true }),
  unknown: Object.freeze({ panel: false, shared: true }),
})
