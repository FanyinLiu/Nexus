import assert from 'node:assert/strict'
import test from 'node:test'

import {
  REQUIRED_MAC_RELEASE_ENV,
  validateMacBuildConfig,
  validateMacReleaseEnvironment,
} from '../scripts/mac-release-preflight.mjs'

test('mac release preflight requires every signing and notarization secret', () => {
  const result = validateMacReleaseEnvironment({})

  assert.equal(result.ok, false)
  assert.deepEqual(result.missing, REQUIRED_MAC_RELEASE_ENV)
  assert.match(result.errors[0], /signing\/notarization environment/)
})

test('mac release preflight rejects smoke and disabled identity discovery modes', () => {
  const result = validateMacReleaseEnvironment({
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    SMOKE_TEST: '1',
    ...Object.fromEntries(REQUIRED_MAC_RELEASE_ENV.map((name) => [name, 'present'])),
  })

  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /CSC_IDENTITY_AUTO_DISCOVERY=false/)
  assert.match(result.errors.join('\n'), /SMOKE_TEST=1/)
})

test('mac release preflight validates the production electron-builder profile', () => {
  assert.equal(validateMacBuildConfig({ build: { mac: { hardenedRuntime: true, gatekeeperAssess: true, notarize: true } } }).ok, true)

  const result = validateMacBuildConfig({ build: { mac: { hardenedRuntime: false, gatekeeperAssess: false, notarize: false } } })
  assert.equal(result.ok, false)
  assert.equal(result.errors.length, 3)
})
