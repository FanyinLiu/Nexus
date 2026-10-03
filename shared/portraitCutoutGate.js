/**
 * Cutout failure contract shared by the main process, settings UI, and
 * acceptance reports. Only known diagnostic codes leave the worker;
 * exceptions, model paths, and source image data are never user messages.
 */
export const PORTRAIT_CUTOUT_GATE_REASONS = Object.freeze({
  MODELS_UNAVAILABLE: 'cutout_models_unavailable',
  MASK_INVALID: 'cutout_mask_invalid',
})

export const PORTRAIT_CUTOUT_GATE_MESSAGE_KEYS = Object.freeze({
  cutout_models_unavailable: 'settings.pet.portrait_gate.cutout_models_unavailable',
  cutout_mask_invalid: 'settings.pet.portrait_gate.cutout_mask_invalid',
})

const REASONS = new Set(Object.values(PORTRAIT_CUTOUT_GATE_REASONS))
const DETAILS = new Set(['missing', 'invalid', 'runtime_unavailable', 'load_failed', 'timeout', 'analysis_failed', 'invalid_mask'])

/** True only for an audited cutout reason code, never arbitrary worker text. */
export function isPortraitCutoutGateReason(value) {
  return typeof value === 'string' && REASONS.has(value)
}

/** Build a localizable cutout failure without exposing exception text. */
export function cutoutUnavailable(detail = 'analysis_failed') {
  const safe = DETAILS.has(detail) ? detail : 'analysis_failed'
  const reasonCode = safe === 'invalid_mask' ? PORTRAIT_CUTOUT_GATE_REASONS.MASK_INVALID : PORTRAIT_CUTOUT_GATE_REASONS.MODELS_UNAVAILABLE
  return { accepted: false, reasonCode, detail: safe, messageKey: PORTRAIT_CUTOUT_GATE_MESSAGE_KEYS[reasonCode], messageParams: {} }
}
