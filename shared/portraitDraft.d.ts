export declare const PORTRAIT_DRAFT_REASONS: Readonly<{
  BACKGROUND_NOT_SEPARABLE: 'background_not_separable'
  PHOTO_NOT_ILLUSTRATION: 'photo_not_illustration'
  MOUTH_UNRELIABLE: 'mouth_unreliable'
  LAYERS_INCOMPLETE: 'layers_incomplete'
  BREATHING_HOLES: 'breathing_holes'
  MODELS_NOT_DOWNLOADED: 'portrait_models_not_downloaded'
}>

export type PortraitDraftReason =
  (typeof PORTRAIT_DRAFT_REASONS)[keyof typeof PORTRAIT_DRAFT_REASONS]

export declare const PORTRAIT_DRAFT_MESSAGE_KEYS: Readonly<{
  background_not_separable: 'settings.pet.portrait_gate.background_not_separable'
  photo_not_illustration: 'settings.pet.portrait_gate.photo_not_illustration'
  mouth_unreliable: 'settings.pet.portrait_gate.mouth_unreliable'
  layers_incomplete: 'settings.pet.portrait_gate.layers_incomplete'
  breathing_holes: 'settings.pet.portrait_gate.breathing_holes'
  portrait_models_not_downloaded: 'settings.pet.portrait_gate.portrait_models_not_downloaded'
}>

export declare function isPortraitDraftReason(value: unknown): value is PortraitDraftReason
