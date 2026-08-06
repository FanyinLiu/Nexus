export declare const SPRITE_PET_COLUMNS: 8
export declare const SPRITE_PET_ROWS: 9
export declare const SPRITE_PET_CELL_WIDTH: 192
export declare const SPRITE_PET_CELL_HEIGHT: 208
export declare const SPRITE_PET_ATLAS_WIDTH: number
export declare const SPRITE_PET_ATLAS_HEIGHT: number

export type SpritePetRowContractState =
  | 'idle'
  | 'running-right'
  | 'running-left'
  | 'waving'
  | 'jumping'
  | 'failed'
  | 'waiting'
  | 'running'
  | 'review'

export interface SpritePetRowContractEntry {
  readonly state: SpritePetRowContractState
  readonly row: number
  readonly frameCount: number
  readonly durationsMs: readonly number[]
}

export declare const SPRITE_PET_ROW_CONTRACT: readonly SpritePetRowContractEntry[]
