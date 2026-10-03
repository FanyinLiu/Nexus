/**
 * Portrait draft generation (v0.5) result contract, for the reasons that
 * belong to generation itself rather than to the image gate (stage A,
 * `portraitImageGate.js`) or the landmark gate (`portraitLandmarkGate.js`).
 *
 * v0.5 rule: when unsure, reject. There is no plain-background fallback:
 * - `background_not_separable`: the isnet-anime cutout failed or its mask
 *   was not trusted, so the character cannot be separated cleanly;
 * - `portrait_models_not_downloaded`: a model generation needs (face
 *   detector, landmarks, or cutout) is missing or damaged; the user has to
 *   download the portrait models first.
 */

export const PORTRAIT_DRAFT_REASONS = Object.freeze({
  BACKGROUND_NOT_SEPARABLE: 'background_not_separable',
  MODELS_NOT_DOWNLOADED: 'portrait_models_not_downloaded',
})

export const PORTRAIT_DRAFT_MESSAGE_KEYS = Object.freeze({
  background_not_separable: 'settings.pet.portrait_gate.background_not_separable',
  portrait_models_not_downloaded: 'settings.pet.portrait_gate.portrait_models_not_downloaded',
})

const REASON_SET = new Set(Object.values(PORTRAIT_DRAFT_REASONS))

/** True when `value` is one of the stable draft-generation reason codes. */
export function isPortraitDraftReason(value) {
  return typeof value === 'string' && REASON_SET.has(value)
}
