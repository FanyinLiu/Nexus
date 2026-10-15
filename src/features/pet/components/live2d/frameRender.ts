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
import { RIGHT_BLINK_LAG_MS, createBlinkLane } from '../../blink.ts'
import { createSaccadeState, stepIdleSaccade, type SaccadeState } from '../../idleSaccades.ts'
import { resolveSpeechVisemes } from '../../speechVisemes.ts'
import { clamp } from '../../../../lib/common.ts'
import { typingPresenceOffset } from '../../../desktopPresence/typingPresence.ts'
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
  blinkRight?: BlinkState
  saccade?: SaccadeState
}

export type FrameRenderInputs = {
  modelDefinition: PetModelDefinition
  internalModel: Live2DInternalModel
  activeExpressionSlot: PetExpressionSlot
  gazeTarget: GazeTarget
  typingIntensity?: number
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
    typingIntensity = 0,
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
  const downParam = modelDefinition.mouthParams?.down
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

  const saccade = stepIdleSaccade(
    state.saccade ?? (state.saccade = createSaccadeState()),
    now,
    activeExpressionSlot === 'idle' && speechLevelTarget < 0.015,
  )
  let gazeX = clamp(state.smoothedGaze.x + saccade.x, -1, 1)
  let gazeY = clamp(state.smoothedGaze.y + saccade.y, -1, 1)
  let angleZ = Math.sin(seconds * 0.95) * 0.65
  let bodyAngleX = Math.sin(seconds * 0.82) * 0.55 + gazeX * 1.9
  let smileLevel = 0
  let cheekLevel = 0
  let browFormLevel = 0
  let browLYLevel = 0
  let browRYLevel = 0
  let browLAngleLevel = 0
  let browRAngleLevel = 0
  let eyeSmileLevel = 0
  let eyeFormLevel = 0
  let mouthDownLevel = 0
  let breathLevel = 0.22 + (Math.sin(seconds * 2.1) + 1) * 0.1
  const typing = typingPresenceOffset(typingIntensity, seconds)

  // ── Base expression-slot rig overlays ────────────────────────────────
  switch (activeExpressionSlot) {
    case 'listening':
      angleZ += Math.sin(seconds * 3.4) * 0.9
      bodyAngleX += gazeX * 1.8
      smileLevel += 0.08
      eyeSmileLevel += 0.1
      breathLevel += 0.06
      break
    case 'thinking':
      gazeX *= 0.35
      gazeY = clamp(gazeY + 0.18, -1, 1)
      angleZ += Math.sin(seconds * 1.8) * 2.4
      bodyAngleX += Math.sin(seconds * 0.9) * 1.15
      browFormLevel -= 0.18
      browLYLevel += 0.06
      browRYLevel += 0.1
      browLAngleLevel += 0.18
      browRAngleLevel += 0.14
      eyeFormLevel -= 0.1
      mouthDownLevel += 0.1
      breathLevel -= 0.04
      break
    case 'speaking':
      angleZ += Math.sin(seconds * 5.8) * 0.9
      bodyAngleX += Math.sin(seconds * 4.9) * 0.95
      smileLevel += 0.14 + clamp(speechLevelTarget, 0, 1) * 0.22
      cheekLevel += clamp(speechLevelTarget, 0, 1) * 0.06
      eyeSmileLevel += 0.12 + clamp(speechLevelTarget, 0, 1) * 0.1
      breathLevel += 0.08
      break
    case 'happy':
      angleZ += 1.8
      smileLevel += 0.18
      cheekLevel += 0.1
      eyeSmileLevel += 0.55
      browLAngleLevel -= 0.06
      browRAngleLevel -= 0.06
      eyeFormLevel -= 0.08
      breathLevel += 0.04
      break
    case 'sleepy':
      gazeX *= 0.45
      gazeY = clamp(gazeY + 0.26, -1, 1)
      angleZ += Math.sin(seconds * 0.66) * 1.15
      bodyAngleX *= 0.58
      browLYLevel -= 0.14
      browRYLevel -= 0.14
      browLAngleLevel += 0.1
      browRAngleLevel += 0.1
      eyeFormLevel -= 0.12
      breathLevel -= 0.08
      smileLevel -= 0.05
      break
    case 'touchHead':
      angleZ += 2.1
      gazeY = clamp(gazeY - 0.2, -1, 1)
      smileLevel += 0.16
      cheekLevel += 0.1
      eyeSmileLevel += 0.55
      break
    case 'touchFace':
      angleZ += Math.sin(seconds * 7.2) * 0.6
      gazeX *= 0.28
      smileLevel += 0.19
      cheekLevel += 0.12
      eyeSmileLevel += 0.62
      break
    case 'touchBody':
      angleZ += 1.3
      bodyAngleX += gazeX * 2.2
      smileLevel += 0.1
      eyeSmileLevel += 0.18
      break
    case 'surprised':
      gazeY = clamp(gazeY - 0.15, -1, 1)
      angleZ += Math.sin(seconds * 6.2) * 1.6
      breathLevel += 0.12
      browFormLevel += 0.22
      browLYLevel += 0.32
      browRYLevel += 0.32
      browLAngleLevel -= 0.1
      browRAngleLevel -= 0.1
      eyeFormLevel += 0.28
      break
    case 'confused':
      gazeX *= 0.5
      gazeY = clamp(gazeY + 0.12, -1, 1)
      angleZ += Math.sin(seconds * 1.4) * 3.2
      bodyAngleX += Math.sin(seconds * 0.7) * 1.4
      browFormLevel -= 0.24
      browLYLevel += 0.12
      browRYLevel -= 0.16
      browLAngleLevel += 0.22
      browRAngleLevel -= 0.2
      eyeFormLevel -= 0.06
      mouthDownLevel += 0.22
      breathLevel -= 0.02
      break
    case 'embarrassed':
      gazeX *= 0.3
      gazeY = clamp(gazeY + 0.2, -1, 1)
      angleZ += 2.6
      smileLevel += 0.12
      cheekLevel += 0.18
      eyeSmileLevel += 0.38
      browLYLevel -= 0.04
      browRYLevel -= 0.06
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
        eyeSmileLevel += 0.18 * performanceCueAccent
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
        eyeSmileLevel += 0.12 * performanceCueAccent
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

  if (typing.gazeYBias) gazeY = clamp(gazeY - typing.gazeYBias, -1, 1)

  internalModel.focusController?.focus(gazeX, gazeY)

  const bodyAngleY = gazeY * -6 * (activeExpressionSlot === 'sleepy' ? 0.55 : 1)

  if (!coreModel?.addParameterValueById) return

  // ── Speech-driven mouth animation ────────────────────────────────────
  const targetSpeechLevel = clamp(speechLevelTarget, 0, 1)
  state.smoothedSpeechLevel += (targetSpeechLevel - state.smoothedSpeechLevel) * (
    targetSpeechLevel > state.smoothedSpeechLevel ? 0.34 : 0.2
  )

  const visemes = resolveSpeechVisemes(state.smoothedSpeechLevel, now)

  const typingMouth = speechLevelTarget < 0.015 ? typing.mouthOpen : 0
  addParameterValue(coreModel, openParam, visemes.open * 0.95 + typingMouth)
  addParameterValue(coreModel, roundParam, visemes.round)
  addParameterValue(coreModel, narrowParam, visemes.narrow)
  addParameterValue(coreModel, smileParam, smileLevel)
  addParameterValue(coreModel, downParam, mouthDownLevel)
  addParameterValue(coreModel, rigParams?.angleX, gazeX * 18)
  addParameterValue(coreModel, rigParams?.angleY, gazeY * -12)
  addParameterValue(coreModel, rigParams?.angleZ, angleZ + typing.angleZ)
  addParameterValue(coreModel, rigParams?.bodyAngleX, bodyAngleX + typing.bodyAngleX)
  addParameterValue(coreModel, rigParams?.bodyAngleY, bodyAngleY)
  addParameterValue(coreModel, rigParams?.eyeBallX, gazeX)
  addParameterValue(coreModel, rigParams?.eyeBallY, gazeY)
  addParameterValue(coreModel, rigParams?.eyeBallForm, eyeSmileLevel * 0.4)
  addParameterValue(coreModel, rigParams?.browForm, browFormLevel)
  addParameterValue(coreModel, rigParams?.browLY, browLYLevel)
  addParameterValue(coreModel, rigParams?.browRY, browRYLevel)
  addParameterValue(coreModel, rigParams?.browLX, gazeX * 0.16)
  addParameterValue(coreModel, rigParams?.browRX, gazeX * 0.16)
  addParameterValue(coreModel, rigParams?.browLAngle, browLAngleLevel)
  addParameterValue(coreModel, rigParams?.browRAngle, browRAngleLevel)
  addParameterValue(coreModel, rigParams?.browLForm, browFormLevel)
  addParameterValue(coreModel, rigParams?.browRForm, browFormLevel)
  addParameterValue(coreModel, rigParams?.cheek, cheekLevel)
  addParameterValue(coreModel, rigParams?.breath, breathLevel + typing.breath)
  addParameterValue(coreModel, rigParams?.eyeLSmile, eyeSmileLevel)
  addParameterValue(coreModel, rigParams?.eyeRSmile, eyeSmileLevel)
  addParameterValue(coreModel, rigParams?.eyeLForm, eyeFormLevel)
  addParameterValue(coreModel, rigParams?.eyeRForm, eyeFormLevel)

  // ── Eye blink ─────────────────────────────────────────────────────────
  const blinkRight = state.blinkRight ?? createBlinkLane(
    state.blink.phaseStartedAt,
    state.blink.nextBlinkAt + RIGHT_BLINK_LAG_MS,
  )
  state.blinkRight = blinkRight
  const scaleLid = (eyeOpen: number) => {
    let open = eyeOpen
    if (activeExpressionSlot === 'thinking') open *= 0.9
    if (activeExpressionSlot === 'sleepy') open *= 0.72
    if (performanceCueAccentStyle === 'sparkle') {
      open = clamp(open + performanceCueAccent * 0.16, 0, 1.12)
    }
    if (performanceCueAccentStyle === 'write') open *= 0.94
    return open
  }
  const eyeOpenLeft = scaleLid(updateBlink(state.blink, now))
  const eyeOpenRight = scaleLid(updateBlink(blinkRight, now))

  addParameterValue(coreModel, rigParams?.eyeLOpen, eyeOpenLeft - 1)
  addParameterValue(coreModel, rigParams?.eyeROpen, eyeOpenRight - 1)
}
