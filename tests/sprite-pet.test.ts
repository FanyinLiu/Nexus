import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  SPRITE_PET_ANIMATIONS,
  SPRITE_PET_CELL_HEIGHT,
  SPRITE_PET_CELL_WIDTH,
  SPRITE_PET_ANIMATION_STATES,
  SPRITE_PET_COLUMNS,
  SPRITE_PET_ROWS,
  getSpritePetFrame,
  isSpritePetAnimationState,
  mapPetInputsToSpriteState,
} from '../src/features/pet/spriteAtlas.ts'
import {
  getSpritePetDebugImagePathFromSearch,
  getSpritePetDebugStateFromSearch,
} from '../src/features/pet/spriteDebug.ts'
import {
  SPRITE_PET_INITIAL_CURSOR,
  advanceSpritePetAnimationCursor,
  applySpritePetStateRequest,
  createSpritePetRequestKey,
  resolveSpritePetRenderFrame,
} from '../src/features/pet/spriteRuntime.ts'
import {
  getPetModelPresets,
  type PetModelDefinition,
} from '../src/features/pet/models.ts'
import {
  SPRITE_PET_ROW_CONTRACT,
} from '../electron/services/spritePetPackage.js'

test('sprite pet atlas contract matches the 8x9 grid renderer', () => {
  assert.equal(SPRITE_PET_COLUMNS, 8)
  assert.equal(SPRITE_PET_ROWS, 9)
  assert.equal(SPRITE_PET_CELL_WIDTH, 192)
  assert.equal(SPRITE_PET_CELL_HEIGHT, 208)
  assert.deepEqual(SPRITE_PET_ANIMATION_STATES, [
    'idle',
    'running-right',
    'running-left',
    'waving',
    'jumping',
    'failed',
    'waiting',
    'running',
    'review',
  ])

  for (const [state, animation] of Object.entries(SPRITE_PET_ANIMATIONS)) {
    const frame = getSpritePetFrame(state as keyof typeof SPRITE_PET_ANIMATIONS, 99)
    assert.ok(frame.row >= 0 && frame.row < SPRITE_PET_ROWS)
    assert.ok(frame.column >= 0 && frame.column < SPRITE_PET_COLUMNS)
    assert.ok(animation.columns.length > 0)
  }
})

test('sprite pet frame timings match the Codex-compatible row contract', () => {
  const expectedDurations: Record<keyof typeof SPRITE_PET_ANIMATIONS, number[]> = {
    idle: [280, 110, 110, 140, 140, 320],
    'running-right': [120, 120, 120, 120, 120, 120, 120, 220],
    'running-left': [120, 120, 120, 120, 120, 120, 120, 220],
    waving: [140, 140, 140, 280],
    jumping: [140, 140, 140, 140, 280],
    failed: [140, 140, 140, 140, 140, 140, 140, 240],
    waiting: [150, 150, 150, 150, 150, 260],
    running: [120, 120, 120, 120, 120, 220],
    review: [150, 150, 150, 150, 150, 280],
  }

  for (const [state, durations] of Object.entries(expectedDurations)) {
    assert.deepEqual(
      durations.map((_, frameIndex) => (
        getSpritePetFrame(state as keyof typeof SPRITE_PET_ANIMATIONS, frameIndex).durationMs
      )),
      durations,
    )
  }
})

test('sprite package validator contract stays aligned with renderer animations', () => {
  assert.deepEqual(
    SPRITE_PET_ROW_CONTRACT.map((rowContract) => ({
      state: rowContract.state,
      row: rowContract.row,
      frameCount: rowContract.frameCount,
      durationsMs: rowContract.durationsMs,
    })),
    Object.entries(SPRITE_PET_ANIMATIONS).map(([state, animation]) => ({
      state,
      row: animation.row,
      frameCount: animation.columns.length,
      durationsMs: animation.durationsMs,
    })),
  )
})

