import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  BLINK_CLOSE_MS,
  BLINK_DOUBLE_GAP_MS,
  BLINK_HOLD_MS,
  BLINK_OPEN_MS,
  createBlinkLane,
  stepBlinkEyes,
  stepBlinkLane,
} from '../src/features/pet/blink.ts'
import { suspendCubismEyeBlink, updateBlink, updateBlinkEyes } from '../src/features/pet/components/live2d/blink.ts'
import { applyLive2DFrame } from '../src/features/pet/components/live2d/frameRender.ts'
import type { PetModelDefinition } from '../src/features/pet/models.ts'

function nextAt(nowMs: number) {
  return nowMs + 3_000
}

test('blink state machine closes, holds shut, then reopens', () => {
  const lane = createBlinkLane(0, 100)

  assert.equal(stepBlinkLane(lane, 99, nextAt), 1)
  assert.equal(lane.phase, 'idle')

  assert.equal(stepBlinkLane(lane, 100, nextAt), 1)
  assert.equal(lane.phase, 'closing')

  assert.equal(stepBlinkLane(lane, 100 + BLINK_CLOSE_MS, nextAt), 0)
  assert.equal(lane.phase, 'holding')

  assert.equal(stepBlinkLane(lane, 100 + BLINK_CLOSE_MS + BLINK_HOLD_MS - 1, nextAt), 0)
  assert.equal(lane.phase, 'holding')

  const opening = stepBlinkLane(lane, 100 + BLINK_CLOSE_MS + BLINK_HOLD_MS, nextAt)
  assert.equal(opening, 0)
  assert.equal(lane.phase, 'opening')

  const midOpen = stepBlinkLane(
    lane,
    100 + BLINK_CLOSE_MS + BLINK_HOLD_MS + BLINK_OPEN_MS / 2,
    nextAt,
  )
  assert.ok(midOpen > 0.4)
  assert.ok(midOpen < 0.6)

  const opened = stepBlinkLane(
    lane,
    100 + BLINK_CLOSE_MS + BLINK_HOLD_MS + BLINK_OPEN_MS,
    nextAt,
  )
  assert.equal(opened, 1)
  assert.equal(lane.phase, 'idle')
  assert.equal(lane.nextBlinkAt, 100 + BLINK_CLOSE_MS + BLINK_HOLD_MS + BLINK_OPEN_MS + 3_000)
})

test('Live2D blink wrapper shares the closed-hold timeline', () => {
  const blink = createBlinkLane(0, 50)
  updateBlink(blink, 50)
  updateBlink(blink, 50 + BLINK_CLOSE_MS)
  assert.equal(blink.phase, 'holding')
  assert.equal(updateBlink(blink, 50 + BLINK_CLOSE_MS + 8), 0)
})

test('blink state machine can chain a second blink after the first reopens', () => {
  const lane = createBlinkLane(0, 10)
  const closeAt = 10 + BLINK_CLOSE_MS
  const openAt = closeAt + BLINK_HOLD_MS + BLINK_OPEN_MS
  stepBlinkLane(lane, 10, nextAt, { doubleChance: 1, random: () => 0 })
  stepBlinkLane(lane, closeAt, nextAt, { doubleChance: 1, random: () => 0 })
  stepBlinkLane(lane, closeAt + BLINK_HOLD_MS, nextAt, { doubleChance: 1, random: () => 0 })
  stepBlinkLane(lane, openAt, nextAt, { doubleChance: 1, random: () => 0 })
  assert.equal(lane.phase, 'idle')
  assert.equal(lane.chainRemaining, 1)
  assert.equal(lane.nextBlinkAt, openAt + BLINK_DOUBLE_GAP_MS)

  const second = stepBlinkLane(lane, openAt + BLINK_DOUBLE_GAP_MS, nextAt)
  assert.equal(lane.phase, 'closing')
  assert.equal(second, 1)
})

test('both eyes share one openness value on every blink frame', () => {
  const sequence = [0.15, 0.8, 0.35, 0.6, 0.05, 0.9, 0.42, 0.73]
  let index = 0
  const originalRandom = Math.random
  Math.random = () => sequence[index++ % sequence.length]
  const blink = createBlinkLane(0, 120)
  let frames = 0
  let sawClosed = false
  let sawPartial = false
  try {
    for (let t = 0; t <= 12_000; t += 16) {
      frames += 1
      const eyes = updateBlinkEyes(blink, t)
      assert.equal(eyes.left, eyes.right)
      if (eyes.left === 0) sawClosed = true
      if (eyes.left > 0 && eyes.left < 1) sawPartial = true
    }
  } finally {
    Math.random = originalRandom
  }
  assert.ok(frames > 100)
  assert.equal(sawClosed, true)
  assert.equal(sawPartial, true)
})

