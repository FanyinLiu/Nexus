import type {
  IdleFidgetDefinition,
  PetExpressionSlot,
  PetModelDefinition,
  PublicGestureName,
} from './models.ts'
import { PUBLIC_GESTURE_NAMES } from './models.ts'

export const PET_EXPRESSION_SLOTS = [
  'idle',
  'thinking',
  'happy',
  'sleepy',
  'surprised',
  'confused',
  'embarrassed',
  'listening',
  'speaking',
  'touchHead',
  'touchFace',
  'touchBody',
] as const satisfies readonly PetExpressionSlot[]

const LIFECYCLE_MOTION_SLOTS = [
  'idle',
  'interaction',
  'listeningStart',
  'speakingStart',
  'hit',
] as const

export const PET_LIFECYCLE_MOTION_SLOTS = LIFECYCLE_MOTION_SLOTS
export type PetLifecycleMotionSlot = (typeof PET_LIFECYCLE_MOTION_SLOTS)[number]

export const PET_PRESENCE_STATE_SLOTS = [
  'standby',
  'focus',
  'speaking',
  'reunion',
  'worried',
  'celebration',
  'quiet_companion',
] as const
export type PetPresenceStateSlot = (typeof PET_PRESENCE_STATE_SLOTS)[number]

export type PetActionMapStatus = 'mapped' | 'missing' | 'sprite'

export type PetPresenceStateMotionTarget =
  | {
    kind: 'lifecycle'
    slot: PetLifecycleMotionSlot
  }
  | {
    kind: 'gesture'
    gesture: PublicGestureName
  }

type PetPresenceStateDefinition = {
  state: PetPresenceStateSlot
  expressionSlot: PetExpressionSlot
  motionTarget: PetPresenceStateMotionTarget
}

const PET_PRESENCE_STATE_DEFINITIONS = [
  {
    state: 'standby',
    expressionSlot: 'idle',
    motionTarget: { kind: 'lifecycle', slot: 'idle' },
  },
  {
    state: 'focus',
    expressionSlot: 'thinking',
    motionTarget: { kind: 'lifecycle', slot: 'idle' },
  },
  {
    state: 'speaking',
    expressionSlot: 'speaking',
    motionTarget: { kind: 'lifecycle', slot: 'speakingStart' },
  },
  {
    state: 'reunion',
    expressionSlot: 'happy',
    motionTarget: { kind: 'gesture', gesture: 'wave' },
  },
  {
    state: 'worried',
    expressionSlot: 'confused',
    motionTarget: { kind: 'lifecycle', slot: 'listeningStart' },
  },
  {
    state: 'celebration',
    expressionSlot: 'happy',
    motionTarget: { kind: 'gesture', gesture: 'wave' },
  },
  {
    state: 'quiet_companion',
    expressionSlot: 'sleepy',
    motionTarget: { kind: 'lifecycle', slot: 'idle' },
  },
] as const satisfies readonly PetPresenceStateDefinition[]

export type PetActionMapExpression = {
  slot: PetExpressionSlot
  expression: string | null
  status: PetActionMapStatus
}

export type PetActionMapGesture = {
  gesture: PublicGestureName
  motionGroup: string | null
  status: PetActionMapStatus
}

export type PetActionMapLifecycleMotion = {
  slot: PetLifecycleMotionSlot
  motionGroup: string | null
  status: PetActionMapStatus
}

export type PetActionMapPresenceState = {
  state: PetPresenceStateSlot
  expressionSlot: PetExpressionSlot
  expression: string | null
  motionTarget: PetPresenceStateMotionTarget
  motionGroup: string | null
  status: PetActionMapStatus
}

export type PetActionMapIdleFidget = {
  id: string
  expressionSlot: PetExpressionSlot
  expression: string | null
  motionSlot: PetExpressionSlot | null
  motionGroup: string | null
  durationMs: number
  stageDirection: string | null
  weight: number
  status: PetActionMapStatus
}

