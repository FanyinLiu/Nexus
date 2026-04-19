/**
 * One entry in a model's idle fidget pool. When the pet is in `idle` mood
 * and the pet window is visible, the idle controller periodically draws
 * a weighted random fidget from this pool and queues it as a performance
 * cue. Models that don't ship a pool fall back to DEFAULT_IDLE_FIDGET_POOL.
 */
export interface IdleFidgetDefinition {
  id: string
  /** Expression slot to hold for the duration. Defaults to 'idle'. */
  expressionSlot?: PetExpressionSlot
  /** Optional motion slot. Omit for "blink-style" expression-only fidgets. */
  motionSlot?: PetExpressionSlot
  /** How long the fidget holds in ms. Defaults to 800. */
  durationMs?: number
  /** Short stage direction surfaced in debug UI / accessibility layer. */
  stageDirection?: string
  /**
   * Relative weight in the random draw. Omitting the field defaults to 1
   * (uniform). Setting weight to 0 or a negative number removes the entry
   * from the draw — handy for disabling an entry without deleting it. Use
   * higher values (e.g. 5 for blinks, 1 for stretches) to bias toward
   * unobtrusive motions.
   */
  weight?: number
}

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

export interface PetModelDefinition {
  id: string
  label: string
  description: string
  modelPath: string
  fallbackImagePath: string
  motionGroups: {
    idle?: string
    interaction?: string
    listeningStart?: string
    speakingStart?: string
    hit?: string
  }
  expressionMap: Partial<Record<PetExpressionSlot, string>>
  mouthParams?: {
    open?: string
    round?: string
    narrow?: string
    smile?: string
  }
  rigParams?: {
    angleX?: string
    angleY?: string
    angleZ?: string
    bodyAngleX?: string
    bodyAngleY?: string
    eyeBallX?: string
    eyeBallY?: string
    eyeLOpen?: string
    eyeROpen?: string
    browForm?: string
    cheek?: string
    breath?: string
  }
  layout?: {
    widthRatio?: number
    heightRatio?: number
    minWidth?: number
    minHeight?: number
    anchorX?: number
    anchorY?: number
    yOffsetRatio?: number
    yOffsetPx?: number
  }
  /**
   * Per-model idle fidget pool. Omit to use the default pool (blink /
   * fidget / shift / stretch targeting slots every model is expected to
   * have). Declare a pool here to tune weights for this model's strengths
   * — e.g. Mao has an `exp_07` blush-face that fits a "shy" fidget, other
   * models might lean on angle-rig-only head tilts. See
   * `src/features/pet/idleSequence.ts` for the draw logic.
   */
  idleFidgets?: IdleFidgetDefinition[]
}

export interface CubismModelFile {
  FileReferences?: {
    Textures?: string[]
    Expressions?: Array<{
      Name: string
      File: string
    }>
    Motions?: Record<string, unknown[]>
  }
  Groups?: Array<{
    Name?: string
    Ids?: string[]
  }>
}

function pickMotionGroup(motions: Record<string, unknown[]> | undefined, candidates: string[]) {
  if (!motions) return undefined

  const entries = Object.keys(motions)
  if (!entries.length) return undefined

  for (const candidate of candidates) {
    const exact = entries.find((key) => key === candidate)
    if (exact) return exact

    const insensitive = entries.find((key) => key.toLowerCase() === candidate.toLowerCase())
    if (insensitive) return insensitive
  }

  return entries[0]
}

function pickExpression(expressions: string[], index: number, fallback?: string) {
  return fallback ?? expressions[index] ?? expressions[0]
}

const DEFAULT_RIG_PARAMS = {
  angleX: 'ParamAngleX',
  angleY: 'ParamAngleY',
  angleZ: 'ParamAngleZ',
  bodyAngleX: 'ParamBodyAngleX',
  bodyAngleY: 'ParamBodyAngleY',
  eyeBallX: 'ParamEyeBallX',
  eyeBallY: 'ParamEyeBallY',
  eyeLOpen: 'ParamEyeLOpen',
  eyeROpen: 'ParamEyeROpen',
  browForm: 'ParamBrowForm',
  cheek: 'ParamCheek',
  breath: 'ParamBreath',
} as const

export const DEFAULT_PET_MODEL_ID = 'mao'

