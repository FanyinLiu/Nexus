export declare const PORTRAIT_DRAFT_REASONS: Readonly<{
  BACKGROUND_NOT_SEPARABLE: 'background_not_separable'
  MODELS_NOT_DOWNLOADED: 'portrait_models_not_downloaded'
}>

export type PortraitDraftReason =
  (typeof PORTRAIT_DRAFT_REASONS)[keyof typeof PORTRAIT_DRAFT_REASONS]

export declare const PORTRAIT_DRAFT_MESSAGE_KEYS: Readonly<{
  background_not_separable: 'settings.pet.portrait_gate.background_not_separable'
  portrait_models_not_downloaded: 'settings.pet.portrait_gate.portrait_models_not_downloaded'
}>

export declare function isPortraitDraftReason(value: unknown): value is PortraitDraftReason
