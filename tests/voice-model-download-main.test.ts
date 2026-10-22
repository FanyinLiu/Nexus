import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { activeModelDownloadIds, downloadMissingRequired } from '../electron/services/modelManager.js'

const installedRequired = [
  { id: 'kws-en', required: true, present: true },
  { id: 'kws-zh', required: true, present: true },
  { id: 'vad', required: true, present: true },
  { id: 'sensevoice', required: false, present: false },
  { id: 'paraformer-zh-en', required: false, present: false },
]

describe('downloadMissingRequired', { concurrency: 1 }, () => {

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

test('a second download request while one is in flight does not fetch again', async () => {
  const calls: string[] = []
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => { release = resolve })
  const downloadOne = async (id: string) => {
    calls.push(id)
    await gate
  }
  const inventory = {
    models: installedRequired,
    missingRequired: [] as string[],
    ready: true,
  }
  const first = downloadMissingRequired('local-sensevoice', { inventory, downloadOne })
  const second = downloadMissingRequired('local-paraformer', { inventory, downloadOne })
  await Promise.resolve()
  await Promise.resolve()
  assert.deepEqual(calls, ['sensevoice'])
  assert.deepEqual(activeModelDownloadIds(), ['sensevoice'])
  release()
  await first
  await second
  assert.deepEqual(calls, ['sensevoice'])
  assert.deepEqual(activeModelDownloadIds(), [])
})

})
