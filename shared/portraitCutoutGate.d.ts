export declare const PORTRAIT_CUTOUT_GATE_REASONS: Readonly<{
  MODELS_UNAVAILABLE: 'cutout_models_unavailable'
  MASK_INVALID: 'cutout_mask_invalid'
}>
export type PortraitCutoutGateReason = (typeof PORTRAIT_CUTOUT_GATE_REASONS)[keyof typeof PORTRAIT_CUTOUT_GATE_REASONS]
export declare const PORTRAIT_CUTOUT_GATE_MESSAGE_KEYS: Readonly<{
  cutout_models_unavailable: 'settings.pet.portrait_gate.cutout_models_unavailable'
  cutout_mask_invalid: 'settings.pet.portrait_gate.cutout_mask_invalid'
}>
export type PortraitCutoutGateMessageKey = (typeof PORTRAIT_CUTOUT_GATE_MESSAGE_KEYS)[keyof typeof PORTRAIT_CUTOUT_GATE_MESSAGE_KEYS]
export type PortraitCutoutGateFailure = {
  accepted: false
  reasonCode: PortraitCutoutGateReason
  detail: string
  messageKey: PortraitCutoutGateMessageKey
  messageParams: Record<string, string | number>
}
export declare function isPortraitCutoutGateReason(value: unknown): value is PortraitCutoutGateReason
export declare function cutoutUnavailable(detail?: unknown): PortraitCutoutGateFailure
