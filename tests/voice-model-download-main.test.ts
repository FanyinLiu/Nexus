import assert from 'node:assert/strict'
import { test } from 'node:test'

import { downloadMissingRequired } from '../electron/services/modelManager.js'

const installedRequired = [
  { id: 'kws-en', required: true, present: true },
  { id: 'kws-zh', required: true, present: true },
  { id: 'vad', required: true, present: true },
  { id: 'sensevoice', required: false, present: false },
  { id: 'paraformer-zh-en', required: false, present: false },
]

test('downloadMissingRequired fetches the selected local listener', async () => {
  const fetched: string[] = []
  const downloadOne = async (id: string) => {
    fetched.push(id)
  }
  const inventory = {
    models: installedRequired,
    missingRequired: [] as string[],
    ready: true,
  }

  await downloadMissingRequired('local-sensevoice', { inventory, downloadOne })
  assert.deepEqual(fetched, ['sensevoice'])

  fetched.length = 0
  await downloadMissingRequired('local-paraformer', { inventory, downloadOne })
  assert.deepEqual(fetched, ['paraformer-zh-en'])

  fetched.length = 0
  await downloadMissingRequired('zhipu-stt', { inventory, downloadOne })
  assert.deepEqual(fetched, [])

  fetched.length = 0
  await downloadMissingRequired('local-sensevoice', {
    inventory: {
      ...inventory,
      ready: false,
      missingRequired: ['vad'],
      models: installedRequired.map((model) => (
        model.id === 'vad' ? { ...model, present: false } : model
      )),
    },
    downloadOne,
  })
  assert.deepEqual(fetched, ['vad', 'sensevoice'])
})
