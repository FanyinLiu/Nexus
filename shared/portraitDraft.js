/**
 * Portrait draft generation (v0.5) result contract, for the reasons that
 * belong to generation itself rather than to the image gate (stage A,
 * `portraitImageGate.js`) or the landmark gate (`portraitLandmarkGate.js`).
 *
 * v0.5 rule: when unsure, reject. There is no plain-background fallback:
 * - `background_not_separable`: the isnet-anime cutout failed or its mask
 *   was not trusted (empty, not covering the face, or in pieces), so the character cannot be separated cleanly;
 * - `photo_not_illustration`: after generation, the cut-out face has photo
 *   texture (no cel-flat areas, camera grain in the skin);
 * - `mouth_unreliable`: after generation, the mouth landmarks are missing,
 *   out of order, or something (a hand, an object) lies across the mouth,
 *   so the mouth cannot be animated;
 * - `layers_incomplete`: the hair/head/body split is missing a layer or cuts
 *   through the face;
 * - `breathing_holes`: the breathing animation would open transparent holes
 *   in the character;
 * - `portrait_models_not_downloaded`: a model generation needs (face
 *   detector, landmarks, or cutout) is missing or damaged; the user has to
 *   download the portrait models first.
 */

export const PORTRAIT_DRAFT_REASONS = Object.freeze({
  BACKGROUND_NOT_SEPARABLE: 'background_not_separable',
  PHOTO_NOT_ILLUSTRATION: 'photo_not_illustration',
  MOUTH_UNRELIABLE: 'mouth_unreliable',
  LAYERS_INCOMPLETE: 'layers_incomplete',
  BREATHING_HOLES: 'breathing_holes',
  MODELS_NOT_DOWNLOADED: 'portrait_models_not_downloaded',
})

export const PORTRAIT_DRAFT_MESSAGE_KEYS = Object.freeze({
  background_not_separable: 'settings.pet.portrait_gate.background_not_separable',
  photo_not_illustration: 'settings.pet.portrait_gate.photo_not_illustration',
  mouth_unreliable: 'settings.pet.portrait_gate.mouth_unreliable',
  layers_incomplete: 'settings.pet.portrait_gate.layers_incomplete',
  breathing_holes: 'settings.pet.portrait_gate.breathing_holes',
  portrait_models_not_downloaded: 'settings.pet.portrait_gate.portrait_models_not_downloaded',
})

const REASON_SET = new Set(Object.values(PORTRAIT_DRAFT_REASONS))

/** True when `value` is one of the stable draft-generation reason codes. */
export function isPortraitDraftReason(value) {
  return typeof value === 'string' && REASON_SET.has(value)
}
