import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildV04DraftStackReport,
  summarizeV04DraftStackReport,
} from '../scripts/v04-draft-stack-audit.mjs'

test('v0.4 draft stack audit guards the no-release state', () => {
  const report = buildV04DraftStackReport(undefined, { mode: 'quick' })
  const summary = summarizeV04DraftStackReport(report)

  assert.equal(report.schemaVersion, 1)
  assert.equal(report.mode, 'quick')
  assert.equal(summary.ok, true)
  assert.equal(summary.errors, 0)
  assert.equal(report.stableRelease, 'v0.4.0')
  assert.deepEqual(report.draftReleases, ['v0.4.1', 'v0.4.2', 'v0.4.3', 'v0.4.4', 'v0.4.5'])
  assert.equal(report.privacy.staticSourceOnly, true)
  assert.equal(report.privacy.readsUserData, false)
  assert.equal(report.privacy.readsEnvironment, false)
  assert.equal(report.privacy.readsNetwork, false)
  assert.equal(report.privacy.createsReleaseArtifacts, false)
})
