// Pure per-frame "compute and apply rig parameters" pipeline for the Live2D
// model.  This was the body of `bindModelRuntime`'s beforeModelUpdate handler
// in Live2DCanvas.tsx — extracted so the canvas component only has to wire up
// the refs and not carry the entire 250-line frame computation inline.
//
// `applyLive2DFrame` mutates `state` in place (smoothed gaze + speech level),
// reads from the supplied refs, and pushes the resulting values into the
// model's coreModel via addParameterValueById.

import type { PetExpressionSlot, PetModelDefinition } from '../../models.ts'
import type { PetPerformanceCue } from '../../performance.ts'
import {
  applyAccentStyle,
  resolvePerformanceAccentWindowMs,
} from './accentStyle.ts'
import { updateBlink, type BlinkState } from './blink.ts'
import { clamp } from '../../../../lib/common.ts'
import type {
  CubismCoreModel,
  GazeTarget,
  Live2DInternalModel,
} from './types.ts'

function addParameterValue(
  coreModel: CubismCoreModel | undefined,
  parameterId: string | undefined,
  value: number,
) {
  if (
    !coreModel?.addParameterValueById
    || !parameterId
    || !Number.isFinite(value)
    || Math.abs(value) < 0.0001
  ) {
    return
  }

  coreModel.addParameterValueById(parameterId, value)
}

export type FrameRenderState = {
  smoothedGaze: GazeTarget
  smoothedSpeechLevel: number
  blink: BlinkState
}

export type FrameRenderInputs = {
  modelDefinition: PetModelDefinition
  internalModel: Live2DInternalModel
  activeExpressionSlot: PetExpressionSlot
  gazeTarget: GazeTarget
  speechLevelTarget: number
  performanceCue: PetPerformanceCue | null
  performanceCueStartedAt: number
  state: FrameRenderState
}

