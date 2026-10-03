/**
 * Portrait generator stage A (image rejection) result contract.
 *
 * The main process decides with heuristics and returns a stable reason code
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
  TOO_SMALL: 'too_small',
  EXTREME_ASPECT_RATIO: 'extreme_aspect_ratio',
  HALF_BODY_ONLY: 'half_body_only',
  TOO_BLURRY: 'too_blurry',
  BUSY_BACKGROUND: 'busy_background',
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
  too_small: 'settings.pet.portrait_gate.too_small',
  extreme_aspect_ratio: 'settings.pet.portrait_gate.extreme_aspect_ratio',
  half_body_only: 'settings.pet.portrait_gate.half_body_only',
  too_blurry: 'settings.pet.portrait_gate.too_blurry',
  busy_background: 'settings.pet.portrait_gate.busy_background',
})

const REASON_SET = new Set(Object.values(PORTRAIT_IMAGE_GATE_REASONS))

/** True when `value` is one of the stable stage-A reason codes. */
export function isPortraitImageGateReason(value) {
  return typeof value === 'string' && REASON_SET.has(value)
}
