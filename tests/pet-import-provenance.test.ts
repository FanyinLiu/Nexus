import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertNotPrivateCodexPetSource,
  getPrivateCodexPetSourceReason,
} from '../electron/services/petImportPolicy.js'
import { PET_IPC_ERROR_CODES } from '../shared/petErrorCodes.js'

test('a user model folder is allowed and a private Codex bundle is not', () => {
  assert.equal(getPrivateCodexPetSourceReason('/home/me/Models/Mao/Mao.model3.json'), '')
  assert.match(
    getPrivateCodexPetSourceReason('/Applications/Codex.app/Contents/Resources/app.asar'),
    /Codex application/,
  )
  assert.match(
    getPrivateCodexPetSourceReason('/tmp/codex-spritesheet-mao.png'),
    /extracted Codex/,
  )
})

test('rejecting a private Codex source uses the unsupported-file code', () => {
  assert.throws(
    () => assertNotPrivateCodexPetSource('/tmp/app.asar.unpacked/pet'),
    (error: unknown) => error instanceof Error && error.message === PET_IPC_ERROR_CODES.UNSUPPORTED_FILE,
  )
})
