import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  assertNotPrivateCodexPetSource,
  getPrivateCodexPetSourceReason,
} from '../electron/services/spritePetPackage.js'

test('getPrivateCodexPetSourceReason flags paths inside a Codex app bundle / asar', () => {
  assert.match(
    getPrivateCodexPetSourceReason('/Applications/Codex.app/Contents/Resources/pets/x/pet.json'),
    /Codex application bundle|app\.asar/,
  )
  assert.notEqual(getPrivateCodexPetSourceReason('/opt/foo/app.asar/pets/x'), '')
  assert.notEqual(getPrivateCodexPetSourceReason('/opt/foo/app.asar.unpacked/pets/x'), '')
  assert.notEqual(getPrivateCodexPetSourceReason('/home/u/codex-app/pets/x'), '')
})

test('getPrivateCodexPetSourceReason flags extracted built-in asset filenames', () => {
  for (const name of [
    'codex-spritesheet-mascot.png',
    'codex-avatar-froge.webp',
    'avatar-mascot-default.png',
    'use-avatar-options-1.json',
  ]) {
    assert.notEqual(getPrivateCodexPetSourceReason(`/tmp/${name}`), '', name)
  }
})

test('getPrivateCodexPetSourceReason allows ordinary community / user pet packages', () => {
  assert.equal(getPrivateCodexPetSourceReason('/Users/klein/.codex/pets/mypet/pet.json'), '')
  assert.equal(getPrivateCodexPetSourceReason('/tmp/community-pack/spritesheet.webp'), '')
  assert.equal(getPrivateCodexPetSourceReason(''), '')
})

test('getPrivateCodexPetSourceReason normalizes backslashes before matching', () => {
  // Windows-style separators must not let a Codex.app path slip past the guard.
  assert.notEqual(getPrivateCodexPetSourceReason('C:\\Apps\\Codex.app\\pets\\x'), '')
})

test('assertNotPrivateCodexPetSource throws for private sources, passes clean ones', () => {
  assert.throws(() => assertNotPrivateCodexPetSource('/Applications/Codex.app/pets/x'))
  assert.doesNotThrow(() => assertNotPrivateCodexPetSource('/tmp/community/spritesheet.webp'))
})
