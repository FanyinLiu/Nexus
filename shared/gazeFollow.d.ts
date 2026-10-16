export const GAZE_SAMPLE_INTERVAL_MS: 40
export const GAZE_MIN_EMIT_INTERVAL_MS: 32
export const GAZE_IDLE_PAUSE_SECONDS: 60
export const GAZE_RESUME_CHECK_MS: 250
export const GAZE_SMOOTH_RATE: 0.55

export type GazeTargetPoint = { x: number; y: number }

export type GazePauseInput = {
  enabled?: boolean
  visible?: boolean
  minimized?: boolean
  locked?: boolean
  suspended?: boolean
  idleSeconds?: number
}

export type GazeSamplePoint = { x: number; y: number; inside?: boolean }

export type DesktopGazeSample = {
  paused: boolean
  x: number
  y: number
  width: number
  height: number
  inside: boolean
}

export type DisplayDipAnchor = {
  scaleFactor?: number
  bounds?: { x?: number; y?: number }
  nativeOrigin?: { x?: number; y?: number }
}

export type WindowDipBounds = { x: number; y: number; width: number; height: number }

export function gazeSamplingPaused(input: GazePauseInput): boolean

export function shouldEmitGazeSample(input: {
  lastPoint?: GazeSamplePoint | null
  nextPoint?: GazeSamplePoint | null
  lastEmitAt?: number
  now: number
  minIntervalMs?: number
}): boolean

export function physicalPointToDip(
  physical: { x: number; y: number },
  display: DisplayDipAnchor | null | undefined,
): GazeTargetPoint

export function normalizeCursorToDip(
  cursor: { x: number; y: number },
  converters: {
    dipToScreenPoint?: (point: GazeTargetPoint) => GazeTargetPoint
    screenToDipPoint?: (point: GazeTargetPoint) => GazeTargetPoint
  } | null | undefined,
): GazeTargetPoint

export function selectGazeCursor(input: {
  platform?: string
  hookPoint?: { x?: number; y?: number } | null
  electronPoint?: { x?: number; y?: number } | null
}): { source: 'hook'; physical: GazeTargetPoint } | { source: 'electron'; dip: GazeTargetPoint } | null

export function cursorRelativeToWindow(input: {
  cursor: { x: number; y: number }
  windowBounds: WindowDipBounds
  cursorIsPhysical?: boolean
  cursorDisplay?: DisplayDipAnchor | null
}): { x: number; y: number; width: number; height: number; inside: boolean }

export function toPublicGazeSample(
  relative: { x?: number; y?: number; width?: number; height?: number; inside?: boolean } | null | undefined,
  paused?: boolean,
): DesktopGazeSample

export function mapRelativeCursorToGaze(relative: {
  x: number
  y: number
  width: number
  height: number
}): GazeTargetPoint

export function stepGazeTarget(
  current: GazeTargetPoint,
  target: GazeTargetPoint,
  rate?: number,
): GazeTargetPoint

export function shouldPublishGaze(
  previous: GazeTargetPoint,
  next: GazeTargetPoint,
  epsilon?: number,
): boolean
