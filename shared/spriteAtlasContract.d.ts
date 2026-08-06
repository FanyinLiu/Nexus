export declare const SPRITE_PET_COLUMNS: 8
export declare const SPRITE_PET_ROWS: 9
export declare const SPRITE_PET_CELL_WIDTH: 192
export declare const SPRITE_PET_CELL_HEIGHT: 208
export declare const SPRITE_PET_ATLAS_WIDTH: number
export declare const SPRITE_PET_ATLAS_HEIGHT: number

export declare const SPRITE_PET_ROW_CONTRACT: readonly [
  { readonly state: 'idle'; readonly row: number; readonly frameCount: number; readonly durationsMs: readonly number[] },
  { readonly state: 'running-right'; readonly row: number; readonly frameCount: number; readonly durationsMs: readonly number[] },
  { readonly state: 'running-left'; readonly row: number; readonly frameCount: number; readonly durationsMs: readonly number[] },
  { readonly state: 'waving'; readonly row: number; readonly frameCount: number; readonly durationsMs: readonly number[] },
  { readonly state: 'jumping'; readonly row: number; readonly frameCount: number; readonly durationsMs: readonly number[] },
  { readonly state: 'failed'; readonly row: number; readonly frameCount: number; readonly durationsMs: readonly number[] },
  { readonly state: 'waiting'; readonly row: number; readonly frameCount: number; readonly durationsMs: readonly number[] },
  { readonly state: 'running'; readonly row: number; readonly frameCount: number; readonly durationsMs: readonly number[] },
  { readonly state: 'review'; readonly row: number; readonly frameCount: number; readonly durationsMs: readonly number[] },
]

export type SpritePetRowContractState = (typeof SPRITE_PET_ROW_CONTRACT)[number]['state']

export interface SpritePetRowContractEntry {
  readonly state: SpritePetRowContractState
  readonly row: number
  readonly frameCount: number
  readonly durationsMs: readonly number[]
}
