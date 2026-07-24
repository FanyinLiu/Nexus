/**
 * Shared pet leaf types.
 * Kept separate from models/performance/spriteAtlas so those modules can
 * depend on this file without forming a cycle:
 * models → spriteAtlas → performance → models.
 */

export type PetExpressionSlot =
  | 'idle'
  | 'thinking'
  | 'happy'
  | 'sleepy'
  | 'surprised'
  | 'confused'
  | 'embarrassed'
  | 'listening'
  | 'speaking'
  | 'touchHead'
  | 'touchFace'
  | 'touchBody'

export type PetPerformanceAccent =
  | 'peek'
  | 'search'
  | 'organize'
  | 'write'
  | 'deliver'
  | 'confirm'
  | 'sparkle'
  | 'listen'
  | 'shy'

export type PetPerformancePlan = {
  expressionSlot?: PetExpressionSlot
  motionSlot?: PetExpressionSlot
  // Model-defined gesture name (e.g. 'wave', 'nod'). Looked up in
  // motionGroups.gestures at apply time; unknown names are silent no-ops
  // so personas on gesture-poor models don't break.
  gestureName?: string
  accentStyle?: PetPerformanceAccent
  durationMs: number
  stageDirection: string
}

export type PetPerformanceCue = PetPerformancePlan & {
  id: string
}

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
