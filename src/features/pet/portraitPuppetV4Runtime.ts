/**
 * Pure runtime for layered Portrait Puppet v4 parameter rigs.
 * It interpolates authored keyforms, resolves parent transforms, and advances
 * delayed spring groups without owning DOM, image, or React lifecycles.
 */

import type {
  PortraitPuppetV4Binding,
  PortraitPuppetV4Keyform,
  PortraitPuppetV4Manifest,
  PortraitPuppetV4Part,
  PortraitPuppetV4PhysicsGroup,
  PortraitPuppetV4Point,
} from '../../../shared/portraitPuppetV4Contract.js'
import { clamp } from '../../lib/common.ts'

export type PortraitPuppetV4ParameterValues = Record<string, number>

export type PortraitPuppetV4MotionInput = {
  headYaw?: number
  headPitch?: number
  headTilt?: number
  eyeX?: number
  eyeY?: number
  eyeBallForm?: number
  blinkLeft?: number
  blinkRight?: number
  eyeSmileLeft?: number
  eyeSmileRight?: number
  eyeFormLeft?: number
  eyeFormRight?: number
  mouthOpen?: number
  mouthForm?: number
  mouthRound?: number
  mouthNarrow?: number
  mouthDown?: number
  browForm?: number
  browLeftY?: number
  browRightY?: number
  browLeftX?: number
  browRightX?: number
  browLeftAngle?: number
  browRightAngle?: number
  browLeftForm?: number
  browRightForm?: number
  cheek?: number
  bodyYaw?: number
  bodyPitch?: number
  bodyTilt?: number
  breath?: number
  armSway?: number
  hairSway?: number
  clothSway?: number
  accessorySway?: number
  parameters?: PortraitPuppetV4ParameterValues
}

type PortraitPuppetV4PhysicsState = {
  position: number
  velocity: number
  elapsedMs: number
  samples: Array<{ timeMs: number; value: number }>
}

export type PortraitPuppetV4Runtime = {
  manifest: PortraitPuppetV4Manifest
  parameters: PortraitPuppetV4ParameterValues
  physics: Map<string, PortraitPuppetV4PhysicsState>
  elapsedMs: number
}

export type PortraitPuppetV4ResolvedPart = {
  part: PortraitPuppetV4Part
  matrix: PortraitPuppetV4Matrix
  opacity: number
  vertexOffsets: PortraitPuppetV4Point[]
}

export type PortraitPuppetV4Matrix = readonly [number, number, number, number, number, number]

const IDENTITY_MATRIX: PortraitPuppetV4Matrix = [1, 0, 0, 1, 0, 0]

function multiplyMatrix(
  left: PortraitPuppetV4Matrix,
  right: PortraitPuppetV4Matrix,
): PortraitPuppetV4Matrix {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ]
}

function transformMatrix(
  pivot: PortraitPuppetV4Point,
  translate: PortraitPuppetV4Point,
  rotateDeg: number,
  scale: PortraitPuppetV4Point,
  canvas: PortraitPuppetV4Manifest['canvas'],
): PortraitPuppetV4Matrix {
  const radians = rotateDeg * Math.PI / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  // Normalized coordinates need D^-1 R S D (D = canvas pixel dimensions)
  // so a rigid rotation preserves lengths on a rectangular portrait canvas.
  const aroundOrigin: PortraitPuppetV4Matrix = [
    cosine * scale[0],
    sine * scale[0] * canvas.width / canvas.height,
    -sine * scale[1] * canvas.height / canvas.width,
    cosine * scale[1],
    0,
    0,
  ]
  return multiplyMatrix(
    [1, 0, 0, 1, pivot[0] + translate[0], pivot[1] + translate[1]],
    multiplyMatrix(aroundOrigin, [1, 0, 0, 1, -pivot[0], -pivot[1]]),
  )
}

function mix(left: number, right: number, amount: number) {
  return left + (right - left) * amount
}

function mixPoint(
  left: PortraitPuppetV4Point,
  right: PortraitPuppetV4Point,
  amount: number,
): PortraitPuppetV4Point {
  return [mix(left[0], right[0], amount), mix(left[1], right[1], amount)]
}

