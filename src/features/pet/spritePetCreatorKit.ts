import {
  SPRITE_PET_ANIMATIONS,
  SPRITE_PET_ANIMATION_STATES,
  SPRITE_PET_ATLAS_HEIGHT,
  SPRITE_PET_ATLAS_WIDTH,
  SPRITE_PET_CELL_HEIGHT,
  SPRITE_PET_CELL_WIDTH,
  SPRITE_PET_COLUMNS,
  SPRITE_PET_ROWS,
} from './spriteAtlas.ts'

export type SpritePetCreatorKitRowStatus = {
  row: number
  state: string
  frameCount: number
  expectedWidth: number
  expectedHeight: number
  sourcePath: string
  ready: boolean
  width?: number
  height?: number
  format?: string
  warnings?: string[]
  error?: string
}

export type SpritePetCreatorKitInspection = {
  id: string
  displayName: string
  kitDirectory: string
  kitDirectoryDisplay?: string
  sourceRowsDirectory?: string
  sourceRowsDirectoryDisplay?: string
  ready: boolean
  readyCount: number
  missingCount: number
  warningCount?: number
  contactSheetPath?: string
  contactSheetPathDisplay?: string
  motionPreviewPath?: string
  motionPreviewPathDisplay?: string
  rows: SpritePetCreatorKitRowStatus[]
  message: string
}

export type CodexPetCreatorPromptOptions = {
  displayName?: string
  concept?: string
}

function normalizePromptText(value?: string) {
  return String(value ?? '').trim().replace(/\s+/gu, ' ')
}

function formatCreatorPromptRow(state: string) {
  const animation = SPRITE_PET_ANIMATIONS[state as keyof typeof SPRITE_PET_ANIMATIONS]
  return `- row ${animation.row}: ${state}, ${animation.columns.length} frames, save as source-rows/${animation.row}-${state}.png`
}

export function buildCodexPetCreatorPrompt({
  displayName,
  concept,
}: CodexPetCreatorPromptOptions = {}) {
  const name = normalizePromptText(displayName) || 'My Codex Pet'
  const conceptText = normalizePromptText(concept) || 'a compact original mascot with a large readable face'
  const rowList = SPRITE_PET_ANIMATION_STATES.map(formatCreatorPromptRow).join('\n')

  return [
    `Create a clean-room Codex-compatible desktop pet named "${name}".`,
    `Concept: ${conceptText}.`,
    '',
    'Target format:',
    `- final atlas: ${SPRITE_PET_ATLAS_WIDTH}x${SPRITE_PET_ATLAS_HEIGHT}`,
    `- grid: ${SPRITE_PET_COLUMNS} columns x ${SPRITE_PET_ROWS} rows`,
    `- cell size: ${SPRITE_PET_CELL_WIDTH}x${SPRITE_PET_CELL_HEIGHT}`,
    '- package files: pet.json plus spritesheet.png or spritesheet.webp',
    '- unused cells must be fully transparent',
    '',
    'Visual style:',
    '- tiny Codex desktop-pet mascot, not Live2D, not anime key art, not a full-body human illustration',
    '- compact silhouette, large head/body mass, tiny limbs, simple readable face',
    '- thick dark outline, hard pixel-adjacent edges, limited palette, flat cel shading',
    '- transparent background only; no scenery, text, UI, panels, code, shadows, glow, speed lines, trails, dust, or detached effects',
    '- keep identity consistent across every frame: same face, palette, silhouette, accessory, and proportions',
    '',
    'Generation workflow:',
    '1. Generate one base reference image for the mascot.',
    '2. Use that exact base as the identity reference for every animation row.',
    '3. Generate these row strips, one image per row:',
    rowList,
    '4. Put those row-strip images into source-rows/ with the filenames above.',
    '5. Assemble into the final 8x9 atlas, then validate and preview before sharing.',
    '',
    'Motion rules:',
    '- idle: tiny blink and breathing only',
    '- running-right / running-left: directional pose changes only, no speed marks',
    '- waving: paw pose changes only, no wave marks',
    '- jumping: vertical body pose changes only, no floor shadow or impact marks',
    '- failed: sad/error expression only; any tears or smoke must touch the pet silhouette',
    '- waiting: patient standby loop',
    '- running: busy work loop, not literal sprinting',
    '- review: focused lean, blink, eye, head, or paw changes only',
  ].join('\n')
}
