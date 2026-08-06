/**
 * Sprite pet atlas contract — single source of truth shared by the Electron
 * main process (services/spritePetPackage.js, which re-exports to the other
 * spritePet*.js services) and the Vite renderer (features/pet/spriteAtlas.ts).
 * Atlas geometry and per-row frame timings must never drift apart.
 */
export const SPRITE_PET_COLUMNS = 8
export const SPRITE_PET_ROWS = 9
export const SPRITE_PET_CELL_WIDTH = 192
export const SPRITE_PET_CELL_HEIGHT = 208
export const SPRITE_PET_ATLAS_WIDTH = SPRITE_PET_COLUMNS * SPRITE_PET_CELL_WIDTH
export const SPRITE_PET_ATLAS_HEIGHT = SPRITE_PET_ROWS * SPRITE_PET_CELL_HEIGHT

/**
 * Row layout of the pet atlas, in row order. `durationsMs` holds one entry
 * per frame (length === frameCount).
 */
export const SPRITE_PET_ROW_CONTRACT = [
  { state: 'idle', row: 0, frameCount: 6, durationsMs: [280, 110, 110, 140, 140, 320] },
  { state: 'running-right', row: 1, frameCount: 8, durationsMs: [120, 120, 120, 120, 120, 120, 120, 220] },
  { state: 'running-left', row: 2, frameCount: 8, durationsMs: [120, 120, 120, 120, 120, 120, 120, 220] },
  { state: 'waving', row: 3, frameCount: 4, durationsMs: [140, 140, 140, 280] },
  { state: 'jumping', row: 4, frameCount: 5, durationsMs: [140, 140, 140, 140, 280] },
  { state: 'failed', row: 5, frameCount: 8, durationsMs: [140, 140, 140, 140, 140, 140, 140, 240] },
  { state: 'waiting', row: 6, frameCount: 6, durationsMs: [150, 150, 150, 150, 150, 260] },
  { state: 'running', row: 7, frameCount: 6, durationsMs: [120, 120, 120, 120, 120, 220] },
  { state: 'review', row: 8, frameCount: 6, durationsMs: [150, 150, 150, 150, 150, 280] },
]
