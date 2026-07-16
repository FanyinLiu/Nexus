import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isExplicitGatekeeperRejection,
  isExplicitMissingStapledTicket,
  parseArchitectures,
  parseCodeSignatureDetails,
  requiredMacReleaseResources,
  verifyMacRelease,
} from '../scripts/verify-mac-release.mjs'

test('mac release verifier recognizes Developer ID and ad-hoc signatures', () => {
  const developerId = parseCodeSignatureDetails([
    'Authority=Developer ID Application: Nexus Release (TEAM123456)',
    'Authority=Developer ID Certification Authority',
    'TeamIdentifier=TEAM123456',
  ].join('\n'))
  const adHoc = parseCodeSignatureDetails('CodeDirectory v=20500 size=123 flags=0x2(adhoc) hashes=3\nSignature=adhoc\nTeamIdentifier=not set\n')

  assert.equal(developerId.isDeveloperId, true)
  assert.equal(developerId.isAdHoc, false)
  assert.equal(adHoc.isDeveloperId, false)
  assert.equal(adHoc.isAdHoc, true)
  assert.deepEqual(parseArchitectures('arm64 x86_64\n'), ['arm64', 'x86_64'])
})

function makeRunner({
  bundleIdentifier = 'ai.factory.desktoppet',
  bundleVersion = '0.4.3',
  signature = 'Signature=adhoc\nCodeDirectory flags=0x2(adhoc)\nTeamIdentifier=not set\n',
  gatekeeperAccepted = false,
  notarizationTicketPresent = false,
  architectures = 'arm64',
} = {}) {
  return (command: string, args: string[]) => {
    if (command === 'plutil') {
      const values: Record<string, string> = {
        CFBundleIdentifier: bundleIdentifier,
        CFBundleShortVersionString: bundleVersion,
        CFBundleExecutable: 'Nexus',
        CFBundleName: 'Nexus',
      }
      return { ok: true, output: values[args[1]] ?? '' }
    }
    if (command === 'lipo') return { ok: true, output: architectures }
    if (command === 'codesign' && args[0] === '--verify') return { ok: true, output: '' }
    if (command === 'codesign') return { ok: true, output: signature }
    if (command === 'spctl') {
      return { ok: gatekeeperAccepted, output: gatekeeperAccepted ? 'accepted' : 'Nexus.app: rejected' }
    }
    if (command === 'xcrun') {
      return {
        ok: notarizationTicketPresent,
        output: notarizationTicketPresent ? 'The validate action worked!' : 'Nexus.app does not have a ticket stapled to it.',
      }
    }
    return { ok: false, output: '' }
  }
}

const resourcesPass = () => ({ ok: true, errors: [] })

test('mac release verifier accepts the formal arm64 explicit unsigned contract', () => {
  const result = verifyMacRelease('/release/mac-arm64/Nexus.app', {
    expectUnsigned: true,
    expectedVersion: '0.4.3',
    pathExists: () => true,
    fileSize: () => 1,
    resourceVerifier: resourcesPass,
    runCommand: makeRunner(),
  })

  assert.equal(result.ok, true)
  assert.equal(result.mode, 'unsigned')
  assert.equal(result.bundleIdentifier, 'ai.factory.desktoppet')
  assert.deepEqual(result.architectures, ['arm64'])
  assert.equal(result.isAdHoc, true)
  assert.equal(result.gatekeeperAccepted, false)
  assert.equal(result.notarizationTicketPresent, false)
})

test('mac unsigned verifier fails closed on signed trust or wrong formal identity', () => {
  const result = verifyMacRelease('/release/mac-arm64/Nexus Smoke.app', {
    expectUnsigned: true,
    expectedVersion: '0.4.3',
    pathExists: () => true,
    fileSize: () => 1,
    resourceVerifier: resourcesPass,
    runCommand: makeRunner({
      bundleIdentifier: 'ai.factory.desktoppet.smoke',
      bundleVersion: '0.4.2',
      signature: 'Authority=Developer ID Application: Nexus (TEAM123456)\nTeamIdentifier=TEAM123456\n',
      gatekeeperAccepted: true,
      notarizationTicketPresent: true,
      architectures: 'x86_64',
    }),
  })

  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /named Nexus\.app/)
  assert.match(result.errors.join('\n'), /bundle identifier/)
  assert.match(result.errors.join('\n'), /bundle version/)
  assert.match(result.errors.join('\n'), /smoke identity/)
  assert.match(result.errors.join('\n'), /arm64/)
  assert.match(result.errors.join('\n'), /ad-hoc signature/)
  assert.match(result.errors.join('\n'), /Gatekeeper/)
  assert.match(result.errors.join('\n'), /notarization ticket/)
})