test('shared blink keeps uneven idle gaps', () => {
  const sequence = [0.1, 0.95, 0.4, 0.7]
  let index = 0
  const originalRandom = Math.random
  Math.random = () => sequence[index++ % sequence.length]
  const blink = createBlinkLane(0, 40)
  const gaps: number[] = []
  let previous = blink.nextBlinkAt
  try {
    for (let t = 0; t <= 30_000; t += 16) {
      updateBlinkEyes(blink, t)
      if (blink.phase === 'idle' && blink.nextBlinkAt !== previous) {
        gaps.push(blink.nextBlinkAt - previous)
        previous = blink.nextBlinkAt
      }
    }
  } finally {
    Math.random = originalRandom
  }
  assert.ok(gaps.length >= 2)
  assert.ok(new Set(gaps).size >= 2)
})

test('a one-eye pose keeps its gap when both lids share the blink delta', () => {
  const lane = createBlinkLane(0, 100)
  const baseLeft = 0
  const baseRight = 1
  let sawBlink = false
  for (let t = 0; t <= 600; t += 16) {
    const eyes = stepBlinkEyes(lane, t, (nowMs) => nowMs + 3_000)
    assert.equal(eyes.left, eyes.right)
    const left = baseLeft + (eyes.left - 1)
    const right = baseRight + (eyes.right - 1)
    assert.equal(right - left, baseRight - baseLeft)
    if (eyes.left < 1) sawBlink = true
  }
  assert.equal(sawBlink, true)
})

test('frame rig writes the same blink delta on both eyes', () => {
  const originalNow = performance.now
  const modelDefinition = {
    id: 'mao',
    label: 'pet.model.mao.label',
    description: 'pet.model.mao.description',
    modelPath: './live2d/mao/Mao.model3.json',
    fallbackImagePath: '',
    motionGroups: {},
    expressionMap: {},
    rigParams: {
      eyeLOpen: 'ParamEyeLOpen',
      eyeROpen: 'ParamEyeROpen',
    },
  } satisfies PetModelDefinition
  const state = {
    smoothedGaze: { x: 0, y: 0 },
    smoothedSpeechLevel: 0,
    blink: createBlinkLane(0, 50),
  }
  const frames: Array<{ left: number, right: number }> = []
  try {
    for (let t = 0; t <= 800; t += 16) {
      performance.now = () => t
      let left: number | undefined
      let right: number | undefined
      applyLive2DFrame({
        modelDefinition,
        internalModel: {
          coreModel: {
            addParameterValueById(parameterId: string, value: number) {
              if (parameterId === 'ParamEyeLOpen') left = value
              if (parameterId === 'ParamEyeROpen') right = value
            },
          },
        },
        activeExpressionSlot: 'idle',
        gazeTarget: { x: 0, y: 0 },
        speechLevelTarget: 0,
        performanceCue: null,
        performanceCueStartedAt: 0,
        state,
      })
      if (left !== undefined || right !== undefined) {
        assert.equal(left, right)
        frames.push({ left: left ?? 0, right: right ?? 0 })
      }
    }
  } finally {
    performance.now = originalNow
  }
  assert.ok(frames.some((frame) => frame.left < 0))
  assert.ok(frames.some((frame) => frame.left > -1 && frame.left < 0))
})

test('model auto-blink is suspended so a one-eye pose is not replaced', () => {
  let setterCalled = false
  const model = {
    internalModel: {
      eyeBlinkEnabled: true,
      setEyeBlinkEnabled(enabled: boolean) {
        setterCalled = true
        this.eyeBlinkEnabled = enabled
      },
    },
  }
  suspendCubismEyeBlink(model)
  assert.equal(setterCalled, true)
  assert.equal(model.internalModel.eyeBlinkEnabled, false)

  const flagOnly = { internalModel: { eyeBlinkEnabled: true } }
  suspendCubismEyeBlink(flagOnly)
  assert.equal(flagOnly.internalModel.eyeBlinkEnabled, false)
  suspendCubismEyeBlink({})
})
