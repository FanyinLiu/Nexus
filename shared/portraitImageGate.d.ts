export declare const PORTRAIT_IMAGE_GATE_REASONS: Readonly<{
  UNREADABLE: 'unreadable'
  FILE_TOO_LARGE: 'file_too_large'
  DECODE_FAILED: 'decode_failed'
  UNSUPPORTED_FORMAT: 'unsupported_format'
  ANIMATED: 'animated'
  DIMENSIONS_TOO_LARGE: 'dimensions_too_large'
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
}>

export type PortraitImageGateMessageKey =
  (typeof PORTRAIT_IMAGE_GATE_MESSAGE_KEYS)[keyof typeof PORTRAIT_IMAGE_GATE_MESSAGE_KEYS]

/** Metadata-only measurements; never paths, names, or pixels. */
export type PortraitImageGateMetrics = {
  byteLength?: number
  format?: string
  width?: number
  height?: number
  /** The image was over the in-memory size or pixel limit and later stages use a downscaled copy. */
  downscaled?: boolean
  workingWidth?: number
  workingHeight?: number
}

export type PortraitImageGateResult = {
  accepted: boolean
  reasonCode: PortraitImageGateReason | null
  messageKey: PortraitImageGateMessageKey
  messageParams: Record<string, string | number>
  metrics: PortraitImageGateMetrics
}

export declare function isPortraitImageGateReason(value: unknown): value is PortraitImageGateReason
