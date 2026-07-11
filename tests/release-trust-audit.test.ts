import assert from 'node:assert/strict'
import test from 'node:test'
import { buildReleaseTrustReport, summarizeReleaseTrustReport } from '../scripts/release-trust-audit.mjs'

test('release trust audit documents the signed platform posture', () => {
  const report = buildReleaseTrustReport()
  const summary = summarizeReleaseTrustReport(report)

  assert.equal(report.schemaVersion, 1)
  assert.equal(summary.error, 0)
  assert.equal(report.updateChannel.provider, 'github')
  assert.equal(report.platforms.mac.signing.posture, 'signed-ready')
  assert.equal(report.platforms.windows.signing.posture, 'signed-ready')
  assert.equal(report.platforms.linux.integrity.sha256Sums, true)
  assert.equal(report.platforms.linux.integrity.optionalGpg, true)
})

test('release signing readiness reports a complete signed profile', () => {
  const report = buildReleaseTrustReport(undefined, { includeSigningReadiness: true })
  const summary = summarizeReleaseTrustReport(report)
  const macReadiness = report.checks.find((check) => check.id === 'mac.signed-readiness')
  const windowsReadiness = report.checks.find((check) => check.id === 'windows.signed-readiness')

  assert.equal(summary.error, 0)
  assert.equal(macReadiness?.status, 'ok')
  assert.equal(windowsReadiness?.status, 'ok')
  assert.equal(report.platforms.mac.signedReadiness.ready, true)
  assert.equal(report.platforms.windows.signedReadiness.ready, true)
  assert.deepEqual(report.platforms.mac.signedReadiness.blockers, [])
  assert.deepEqual(report.platforms.windows.signedReadiness.blockers, [])
})

test('release signing gate accepts the signed macOS release profile', () => {
  const report = buildReleaseTrustReport(undefined, { requireSigned: 'mac' })
  const summary = summarizeReleaseTrustReport(report)
  const readiness = report.checks.find((check) => check.id === 'mac.signed-readiness')

  assert.equal(summary.error, 0)
  assert.equal(readiness?.status, 'ok')
})

test('release signing gate accepts the signed Windows release profile', () => {
  const report = buildReleaseTrustReport(undefined, { requireSigned: 'windows' })
  const summary = summarizeReleaseTrustReport(report)
  const readiness = report.checks.find((check) => check.id === 'windows.signed-readiness')

  assert.equal(summary.error, 0)
  assert.equal(readiness?.status, 'ok')
})

test('release signing gate can require all signed platform profiles', () => {
  const report = buildReleaseTrustReport(undefined, { requireSigned: 'all' })
  const summary = summarizeReleaseTrustReport(report)

  assert.equal(summary.error, 0)
  assert.equal(report.checks.find((check) => check.id === 'mac.signed-readiness')?.status, 'ok')
  assert.equal(report.checks.find((check) => check.id === 'windows.signed-readiness')?.status, 'ok')
})

test('release trust audit does not inspect or serialize secret values', () => {
  const reportText = JSON.stringify(buildReleaseTrustReport())

  assert.match(reportText, /APPLE_API_KEY_ID/)
  assert.doesNotMatch(reportText, /sk-[A-Za-z0-9]/)
  assert.doesNotMatch(reportText, /-----BEGIN PRIVATE KEY-----/)
})
