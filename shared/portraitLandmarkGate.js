/**
 * Portrait generator stage A, part 2 (landmark gate) result contract.
 *
 * Runs after the sharp-only gate (`portraitImageGate.js`) on images it
 * accepted. Same shape: a stable reason code plus a renderer `messageKey`;
 * the renderer owns every sentence. v0.5 is narrowed to half-body
 * illustrations, so "no face found" on a full-body / small-face / chibi
 * image is reported as `half_body_only`, sharing stage A's message.
 */

export const PORTRAIT_LANDMARK_GATE_REASONS = Object.freeze({
  HALF_BODY_ONLY: 'half_body_only',
  MULTIPLE_CHARACTERS: 'multiple_characters',
  EYES_UNCLEAR: 'eyes_unclear',
  SIDE_VIEW: 'side_view',
  MOUTH_COVERED: 'mouth_covered',
  HANDS_NEAR_FACE: 'hands_near_face',
  PHOTO_NOT_ILLUSTRATION: 'photo_not_illustration',
  MODELS_UNAVAILABLE: 'landmark_models_unavailable',
})

export const PORTRAIT_LANDMARK_GATE_MESSAGE_KEYS = Object.freeze({
  accepted: 'settings.pet.portrait_gate.accepted',
  half_body_only: 'settings.pet.portrait_gate.half_body_only',
  multiple_characters: 'settings.pet.portrait_gate.multiple_characters',
  eyes_unclear: 'settings.pet.portrait_gate.eyes_unclear',
  side_view: 'settings.pet.portrait_gate.side_view',
  mouth_covered: 'settings.pet.portrait_gate.mouth_covered',
  hands_near_face: 'settings.pet.portrait_gate.hands_near_face',
  photo_not_illustration: 'settings.pet.portrait_gate.photo_not_illustration',
  landmark_models_unavailable: 'settings.pet.portrait_gate.landmark_models_unavailable',
})

const REASON_SET = new Set(Object.values(PORTRAIT_LANDMARK_GATE_REASONS))

/** True when `value` is one of the stable landmark-gate reason codes. */
export function isPortraitLandmarkGateReason(value) {
  return typeof value === 'string' && REASON_SET.has(value)
}