test('sprite pet cursor plays Codex-style transient active loops then slow idle', () => {
  const cursor = {
    state: 'review',
    frameIndex: 5,
    loopsRemaining: 3,
    requestKey: 'review',
  } as const

  assert.deepEqual(
    advanceSpritePetAnimationCursor(cursor, 'review', 'review'),
    {
      state: 'review',
      frameIndex: 0,
      loopsRemaining: 2,
      requestKey: 'review',
    },
  )

  assert.deepEqual(
    advanceSpritePetAnimationCursor(
      { ...cursor, loopsRemaining: 1 },
      'review',
      'review',
    ),
    {
      state: 'idle',
      frameIndex: 0,
      loopsRemaining: 0,
      requestKey: 'review',
      idleDurationMultiplier: 2,
    },
  )
})

test('sprite pet cursor can loop a forced preview state for row inspection', () => {
  const cursor = {
    state: 'review',
    frameIndex: 5,
    loopsRemaining: 1,
    requestKey: 'review',
  } as const

  assert.deepEqual(
    advanceSpritePetAnimationCursor(cursor, 'review', 'review', { loopRequestedState: true }),
    {
      state: 'review',
      frameIndex: 0,
      loopsRemaining: 3,
      requestKey: 'review',
    },
  )
})

test('portable sprite runtime starts, holds, and reduces motion without React', () => {
  const activeRequestKey = createSpritePetRequestKey(['review', 'cue-1', null])
  assert.equal(activeRequestKey, 'review:cue-1:')

  const activeCursor = applySpritePetStateRequest({
    current: {
      state: 'idle',
      frameIndex: 4,
      loopsRemaining: 0,
      requestKey: 'idle',
    },
    requestedState: 'review',
    requestKey: activeRequestKey,
  })

  assert.deepEqual(activeCursor, {
    state: 'review',
    frameIndex: 0,
    loopsRemaining: 3,
    requestKey: activeRequestKey,
  })

  assert.deepEqual(
    applySpritePetStateRequest({
      current: activeCursor,
      requestedState: 'idle',
      requestKey: 'idle',
    }),
    activeCursor,
  )

  assert.deepEqual(
    applySpritePetStateRequest({
      current: {
        state: 'idle',
        frameIndex: 2,
        loopsRemaining: 0,
        requestKey: activeRequestKey,
        idleDurationMultiplier: 6,
      },
      requestedState: 'review',
      requestKey: activeRequestKey,
    }),
    {
      state: 'idle',
      frameIndex: 2,
      loopsRemaining: 0,
      requestKey: activeRequestKey,
      idleDurationMultiplier: 6,
    },
  )

  assert.deepEqual(
    applySpritePetStateRequest({
      current: activeCursor,
      requestedState: 'waiting',
      requestKey: 'waiting',
      prefersReducedMotion: true,
    }),
    {
      state: 'waiting',
      frameIndex: 0,
      loopsRemaining: 0,
      requestKey: 'waiting',
    },
  )
})

test('portable sprite runtime resolves atlas coordinates for any renderer', () => {
  const renderFrame = resolveSpritePetRenderFrame(
    { imagePath: './pets/nexus-mini/spritesheet.png' },
    {
      state: 'review',
      frameIndex: 0,
      loopsRemaining: 3,
      requestKey: 'review',
    },
  )

  assert.deepEqual(renderFrame.frame, {
    row: 8,
    column: 0,
    durationMs: 150,
  })
  assert.equal(renderFrame.aspectRatio, '192 / 208')
  assert.equal(renderFrame.backgroundPosition, '0% 100%')
  assert.equal(renderFrame.backgroundSize, '800% 900%')
})

test('sprite runtime initial cursor starts from the Codex-compatible idle pose', () => {
  assert.deepEqual(SPRITE_PET_INITIAL_CURSOR, {
    state: 'idle',
    frameIndex: 0,
    loopsRemaining: 0,
    requestKey: 'initial',
  })
})

test('sprite pet cursor finishes transient active rows when the requested state is idle', () => {
  const cursor = {
    state: 'review',
    frameIndex: 5,
    loopsRemaining: 1,
    requestKey: 'review',
  } as const

  assert.deepEqual(
    advanceSpritePetAnimationCursor(cursor, 'idle', 'idle'),
    {
      state: 'idle',
      frameIndex: 0,
      loopsRemaining: 0,
      requestKey: 'review',
      idleDurationMultiplier: 2,
    },
  )
})