function keyformPair(keyforms: PortraitPuppetV4Keyform[], value: number) {
  if (value <= keyforms[0].value) return { left: keyforms[0], right: keyforms[0], amount: 0 }
  const final = keyforms[keyforms.length - 1]
  if (value >= final.value) return { left: final, right: final, amount: 0 }
  for (let index = 0; index < keyforms.length - 1; index += 1) {
    const left = keyforms[index]
    const right = keyforms[index + 1]
    if (value > right.value) continue
    const span = Math.max(0.000_001, right.value - left.value)
    return { left, right, amount: clamp((value - left.value) / span, 0, 1) }
  }
  return { left: final, right: final, amount: 0 }
}

function zeroOffsets(count: number): PortraitPuppetV4Point[] {
  return Array.from({ length: count }, () => [0, 0])
}

function parameterTargetMap(
  input: PortraitPuppetV4MotionInput,
): PortraitPuppetV4ParameterValues {
  return {
    ParamAngleX: input.headYaw ?? 0,
    ParamAngleY: input.headPitch ?? 0,
    ParamAngleZ: input.headTilt ?? 0,
    ParamEyeBallX: input.eyeX ?? 0,
    ParamEyeBallY: input.eyeY ?? 0,
    ParamEyeBallForm: clamp(input.eyeBallForm ?? 0, 0, 1),
    ParamEyeLOpen: 1 - clamp(input.blinkLeft ?? 0, 0, 1),
    ParamEyeROpen: 1 - clamp(input.blinkRight ?? input.blinkLeft ?? 0, 0, 1),
    ParamEyeLSmile: clamp(input.eyeSmileLeft ?? 0, 0, 1),
    ParamEyeRSmile: clamp(input.eyeSmileRight ?? input.eyeSmileLeft ?? 0, 0, 1),
    ParamEyeLForm: input.eyeFormLeft ?? 0,
    ParamEyeRForm: input.eyeFormRight ?? input.eyeFormLeft ?? 0,
    ParamMouthOpenY: input.mouthOpen ?? 0,
    ParamMouthForm: input.mouthForm ?? 0,
    ParamMouthRound: input.mouthRound ?? 0,
    ParamMouthNarrow: input.mouthNarrow ?? 0,
    ParamMouthDown: clamp(input.mouthDown ?? 0, 0, 1),
    ParamBrowForm: input.browForm ?? 0,
    ParamBrowLY: input.browLeftY ?? 0,
    ParamBrowRY: input.browRightY ?? input.browLeftY ?? 0,
    ParamBrowLX: input.browLeftX ?? 0,
    ParamBrowRX: input.browRightX ?? input.browLeftX ?? 0,
    ParamBrowLAngle: input.browLeftAngle ?? 0,
    ParamBrowRAngle: input.browRightAngle ?? input.browLeftAngle ?? 0,
    ParamBrowLForm: input.browLeftForm ?? input.browForm ?? 0,
    ParamBrowRForm: input.browRightForm ?? input.browForm ?? 0,
    ParamCheek: input.cheek ?? 0,
    ParamBodyAngleX: input.bodyYaw ?? 0,
    ParamBodyAngleY: input.bodyPitch ?? 0,
    ParamBodyAngleZ: input.bodyTilt ?? 0,
    ParamBreath: input.breath ?? 0,
    ParamArmSway: input.armSway ?? 0,
    ParamHairSway: input.hairSway ?? 0,
    ParamClothSway: input.clothSway ?? 0,
    ParamAccessorySway: input.accessorySway ?? 0,
    ...(input.parameters ?? {}),
  }
}

function delayedPhysicsInput(
  state: PortraitPuppetV4PhysicsState,
  group: PortraitPuppetV4PhysicsGroup,
  currentValue: number,
) {
  state.samples.push({ timeMs: state.elapsedMs, value: currentValue })
  const cutoff = state.elapsedMs - group.delayMs
  let delayed = state.samples[0]?.value ?? currentValue
  for (const sample of state.samples) {
    if (sample.timeMs > cutoff) break
    delayed = sample.value
  }
  const keepFrom = state.elapsedMs - Math.max(1_000, group.delayMs + 250)
  while (state.samples.length > 2 && state.samples[1].timeMs < keepFrom) {
    state.samples.shift()
  }
  return delayed
}