export type PetActionMapReport = {
  schema: 'nexus.pet-action-map.v1'
  model: {
    id: string
    label: string
    kind: 'live2d' | 'sprite'
  }
  summary: {
    expressionSlots: number
    mappedExpressions: number
    publicGestures: number
    mappedGestures: number
    lifecycleMotions: number
    mappedLifecycleMotions: number
    presenceStates: number
    mappedPresenceStates: number
    idleFidgets: number
    missing: number
  }
  expressions: PetActionMapExpression[]
  gestures: PetActionMapGesture[]
  lifecycleMotions: PetActionMapLifecycleMotion[]
  presenceStates: PetActionMapPresenceState[]
  idleFidgets: PetActionMapIdleFidget[]
}

export type PetActionMapDraft = {
  schema: 'nexus.pet-action-map-draft.v1'
  model: PetActionMapReport['model']
  note: string
  expressions: Record<PetExpressionSlot, string>
  gestures: Record<PublicGestureName, string>
  lifecycleMotions: Record<PetLifecycleMotionSlot, string>
}

export type PetActionMapDraftPatch = {
  expressions?: Partial<Record<PetExpressionSlot, string>>
  gestures?: Partial<Record<PublicGestureName, string>>
  lifecycleMotions?: Partial<Record<PetLifecycleMotionSlot, string>>
}

export type PetActionMapOverrideStore = Record<string, PetActionMapDraftPatch>

export type PublicPetActionMapEvidenceCheck = {
  id:
    | 'model-available'
    | 'expressions-covered'
    | 'gestures-covered'
    | 'lifecycle-covered'
    | 'presence-states-covered'
    | 'no-missing-live2d-targets'
  pass: boolean
  detail: string
}

export type PublicPetActionMapEvidenceReport = {
  schemaVersion: 1
  gate: 'live2d-action-map-coverage'
  generatedAt: string
  ok: boolean
  model: {
    id: string
    kind: 'live2d' | 'sprite'
  }
  summary: PetActionMapReport['summary'] & {
    mappedTargets: number
    totalTargets: number
    coverage: number
  }
  statusCounts: Record<PetActionMapStatus, number>
  missingSlots: {
    expressions: PetExpressionSlot[]
    gestures: PublicGestureName[]
    lifecycleMotions: PetLifecycleMotionSlot[]
    presenceStates: PetPresenceStateSlot[]
    idleFidgets: string[]
  }
  checks: PublicPetActionMapEvidenceCheck[]
  privacy: {
    privateFieldsOmitted: string[]
  }
}

function statusForTarget(target: string | null, isSprite: boolean): PetActionMapStatus {
  if (isSprite) return 'sprite'
  return target ? 'mapped' : 'missing'
}

function statusForPresenceState(
  expression: string | null,
  motionGroup: string | null,
  isSprite: boolean,
): PetActionMapStatus {
  if (isSprite) return 'sprite'
  return expression && motionGroup ? 'mapped' : 'missing'
}

function expressionFor(model: PetModelDefinition, slot: PetExpressionSlot): string | null {
  return model.expressionMap[slot] ?? null
}

function motionFor(model: PetModelDefinition, slot: PetExpressionSlot): string | null {
  if (slot === 'idle') return model.motionGroups.idle ?? null
  return model.motionGroups.gestures?.[slot] ?? null
}

function presenceMotionFor(
  model: PetModelDefinition,
  target: PetPresenceStateMotionTarget,
): string | null {
  if (target.kind === 'gesture') return model.motionGroups.gestures?.[target.gesture] ?? null
  return model.motionGroups[target.slot] ?? null
}

function normalizePresenceState(
  model: PetModelDefinition,
  definition: PetPresenceStateDefinition,
  isSprite: boolean,
): PetActionMapPresenceState {
  const expression = expressionFor(model, definition.expressionSlot)
  const motionGroup = presenceMotionFor(model, definition.motionTarget)

  return {
    state: definition.state,
    expressionSlot: definition.expressionSlot,
    expression,
    motionTarget: definition.motionTarget,
    motionGroup,
    status: statusForPresenceState(expression, motionGroup, isSprite),
  }
}

