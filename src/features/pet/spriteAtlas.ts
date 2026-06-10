import type { PetMood, PetTouchZone } from '../../types/index.ts'
import type { PetExpressionSlot } from './models.ts'
import type { PetPerformanceCue } from './performance.ts'

export const SPRITE_PET_COLUMNS = 8
export const SPRITE_PET_ROWS = 9
export const SPRITE_PET_CELL_WIDTH = 192
export const SPRITE_PET_CELL_HEIGHT = 208
export const SPRITE_PET_ATLAS_WIDTH = SPRITE_PET_COLUMNS * SPRITE_PET_CELL_WIDTH
export const SPRITE_PET_ATLAS_HEIGHT = SPRITE_PET_ROWS * SPRITE_PET_CELL_HEIGHT
export const SPRITE_PET_ACTIVE_LOOP_COUNT = 3
export const SPRITE_PET_SLOW_IDLE_DURATION_MULTIPLIER = 2

export const SPRITE_PET_ANIMATION_STATES = [
  'idle',
  'running-right',
  'running-left',
  'waving',
  'jumping',
  'failed',
  'waiting',
  'running',
  'review',
] as const

export type SpritePetAnimationState = (typeof SPRITE_PET_ANIMATION_STATES)[number]

export interface SpritePetAtlasDefinition {
  imagePath: string
  columns?: number
  rows?: number
  cellWidth?: number
  cellHeight?: number
  imageRendering?: 'pixelated' | 'auto'
  stageSize?: string
  stageMinSize?: string
  stageMaxSize?: string
  stageMarginBottom?: string
  previewSize?: string
  previewMinSize?: string
  previewMaxSize?: string
}

export type SpritePetFrame = {
  row: number
  column: number
  durationMs: number
}

export type SpritePetAnimationCursor = {
  state: SpritePetAnimationState
  frameIndex: number
  loopsRemaining: number
  requestKey: string
  idleDurationMultiplier?: number
}

export type SpritePetAdvanceOptions = {
  loopRequestedState?: boolean
}

export type SpritePetAnimationDefinition = {
  row: number
  columns: number[]
  durationsMs: number[]
}

export const SPRITE_PET_ANIMATIONS: Record<SpritePetAnimationState, SpritePetAnimationDefinition> = {
  idle: {
    row: 0,
    columns: [0, 1, 2, 3, 4, 5],
    durationsMs: [280, 110, 110, 140, 140, 320],
  },
  'running-right': {
    row: 1,
    columns: [0, 1, 2, 3, 4, 5, 6, 7],
    durationsMs: [120, 120, 120, 120, 120, 120, 120, 220],
  },
  'running-left': {
    row: 2,
    columns: [0, 1, 2, 3, 4, 5, 6, 7],
    durationsMs: [120, 120, 120, 120, 120, 120, 120, 220],
  },
  waving: {
    row: 3,
    columns: [0, 1, 2, 3],
    durationsMs: [140, 140, 140, 280],
  },
  jumping: {
    row: 4,
    columns: [0, 1, 2, 3, 4],
    durationsMs: [140, 140, 140, 140, 280],
  },
  failed: {
    row: 5,
    columns: [0, 1, 2, 3, 4, 5, 6, 7],
    durationsMs: [140, 140, 140, 140, 140, 140, 140, 240],
  },
  waiting: {
    row: 6,
    columns: [0, 1, 2, 3, 4, 5],
    durationsMs: [150, 150, 150, 150, 150, 260],
  },
  running: {
    row: 7,
    columns: [0, 1, 2, 3, 4, 5],
    durationsMs: [120, 120, 120, 120, 120, 220],
  },
  review: {
    row: 8,
    columns: [0, 1, 2, 3, 4, 5],
    durationsMs: [150, 150, 150, 150, 150, 280],
  },
}

