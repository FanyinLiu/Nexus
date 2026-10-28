import assert from 'node:assert/strict'
import { test } from 'node:test'

import { modelSetupInfoBlocks } from '../src/features/setup/modelSetupState.ts'
import { AVAILABLE_LOCALES, ensureLocaleLoaded } from '../src/i18n/runtime.ts'

/**
 * The install dialog used to end with a Python services block. The copy was
 * developer facing (pip, OmniVoice, GLM-ASR) and the product never needed it,
 * so the block and its four keys are gone from every locale.
 */
const PYTHON_KEYS = [
  'model_setup.python_title',
  'model_setup.python_detected',
  'model_setup.python_not_detected',
  'model_setup.python_missing_deps',
]

test('no locale carries the removed Python copy of the install dialog', async () => {
  for (const locale of AVAILABLE_LOCALES) {
    const dictionary = await ensureLocaleLoaded(locale)

    for (const key of PYTHON_KEYS) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(dictionary, key),
        false,
        `${locale} still has ${key}`,
      )
    }

    const pythonKeys = Object.keys(dictionary).filter((key) => key.startsWith('model_setup.python'))
    assert.deepEqual(pythonKeys, [], `${locale} still has model_setup.python* keys`)
  }
})

test('the install dialog never renders a Python block', () => {
  const blocks = modelSetupInfoBlocks({
    huggingFaceReachable: false,
    errorMessage: 'download failed',
  })

  assert.deepEqual(blocks, ['network_hint', 'error_banner'])
  assert.ok(
    blocks.every((block) => !/python/i.test(block)),
    'the dialog still offers a Python block',
  )
})

test('the install dialog keeps the network hint and the error banner', () => {
  assert.deepEqual(
    modelSetupInfoBlocks({ huggingFaceReachable: true, errorMessage: null }),
    [],
  )
  assert.deepEqual(
    modelSetupInfoBlocks({ huggingFaceReachable: undefined, errorMessage: null }),
    [],
  )
  assert.deepEqual(
    modelSetupInfoBlocks({ huggingFaceReachable: false, errorMessage: null }),
    ['network_hint'],
  )
  assert.deepEqual(
    modelSetupInfoBlocks({ huggingFaceReachable: true, errorMessage: 'boom' }),
    ['error_banner'],
  )
})