function stepSpring(
  state: PortraitPuppetV4PhysicsState,
  group: PortraitPuppetV4PhysicsGroup,
  target: number,
  deltaSeconds: number,
) {
  const stepCount = Math.max(1, Math.ceil(deltaSeconds / (1 / 120)))
  const stepSeconds = deltaSeconds / stepCount
  for (let index = 0; index < stepCount; index += 1) {
    const acceleration = (
      (target - state.position) * group.stiffness
      - state.velocity * group.damping
    ) / group.mass
    state.velocity += acceleration * stepSeconds
    state.position = clamp(
      state.position + state.velocity * stepSeconds,
      group.min,
      group.max,
    )
    if (
      (state.position === group.min && state.velocity < 0)
      || (state.position === group.max && state.velocity > 0)
    ) {
      state.velocity = 0
    }
  }
}

/** Build a runtime with parameter defaults and rested physics state. */
export function createPortraitPuppetV4Runtime(
  manifest: PortraitPuppetV4Manifest,
): PortraitPuppetV4Runtime {
  const parameters = Object.fromEntries(
    manifest.parameters.map((parameter) => [parameter.id, parameter.defaultValue]),
  )
  const physics = new Map<string, PortraitPuppetV4PhysicsState>()
  for (const group of manifest.physics) {
    const initial = parameters[group.output] ?? 0
    physics.set(group.id, {
      position: initial,
      velocity: 0,
      elapsedMs: 0,
      samples: [{ timeMs: 0, value: parameters[group.input] ?? 0 }],
    })
  }
  return { manifest, parameters, physics, elapsedMs: 0 }
}

/**
 * Advance target parameters and delayed spring outputs using a bounded,
 * frame-rate-independent integration step.
 */
export function stepPortraitPuppetV4Runtime(
  runtime: PortraitPuppetV4Runtime,
  input: PortraitPuppetV4MotionInput,
  deltaMs: number,
) {
  const safeDeltaMs = clamp(Number.isFinite(deltaMs) ? deltaMs : 16, 0, 100)
  runtime.elapsedMs += safeDeltaMs
  const targetMap = parameterTargetMap(input)
  const physicsOutputs = new Set(runtime.manifest.physics.map((group) => group.output))
  const smoothing = safeDeltaMs <= 0 ? 0 : 1 - Math.exp(-safeDeltaMs / 72)

  for (const parameter of runtime.manifest.parameters) {
    if (physicsOutputs.has(parameter.id)) continue
    const current = runtime.parameters[parameter.id] ?? parameter.defaultValue
    const target = clamp(targetMap[parameter.id] ?? parameter.defaultValue, parameter.min, parameter.max)
    const immediate = parameter.id === 'ParamEyeLOpen' || parameter.id === 'ParamEyeROpen'
    runtime.parameters[parameter.id] = immediate ? target : mix(current, target, smoothing)
  }

  for (const group of runtime.manifest.physics) {
    const state = runtime.physics.get(group.id)
    if (!state) continue
    state.elapsedMs = runtime.elapsedMs
    const inputValue = runtime.parameters[group.input] ?? targetMap[group.input] ?? 0
    const delayed = delayedPhysicsInput(state, group, inputValue) * group.scale
    stepSpring(state, group, delayed, safeDeltaMs / 1_000)
    runtime.parameters[group.output] = state.position
  }
  return runtime.parameters
}

