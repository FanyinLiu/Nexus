/**
 * Portrait puppet motion planning and mesh deformation.
 *
 * One image is split by motion weights: grounded feet, bending torso,
 * independent head, local face deformation, and delayed edge motion.
 */

import type { PetMood, PetTouchZone } from '../../types/index.ts'
import type { PetExpressionSlot, PetPerformanceCue } from './types.ts'
import { clamp } from '../../lib/common.ts'
import { planPortraitPuppetAction } from './portraitPuppetActions.ts'
import {
  normalizePortraitPuppetRig,
  type PortraitPuppetLayerKey,
  type PortraitPuppetRigDefinition,
} from '../../../shared/portraitPuppetContract.js'
import type { PortraitPuppetV4Manifest } from '../../../shared/portraitPuppetV4Contract.js'

export type PortraitPuppetDefinition = {
  imagePath: string
  formatVersion?: number
  renderMode?: 'procedural-rig-v1' | 'layered-artmesh-v1'
  layeredRig?: PortraitPuppetV4Manifest
  layers?: Partial<Record<PortraitPuppetLayerKey, string>>
  rig?: Partial<PortraitPuppetRigDefinition>
}

export type PortraitPuppetPose = {
  expression: PetExpressionSlot
  blink: number
  mouth: number
  breath: number
  rootX: number
  rootY: number
  bodyLean: number
  headYaw: number
  headTilt: number
  headBob: number
  eyeX: number
  eyeY: number
  bodyBob: number
  armSway: number
  hairSway: number
  clothSway: number
  pendantSway: number
  secondarySway: number
  swayX: number
  swayY: number
  tilt: number
  squash: number
  scale: number
  eyeDrop: number
}

export type PortraitPuppetInput = {
  mood: PetMood
  isSpeaking?: boolean
  isListening?: boolean
  isBusy?: boolean
  speechLevel?: number
  gazeX?: number
  gazeY?: number
  touchZone?: PetTouchZone | null
  performanceCue?: PetPerformanceCue | null
  performanceElapsedMs?: number
  nowMs?: number
  prefersReducedMotion?: boolean
}

export type PortraitPuppetPoint = {
  x: number
  y: number
}

/** Deterministic local QA override, active only with `portraitDebug=1`. */
export function applyPortraitPuppetDebugPose(
  pose: PortraitPuppetPose,
  search: string,
): PortraitPuppetPose {
  const params = new URLSearchParams(search)
  if (params.get('portraitDebug') !== '1') return pose
  const read = (key: string, fallback: number, min: number, max: number) => {
    const value = Number(params.get(key))
    return Number.isFinite(value) ? clamp(value, min, max) : fallback
  }
  return {
    ...pose,
    blink: read('portraitBlink', pose.blink, 0, 1),
    mouth: read('portraitMouth', pose.mouth, 0, 1),
    headYaw: read('portraitHeadYaw', pose.headYaw, -1, 1),
    headTilt: read('portraitHeadTilt', pose.headTilt, -12, 12),
    eyeX: read('portraitEyeX', pose.eyeX, -1, 1),
    eyeY: read('portraitEyeY', pose.eyeY, -1, 1),
    rootX: read('portraitRootX', pose.rootX, -0.03, 0.03),
    rootY: read('portraitRootY', pose.rootY, -0.03, 0.03),
    bodyLean: read('portraitBodyLean', pose.bodyLean, -6, 6),
    breath: read('portraitBreath', pose.breath, -1, 1),
    headBob: read('portraitHeadBob', pose.headBob, -0.03, 0.03),
    bodyBob: read('portraitBodyBob', pose.bodyBob, -0.03, 0.03),
    armSway: read('portraitArmSway', pose.armSway, -1.5, 1.5),
    hairSway: read('portraitHairSway', pose.hairSway, -1.5, 1.5),
    clothSway: read('portraitClothSway', pose.clothSway, -1.5, 1.5),
    pendantSway: read('portraitPendantSway', pose.pendantSway, -1.5, 1.5),
    secondarySway: read('portraitSecondarySway', pose.secondarySway, -1.5, 1.5),
  }
}

/** Smoothly blend from 0 to 1 between two edges. */
export function portraitPuppetSmoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1
  const amount = clamp((value - edge0) / (edge1 - edge0), 0, 1)
  return amount * amount * (3 - 2 * amount)
}

