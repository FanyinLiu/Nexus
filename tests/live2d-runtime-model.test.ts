import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildRuntimePetModelDefinition,
  getPetModelPreset,
  type CubismModelFile,
} from '../src/features/pet/models.ts'

test('buildRuntimePetModelDefinition preserves authored non-positional expression slots', () => {
  const mao = getPetModelPreset('mao')
  // Sanity: the preset authors the three slots that have no positional default.
  assert.equal(mao.expressionMap.surprised, 'exp_08')
  assert.equal(mao.expressionMap.confused, 'exp_03')
  assert.equal(mao.expressionMap.embarrassed, 'exp_07')

  const modelFile = {
    FileReferences: {
      Expressions: Array.from({ length: 8 }, (_, i) => ({ Name: `e${i}` })),
    },
  } as CubismModelFile

  const runtime = buildRuntimePetModelDefinition(mao, modelFile)

  // The positional rebuild used to overwrite the whole map with only the 9
  // positional slots, silently dropping surprised/confused/embarrassed even
  // when authored. They must survive the rebuild.
  assert.equal(runtime.expressionMap.surprised, 'exp_08')
  assert.equal(runtime.expressionMap.confused, 'exp_03')
  assert.equal(runtime.expressionMap.embarrassed, 'exp_07')
  // Standard positional slots still resolve (authored fallback wins).
  assert.ok(runtime.expressionMap.idle)
  assert.ok(runtime.expressionMap.happy)
})
