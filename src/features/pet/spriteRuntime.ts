import {
  SPRITE_PET_CELL_HEIGHT,
  SPRITE_PET_CELL_WIDTH,
  SPRITE_PET_ACTIVE_LOOP_COUNT,
  SPRITE_PET_COLUMNS,
  SPRITE_PET_ROWS,
  advanceSpritePetAnimationCursor,
  getSpritePetFrame,
  type SpritePetAnimationCursor,
  type SpritePetAnimationState,
  type SpritePetAtlasDefinition,
  type SpritePetFrame,
} from './spriteAtlas.ts'

export { advanceSpritePetAnimationCursor }

export const SPRITE_PET_INITIAL_CURSOR: SpritePetAnimationCursor = {
  state: 'idle',
  frameIndex: 0,
  loopsRemaining: 0,
  requestKey: 'initial',
}

export type SpritePetStateRequest = {
  current: SpritePetAnimationCursor
  requestedState: SpritePetAnimationState
  requestKey: string
  prefersReducedMotion?: boolean
}

export type SpritePetRenderFrame = {
  frame: SpritePetFrame
  columns: number
  rows: number
  cellWidth: number
  cellHeight: number
  aspectRatio: string
  backgroundPosition: string
  backgroundSize: string
}

export function createSpritePetRequestKey(parts: Array<string | null | undefined>): string {
  return parts.map((part) => part ?? '').join(':')
}

export function applySpritePetStateRequest({
  current,
  requestedState,
  requestKey,
  prefersReducedMotion = false,
}: SpritePetStateRequest): SpritePetAnimationCursor {
  if (prefersReducedMotion) {
    return {
      state: requestedState,
      frameIndex: 0,
      loopsRemaining: 0,
      requestKey,
    }
  }

  if (requestedState === 'idle') {
    if (current.state === 'idle') {
      return {
        ...current,
        frameIndex: 0,
        requestKey,
      }
    }

    return current
  }

  if (current.requestKey === requestKey) {
    return current
  }

  return {
    state: requestedState,
    frameIndex: 0,
    loopsRemaining: SPRITE_PET_ACTIVE_LOOP_COUNT,
    requestKey,
  }
}

export function resolveSpritePetRenderFrame(
  atlas: SpritePetAtlasDefinition,
  cursor: SpritePetAnimationCursor,
): SpritePetRenderFrame {
  const columns = atlas.columns ?? SPRITE_PET_COLUMNS
  const rows = atlas.rows ?? SPRITE_PET_ROWS
  const cellWidth = atlas.cellWidth ?? SPRITE_PET_CELL_WIDTH
  const cellHeight = atlas.cellHeight ?? SPRITE_PET_CELL_HEIGHT
  const baseFrame = getSpritePetFrame(cursor.state, cursor.frameIndex)
  const durationMultiplier = cursor.state === 'idle'
    ? cursor.idleDurationMultiplier ?? 1
    : 1
  const frame = {
    ...baseFrame,
    durationMs: Math.round(baseFrame.durationMs * durationMultiplier),
  }
  const backgroundX = columns > 1 ? (frame.column / (columns - 1)) * 100 : 0
  const backgroundY = rows > 1 ? (frame.row / (rows - 1)) * 100 : 0

  return {
    frame,
    columns,
    rows,
    cellWidth,
    cellHeight,
    aspectRatio: `${cellWidth} / ${cellHeight}`,
    backgroundPosition: `${backgroundX}% ${backgroundY}%`,
    backgroundSize: `${columns * 100}% ${rows * 100}%`,
  }
}