export function applyLive2DFrame(inputs: FrameRenderInputs) {
  const {
    modelDefinition,
    internalModel,
    activeExpressionSlot,
    gazeTarget,
    speechLevelTarget,
    performanceCue,
    performanceCueStartedAt,
    state,
  } = inputs

  const coreModel = internalModel.coreModel
  const rigParams = modelDefinition.rigParams
  const openParam = modelDefinition.mouthParams?.open ?? 'ParamA'
  const roundParam = modelDefinition.mouthParams?.round
  const narrowParam = modelDefinition.mouthParams?.narrow
  const smileParam = modelDefinition.mouthParams?.smile
  const now = performance.now()
  const seconds = now / 1000

  const performanceCueElapsedMs = performanceCue
    ? Math.max(0, now - performanceCueStartedAt)
    : 0
  const performanceCueAccentStyle = performanceCue?.accentStyle
  const performanceCueAccentWindowMs = resolvePerformanceAccentWindowMs(performanceCue)
  const performanceCueAccent = performanceCue
    ? clamp(1 - performanceCueElapsedMs / performanceCueAccentWindowMs, 0, 1)
    : 0
  const performanceCuePulse = performanceCueAccent > 0
    ? Math.sin(performanceCueElapsedMs / 1000 * 12.5) * performanceCueAccent
    : 0

  // Smooth the gaze towards the latest target.  Thinking is the most
  // contemplative slot, so it gets a slower interpolation rate.
  const targetGazeX = clamp(gazeTarget.x, -1, 1)
  const targetGazeY = clamp(gazeTarget.y, -1, 1)
  const gazeInterpolation = activeExpressionSlot === 'thinking' ? 0.08 : 0.16
  state.smoothedGaze = {
    x: state.smoothedGaze.x + (targetGazeX - state.smoothedGaze.x) * gazeInterpolation,
    y: state.smoothedGaze.y + (targetGazeY - state.smoothedGaze.y) * gazeInterpolation,
  }

  let gazeX = state.smoothedGaze.x
  let gazeY = state.smoothedGaze.y
  let angleZ = Math.sin(seconds * 0.95) * 0.65
  let bodyAngleX = Math.sin(seconds * 0.82) * 0.55 + gazeX * 1.9
  const bodyAngleY = 0
  let smileLevel = 0
  let cheekLevel = 0
  let browFormLevel = 0
  let breathLevel = 0.22 + (Math.sin(seconds * 2.1) + 1) * 0.1

  // ── Base expression-slot rig overlays ────────────────────────────────
  switch (activeExpressionSlot) {
    case 'listening':
      angleZ += Math.sin(seconds * 3.4) * 0.9
      bodyAngleX += gazeX * 1.8
      smileLevel += 0.08
      breathLevel += 0.06
      break
    case 'thinking':
      gazeX *= 0.35
      gazeY = clamp(gazeY + 0.18, -1, 1)
      angleZ += Math.sin(seconds * 1.8) * 2.4
      bodyAngleX += Math.sin(seconds * 0.9) * 1.15
      browFormLevel -= 0.18
      breathLevel -= 0.04
      break
    case 'speaking':
      angleZ += Math.sin(seconds * 5.8) * 0.9
      bodyAngleX += Math.sin(seconds * 4.9) * 0.95
      smileLevel += 0.14 + clamp(speechLevelTarget, 0, 1) * 0.22
      cheekLevel += clamp(speechLevelTarget, 0, 1) * 0.06
      breathLevel += 0.08
      break
    case 'happy':
      angleZ += 1.8
      smileLevel += 0.18
      cheekLevel += 0.1
      breathLevel += 0.04
      break
    case 'sleepy':
      gazeX *= 0.45
      gazeY = clamp(gazeY + 0.26, -1, 1)
      angleZ += Math.sin(seconds * 0.66) * 1.15
      bodyAngleX *= 0.58
      breathLevel -= 0.08
      smileLevel -= 0.05
      break
    case 'touchHead':
      angleZ += 2.1
      gazeY = clamp(gazeY - 0.2, -1, 1)
      smileLevel += 0.16
      cheekLevel += 0.1
      break
    case 'touchFace':
      angleZ += Math.sin(seconds * 7.2) * 0.6
      gazeX *= 0.28
      smileLevel += 0.19
      cheekLevel += 0.12
      break
    case 'touchBody':
      angleZ += 1.3
      bodyAngleX += gazeX * 2.2
      smileLevel += 0.1
      break
    case 'surprised':
      gazeY = clamp(gazeY - 0.15, -1, 1)
      angleZ += Math.sin(seconds * 6.2) * 1.6
      breathLevel += 0.12
      browFormLevel += 0.22
      break
    case 'confused':
      gazeX *= 0.5
      gazeY = clamp(gazeY + 0.12, -1, 1)
      angleZ += Math.sin(seconds * 1.4) * 3.2
      bodyAngleX += Math.sin(seconds * 0.7) * 1.4
      browFormLevel -= 0.24
      breathLevel -= 0.02
      break
    case 'embarrassed':
      gazeX *= 0.3
      gazeY = clamp(gazeY + 0.2, -1, 1)
      angleZ += 2.6
      smileLevel += 0.12
      cheekLevel += 0.18
      breathLevel += 0.06
      break
    case 'idle':
    default:
      break
  }

  // ── Performance cue overlay (accent boost on top of base slot) ──────
  if (performanceCueAccent > 0) {
    breathLevel += 0.05 * performanceCueAccent

    switch (activeExpressionSlot) {
      case 'happy':
        angleZ += 4.8 * performanceCueAccent + performanceCuePulse * 2.4
        bodyAngleX += performanceCuePulse * 4.2
        smileLevel += 0.24 * performanceCueAccent
        cheekLevel += 0.16 * performanceCueAccent
        break
      case 'thinking':
        gazeY = clamp(gazeY + 0.12 * performanceCueAccent, -1, 1)
        angleZ += 3.4 * performanceCueAccent + performanceCuePulse * 2.2
        bodyAngleX += performanceCuePulse * 3
        browFormLevel -= 0.12 * performanceCueAccent
        break
      case 'listening':
        angleZ += performanceCuePulse * 2
        bodyAngleX += performanceCuePulse * 2.8
        smileLevel += 0.1 * performanceCueAccent
        break
      case 'touchHead':
        angleZ += 5.1 * performanceCueAccent + performanceCuePulse * 2.8
        bodyAngleX += performanceCuePulse * 4.8
        smileLevel += 0.18 * performanceCueAccent
        cheekLevel += 0.16 * performanceCueAccent
        break
      case 'touchFace':
        gazeX *= 0.18
        angleZ += performanceCuePulse * 2.4
        bodyAngleX += performanceCuePulse * 2.4
        smileLevel += 0.22 * performanceCueAccent
        cheekLevel += 0.18 * performanceCueAccent
        break
      case 'touchBody':
        angleZ += 2.8 * performanceCueAccent + performanceCuePulse * 2
        bodyAngleX += performanceCuePulse * 4.8
        smileLevel += 0.12 * performanceCueAccent
        break
      case 'sleepy':
        angleZ += performanceCuePulse * 0.8
        breathLevel -= 0.04 * performanceCueAccent
        break
      case 'speaking':
        angleZ += performanceCuePulse * 1.4
        bodyAngleX += performanceCuePulse * 1.8
        break
      case 'idle':
      default:
        break
    }

    if (performanceCueAccentStyle) {
      ({
        gazeX,
        gazeY,
        angleZ,
        bodyAngleX,
        smileLevel,
        cheekLevel,
        browFormLevel,
        breathLevel,
      } = applyAccentStyle({
        accentStyle: performanceCueAccentStyle,
        accentLevel: performanceCueAccent,
        elapsedMs: performanceCueElapsedMs,
        pulse: performanceCuePulse,
        state: {
          gazeX,
          gazeY,
          angleZ,
          bodyAngleX,
          smileLevel,
          cheekLevel,
          browFormLevel,
          breathLevel,
        },
      }))
    }
  }

  internalModel.focusController?.focus(gazeX, gazeY)

  if (!coreModel?.addParameterValueById) return

  // ── Speech-driven mouth animation ────────────────────────────────────
  const targetSpeechLevel = clamp(speechLevelTarget, 0, 1)
  state.smoothedSpeechLevel += (targetSpeechLevel - state.smoothedSpeechLevel) * (
    targetSpeechLevel > state.smoothedSpeechLevel ? 0.34 : 0.2
  )

  const mouthLevel = state.smoothedSpeechLevel < 0.015 ? 0 : state.smoothedSpeechLevel

  addParameterValue(coreModel, openParam, mouthLevel * 0.95)
  addParameterValue(coreModel, roundParam, mouthLevel * 0.24)
  addParameterValue(coreModel, narrowParam, mouthLevel * 0.08)
  addParameterValue(coreModel, smileParam, smileLevel)
  addParameterValue(coreModel, rigParams?.angleX, gazeX * 18)
  addParameterValue(coreModel, rigParams?.angleY, gazeY * -12)
  addParameterValue(coreModel, rigParams?.angleZ, angleZ)
  addParameterValue(coreModel, rigParams?.bodyAngleX, bodyAngleX)
  addParameterValue(coreModel, rigParams?.bodyAngleY, bodyAngleY)
  addParameterValue(coreModel, rigParams?.eyeBallX, gazeX)
  addParameterValue(coreModel, rigParams?.eyeBallY, gazeY)
  addParameterValue(coreModel, rigParams?.browForm, browFormLevel)
  addParameterValue(coreModel, rigParams?.cheek, cheekLevel)
  addParameterValue(coreModel, rigParams?.breath, breathLevel)

  // ── Eye blink ─────────────────────────────────────────────────────────
  let eyeOpen = updateBlink(state.blink, now)
  if (activeExpressionSlot === 'thinking') {
    eyeOpen *= 0.9
  }
  if (activeExpressionSlot === 'sleepy') {
    eyeOpen *= 0.72
  }
  if (performanceCueAccentStyle === 'sparkle') {
    eyeOpen = clamp(eyeOpen + performanceCueAccent * 0.16, 0, 1.12)
  }
  if (performanceCueAccentStyle === 'write') {
    eyeOpen *= 0.94
  }

  addParameterValue(coreModel, rigParams?.eyeLOpen, eyeOpen - 1)
  addParameterValue(coreModel, rigParams?.eyeROpen, eyeOpen - 1)
}
