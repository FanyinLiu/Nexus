export declare const PORTRAIT_LANDMARK_GATE_REASONS: Readonly<{
  HALF_BODY_ONLY: 'half_body_only'
  MULTIPLE_CHARACTERS: 'multiple_characters'
  EYES_UNCLEAR: 'eyes_unclear'
  SIDE_VIEW: 'side_view'
  MOUTH_COVERED: 'mouth_covered'
  HANDS_NEAR_FACE: 'hands_near_face'
  MODELS_UNAVAILABLE: 'landmark_models_unavailable'
}>

export type PortraitLandmarkGateReason =
  (typeof PORTRAIT_LANDMARK_GATE_REASONS)[keyof typeof PORTRAIT_LANDMARK_GATE_REASONS]

export declare const PORTRAIT_LANDMARK_GATE_MESSAGE_KEYS: Readonly<{
  accepted: 'settings.pet.portrait_gate.accepted'
  half_body_only: 'settings.pet.portrait_gate.half_body_only'
  multiple_characters: 'settings.pet.portrait_gate.multiple_characters'
  eyes_unclear: 'settings.pet.portrait_gate.eyes_unclear'
  side_view: 'settings.pet.portrait_gate.side_view'
  mouth_covered: 'settings.pet.portrait_gate.mouth_covered'
  hands_near_face: 'settings.pet.portrait_gate.hands_near_face'
  landmark_models_unavailable: 'settings.pet.portrait_gate.landmark_models_unavailable'
}>

export type PortraitLandmarkGateMessageKey =
  (typeof PORTRAIT_LANDMARK_GATE_MESSAGE_KEYS)[keyof typeof PORTRAIT_LANDMARK_GATE_MESSAGE_KEYS]

/** Why a landmark-gate decision was taken (diagnostic detail, never user copy). */
export type PortraitLandmarkGateDetail =
  | 'no_face'
  | 'face_small'
  | 'eye_landmarks_broken'
  | 'mouth_landmarks_missing'
  | 'landmark_order'
  | 'object_across_mouth'
  | null

export type PortraitLandmarkGateResult = {
  accepted: boolean
  reasonCode: PortraitLandmarkGateReason | null
  detail: PortraitLandmarkGateDetail | string | null
  messageKey: PortraitLandmarkGateMessageKey
  messageParams: Record<string, string | number>
  metrics: Record<string, number | boolean>
}

export declare function isPortraitLandmarkGateReason(value: unknown): value is PortraitLandmarkGateReason
