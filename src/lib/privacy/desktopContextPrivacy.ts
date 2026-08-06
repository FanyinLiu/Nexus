import type { DesktopContextSnapshot } from '../../types'
import { sanitizeDesktopContextSnapshot } from '../../../shared/desktopContextPrivacy.js'

// Re-exported from the canonical implementation in
// shared/desktopContextPrivacy.js. The audit contract
// (scripts/desktop-context-privacy-audit.mjs) pins this name here.
export { DESKTOP_CONTEXT_REDACTION } from '../../../shared/desktopContextPrivacy.js'

export function sanitizeDesktopContextSnapshotForPrompt(
  snapshot: DesktopContextSnapshot,
): DesktopContextSnapshot {
  return sanitizeDesktopContextSnapshot(snapshot)
}

export function stripDesktopContextScreenshotPayload(
  snapshot: DesktopContextSnapshot | null | undefined,
): DesktopContextSnapshot | null {
  if (!snapshot) return null

  const {
    screenshotDataUrl: _screenshotDataUrl,
    displayName: _displayName,
    ...contentOnlySnapshot
  } = snapshot

  void _screenshotDataUrl
  void _displayName

  return contentOnlySnapshot
}
