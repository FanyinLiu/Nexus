import assert from 'node:assert/strict'
import test from 'node:test'
import { getPortraitModelStatus } from '../electron/services/portraitGenerator/portraitModelDownloader.js'
import { PORTRAIT_MODEL_CATALOG } from '../shared/portraitModels.js'

test('portrait status keeps hash-invalid models repairable and returns no paths', async () => {
  const broken = PORTRAIT_MODEL_CATALOG.find((model) => model.wired)!
  let inspections = 0
  const status = await getPortraitModelStatus({
    directory: '/isolated-models',
    inspect: async (directory: string, options: { files: Record<string, { sha256: string }> }) => {
      inspections += 1
      assert.equal(directory, '/isolated-models')
      for (const model of PORTRAIT_MODEL_CATALOG) assert.equal(options.files[model.id].sha256, model.sha256)
      return {
        ready: false,
        files: Object.fromEntries(PORTRAIT_MODEL_CATALOG.map((model) => [model.id, {
          filePath: `/private/${model.fileName}`,
          status: model.id === broken.id ? 'hash_mismatch' : 'ok',
        }])),
      }
    },
  })
  assert.equal(inspections, 1)
  assert.equal(status.models.find((model: { id: string }) => model.id === broken.id)?.installed, 'invalid')
  assert.equal(status.downloadBytes, broken.sizeBytes)
  assert.equal(JSON.stringify(status).includes('/private/'), false)
})

test('portrait status distinguishes absent files from size-invalid files', async () => {
  const status = await getPortraitModelStatus({
    directory: '/isolated-models',
    inspect: async () => ({
      ready: false,
      files: Object.fromEntries(PORTRAIT_MODEL_CATALOG.map((model, index) => [model.id, {
        filePath: model.fileName,
        status: index === 0 ? 'missing' : 'size_mismatch',
      }])),
    }),
  })
  assert.equal(status.models[0].installed, 'missing')
  assert.equal(status.models[1].installed, 'invalid')
  assert.equal(status.downloadBytes, PORTRAIT_MODEL_CATALOG.filter((model) => model.wired).reduce((total, model) => total + model.sizeBytes, 0))
})