/** Gaussian-shaped local influence with a normalized radius. */
export function portraitPuppetFalloff(value: number, center: number, radius: number): number {
  const safeRadius = Math.max(0.0001, Math.abs(radius))
  return Math.exp(-Math.pow((value - center) / safeRadius, 2))
}

/**
 * Resolve the local face translation used for a one-image turn.
 *
 * The result is deliberately translation-only: scale and shear stay exactly
 * at identity so a flat portrait never gets squeezed into a fake 3D turn.
 */
export function resolvePortraitPuppetRigidTurn(headYaw: number) {
  const amount = clamp(headYaw, -1, 1)
  return {
    // This is relative to the moving head patch. Together with
    // resolvePortraitPuppetRigidHeadFollow it keeps the same overall turn
    // distance while adding visible hair/head follow.
    faceOffsetX: amount * 0.016,
    faceOffsetY: 0,
    scaleX: 1,
    scaleY: 1,
    shearX: 0,
    shearY: 0,
  } as const
}

/**
 * Resolve the shape-preserving head/hair follow used by one-image puppets.
 *
 * Every value is normalized and independent of a particular portrait. The
 * renderer applies it around the locally inferred head anchor, so a different
 * image or aspect ratio reuses the same motion without hard-coded pixels.
 */
export function resolvePortraitPuppetRigidHeadFollow(
  headYaw: number,
  headTilt = 0,
  headBob = 0,
) {
  const yaw = clamp(headYaw, -1, 1)
  const tiltDegrees = clamp(headTilt, -7, 7)
  const bob = clamp(headBob, -0.018, 0.018)
  return {
    headOffsetX: yaw * 0.006,
    headOffsetY: bob * 0.38 + Math.abs(yaw) * 0.0006,
    rotationRadians: tiltDegrees * Math.PI / 180 * 0.72 + yaw * 0.008,
    scaleX: 1,
    scaleY: 1,
    shearX: 0,
    shearY: 0,
  } as const
}

/** Resolve the expression slot shared by portrait, sprite, and Live2D pets. */
export function resolvePortraitPuppetExpression(input: PortraitPuppetInput): PetExpressionSlot {
  if (input.performanceCue?.expressionSlot) return input.performanceCue.expressionSlot
  if (input.isSpeaking) return 'speaking'
  if (input.isListening) return 'listening'
  switch (input.touchZone) {
    case 'head':
      return 'touchHead'
    case 'face':
      return 'touchFace'
    case 'body':
      return 'touchBody'
    default:
      break
  }
  if (input.isBusy) return 'thinking'

  switch (input.mood) {
    case 'thinking':
    case 'curious':
      return 'thinking'
    case 'happy':
    case 'excited':
    case 'proud':
    case 'playful':
      return 'happy'
    case 'sleepy':
      return 'sleepy'
    case 'surprised':
      return 'surprised'
    case 'confused':
      return 'confused'
    case 'embarrassed':
    case 'affectionate':
      return 'embarrassed'
    default:
      return 'idle'
  }
}

function portraitPuppetHash(value: number) {
  const hashed = Math.sin(value * 12.9898 + 78.233) * 43_758.5453
  return hashed - Math.floor(hashed)
}

/** Random-looking close-hold-open blink curve with occasional double blinks. */
export function planPortraitPuppetBlink(nowMs: number): number {
  const amountAt = (elapsed: number) => {
    if (elapsed < 0 || elapsed >= 270) return 0
    if (elapsed < 80) return portraitPuppetSmoothstep(0, 80, elapsed)
    if (elapsed < 120) return 1
    return 1 - portraitPuppetSmoothstep(120, 270, elapsed)
  }

  const blockDuration = 12_000
  const currentBlock = Math.floor(nowMs / blockDuration)
  let amount = 0
  for (let block = currentBlock - 1; block <= currentBlock; block += 1) {
    const blockStart = block * blockDuration
    const offsets = [
      2_600 + portraitPuppetHash(block * 7 + 1) * 700,
      6_400 + portraitPuppetHash(block * 7 + 2) * 800,
      10_100 + portraitPuppetHash(block * 7 + 3) * 650,
    ]
    offsets.forEach((offset, index) => {
      const elapsed = nowMs - blockStart - offset
      amount = Math.max(amount, amountAt(elapsed))
      if (portraitPuppetHash(block * 11 + index + 40) < 0.17) {
        amount = Math.max(amount, amountAt(elapsed - 230))
      }
    })
  }
  return amount
}

