import assert from 'node:assert/strict'
import test from 'node:test'

import { createVerifiedUpdateGate } from '../electron/services/updateDownloadGate.js'

test('a verified manifest is the only path that starts the download', async () => {
  const downloads = []
  const gate = createVerifiedUpdateGate({
    verifyManifest: async () => ({ ok: true }),
    downloadUpdate: async () => {
      downloads.push('download')
    },
  })

  const result = await gate.handleUpdateAvailable({ version: '0.4.8', tag: 'v0.4.8' })

  assert.deepEqual(result, { ok: true, version: '0.4.8' })
  assert.deepEqual(downloads, ['download'])
  assert.equal(gate.isVerified('0.4.8'), true)
  assert.equal(gate.isVerified('0.4.9'), false)
  assert.equal(gate.isVerified(null), false)
})

test('a failed verification refuses the download and forgets any earlier verification', async () => {
  let downloads = 0
  const refusals = []
  const responses = [
    { ok: true },
    { ok: false, reason: 'sha512-mismatch' },
  ]
  const gate = createVerifiedUpdateGate({
    verifyManifest: async () => responses.shift() ?? { ok: false, reason: 'unexpected' },
    downloadUpdate: async () => {
      downloads += 1
    },
    onRefused: (input) => {
      refusals.push(input)
    },
  })

  assert.equal((await gate.handleUpdateAvailable({ version: '0.4.8' })).ok, true)
  assert.equal(gate.isVerified('0.4.8'), true)

  const result = await gate.handleUpdateAvailable({ version: '0.4.9' })
  assert.deepEqual(result, { ok: false, reason: 'sha512-mismatch' })
  assert.equal(downloads, 1)
  assert.equal(gate.isVerified('0.4.8'), false)
  assert.equal(gate.isVerified('0.4.9'), false)
  assert.deepEqual(refusals, [{ version: '0.4.9', reason: 'sha512-mismatch' }])
})

test('verification exceptions and missing versions fail closed without downloading', async () => {
  let downloads = 0
  const refusals = []
  const gate = createVerifiedUpdateGate({
    verifyManifest: async () => {
      throw new Error('verification crashed')
    },
    downloadUpdate: async () => {
      downloads += 1
    },
    onRefused: (input) => {
      refusals.push(input)
    },
  })

  const thrown = await gate.handleUpdateAvailable({ version: '0.4.8' })
  assert.deepEqual(thrown, { ok: false, reason: 'verification-error' })

  const missing = await gate.handleUpdateAvailable({})
  assert.deepEqual(missing, { ok: false, reason: 'missing-version' })

  assert.equal(downloads, 0)
  assert.equal(gate.isVerified('0.4.8'), false)
  assert.deepEqual(refusals, [
    { version: '0.4.8', reason: 'verification-error' },
    { version: null, reason: 'missing-version' },
  ])
})

test('a download that fails to start clears the verified version', async () => {
  const errors = []
  const gate = createVerifiedUpdateGate({
    verifyManifest: async () => ({ ok: true }),
    downloadUpdate: async () => {
      throw new Error('download failed')
    },
    onDownloadError: (error) => {
      errors.push(error)
    },
  })

  const result = await gate.handleUpdateAvailable({ version: '0.4.8' })
  assert.deepEqual(result, { ok: false, reason: 'download-failed' })
  assert.equal(errors.length, 1)
  assert.equal(gate.isVerified('0.4.8'), false)
})
