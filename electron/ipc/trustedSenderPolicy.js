/** @param {unknown} value @returns {URL|null} */
function parseUrl(value) {
  try {
    return new URL(String(value ?? ''))
  } catch {
    return null
  }
}

/**
 * @param {unknown} frameUrl
 * @param {unknown} ownerUrl
 */
export function isTrustedRendererFrameUrl(frameUrl, ownerUrl) {
  const frame = parseUrl(frameUrl)
  const owner = parseUrl(ownerUrl)
  if (!frame || !owner || frame.username || frame.password) return false
  if (frame.protocol !== owner.protocol) return false

  if (frame.protocol === 'file:') {
    return frame.pathname === owner.pathname
  }

  return frame.origin === owner.origin
    && (frame.pathname || '/') === (owner.pathname || '/')
}

/** @param {{ parent?: unknown } | null | undefined} frame */
export function isTopLevelRendererFrame(frame) {
  if (!frame) return false
  return frame.parent == null
}