function normalizeFidget(model: PetModelDefinition, fidget: IdleFidgetDefinition, isSprite: boolean): PetActionMapIdleFidget {
  const expressionSlot = fidget.expressionSlot ?? 'idle'
  const motionSlot = fidget.motionSlot ?? null
  const expression = expressionFor(model, expressionSlot)
  const motionGroup = motionSlot ? motionFor(model, motionSlot) : null
  const status = isSprite
    ? 'sprite'
    : expression || motionGroup
      ? 'mapped'
      : 'missing'

  return {
    id: fidget.id,
    expressionSlot,
    expression,
    motionSlot,
    motionGroup,
    durationMs: fidget.durationMs ?? 800,
    stageDirection: fidget.stageDirection ?? null,
    weight: fidget.weight ?? 1,
    status,
  }
}

function normalizeDraftTarget(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeIso(value: unknown, fallbackIso = new Date().toISOString()): string {
  if (typeof value !== 'string' && typeof value !== 'number') return fallbackIso
  const parsed = typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isFinite(parsed)) return fallbackIso
  return new Date(parsed).toISOString()
}

function roundRatio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0
  return Math.round((numerator / denominator) * 1000) / 1000
}

function normalizeStoredTarget(value: unknown) {
  if (typeof value !== 'string') return null
  return value.trim().slice(0, 120)
}

function hasOwnValue<TObject extends object, TKey extends PropertyKey>(
  value: TObject,
  key: TKey,
): value is TObject & Record<TKey, unknown> {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function buildDraftRecord<const TSlot extends string>(
  slots: readonly TSlot[],
  resolveDefault: (slot: TSlot) => string | null,
  overrides: Partial<Record<TSlot, string>> | undefined,
): Record<TSlot, string> {
  return slots.reduce((draft, slot) => {
    draft[slot] = normalizeDraftTarget(overrides?.[slot] ?? resolveDefault(slot))
    return draft
  }, {} as Record<TSlot, string>)
}

export function buildPetActionMapDraft(
  model: PetModelDefinition,
  patch: PetActionMapDraftPatch = {},
): PetActionMapDraft {
  const report = buildPetActionMapReport(model)

  return {
    schema: 'nexus.pet-action-map-draft.v1',
    model: report.model,
    note: 'Editable draft. Applying it saves a settings override; the running avatar changes after the settings draft is saved.',
    expressions: buildDraftRecord(
      PET_EXPRESSION_SLOTS,
      (slot) => expressionFor(model, slot),
      patch.expressions,
    ),
    gestures: buildDraftRecord(
      PUBLIC_GESTURE_NAMES,
      (gesture) => model.motionGroups.gestures?.[gesture] ?? null,
      patch.gestures,
    ),
    lifecycleMotions: buildDraftRecord(
      PET_LIFECYCLE_MOTION_SLOTS,
      (slot) => model.motionGroups[slot] ?? null,
      patch.lifecycleMotions,
    ),
  }
}

function normalizeSlotPatch<const TSlot extends string>(
  input: unknown,
  slots: readonly TSlot[],
): Partial<Record<TSlot, string>> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const source = input as Record<string, unknown>
  const patch: Partial<Record<TSlot, string>> = {}

  for (const slot of slots) {
    if (!hasOwnValue(source, slot)) continue
    const target = normalizeStoredTarget(source[slot])
    if (target === null) continue
    patch[slot] = target
  }

  return Object.keys(patch).length ? patch : undefined
}

export function normalizePetActionMapDraftPatch(input: unknown): PetActionMapDraftPatch | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const source = input as Record<string, unknown>
  const patch: PetActionMapDraftPatch = {}

  const expressions = normalizeSlotPatch(source.expressions, PET_EXPRESSION_SLOTS)
  if (expressions) patch.expressions = expressions

  const gestures = normalizeSlotPatch(source.gestures, PUBLIC_GESTURE_NAMES)
  if (gestures) patch.gestures = gestures

  const lifecycleMotions = normalizeSlotPatch(source.lifecycleMotions, PET_LIFECYCLE_MOTION_SLOTS)
  if (lifecycleMotions) patch.lifecycleMotions = lifecycleMotions

  return Object.keys(patch).length ? patch : undefined
}

export function normalizePetActionMapOverrideStore(input: unknown): PetActionMapOverrideStore {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const store: PetActionMapOverrideStore = {}

  for (const [modelId, rawPatch] of Object.entries(input as Record<string, unknown>)) {
    const normalizedModelId = modelId.trim().slice(0, 128)
    if (!normalizedModelId) continue
    const patch = normalizePetActionMapDraftPatch(rawPatch)
    if (patch) store[normalizedModelId] = patch
  }

  return store
}

