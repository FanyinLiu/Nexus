/**
 * Portrait generator stage A (image rejection) result contract.
 *
 * Stage A only refuses files that cannot be processed (unreadable, corrupt,
 * unsupported or animated format, beyond the hard size caps). Large images
 * are downscaled, not rejected; picture content is judged later.
 *
 * The main process decides from the file alone and returns a stable reason code
 * plus a `messageKey`; the renderer owns every user-facing sentence. Reason
 * codes are safe for audit logs; paths and pixels never are. Codes are
 * contractual: renaming one breaks stored diagnostics and i18n keys.
 */

export const PORTRAIT_IMAGE_GATE_REASONS = Object.freeze({
  UNREADABLE: 'unreadable',
  FILE_TOO_LARGE: 'file_too_large',
  DECODE_FAILED: 'decode_failed',
  UNSUPPORTED_FORMAT: 'unsupported_format',
  ANIMATED: 'animated',
  DIMENSIONS_TOO_LARGE: 'dimensions_too_large',
})

/** Renderer copy keys, one per reason code plus the accepted verdict. */
export const PORTRAIT_IMAGE_GATE_MESSAGE_KEYS = Object.freeze({
  accepted: 'settings.pet.portrait_gate.accepted',
  unreadable: 'settings.pet.portrait_gate.unreadable',
  file_too_large: 'settings.pet.portrait_gate.file_too_large',
  decode_failed: 'settings.pet.portrait_gate.decode_failed',
  unsupported_format: 'settings.pet.portrait_gate.unsupported_format',
  animated: 'settings.pet.portrait_gate.animated',
  dimensions_too_large: 'settings.pet.portrait_gate.dimensions_too_large',
})

const REASON_SET = new Set(Object.values(PORTRAIT_IMAGE_GATE_REASONS))

/** True when `value` is one of the stable stage-A reason codes. */
export function isPortraitImageGateReason(value) {
  return typeof value === 'string' && REASON_SET.has(value)
}