export const PET_MODEL_PRESETS: PetModelDefinition[] = [
  {
    id: 'mao',
    label: 'Mao 魔法少女',
    description: '当前内置测试模型，已经适配了说话嘴型、视线跟随和互动动作。',
    modelPath: './live2d/mao/Mao.model3.json',
    fallbackImagePath: '',
    motionGroups: {
      idle: 'Idle',
      interaction: 'TapBody',
      listeningStart: 'TapBody',
      speakingStart: 'TapBody',
      hit: 'TapBody',
    },
    expressionMap: {
      idle: 'exp_01',
      listening: 'exp_02',
      thinking: 'exp_03',
      sleepy: 'exp_04',
      speaking: 'exp_05',
      happy: 'exp_06',
      surprised: 'exp_08',
      confused: 'exp_03',
      embarrassed: 'exp_07',
      touchBody: 'exp_06',
      touchFace: 'exp_07',
      touchHead: 'exp_08',
    },
    mouthParams: {
      open: 'ParamA',
      round: 'ParamO',
      narrow: 'ParamI',
      smile: 'ParamMouthUp',
    },
    rigParams: {
      angleX: 'ParamAngleX',
      angleY: 'ParamAngleY',
      angleZ: 'ParamAngleZ',
      bodyAngleX: 'ParamBodyAngleX',
      bodyAngleY: 'ParamBodyAngleY',
      eyeBallX: 'ParamEyeBallX',
      eyeBallY: 'ParamEyeBallY',
      eyeLOpen: 'ParamEyeLOpen',
      eyeROpen: 'ParamEyeROpen',
      browForm: 'ParamBrowForm',
      cheek: 'ParamCheek',
      breath: 'ParamBreath',
    },
    layout: {
      widthRatio: 0.74,
      heightRatio: 0.84,
      minWidth: 250,
      minHeight: 360,
      anchorX: 0.5,
      anchorY: 0,
      yOffsetRatio: 0.03,
      yOffsetPx: 12,
    },
    // Mao gets a 6-entry pool instead of the 4-entry default — `exp_07`
    // (blush/embarrassed) makes a good quiet "shy glance" fidget, and
    // `exp_02` (listening-attentive) reads as "perks up" when alternated
    // with the tilt/stretch motions.
    idleFidgets: [
      { id: 'blink', expressionSlot: 'idle', durationMs: 600, stageDirection: '(眨眼)', weight: 6 },
      { id: 'glance', expressionSlot: 'listening', durationMs: 900, stageDirection: '(环顾)', weight: 3 },
      { id: 'shy', expressionSlot: 'embarrassed', durationMs: 1100, stageDirection: '(小害羞)', weight: 2 },
      { id: 'fidget', expressionSlot: 'happy', motionSlot: 'happy', durationMs: 1000, stageDirection: '(小动作)', weight: 2 },
      { id: 'think', expressionSlot: 'thinking', motionSlot: 'thinking', durationMs: 1200, stageDirection: '(想事情)', weight: 2 },
      { id: 'stretch', expressionSlot: 'sleepy', motionSlot: 'sleepy', durationMs: 1400, stageDirection: '(伸懒腰)', weight: 1 },
    ],
  },
]

export function getPetModelPresets(additionalModels: PetModelDefinition[] = []) {
  const merged = [...PET_MODEL_PRESETS]

  for (const model of additionalModels) {
    if (merged.some((preset) => preset.id === model.id)) continue
    merged.push(model)
  }

  return merged
}

export function getPetModelPreset(modelId?: string, additionalModels: PetModelDefinition[] = []) {
  const presets = getPetModelPresets(additionalModels)
  return presets.find((preset) => preset.id === modelId) ?? presets[0]
}

export function buildRuntimePetModelDefinition(
  modelDefinition: PetModelDefinition,
  modelFile?: CubismModelFile,
): PetModelDefinition {
  const expressions = modelFile?.FileReferences?.Expressions?.map((expression) => expression.Name) ?? []
  const motions = modelFile?.FileReferences?.Motions
  const lipSyncIds = modelFile?.Groups?.find((group) => group.Name === 'LipSync')?.Ids ?? []

  return {
    ...modelDefinition,
    motionGroups: {
      idle: modelDefinition.motionGroups.idle ?? pickMotionGroup(motions, ['Idle', 'idle', 'Main', 'main']),
      interaction: modelDefinition.motionGroups.interaction ?? pickMotionGroup(
        motions,
        ['TapBody', 'Tap', 'Touch', 'touch', 'Action'],
      ),
      listeningStart: modelDefinition.motionGroups.listeningStart ?? modelDefinition.motionGroups.interaction
        ?? pickMotionGroup(motions, ['TapBody', 'Tap', 'Touch']),
      speakingStart: modelDefinition.motionGroups.speakingStart ?? modelDefinition.motionGroups.interaction
        ?? pickMotionGroup(motions, ['TapBody', 'Tap', 'Touch']),
      hit: modelDefinition.motionGroups.hit ?? modelDefinition.motionGroups.interaction
        ?? pickMotionGroup(motions, ['TapBody', 'Tap', 'Touch']),
    },
    expressionMap: {
      idle: pickExpression(expressions, 0, modelDefinition.expressionMap.idle),
      listening: pickExpression(expressions, 1, modelDefinition.expressionMap.listening),
      thinking: pickExpression(expressions, 2, modelDefinition.expressionMap.thinking),
      sleepy: pickExpression(expressions, 3, modelDefinition.expressionMap.sleepy),
      speaking: pickExpression(expressions, 4, modelDefinition.expressionMap.speaking),
      happy: pickExpression(expressions, 5, modelDefinition.expressionMap.happy),
      touchBody: pickExpression(expressions, 5, modelDefinition.expressionMap.touchBody),
      touchFace: pickExpression(expressions, 6, modelDefinition.expressionMap.touchFace),
      touchHead: pickExpression(expressions, 7, modelDefinition.expressionMap.touchHead),
    },
    mouthParams: {
      open: modelDefinition.mouthParams?.open ?? lipSyncIds[0] ?? 'ParamA',
      round: modelDefinition.mouthParams?.round,
      narrow: modelDefinition.mouthParams?.narrow,
      smile: modelDefinition.mouthParams?.smile ?? 'ParamMouthForm',
    },
    rigParams: {
      ...DEFAULT_RIG_PARAMS,
      ...modelDefinition.rigParams,
    },
  }
}