/** Interpolate one authored binding, including optional per-vertex offsets. */
export function resolvePortraitPuppetV4Binding(
  binding: PortraitPuppetV4Binding,
  parameterValue: number,
  vertexCount: number,
) {
  if (!binding.keyforms.length) {
    return {
      translate: [0, 0] as PortraitPuppetV4Point,
      rotateDeg: 0,
      scale: [1, 1] as PortraitPuppetV4Point,
      opacity: 1,
      vertexOffsets: zeroOffsets(vertexCount),
    }
  }
  const { left, right, amount } = keyformPair(binding.keyforms, parameterValue)
  const leftOffsets = left.vertexOffsets?.length === vertexCount
    ? left.vertexOffsets
    : zeroOffsets(vertexCount)
  const rightOffsets = right.vertexOffsets?.length === vertexCount
    ? right.vertexOffsets
    : zeroOffsets(vertexCount)
  return {
    translate: mixPoint(left.translate, right.translate, amount),
    rotateDeg: mix(left.rotateDeg, right.rotateDeg, amount),
    scale: mixPoint(left.scale, right.scale, amount),
    opacity: mix(left.opacity, right.opacity, amount),
    vertexOffsets: leftOffsets.map((offset, index) => mixPoint(
      offset,
      rightOffsets[index],
      amount,
    )),
  }
}

/** Resolve normalized bindings and mesh offsets, measuring rotation in canvas pixels. */
export function resolvePortraitPuppetV4PartLocalState(
  part: PortraitPuppetV4Part,
  parameters: PortraitPuppetV4ParameterValues,
  canvas: PortraitPuppetV4Manifest['canvas'],
) {
  const vertexCount = (part.mesh.columns + 1) * (part.mesh.rows + 1)
  const vertexOffsets = zeroOffsets(vertexCount)
  let translate: PortraitPuppetV4Point = [0, 0]
  let rotateDeg = 0
  let scale: PortraitPuppetV4Point = [1, 1]
  let opacity = part.opacity

  for (const binding of part.bindings) {
    const resolved = resolvePortraitPuppetV4Binding(
      binding,
      parameters[binding.parameter] ?? 0,
      vertexCount,
    )
    translate = [translate[0] + resolved.translate[0], translate[1] + resolved.translate[1]]
    rotateDeg += resolved.rotateDeg
    scale = [scale[0] * resolved.scale[0], scale[1] * resolved.scale[1]]
    opacity *= resolved.opacity
    resolved.vertexOffsets.forEach((offset, index) => {
      vertexOffsets[index][0] += offset[0]
      vertexOffsets[index][1] += offset[1]
    })
  }
  return {
    matrix: transformMatrix(part.pivot, translate, rotateDeg, scale, canvas),
    opacity: clamp(opacity, 0, 1),
    vertexOffsets,
  }
}

/** Resolve parent transforms and return stable z-ordered render parts. */
export function resolvePortraitPuppetV4Parts(
  manifest: PortraitPuppetV4Manifest,
  parameters: PortraitPuppetV4ParameterValues,
): PortraitPuppetV4ResolvedPart[] {
  const byId = new Map(manifest.parts.map((part) => [part.id, part]))
  const localById = new Map(
    manifest.parts.map((part) => [part.id, resolvePortraitPuppetV4PartLocalState(part, parameters, manifest.canvas)]),
  )
  const worldById = new Map<string, PortraitPuppetV4Matrix>()
  const resolving = new Set<string>()

  const resolveWorld = (part: PortraitPuppetV4Part): PortraitPuppetV4Matrix => {
    const existing = worldById.get(part.id)
    if (existing) return existing
    if (resolving.has(part.id)) return IDENTITY_MATRIX
    resolving.add(part.id)
    const local = localById.get(part.id)?.matrix ?? IDENTITY_MATRIX
    const parent = part.parentId ? byId.get(part.parentId) : undefined
    const world = parent ? multiplyMatrix(resolveWorld(parent), local) : local
    resolving.delete(part.id)
    worldById.set(part.id, world)
    return world
  }

  return manifest.parts
    .map((part) => {
      const local = localById.get(part.id)
      return {
        part,
        matrix: resolveWorld(part),
        opacity: local?.opacity ?? part.opacity,
        vertexOffsets: local?.vertexOffsets ?? [],
      }
    })
    .sort((left, right) => left.part.zIndex - right.part.zIndex)
}

/** Apply a normalized affine matrix to one point. */
export function applyPortraitPuppetV4Matrix(
  matrix: PortraitPuppetV4Matrix,
  point: PortraitPuppetV4Point,
): PortraitPuppetV4Point {
  return [
    matrix[0] * point[0] + matrix[2] * point[1] + matrix[4],
    matrix[1] * point[0] + matrix[3] * point[1] + matrix[5],
  ]
}
