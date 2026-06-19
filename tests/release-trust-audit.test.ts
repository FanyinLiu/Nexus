import assert from 'node:assert/strict'
import test from 'node:test'
import { buildReleaseTrustReport, summarizeReleaseTrustReport } from '../scripts/release-trust-audit.mjs'

test('release trust audit documents the current platform posture', () => {
  const report = buildReleaseTrustReport()
  const summary = summarizeReleaseTrustReport(report)

  assert.equal(report.schemaVersion, 1)
  assert.equal(summary.error, 0)
  assert.equal(report.updateChannel.provider, 'github')
  assert.equal(report.platforms.mac.signing.posture, 'unsigned-explicit')
  assert.equal(report.platforms.windows.signing.posture, 'unsigned-explicit')
  assert.equal(report.platforms.linux.integrity.sha256Sums, true)
  assert.equal(report.platforms.linux.integrity.optionalGpg, true)
})

test('release signing readiness reports blockers without failing the default audit', () => {
  const report = buildReleaseTrustReport(undefined, { includeSigningReadiness: true })
  const summary = summarizeReleaseTrustReport(report)
  const macReadiness = report.checks.find((check) => check.id === 'mac.signed-readiness')
  const windowsReadiness = report.checks.find((check) => check.id === 'windows.signed-readiness')

  assert.equal(summary.error, 0)
  assert.equal(macReadiness?.status, 'warning')
  assert.equal(windowsReadiness?.status, 'warning')
  assert.equal(report.platforms.mac.signedReadiness.ready, false)
  assert.equal(report.platforms.windows.signedReadiness.ready, false)
  assert.ok(report.platforms.mac.signedReadiness.blockers.some((item) => item.includes('hardenedRuntime')))
  assert.ok(report.platforms.windows.signedReadiness.blockers.some((item) => item.includes('signAndEditExecutable')))
})

test('release signing gate fails until signed macOS release prerequisites are wired', () => {
  const report = buildReleaseTrustReport(undefined, { requireSigned: 'mac' })
  const summary = summarizeReleaseTrustReport(report)
  const readiness = report.checks.find((check) => check.id === 'mac.signed-readiness')

  assert.ok(summary.error > 0)
  assert.equal(readiness?.status, 'error')
})

test('release signing gate fails until signed Windows release prerequisites are wired', () => {
  const report = buildReleaseTrustReport(undefined, { requireSigned: 'windows' })
  const summary = summarizeReleaseTrustReport(report)
  const readiness = report.checks.find((check) => check.id === 'windows.signed-readiness')

  assert.ok(summary.error > 0)
  assert.equal(readiness?.status, 'error')
})

test('release signing gate can require all signed platform profiles', () => {
  const report = buildReleaseTrustReport(undefined, { requireSigned: 'all' })
  const summary = summarizeReleaseTrustReport(report)

  assert.ok(summary.error >= 2)
  assert.equal(report.checks.find((check) => check.id === 'mac.signed-readiness')?.status, 'error')
  assert.equal(report.checks.find((check) => check.id === 'windows.signed-readiness')?.status, 'error')
})

test('release trust audit does not inspect or serialize secret values', () => {
  const reportText = JSON.stringify(buildReleaseTrustReport())

  assert.match(reportText, /APPLE_API_KEY_ID/)
  assert.doesNotMatch(reportText, /sk-[A-Za-z0-9]/)
  assert.doesNotMatch(reportText, /-----BEGIN PRIVATE KEY-----/)
})