/** Turn companion signals into independent head/body/face pose channels. */
export function planPortraitPuppetPose(input: PortraitPuppetInput): PortraitPuppetPose {
  const expression = resolvePortraitPuppetExpression(input)
  const nowMs = Number.isFinite(input.nowMs) ? Number(input.nowMs) : 0
  const speechInput = input.isSpeaking ? clamp(input.speechLevel ?? 0, 0, 1) : 0
  const fallbackSpeech = 0.16 + Math.pow(Math.sin(nowMs / 86), 2) * 0.52
  const speech = input.isSpeaking
    ? (speechInput > 0.015 ? Math.pow(speechInput, 0.68) : fallbackSpeech)
    : 0
  const gazeX = clamp(input.gazeX ?? 0, -1, 1)
  const gazeY = clamp(input.gazeY ?? 0, -1, 1)

  if (input.prefersReducedMotion) {
    const reducedTilt = expression === 'listening' ? -2.5 : 0
    return {
      expression,
      blink: expression === 'sleepy' ? 0.28 : 0,
      mouth: input.isSpeaking ? Math.max(0.12, speech) : 0,
      breath: 0,
      rootX: 0,
      rootY: 0,
      bodyLean: 0,
      headYaw: gazeX * 0.18,
      headTilt: reducedTilt,
      headBob: 0,
      eyeX: gazeX * 0.35,
      eyeY: gazeY * 0.25,
      bodyBob: 0,
      armSway: 0,
      hairSway: 0,
      clothSway: 0,
      pendantSway: 0,
      secondarySway: 0,
      swayX: 0,
      swayY: 0,
      tilt: reducedTilt,
      squash: 1,
      scale: 1,
      eyeDrop: expression === 'sleepy' ? 0.2 : 0,
    }
  }

  const seconds = nowMs / 1_000
  const breath = Math.sin(seconds * Math.PI * 2 / 3.35)
  const bodyDrift = Math.sin(seconds * Math.PI * 2 / 7.2 + 0.4)
  const headDrift = Math.sin(seconds * Math.PI * 2 / 5.6 - 0.8)
  const secondaryDrift = Math.sin(seconds * Math.PI * 2 / 4.7 + 1.1)
  const clothDrift = Math.sin(seconds * Math.PI * 2 / 6.4 - 1.6)
  const pendantDrift = Math.sin(seconds * Math.PI * 2 / 5.1 + 2.2)

  let bodyLean = bodyDrift * 0.52 + gazeX * 0.18
  let headYaw = gazeX * 0.62 + headDrift * 0.18
  let headTilt = gazeX * 1.35 + headDrift * 0.82
  let headBob = -breath * 0.0025 - gazeY * 0.005
  let eyeX = clamp(gazeX * 0.78 + headDrift * 0.08, -1, 1)
  let eyeY = clamp(gazeY * 0.72, -1, 1)
  const bodyBob = -breath * 0.0017
  const rootY = Math.max(0, -breath) * 0.0005
  let armSway = bodyDrift * 0.3 - breath * 0.1
  let mouth = speech
  let eyeDrop = 0
  let poseBreath = breath * 0.7

  switch (expression) {
    case 'thinking':
      headTilt -= 4.8
      headYaw -= 0.08
      headBob -= 0.004
      eyeDrop = 0.06
      eyeX -= 0.28
      eyeY += 0.35
      break
    case 'happy':
      headTilt += 1.4
      headBob -= 0.004
      poseBreath *= 1.15
      break
    case 'speaking':
      headTilt += Math.sin(seconds * 7.2) * speech * 1.15
      headBob -= speech * 0.006
      bodyLean += Math.sin(seconds * 4.2) * speech * 0.28
      break
    case 'embarrassed':
      headTilt += 5.8
      headYaw -= 0.12
      headBob += 0.003
      eyeDrop = 0.1
      eyeY -= 0.22
      break
    case 'sleepy':
      headTilt -= 2.2
      headBob += 0.008
      poseBreath *= 0.55
      eyeDrop = 0.42
      eyeY -= 0.12
      break
    case 'surprised':
      headBob -= 0.009
      bodyLean *= 0.45
      poseBreath *= 0.4
      eyeX *= 0.2
      eyeY *= 0.2
      break
    case 'confused':
      headTilt += 4.2
      headYaw += 0.1
      break
    case 'listening':
      bodyLean *= 0.48
      headTilt -= 4.1
      headYaw += gazeX * 0.12
      headBob -= 0.005 + Math.max(0, Math.sin(seconds * 2.25)) * 0.0018
      poseBreath *= 0.65
      mouth = 0
      eyeX = gazeX
      eyeY = gazeY
      break
    default:
      break
  }

  const action = planPortraitPuppetAction({
    nowMs,
    performanceCue: input.performanceCue,
    performanceElapsedMs: input.performanceElapsedMs,
    allowIdleAction: !input.isSpeaking && !input.isListening && !input.isBusy
      && expression === 'idle'
      && !input.performanceCue,
  })
  if (action.weight > 0) {
    const keep = 1 - action.weight * 0.45
    headYaw = clamp(headYaw * keep + action.headYaw, -1, 1)
    headTilt = clamp(headTilt + action.headTilt, -7, 7)
    headBob = clamp(headBob + action.headBob, -0.018, 0.018)
    bodyLean = clamp(bodyLean + action.bodyLean, -3.5, 3.5)
    armSway = clamp(armSway * keep + action.armSway, -1.5, 1.5)
    eyeX = clamp(eyeX * keep + action.eyeX, -1, 1)
    eyeY = clamp(eyeY + action.eyeY, -1, 1)
    eyeDrop = clamp(eyeDrop + action.eyeDrop, 0, 1)
    poseBreath = clamp(poseBreath + action.breath, -1, 1)
  }

  const blink = clamp(
    planPortraitPuppetBlink(nowMs) + (expression === 'sleepy' ? 0.22 : 0),
    0,
    1,
  )
  const rootX = bodyDrift * 0.0009

  return {
    expression,
    blink,
    mouth: clamp(mouth, 0, 1),
    breath: clamp(poseBreath, -1, 1),
    rootX,
    rootY,
    bodyLean: clamp(bodyLean, -3.5, 3.5),
    headYaw: clamp(headYaw, -1, 1),
    headTilt: clamp(headTilt, -7, 7),
    headBob: clamp(headBob, -0.018, 0.018),
    eyeX: clamp(eyeX, -1, 1),
    eyeY: clamp(eyeY, -1, 1),
    bodyBob,
    armSway: clamp(armSway, -1.5, 1.5),
    hairSway: clamp(secondaryDrift * 0.3 + headDrift * 0.08, -1, 1),
    clothSway: clamp(clothDrift * 0.34 + bodyDrift * 0.12, -1, 1),
    pendantSway: clamp(pendantDrift * 0.34 + bodyDrift * 0.08, -1, 1),
    secondarySway: clamp(secondaryDrift * 0.72 - bodyDrift * 0.34 + gazeX * 0.28, -1, 1),
    swayX: rootX * 160,
    swayY: rootY * 220,
    tilt: clamp(headTilt, -7, 7),
    squash: 1,
    scale: 1,
    eyeDrop,
  }
}

