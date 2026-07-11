import assert from 'node:assert/strict'
import test from 'node:test'

import { parseCodeSignatureDetails } from '../scripts/verify-mac-release.mjs'

test('mac release verifier recognizes a Developer ID signature', () => {
  const details = parseCodeSignatureDetails([
    'Authority=Developer ID Application: Nexus Release (TEAM123456)',
    'Authority=Developer ID Certification Authority',
    'TeamIdentifier=TEAM123456',
  ].join('\n'))

  assert.equal(details.isDeveloperId, true)
  assert.equal(details.teamIdentifier, 'TEAM123456')
})

test('mac release verifier rejects an ad-hoc signature', () => {
  const details = parseCodeSignatureDetails('CodeDirectory flags=0x2(adhoc)\nTeamIdentifier=not set\n')

  assert.equal(details.isDeveloperId, false)
})