export function buildPetActionMapDraftPatch(draft: PetActionMapDraft): PetActionMapDraftPatch {
  return normalizePetActionMapDraftPatch({
    expressions: draft.expressions,
    gestures: draft.gestures,
    lifecycleMotions: draft.lifecycleMotions,
  }) ?? {}
}

export function applyPetActionMapOverride(
  model: PetModelDefinition,
  patch: PetActionMapDraftPatch | undefined,
): PetModelDefinition {
  const normalizedPatch = normalizePetActionMapDraftPatch(patch)
  if (!normalizedPatch) return model

  const expressionMap = { ...model.expressionMap }
  for (const slot of PET_EXPRESSION_SLOTS) {
    if (!normalizedPatch.expressions || !hasOwnValue(normalizedPatch.expressions, slot)) continue
    const target = normalizeDraftTarget(normalizedPatch.expressions[slot])
    if (target) {
      expressionMap[slot] = target
    } else {
      delete expressionMap[slot]
    }
  }

  const gestures = { ...(model.motionGroups.gestures ?? {}) }
  for (const gesture of PUBLIC_GESTURE_NAMES) {
    if (!normalizedPatch.gestures || !hasOwnValue(normalizedPatch.gestures, gesture)) continue
    const target = normalizeDraftTarget(normalizedPatch.gestures[gesture])
    if (target) {
      gestures[gesture] = target
    } else {
      delete gestures[gesture]
    }
  }

  const motionGroups = {
    ...model.motionGroups,
    gestures,
  }
  for (const slot of PET_LIFECYCLE_MOTION_SLOTS) {
    if (!normalizedPatch.lifecycleMotions || !hasOwnValue(normalizedPatch.lifecycleMotions, slot)) continue
    const target = normalizeDraftTarget(normalizedPatch.lifecycleMotions[slot])
    if (target) {
      motionGroups[slot] = target
    } else {
      delete motionGroups[slot]
    }
  }

  return {
    ...model,
    expressionMap,
    motionGroups,
  }
}

export function buildPetActionMapReport(model: PetModelDefinition): PetActionMapReport {
  const isSprite = Boolean(model.spriteAtlas)
  const expressions = PET_EXPRESSION_SLOTS.map((slot): PetActionMapExpression => {
    const expression = expressionFor(model, slot)
    return {
      slot,
      expression,
      status: statusForTarget(expression, isSprite),
    }
  })
  const gestures = PUBLIC_GESTURE_NAMES.map((gesture): PetActionMapGesture => {
    const motionGroup = model.motionGroups.gestures?.[gesture] ?? null
    return {
      gesture,
      motionGroup,
      status: statusForTarget(motionGroup, isSprite),
    }
  })
  const lifecycleMotions = LIFECYCLE_MOTION_SLOTS.map((slot): PetActionMapLifecycleMotion => {
    const motionGroup = model.motionGroups[slot] ?? null
    return {
      slot,
      motionGroup,
      status: statusForTarget(motionGroup, isSprite),
    }
  })
  const idleFidgets = (model.idleFidgets ?? []).map((fidget) => normalizeFidget(model, fidget, isSprite))
  const presenceStates = PET_PRESENCE_STATE_DEFINITIONS.map((definition) => (
    normalizePresenceState(model, definition, isSprite)
  ))
  const mappedExpressions = expressions.filter((entry) => entry.status !== 'missing').length
  const mappedGestures = gestures.filter((entry) => entry.status !== 'missing').length
  const mappedLifecycleMotions = lifecycleMotions.filter((entry) => entry.status !== 'missing').length
  const mappedPresenceStates = presenceStates.filter((entry) => entry.status !== 'missing').length
  const missing = [
    ...expressions,
    ...gestures,
    ...lifecycleMotions,
    ...presenceStates,
    ...idleFidgets,
  ].filter((entry) => entry.status === 'missing').length

  return {
    schema: 'nexus.pet-action-map.v1',
    model: {
      id: model.id,
      label: model.label,
      kind: isSprite ? 'sprite' : 'live2d',
    },
    summary: {
      expressionSlots: expressions.length,
      mappedExpressions,
      publicGestures: gestures.length,
      mappedGestures,
      lifecycleMotions: lifecycleMotions.length,
      mappedLifecycleMotions,
      presenceStates: presenceStates.length,
      mappedPresenceStates,
      idleFidgets: idleFidgets.length,
      missing,
    },
    expressions,
    gestures,
    lifecycleMotions,
    presenceStates,
    idleFidgets,
  }
}