/** Dampen visual channels without tying the animation to frame rate. */
export function interpolatePortraitPuppetPose(
  previous: PortraitPuppetPose,
  target: PortraitPuppetPose,
  deltaMs: number,
): PortraitPuppetPose {
  const safeDelta = clamp(deltaMs, 0, 34)
  const fast = 1 - Math.exp(-safeDelta / 58)
  const medium = 1 - Math.exp(-safeDelta / 115)
  const slow = 1 - Math.exp(-safeDelta / 190)

  return {
    expression: target.expression,
    // The authored curve already eases close/open. Filtering it again removes
    // the short fully-closed hold and leaves the iris visibly half open.
    blink: target.blink,
    mouth: previous.mouth + (target.mouth - previous.mouth) * fast,
    breath: previous.breath + (target.breath - previous.breath) * medium,
    rootX: previous.rootX + (target.rootX - previous.rootX) * slow,
    rootY: previous.rootY + (target.rootY - previous.rootY) * medium,
    bodyLean: previous.bodyLean + (target.bodyLean - previous.bodyLean) * slow,
    headYaw: previous.headYaw + (target.headYaw - previous.headYaw) * medium,
    headTilt: previous.headTilt + (target.headTilt - previous.headTilt) * medium,
    headBob: previous.headBob + (target.headBob - previous.headBob) * fast,
    eyeX: previous.eyeX + (target.eyeX - previous.eyeX) * fast,
    eyeY: previous.eyeY + (target.eyeY - previous.eyeY) * fast,
    bodyBob: previous.bodyBob + (target.bodyBob - previous.bodyBob) * medium,
    armSway: previous.armSway + (target.armSway - previous.armSway) * slow,
    hairSway: previous.hairSway + (target.hairSway - previous.hairSway) * slow,
    clothSway: previous.clothSway + (target.clothSway - previous.clothSway) * slow,
    pendantSway: previous.pendantSway + (target.pendantSway - previous.pendantSway) * slow,
    secondarySway: previous.secondarySway + (target.secondarySway - previous.secondarySway) * slow,
    swayX: previous.swayX + (target.swayX - previous.swayX) * slow,
    swayY: previous.swayY + (target.swayY - previous.swayY) * medium,
    tilt: previous.tilt + (target.tilt - previous.tilt) * medium,
    squash: previous.squash + (target.squash - previous.squash) * medium,
    scale: previous.scale + (target.scale - previous.scale) * medium,
    eyeDrop: previous.eyeDrop + (target.eyeDrop - previous.eyeDrop) * medium,
  }
}

