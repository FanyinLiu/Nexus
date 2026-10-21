import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_PET_MODEL_ID,
  getPetModelPresets,
  repairDiscoveredPetModelSelection,
  type PetModelDefinition,
} from '../src/features/pet/models.ts'

function extra(id: string): PetModelDefinition {
  return {
    id,
    label: id,
    description: '',
    modelPath: './live2d/custom/model.model3.json',
    fallbackImagePath: '',
    motionGroups: {},
    expressionMap: {},
  }
}

test('presets merge a discovered Live2D model without duplicating Mao', () => {
  const presets = getPetModelPresets([extra('mao'), extra('imported-custom')])
  assert.equal(DEFAULT_PET_MODEL_ID, 'mao')
  assert.equal(presets.filter((preset) => preset.id === 'mao').length, 1)
  assert.ok(presets.some((preset) => preset.id === 'haru'))
  assert.ok(presets.some((preset) => preset.id === 'hiyori'))
  assert.ok(presets.some((preset) => preset.id === 'imported-custom'))
})

test('repair maps an absent selection to Mao and keeps imported Live2D and Haru', () => {
  const presets = getPetModelPresets([extra('imported-custom')])
  const repaired = repairDiscoveredPetModelSelection({
    petModelId: 'codex',
    characterProfiles: [
      { petModelId: 'qiyi' },
      { petModelId: 'imported-custom' },
      { petModelId: 'haru' },
    ],
  }, 'ready', presets)

  assert.equal(repaired.petModelId, 'mao')
  assert.deepEqual(repaired.characterProfiles.map((profile) => profile.petModelId), [
    'mao',
    'imported-custom',
    'haru',
  ])
})

test('repair waits until discovery has a library', () => {
  const settings = {
    petModelId: 'codex',
    characterProfiles: [{ petModelId: 'sprite-cat' }],
  }
  assert.equal(repairDiscoveredPetModelSelection(settings, 'pending', getPetModelPresets()), settings)
  assert.equal(repairDiscoveredPetModelSelection(settings, 'ready', []), settings)
})
