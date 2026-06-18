import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import {
  buildM3IpcSecurityReport,
  DEFAULT_M3_IPC_SECURITY_FILE,
  M3_IPC_SECURITY_GATE,
  parseM3IpcSecurityArgs,
} from '../scripts/m3-ipc-security-audit.mjs'
import packageJson from '../package.json' with { type: 'json' }

const execFileAsync = promisify(execFile)

test('m3 ipc security args support strict modes and output path', () => {
  assert.deepEqual(parseM3IpcSecurityArgs([
    '--generated-at=2026-06-18T10:00:00Z',
    '--output',
    'artifacts/v1/m3-ipc-security.json',
    '--require-ready',
    '--require-full-validation',
    '--require-high-risk-audit',
  ]), {
    generatedAt: '2026-06-18T10:00:00Z',
    help: false,
    outputPath: 'artifacts/v1/m3-ipc-security.json',
    requireFullValidation: true,
    requireHighRiskAudit: true,
    requireReady: true,
  })
})

test('m3 ipc security report summarizes current IPC inventory safely', async () => {
  const report = await buildM3IpcSecurityReport({
    generatedAt: '2026-06-18T10:00:00Z',
  })
  const json = JSON.stringify(report)

  assert.equal(report.gate, M3_IPC_SECURITY_GATE)
  assert.equal(report.generatedAt, '2026-06-18T10:00:00.000Z')
  assert.equal(report.ok, true)
  assert.equal(report.overallStatus, 'ready')
  assert.ok(report.totals.ipcHandlerCount > 100)
  assert.equal(report.totals.ipcHandlerCount, report.totals.preloadInvokeChannelCount)
  assert.deepEqual(report.preloadContract.missingHandlerChannels, [])
  assert.deepEqual(report.preloadContract.handlersNotExposedToPreload, [])
  assert.deepEqual(report.preloadContract.missingSubscriptionSources, [])
  assert.equal(report.trustedSender.ready, true)
  assert.deepEqual(report.trustedSender.missingTrustedSenderChannels, [])
  assert.equal(report.secretBoundary.ready, true)
  assert.equal(report.secretBoundary.vaultRetrieveReturnsRefs, true)
  assert.equal(report.secretBoundary.vaultRetrieveManyReturnsRefs, true)
  assert.equal(report.secretBoundary.directVaultRetrieveImported, false)
  assert.ok(report.secretBoundary.outboundRefResolutionChannelCount > 0)
  assert.equal(report.auditLog.appendOnlyJsonLines, true)
  assert.equal(report.requestValidation.fullRequestValidationReady, true)
  assert.equal(report.requestValidation.unvalidatedPayloadCount, 0)
  assert.deepEqual(report.requestValidation.unvalidatedPayloadChannels, [])
  assert.equal(report.globalHighRiskAudit.ready, true)
  assert.equal(report.globalHighRiskAudit.writesAuditLog, true)
  assert.equal(report.globalHighRiskAudit.avoidsPayloadCopy, true)
  assert.equal(report.highRiskAudit.highRiskAuditReady, true)
  assert.equal(report.highRiskAudit.unauditedHighRiskCount, 0)
  assert.equal(report.privacy.artifactContentsCopied, false)
  assert.equal(json.includes('private user chat sample'), false)
})

test('m3 ipc security strict modes pass full validation and high-risk audit gates', async () => {
  const validationOnlyReport = await buildM3IpcSecurityReport({
    generatedAt: '2026-06-18T10:00:00Z',
    requireFullValidation: true,
  })
  assert.equal(validationOnlyReport.ok, true)
  assert.equal(validationOnlyReport.requestValidation.fullRequestValidationReady, true)
  assert.deepEqual(validationOnlyReport.requestValidation.unvalidatedPayloadChannels, [])

  const report = await buildM3IpcSecurityReport({
    generatedAt: '2026-06-18T10:00:00Z',
    requireFullValidation: true,
    requireHighRiskAudit: true,
  })

  assert.equal(report.ok, true)
  assert.equal(report.blockingIssueIds.some((id) => id.startsWith('unvalidated-payload:')), false)
  assert.equal(report.blockingIssueIds.some((id) => id.startsWith('unaudited-high-risk:')), false)
  assert.deepEqual(report.highRiskAudit.unauditedHighRiskChannels, [])
  assert.ok(report.handlers.some((handler) => (
    handler.channel === 'tool:open-external'
    && handler.auditCoverage === 'global-wrapper'
  )))
})

test('m3 ipc security CLI persists report and enforces inventory readiness', async () => {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'nexus-m3-ipc-'))
  try {
    const outputPath = path.join(directoryPath, 'm3-ipc-security.json')
    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/m3-ipc-security-audit.mjs',
      '--generated-at',
      '2026-06-18T10:00:00Z',
      '--output',
      outputPath,
      '--require-ready',
    ], { cwd: process.cwd(), maxBuffer: 1024 * 1024 * 8 })
    const stdoutReport = JSON.parse(stdout)
    const fileReport = JSON.parse(await readFile(outputPath, 'utf8'))

    assert.deepEqual(fileReport, stdoutReport)
    assert.equal(fileReport.ok, true)
    assert.equal(fileReport.gate, M3_IPC_SECURITY_GATE)
  } finally {
    await rm(directoryPath, { recursive: true, force: true })
  }
})

test('m3 ipc security package wiring stays available', () => {
  assert.equal(packageJson.scripts?.['m3:ipc:audit'], 'node scripts/m3-ipc-security-audit.mjs')
  assert.ok(packageJson.build?.files?.includes('scripts/m3-ipc-security-audit.mjs'))
  assert.ok(packageJson.build?.asarUnpack?.includes('scripts/m3-ipc-security-audit.mjs'))
  assert.equal(DEFAULT_M3_IPC_SECURITY_FILE, 'artifacts/v1/m3-ipc-security.json')
})