export function buildPublicPetActionMapEvidenceReport(
  model: PetModelDefinition,
  generatedAt = new Date().toISOString(),
): PublicPetActionMapEvidenceReport {
  const report = buildPetActionMapReport(model)
  const allStatuses = [
    ...report.expressions.map((entry) => entry.status),
    ...report.gestures.map((entry) => entry.status),
    ...report.lifecycleMotions.map((entry) => entry.status),
    ...report.presenceStates.map((entry) => entry.status),
    ...report.idleFidgets.map((entry) => entry.status),
  ]
  const statusCounts = allStatuses.reduce((counts, status) => {
    counts[status] += 1
    return counts
  }, { mapped: 0, missing: 0, sprite: 0 } as Record<PetActionMapStatus, number>)
  const mappedTargets = statusCounts.mapped + statusCounts.sprite
  const totalTargets = allStatuses.length
  const missingSlots = {
    expressions: report.expressions
      .filter((entry) => entry.status === 'missing')
      .map((entry) => entry.slot),
    gestures: report.gestures
      .filter((entry) => entry.status === 'missing')
      .map((entry) => entry.gesture),
    lifecycleMotions: report.lifecycleMotions
      .filter((entry) => entry.status === 'missing')
      .map((entry) => entry.slot),
    presenceStates: report.presenceStates
      .filter((entry) => entry.status === 'missing')
      .map((entry) => entry.state),
    idleFidgets: report.idleFidgets
      .filter((entry) => entry.status === 'missing')
      .map((entry) => entry.id),
  }
  const checks: PublicPetActionMapEvidenceCheck[] = [
    {
      id: 'model-available',
      pass: Boolean(report.model.id),
      detail: report.model.id ? `model ${report.model.id} loaded` : 'model id is missing',
    },
    {
      id: 'expressions-covered',
      pass: report.summary.mappedExpressions === report.summary.expressionSlots,
      detail: `${report.summary.mappedExpressions}/${report.summary.expressionSlots} expression slot(s) mapped`,
    },
    {
      id: 'gestures-covered',
      pass: report.summary.mappedGestures === report.summary.publicGestures,
      detail: `${report.summary.mappedGestures}/${report.summary.publicGestures} public gesture(s) mapped`,
    },
    {
      id: 'lifecycle-covered',
      pass: report.summary.mappedLifecycleMotions === report.summary.lifecycleMotions,
      detail: `${report.summary.mappedLifecycleMotions}/${report.summary.lifecycleMotions} lifecycle motion(s) mapped`,
    },
    {
      id: 'presence-states-covered',
      pass: report.summary.mappedPresenceStates === report.summary.presenceStates,
      detail: `${report.summary.mappedPresenceStates}/${report.summary.presenceStates} companion presence state(s) mapped`,
    },
    {
      id: 'no-missing-live2d-targets',
      pass: report.summary.missing === 0,
      detail: `${report.summary.missing} missing target(s)`,
    },
  ]

  return {
    schemaVersion: 1,
    gate: 'live2d-action-map-coverage',
    generatedAt: normalizeIso(generatedAt),
    ok: checks.every((check) => check.pass),
    model: {
      id: report.model.id,
      kind: report.model.kind,
    },
    summary: {
      ...report.summary,
      mappedTargets,
      totalTargets,
      coverage: roundRatio(mappedTargets, totalTargets),
    },
    statusCounts,
    missingSlots,
    checks,
    privacy: {
      privateFieldsOmitted: [
        'model.label',
        'expressions.expression',
        'gestures.motionGroup',
        'lifecycleMotions.motionGroup',
        'presenceStates.expression',
        'presenceStates.motionGroup',
        'idleFidgets.expression',
        'idleFidgets.motionGroup',
        'idleFidgets.stageDirection',
      ],
    },
  }
}
