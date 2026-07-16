import assert from 'node:assert/strict'
import test from 'node:test'

import {
  FORBIDDEN_MAC_SIGNING_ENV,
  validateMacBuildConfig,
  validateMacReleaseEnvironment,
} from '../scripts/mac-release-preflight.mjs'

const makeUnsignedPackage = () => ({
  build: {
    appId: 'ai.factory.desktoppet',
    productName: 'Nexus',
    forceCodeSigning: false,
    electronFuses: {
      runAsNode: false,
      enableCookieEncryption: true,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      onlyLoadAppFromAsar: true,
      enableEmbeddedAsarIntegrityValidation: true,
    },
    mac: {
      identity: '-',
      hardenedRuntime: false,
      gatekeeperAssess: false,
      notarize: false,
      extraResources: [
        { from: 'sherpa-models', to: 'sherpa-models' },
        { from: 'public/vendor/vad/silero_vad_v5.onnx', to: 'silero_vad_v5.onnx' },
      ],
    },
  },
})

test('mac unsigned release preflight rejects signing and notarization secrets', () => {
  const result = validateMacReleaseEnvironment(
    Object.fromEntries(FORBIDDEN_MAC_SIGNING_ENV.map((name) => [name, 'present'])),
  )

  assert.equal(result.ok, false)
  assert.deepEqual(result.configuredSigningEnvironment, FORBIDDEN_MAC_SIGNING_ENV)
  assert.match(result.errors[0], /must not receive signing\/notarization environment/)
})

test('mac unsigned release preflight rejects smoke and enabled identity discovery modes', () => {
  const result = validateMacReleaseEnvironment({
    CSC_IDENTITY_AUTO_DISCOVERY: 'true',
    SMOKE_TEST: '1',
  })

  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /must be false/)
  assert.match(result.errors.join('\n'), /SMOKE_TEST=1/)
})

test('mac unsigned release preflight accepts absent or explicitly disabled identity discovery', () => {
  assert.equal(validateMacReleaseEnvironment({}).ok, true)
  assert.equal(validateMacReleaseEnvironment({ CSC_IDENTITY_AUTO_DISCOVERY: 'false' }).ok, true)
})

test('mac release preflight validates the formal explicit unsigned builder profile', () => {
  assert.equal(validateMacBuildConfig(makeUnsignedPackage()).ok, true)

  const invalid = makeUnsignedPackage()
  invalid.build.productName = 'Nexus Smoke'
  invalid.build.forceCodeSigning = true
  invalid.build.mac.identity = 'Developer ID Application'
  invalid.build.mac.hardenedRuntime = true
  invalid.build.mac.gatekeeperAssess = true
  invalid.build.mac.notarize = true

  const result = validateMacBuildConfig(invalid)
  assert.equal(result.ok, false)
  assert.equal(result.errors.length, 6)
})

test('mac release preflight requires both production runtime resources exactly once', () => {
  const missingVad = makeUnsignedPackage()
  missingVad.build.mac.extraResources.pop()
  assert.match(validateMacBuildConfig(missingVad).errors.join('\n'), /silero_vad_v5\.onnx/)

  const duplicateModels = makeUnsignedPackage()
  duplicateModels.build.mac.extraResources.push({ from: 'sherpa-models', to: 'sherpa-models' })
  assert.match(validateMacBuildConfig(duplicateModels).errors.join('\n'), /exactly one sherpa-models/)
})

test('mac release preflight requires the production security fuse profile', () => {
  const invalid = makeUnsignedPackage()
  invalid.build.electronFuses.enableCookieEncryption = false
  invalid.build.electronFuses.runAsNode = true

  const result = validateMacBuildConfig(invalid)
  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /enableCookieEncryption must be true/)
  assert.match(result.errors.join('\n'), /runAsNode must be false/)
})
