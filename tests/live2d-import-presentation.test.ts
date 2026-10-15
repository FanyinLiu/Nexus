import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getLive2dImportMessageContract } from '../shared/live2dModelResources.js'
import { formatPetModelImportPresentation } from '../src/features/pet/live2dImportPresentation.ts'
import { getPetModelPreset, type PetModelImportResult } from '../src/features/pet/models.ts'
import type { TranslationKey, TranslationParams, Translator } from '../src/types/i18n.ts'

const EMPTY_SUMMARY = {
  textureCount: 0,
  motionCount: 0,
  expressionCount: 0,
  missingMocCount: 0,
  missingTextureCount: 0,
  missingMotionCount: 0,
  missingExpressionCount: 0,
  missingOptionalCount: 0,
  unsafeResourceCount: 0,
}

function createRecordingTranslator() {
  const calls: Array<{ key: TranslationKey; params?: TranslationParams }> = []
  const translate: Translator = (key, params) => {
    calls.push({ key, params })
    return `translated:${key}`
  }
  return { calls, translate }
}

test('Live2D import presentation localizes blocked IPC keys and resource categories', () => {
  const contract = getLive2dImportMessageContract('blocked', [
    'invalid-model-file',
    'unsafe-resource-path',
  ])
  const result: PetModelImportResult = {
    model: null,
    message: contract.messageKey,
    ...contract,
    compatibility: {
      status: 'blocked',
      errors: ['invalid-model-file', 'unsafe-resource-path'],
      warnings: [],
      summary: EMPTY_SUMMARY,
    },
  }
  const { calls, translate } = createRecordingTranslator()

  assert.deepEqual(formatPetModelImportPresentation(result, translate), {
    message: 'translated:settings.pet.compatibility_blocked',
    recommendation: 'translated:settings.pet.compatibility_blocked_rec_unsafe',
  })
  assert.deepEqual(calls, [
    { key: 'settings.pet.compatibility_resource.model', params: undefined },
    { key: 'settings.pet.compatibility_resource.unsafe', params: undefined },
    {
      key: 'settings.pet.compatibility_blocked',
      params: {
        resources: [
          'translated:settings.pet.compatibility_resource.model',
          'translated:settings.pet.compatibility_resource.unsafe',
        ].join(', '),
      },
    },
    { key: 'settings.pet.compatibility_blocked_rec_unsafe', params: undefined },
  ])
})

test('Live2D import presentation picks schema repair copy for malformed declarations', () => {
  const contract = getLive2dImportMessageContract('blocked', ['invalid-model-file'])
  assert.equal(contract.recommendationKey, 'settings.pet.compatibility_blocked_rec_schema')

  const result: PetModelImportResult = {
    model: null,
    message: contract.messageKey,
    ...contract,
    compatibility: {
      status: 'blocked',
      errors: ['invalid-model-file'],
      warnings: [],
      summary: EMPTY_SUMMARY,
    },
  }
  const { translate } = createRecordingTranslator()
  assert.deepEqual(formatPetModelImportPresentation(result, translate), {
    message: 'translated:settings.pet.compatibility_blocked',
    recommendation: 'translated:settings.pet.compatibility_blocked_rec_schema',
  })
})

test('Live2D import presentation formats limited and ready compatibility evidence', () => {
  const limitedTranslator = createRecordingTranslator()
  const limitedContract = getLive2dImportMessageContract('limited')
  const limited: PetModelImportResult = {
    model: { ...getPetModelPreset('mao'), id: 'limited', label: 'Limited Model' },
    message: limitedContract.messageKey,
    ...limitedContract,
    compatibility: {
      status: 'limited',
      errors: [],
      warnings: ['no-expressions'],
      summary: { ...EMPTY_SUMMARY, textureCount: 2, motionCount: 3 },
    },
  }
  assert.deepEqual(formatPetModelImportPresentation(limited, limitedTranslator.translate), {
    message: 'translated:settings.pet.compatibility_limited',
  })
  assert.deepEqual(limitedTranslator.calls.at(-1), {
    key: 'settings.pet.compatibility_limited',
    params: {
      name: 'Limited Model',
      capabilities: 'translated:settings.pet.compatibility_resource.expressions',
    },
  })

  const readyTranslator = createRecordingTranslator()
  const readyContract = getLive2dImportMessageContract('ready')
  const ready: PetModelImportResult = {
    model: { ...getPetModelPreset('mao'), id: 'ready', label: 'Ready Model' },
    message: readyContract.messageKey,
    ...readyContract,
    compatibility: {
      status: 'ready',
      errors: [],
      warnings: [],
      summary: {
        ...EMPTY_SUMMARY,
        textureCount: 2,
        motionCount: 6,
        expressionCount: 8,
      },
    },
  }
  assert.deepEqual(formatPetModelImportPresentation(ready, readyTranslator.translate), {
    message: 'translated:settings.pet.compatibility_ready',
  })
  assert.deepEqual(readyTranslator.calls, [{
    key: 'settings.pet.compatibility_ready',
    params: {
      name: 'Ready Model',
      textures: 2,
      motions: 6,
      expressions: 8,
    },
  }])
})

test('keyed pet import success messages localize a nested source fragment', () => {
  const { calls, translate } = createRecordingTranslator()
  assert.equal(formatPetModelImportPresentation({
    message: 'settings.pet.success.imported_from',
    messageKey: 'settings.pet.success.imported_from',
    messageParams: {
      name: 'Mini',
      sourceKey: 'settings.pet.success.source.community_zip',
    },
  }, translate).message, 'translated:settings.pet.success.imported_from')
  assert.deepEqual(calls.map((call) => call.key), [
    'settings.pet.success.source.community_zip',
    'settings.pet.success.imported_from',
  ])
})

test('non-Live2D import messages remain untouched', () => {
  const { calls, translate } = createRecordingTranslator()
  const result = {
    model: null,
    message: 'legacy sprite result',
  } satisfies PetModelImportResult

  assert.deepEqual(formatPetModelImportPresentation(result, translate), {
    message: 'legacy sprite result',
  })
  assert.deepEqual(calls, [])
})
