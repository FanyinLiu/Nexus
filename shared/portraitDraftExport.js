/**
 * Path-free contract for explicitly exporting a generated static portrait.
 * A draft identifier selects only committed local draft files; the host owns
 * the save dialog. Attribution is supplied verbatim, never inferred.
 */
export const PORTRAIT_DRAFT_EXPORT_LIMITS = Object.freeze({ displayNameChars: 120, attributionChars: 8192, manifestBytes: 65536 })
export const PORTRAIT_DRAFT_EXPORT_ERROR_CODES = Object.freeze({
  INVALID: 'portrait_draft_export_invalid',
  UNAVAILABLE: 'portrait_draft_export_unavailable',
  EXISTS: 'portrait_draft_export_exists',
  WRITE_FAILED: 'portrait_draft_export_write_failed',
})
export const PORTRAIT_DRAFT_EXPORT_MESSAGE_KEY = 'settings.chat.portrait_flow.export_saved'

/** Extract a known stable token from direct or Electron-wrapped errors. */
export function extractPortraitDraftExportErrorCode(error) {
  const message = error instanceof Error ? error.message : String(error ?? '')
  const token = message.match(/\bportrait_draft_export_(?:invalid|unavailable|exists|write_failed)\b/)?.[0]
  return token ?? null
}

/** Accept only identifiers produced by the local draft generator. */
export function isPortraitDraftId(value) {
  return typeof value === 'string' && /^draft-\d{13}-[0-9a-f]{8}$/.test(value)
}

/** Reject paths and unknown fields; preserve supplied attribution text exactly. */
export function normalizePortraitDraftExportPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (Object.keys(value).some((key) => !['draftId', 'displayName', 'attributionText'].includes(key))) return null
  if (!isPortraitDraftId(value.draftId)) return null
  const output = { draftId: value.draftId }
  for (const [key, limit] of [['displayName', PORTRAIT_DRAFT_EXPORT_LIMITS.displayNameChars], ['attributionText', PORTRAIT_DRAFT_EXPORT_LIMITS.attributionChars]]) {
    if (value[key] === undefined) continue
    if (typeof value[key] !== 'string' || value[key].length > limit || value[key].includes('\0')) return null
    output[key] = key === 'displayName' ? value[key].trim() : value[key]
  }
  return output
}