test('sprite pet slow idle multiplies frame duration after active rows complete', () => {
  const renderFrame = resolveSpritePetRenderFrame(
    { imagePath: './pets/nexus-mini/spritesheet.png' },
    {
      state: 'idle',
      frameIndex: 0,
      loopsRemaining: 0,
      requestKey: 'review',
      idleDurationMultiplier: 6,
    },
  )

  assert.deepEqual(renderFrame.frame, {
    row: 0,
    column: 0,
    durationMs: 1680,
  })
})

test('sprite pet debug query parsing only accepts known animation states', () => {
  assert.equal(isSpritePetAnimationState('review'), true)
  assert.equal(isSpritePetAnimationState(' review '), true)
  assert.equal(isSpritePetAnimationState('unknown'), false)
  assert.equal(isSpritePetAnimationState(null), false)
  assert.equal(getSpritePetDebugStateFromSearch('?view=pet&spritePetState=review'), 'review')
  assert.equal(getSpritePetDebugStateFromSearch('spriteState=waiting'), 'waiting')
  assert.equal(getSpritePetDebugStateFromSearch('?spritePetState=bad&spriteState=failed'), 'failed')
  assert.equal(getSpritePetDebugStateFromSearch('?spritePetState=bad'), null)
  assert.equal(
    getSpritePetDebugImagePathFromSearch('?spritePetImage=pets/original-virtual-swordsman/spritesheet.png'),
    './pets/original-virtual-swordsman/spritesheet.png',
  )
  assert.equal(
    getSpritePetDebugImagePathFromSearch('?spriteImage=/pets/original-virtual-swordsman/spritesheet.png'),
    './pets/original-virtual-swordsman/spritesheet.png',
  )
  assert.equal(getSpritePetDebugImagePathFromSearch('?spritePetImage=https://example.com/pet.png'), null)
  assert.equal(getSpritePetDebugImagePathFromSearch('?spritePetImage=pets/../secret.png'), null)
})

test('sprite pet state mapper follows voice, work, and touch signals', () => {
  assert.equal(mapPetInputsToSpriteState({ mood: 'idle', isListening: true }), 'waiting')
  assert.equal(mapPetInputsToSpriteState({ mood: 'idle', isSpeaking: true }), 'review')
  assert.equal(mapPetInputsToSpriteState({ mood: 'idle', isBusy: true }), 'running')
  assert.equal(mapPetInputsToSpriteState({ mood: 'idle', touchZone: 'head' }), 'jumping')
  assert.equal(mapPetInputsToSpriteState({ mood: 'worried' }), 'failed')
  assert.equal(mapPetInputsToSpriteState({
    mood: 'idle',
    performanceCue: {
      id: 'cue-1',
      gestureName: 'wave',
      durationMs: 800,
      stageDirection: '(wave)',
    },
  }), 'waving')
})

test('discovered bundled sprite packages merge without duplicating built-in presets', () => {
  // The merge-dedup semantics under test concern sprite built-ins; use the
  // codex preset explicitly (the default model is Live2D now).
  const discoveredDefault: PetModelDefinition = {
    id: 'codex',
    label: 'Nexus Mini',
    description: 'Discovered from public/pets/nexus-mini/pet.json',
    modelPath: '',
    fallbackImagePath: '',
    spriteAtlas: {
      imagePath: './pets/nexus-mini/spritesheet.png',
    },
    motionGroups: {},
    expressionMap: {},
  }
  const discoveredExtra: PetModelDefinition = {
    id: 'sprite-extra',
    label: 'Sprite Extra',
    description: 'Discovered from public/pets/sprite-extra/pet.json',
    modelPath: '',
    fallbackImagePath: '',
    spriteAtlas: {
      imagePath: './pets/sprite-extra/spritesheet.png',
    },
    motionGroups: {},
    expressionMap: {},
  }

  const presets = getPetModelPresets([discoveredDefault, discoveredExtra])

  assert.equal(presets.filter((preset) => preset.id === 'codex').length, 1)
  assert.equal(
    presets.find((preset) => preset.id === 'codex')?.spriteAtlas?.stageMaxSize,
    '126px',
  )
  assert.equal(presets.some((preset) => preset.id === 'sprite-extra'), true)
  assert.equal(
    presets.find((preset) => preset.id === 'qiyi')?.spriteAtlas?.imageRendering,
    'auto',
  )
})