export function getSpritePetFrame(state: SpritePetAnimationState, frameIndex: number): SpritePetFrame {
  const animation = SPRITE_PET_ANIMATIONS[state]
  const safeIndex = animation.columns.length
    ? Math.abs(frameIndex) % animation.columns.length
    : 0

  return {
    row: animation.row,
    column: animation.columns[safeIndex] ?? 0,
    durationMs: animation.durationsMs[safeIndex] ?? animation.durationsMs.at(-1) ?? 120,
  }
}

export function getSpritePetFrameCount(state: SpritePetAnimationState): number {
  return SPRITE_PET_ANIMATIONS[state].columns.length
}

export function advanceSpritePetAnimationCursor(
  current: SpritePetAnimationCursor,
  requestedState: SpritePetAnimationState,
  requestKey: string,
  options: SpritePetAdvanceOptions = {},
): SpritePetAnimationCursor {
  const frameCount = getSpritePetFrameCount(current.state)
  const nextFrameIndex = current.frameIndex + 1

  if (nextFrameIndex < frameCount) {
    return {
      ...current,
      frameIndex: nextFrameIndex,
    }
  }

  if (current.state === 'idle') {
    return {
      ...current,
      frameIndex: 0,
    }
  }

  if (options.loopRequestedState && current.state === requestedState && current.requestKey === requestKey) {
    return {
      ...current,
      frameIndex: 0,
      loopsRemaining: SPRITE_PET_ACTIVE_LOOP_COUNT,
    }
  }

  const nextLoopsRemaining = current.loopsRemaining - 1
  if (nextLoopsRemaining > 0) {
    return {
      ...current,
      frameIndex: 0,
      loopsRemaining: nextLoopsRemaining,
    }
  }

  return {
    state: 'idle',
    frameIndex: 0,
    loopsRemaining: 0,
    requestKey: current.requestKey,
    idleDurationMultiplier: SPRITE_PET_SLOW_IDLE_DURATION_MULTIPLIER,
  }
}

export function isSpritePetAnimationState(value: unknown): value is SpritePetAnimationState {
  return typeof value === 'string'
    && SPRITE_PET_ANIMATION_STATES.includes(value.trim() as SpritePetAnimationState)
}

function mapExpressionSlotToState(slot?: PetExpressionSlot): SpritePetAnimationState | null {
  switch (slot) {
    case 'thinking':
      return 'running'
    case 'happy':
      return 'review'
    case 'sleepy':
      return 'waiting'
    case 'surprised':
      return 'jumping'
    case 'confused':
      return 'failed'
    case 'embarrassed':
      return 'waving'
    case 'listening':
      return 'waiting'
    case 'speaking':
      return 'review'
    case 'touchHead':
    case 'touchFace':
    case 'touchBody':
      return 'jumping'
    default:
      return null
  }
}

export function mapPetMoodToSpriteState(mood: PetMood): SpritePetAnimationState {
  switch (mood) {
    case 'thinking':
    case 'curious':
      return 'running'
    case 'happy':
    case 'excited':
    case 'proud':
    case 'playful':
      return 'review'
    case 'sleepy':
      return 'waiting'
    case 'surprised':
      return 'jumping'
    case 'confused':
    case 'worried':
      return 'failed'
    case 'embarrassed':
    case 'affectionate':
      return 'waving'
    default:
      return 'idle'
  }
}

export function mapPetInputsToSpriteState(input: {
  mood: PetMood
  touchZone?: PetTouchZone | null
  isListening?: boolean
  isSpeaking?: boolean
  isBusy?: boolean
  performanceCue?: PetPerformanceCue | null
}): SpritePetAnimationState {
  if (input.performanceCue?.gestureName === 'wave') {
    return 'waving'
  }

  if (input.performanceCue?.gestureName) {
    return 'jumping'
  }

  const cueState = mapExpressionSlotToState(input.performanceCue?.expressionSlot)
  if (cueState) {
    return cueState
  }

  if (input.isSpeaking) {
    return 'review'
  }

  if (input.isListening) {
    return 'waiting'
  }

  if (input.isBusy) {
    return 'running'
  }

  if (input.touchZone) {
    return 'jumping'
  }

  return mapPetMoodToSpriteState(input.mood)
}