/** Map one normalized source vertex into its animated destination. */
export function deformPortraitPuppetPoint(
  point: PortraitPuppetPoint,
  pose: PortraitPuppetPose,
  rigInput?: Partial<PortraitPuppetRigDefinition>,
  aspectRatio = 0.75,
): PortraitPuppetPoint {
  const rig = normalizePortraitPuppetRig(rigInput)
  const intensity = rig.motionIntensity
  const groundedWeight = 1 - portraitPuppetSmoothstep(0.82, 1, point.y)
  const upperBodyWeight = 1 - portraitPuppetSmoothstep(
    rig.neckY,
    Math.min(0.94, rig.waistY + 0.32),
    point.y,
  )
  const bodyAngle = pose.bodyLean * Math.PI / 180 * intensity * upperBodyWeight
  const bodyPivotY = Math.min(0.96, rig.waistY + 0.34)
  const bodyX = (point.x - rig.headX) * aspectRatio
  const bodyY = point.y - bodyPivotY
  const bodyCos = Math.cos(bodyAngle)
  const bodySin = Math.sin(bodyAngle)
  const rotatedBodyX = bodyX * bodyCos - bodyY * bodySin
  const rotatedBodyY = bodyX * bodySin + bodyY * bodyCos
  let x = rig.headX + rotatedBodyX / aspectRatio
  let y = bodyPivotY + rotatedBodyY

  x += pose.rootX * groundedWeight * intensity
  y += (pose.rootY + pose.bodyBob) * groundedWeight * intensity

  const chestWeight = portraitPuppetFalloff(point.y, rig.chestY, 0.13)
    * (1 - portraitPuppetSmoothstep(rig.neckY - 0.04, rig.neckY + 0.05, point.y) * 0.35)
  x += (point.x - rig.headX) * pose.breath * 0.026 * chestWeight * intensity
  y -= pose.breath * 0.0035 * chestWeight * intensity

  const headBlend = 1 - portraitPuppetSmoothstep(rig.neckY - 0.035, rig.neckY + 0.055, point.y)
  const headEllipse = Math.min(1, Math.max(0, 1
    - Math.pow((point.x - rig.headX) / rig.headRadiusX, 2)
    - Math.pow((point.y - rig.headY) / rig.headRadiusY, 2)))
  const headWeight = Math.max(headBlend * 0.72, headEllipse) * intensity
  const headAngle = pose.headTilt * Math.PI / 180 * headWeight
  const headPivotY = rig.neckY
  const headLocalX = (x - rig.headX) * aspectRatio
  const headLocalY = y - headPivotY
  const headCos = Math.cos(headAngle)
  const headSin = Math.sin(headAngle)
  const rotatedHeadX = headLocalX * headCos - headLocalY * headSin
  const rotatedHeadY = headLocalX * headSin + headLocalY * headCos
  x = rig.headX + rotatedHeadX / aspectRatio
  y = headPivotY + rotatedHeadY

  const faceCenterY = (rig.eyeY + rig.mouthY) / 2
  const faceVertical = portraitPuppetFalloff(point.y, faceCenterY, rig.headRadiusY * 0.78)
  const faceInterior = faceVertical
    * portraitPuppetFalloff(point.x, rig.headX, rig.headRadiusX * 0.8)
    * headBlend
  // Yaw is intentionally absent from the source mesh. A single flat image has
  // no hidden cheek/hair pixels, so bending its triangles creates visible
  // rubber-sheet distortion. Procedural v3 renders yaw as a feathered rigid
  // face translation after this shape-preserving base pass.
  y += pose.headBob * headWeight

  const eyeBand = portraitPuppetFalloff(point.y, rig.eyeY + pose.eyeDrop * 0.012, rig.eyeRadiusY * 1.45)
  const leftEyeWeight = portraitPuppetFalloff(point.x, rig.eyeLeftX, rig.eyeRadiusX * 1.15)
    * eyeBand * headBlend
  const rightEyeWeight = portraitPuppetFalloff(point.x, rig.eyeRightX, rig.eyeRadiusX * 1.15)
    * eyeBand * headBlend
  const eyeWeight = Math.min(1, leftEyeWeight + rightEyeWeight)
  x += pose.eyeX * 0.0045 * eyeWeight * intensity
  y -= pose.eyeY * 0.0028 * eyeWeight * intensity
  y += (rig.eyeY - point.y) * pose.blink * 0.74 * eyeWeight * intensity

  const mouthWeight = portraitPuppetFalloff(point.y, rig.mouthY, 0.045)
    * portraitPuppetFalloff(point.x, rig.mouthX, rig.mouthRadiusX * 1.7)
    * headBlend
  y += Math.sign(point.y - rig.mouthY) * pose.mouth * 0.006 * mouthWeight * intensity
  x += (rig.mouthX - point.x) * pose.mouth * 0.018 * mouthWeight * intensity

  const edgeWeight = portraitPuppetSmoothstep(0.34, 0.92, Math.abs(point.x - rig.headX) / 0.5)
  const lowerClothWeight = portraitPuppetFalloff(
    point.y,
    Math.min(0.78, rig.waistY + 0.13),
    0.22,
  )
  const hairWeight = headBlend * (0.28 + edgeWeight * 0.72) * (1 - faceInterior * 0.48)
  const armVertical = portraitPuppetFalloff(
    point.y,
    (rig.neckY + rig.waistY + 0.12) / 2,
    0.2,
  )
  const sideSign = point.x < rig.headX ? -1 : 1
  const armWeight = portraitPuppetSmoothstep(0.16, 0.36, Math.abs(point.x - rig.headX))
    * armVertical * groundedWeight
  const clothWeight = lowerClothWeight
    * portraitPuppetSmoothstep(0.12, 0.3, Math.abs(point.x - rig.headX))
    * groundedWeight
  const pendantWeight = (
    portraitPuppetFalloff(Math.abs(point.x - rig.headX), 0.27, 0.085)
      * portraitPuppetFalloff(point.y, Math.min(0.82, rig.waistY + 0.2), 0.16)
    + portraitPuppetFalloff(point.x, rig.headX, 0.065)
      * portraitPuppetFalloff(point.y, rig.chestY + 0.13, 0.15) * 0.4
  ) * groundedWeight
  x += pose.hairSway * 0.009 * hairWeight * intensity
  y += Math.abs(pose.hairSway) * 0.0015 * hairWeight * intensity
  x += pose.armSway * 0.006 * sideSign * armWeight * intensity
  y += pose.armSway * 0.0018 * sideSign * armWeight * intensity
  x += pose.clothSway * 0.0075 * clothWeight * intensity
  y += Math.abs(pose.clothSway) * 0.0015 * clothWeight * intensity
  x += pose.pendantSway * 0.0045 * pendantWeight * intensity
  x += pose.secondarySway * 0.001 * (hairWeight + clothWeight * 0.45) * groundedWeight * intensity

  return { x, y }
}

/** Pick the authored whole-image layer for the current expression. */
export function resolvePortraitPuppetFaceImage(
  puppet: PortraitPuppetDefinition,
  expression: PetExpressionSlot,
) {
  const layers = puppet.layers ?? {}
  const expressionKey = expression as PortraitPuppetLayerKey
  return layers[expressionKey] || layers.idle || puppet.imagePath
}
