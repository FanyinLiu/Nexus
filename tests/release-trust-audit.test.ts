import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  buildReleaseTrustReport,
  parseReleaseTrustArgs,
  summarizeReleaseTrustReport,
} from '../scripts/release-trust-audit.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test('release trust audit documents the explicit unsigned platform posture', () => {
  const report = buildReleaseTrustReport()
  const summary = summarizeReleaseTrustReport(report)

  assert.equal(report.schemaVersion, 1)
  assert.equal(summary.error, 0)
  assert.equal(report.updateChannel.provider, 'github')
  assert.equal(report.platforms.mac.signing.posture, 'unsigned-explicit')
  assert.equal(report.platforms.windows.signing.posture, 'unsigned-explicit')
  assert.equal(report.platforms.linux.integrity.sha256Sums, true)
  assert.equal(report.platforms.linux.integrity.gpgRemoved, true)
  assert.equal(report.releaseProfile.formalIdentity.ready, true)
  assert.equal(report.releaseProfile.unsignedWorkflow.ready, true)
})

test('release unsigned gate accepts both explicit unsigned platform profiles', () => {
  const report = buildReleaseTrustReport(undefined, { requireUnsigned: 'all' })
  const summary = summarizeReleaseTrustReport(report)

  assert.equal(summary.error, 0)
  assert.equal(report.checks.find((check) => check.id === 'mac.unsigned-gate')?.status, 'ok')
  assert.equal(report.checks.find((check) => check.id === 'windows.unsigned-gate')?.status, 'ok')
})

test('future signing readiness remains reportable but is not the release gate', () => {
  const report = buildReleaseTrustReport(undefined, { includeSigningReadiness: true })
  const summary = summarizeReleaseTrustReport(report)
  const macReadiness = report.checks.find((check) => check.id === 'mac.signed-readiness')
  const windowsReadiness = report.checks.find((check) => check.id === 'windows.signed-readiness')

  assert.equal(summary.error, 0)
  assert.equal(macReadiness?.status, 'warning')
  assert.equal(windowsReadiness?.status, 'warning')
  assert.equal(report.platforms.mac.signedReadiness.ready, false)
  assert.equal(report.platforms.windows.signedReadiness.ready, false)
})

test('legacy signed hard gate fails while the explicit unsigned profile is active', () => {
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

test('release trust argument parser accepts only explicit hard-gate profiles', () => {
  assert.deepEqual(parseReleaseTrustArgs(['--require-unsigned', 'all', '--json']), {
    json: true,
    includeSigningReadiness: false,
    requireSigned: null,
    requireUnsigned: 'all',
  })
  assert.deepEqual(parseReleaseTrustArgs(['--require-signed=windows']), {
    json: false,
    includeSigningReadiness: true,
    requireSigned: 'windows',
    requireUnsigned: null,
  })

  for (const argv of [
    ['--require-unsigned', 'typo'],
    ['--require-signed', 'typo'],
    ['--require-unsigned'],
    ['--require-signed', '--json'],
    ['--require-unsigned='],
    ['--require-signed=all', '--require-unsigned=all'],
    ['--require-signed=mac', '--require-signed=mac'],
    ['--unknown'],
    ['windows'],
  ]) {
    assert.throws(() => parseReleaseTrustArgs(argv), /requires one of|mutually exclusive|only be provided once|unknown argument/)
  }
})

test('release trust CLI fails closed before auditing malformed gate arguments', () => {
  for (const args of [
    ['--require-unsigned', 'typo'],
    ['--require-signed'],
    ['--unknown'],
  ]) {
    const result = spawnSync(process.execPath, ['scripts/release-trust-audit.mjs', ...args], {
      cwd: ROOT,
      encoding: 'utf8',
    })
    assert.equal(result.status, 2)
    assert.match(result.stderr, /Release trust audit argument error:/)
    assert.equal(result.stdout, '')
  }
})
