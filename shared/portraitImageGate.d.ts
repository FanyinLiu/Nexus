export declare const PORTRAIT_IMAGE_GATE_REASONS: Readonly<{
  UNREADABLE: 'unreadable'
  FILE_TOO_LARGE: 'file_too_large'
  DECODE_FAILED: 'decode_failed'
  UNSUPPORTED_FORMAT: 'unsupported_format'
  ANIMATED: 'animated'
  DIMENSIONS_TOO_LARGE: 'dimensions_too_large'
  TOO_SMALL: 'too_small'
  EXTREME_ASPECT_RATIO: 'extreme_aspect_ratio'
  HALF_BODY_ONLY: 'half_body_only'
  TOO_BLURRY: 'too_blurry'
  BUSY_BACKGROUND: 'busy_background'
}>

export type PortraitImageGateReason =
  (typeof PORTRAIT_IMAGE_GATE_REASONS)[keyof typeof PORTRAIT_IMAGE_GATE_REASONS]

export declare const PORTRAIT_IMAGE_GATE_MESSAGE_KEYS: Readonly<{
  accepted: 'settings.pet.portrait_gate.accepted'
  unreadable: 'settings.pet.portrait_gate.unreadable'
  file_too_large: 'settings.pet.portrait_gate.file_too_large'
  decode_failed: 'settings.pet.portrait_gate.decode_failed'
  unsupported_format: 'settings.pet.portrait_gate.unsupported_format'
  animated: 'settings.pet.portrait_gate.animated'
  dimensions_too_large: 'settings.pet.portrait_gate.dimensions_too_large'
  too_small: 'settings.pet.portrait_gate.too_small'
  extreme_aspect_ratio: 'settings.pet.portrait_gate.extreme_aspect_ratio'
  half_body_only: 'settings.pet.portrait_gate.half_body_only'
  too_blurry: 'settings.pet.portrait_gate.too_blurry'
  busy_background: 'settings.pet.portrait_gate.busy_background'
}>

export type PortraitImageGateMessageKey =
  (typeof PORTRAIT_IMAGE_GATE_MESSAGE_KEYS)[keyof typeof PORTRAIT_IMAGE_GATE_MESSAGE_KEYS]

/** Metadata-only measurements; never paths, names, or pixels. */
export type PortraitImageGateMetrics = {
  byteLength?: number
  format?: string
  width?: number
  height?: number
  laplacianVariance?: number
  edgeDensity?: number
  plainBorderRatio?: number
  transparentBorderRatio?: number
  transparentPixelRatio?: number
}

export type PortraitImageGateResult = {
  accepted: boolean
  reasonCode: PortraitImageGateReason | null
  messageKey: PortraitImageGateMessageKey
  messageParams: Record<string, string | number>
  metrics: PortraitImageGateMetrics
}

export declare function isPortraitImageGateReason(value: unknown): value is PortraitImageGateReason