test('mac unsigned verifier rejects universal builds instead of accepting arm64 as one slice', () => {
  const result = verifyMacRelease('/release/mac-arm64/Nexus.app', {
    expectUnsigned: true,
    expectedVersion: '0.4.3',
    pathExists: () => true,
    fileSize: () => 1,
    resourceVerifier: resourcesPass,
    runCommand: makeRunner({ architectures: 'arm64 x86_64' }),
  })

  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /arm64 only/)
})

test('mac unsigned verifier fails closed when trust tools are unavailable or fail ambiguously', () => {
  const ambiguousRunner = (command: string, args: string[]) => {
    if (command === 'spctl') return { ok: false, output: 'spctl: command failed for unrelated reason' }
    if (command === 'xcrun') return { ok: false, output: 'xcrun: tool unavailable', executed: false, error: 'ENOENT' }
    return makeRunner()(command, args)
  }
  const result = verifyMacRelease('/release/mac-arm64/Nexus.app', {
    expectUnsigned: true,
    expectedVersion: '0.4.3',
    pathExists: () => true,
    fileSize: () => 1,
    resourceVerifier: resourcesPass,
    runCommand: ambiguousRunner,
  })

  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /explicit rejection/)
  assert.match(result.errors.join('\n'), /explicitly report a missing ticket/)
  assert.equal(isExplicitGatekeeperRejection({ ok: false, output: 'Nexus.app: rejected' }), true)
  assert.equal(isExplicitGatekeeperRejection({ ok: false, output: 'tool failed' }), false)
  assert.equal(isExplicitMissingStapledTicket({ ok: false, output: 'Nexus.app does not have a ticket stapled to it.' }), true)
  assert.equal(isExplicitMissingStapledTicket({ ok: false, output: 'xcrun missing', executed: false }), false)
})

test('signed verifier remains available as an optional future readiness tool', () => {
  const result = verifyMacRelease('/release/mac-arm64/Nexus.app', {
    expectedVersion: '0.4.3',
    pathExists: () => true,
    fileSize: () => 1,
    resourceVerifier: resourcesPass,
    runCommand: makeRunner({
      signature: 'Authority=Developer ID Application: Nexus Release (TEAM123456)\nTeamIdentifier=TEAM123456\n',
      gatekeeperAccepted: true,
      notarizationTicketPresent: true,
    }),
  })

  assert.equal(result.ok, true)
  assert.equal(result.mode, 'signed')
  assert.equal(result.teamIdentifier, 'TEAM123456')
})

test('mac release verifier requires app.asar and every required voice runtime resource', () => {
  const required = requiredMacReleaseResources('/release/mac-arm64/Nexus.app')
  assert.deepEqual(required.map((resource) => resource.modelId), [
    'app-asar',
    'kws-en',
    'kws-zh',
    'sensevoice',
    'vad',
  ])

  const missingSenseVoice = verifyMacRelease('/release/mac-arm64/Nexus.app', {
    expectUnsigned: true,
    expectedVersion: '0.4.3',
    pathExists: () => true,
    fileSize: () => 1,
    resourceVerifier: () => ({
      ok: false,
      errors: ['required packaged resource is missing: sensevoice'],
    }),
    runCommand: makeRunner(),
  })
  assert.equal(missingSenseVoice.ok, false)
  assert.match(missingSenseVoice.errors.join('\n'), /required packaged resource is missing: sensevoice/)

  const emptyVad = verifyMacRelease('/release/mac-arm64/Nexus.app', {
    expectUnsigned: true,
    expectedVersion: '0.4.3',
    pathExists: () => true,
    fileSize: () => 1,
    resourceVerifier: () => ({
      ok: false,
      errors: ['required packaged resource is empty: vad'],
    }),
    runCommand: makeRunner(),
  })
  assert.equal(emptyVad.ok, false)
  assert.match(emptyVad.errors.join('\n'), /required packaged resource is empty: vad/)
})
