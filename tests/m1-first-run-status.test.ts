import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import {
  buildM1FirstRunStatusReport,
  DEFAULT_M1_FIRST_RUN_AUDIT_FILE,
  DEFAULT_M1_FIRST_RUN_OPERATOR_DIR,
  M1_FIRST_RUN_AUDIT_GATE,
  M1_FIRST_RUN_OPERATOR_EVIDENCE_GATE,
  M1_FIRST_RUN_STATUS_GATE,
  parseM1FirstRunStatusArgs,
  REQUIRED_M1_FIRST_RUN_PLATFORMS,
} from '../scripts/m1-first-run-status.mjs'
import packageJson from '../package.json' with { type: 'json' }

const execFileAsync = promisify(execFile)

function runtimeAudit(overrides = {}) {
  return {
    schemaVersion: 1,
    gate: M1_FIRST_RUN_AUDIT_GATE,
    generatedAt: '2026-06-18T08:00:00.000Z',
    ok: true,
    overallStatus: 'ready',
    targetMilestone: 'M1',
    evidenceSource: 'runtime-console-summary',
    nextActions: [],
    ...overrides,
  }
}

function operatorEvidence(platform: string, overrides = {}) {
  return {
    schemaVersion: 1,
    gate: M1_FIRST_RUN_OPERATOR_EVIDENCE_GATE,
    generatedAt: '2026-06-18T08:10:00.000Z',
    ok: true,
    overallStatus: 'ready',
    targetMilestone: 'M1',
    evidenceSource: 'operator-first-run',
    observedAt: '2026-06-18T08:09:00.000Z',
    platform,
    providerId: 'ollama',
    firstConversation: {
      attempted: true,
      evidencePresent: true,
      latencyMs: 1800,
      latencyWithinBudget: true,
      succeeded: true,
    },
    missingCheckIds: [],
    nextActions: [],
    privacy: {
      artifactContentsCopied: false,
    },
    ...overrides,
  }
}

async function writeJson(filePath: string, value: unknown) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

test('m1 first-run status args support audit, operator files, output and readiness', () => {
  assert.deepEqual(parseM1FirstRunStatusArgs([
    '--audit-file',
    'artifacts/v1/m1-first-run-audit.json',
    '--operator-dir=artifacts/v1/operators',
    '--operator-evidence-file',
    'macos.json',
    '--operator-file=windows.json',
    '--generated-at',
    '2026-06-18T08:00:00Z',
    '--output',
    'artifacts/v1/m1-first-run-status.json',
    '--require-ready',
  ]), {
    auditFile: 'artifacts/v1/m1-first-run-audit.json',
    generatedAt: '2026-06-18T08:00:00Z',
    help: false,
    list: false,
    operatorDir: 'artifacts/v1/operators',
    operatorEvidenceFiles: ['macos.json', 'windows.json'],
    outputPath: 'artifacts/v1/m1-first-run-status.json',
    requireReady: true,
  })
})

test('m1 first-run status is ready only with runtime audit and all platform operator records', async () => {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'nexus-m1-status-ready-'))
  const auditPath = path.join(directoryPath, 'audit.json')
  try {
    await writeJson(auditPath, runtimeAudit())
    for (const platform of REQUIRED_M1_FIRST_RUN_PLATFORMS) {
      await writeJson(path.join(directoryPath, `m1-first-run-operator-${platform}.json`), operatorEvidence(platform))
    }

    const report = await buildM1FirstRunStatusReport(parseM1FirstRunStatusArgs([
      '--audit-file',
      auditPath,
      '--operator-dir',
      directoryPath,
    ]), '2026-06-18T08:30:00Z')
    const json = JSON.stringify(report)

    assert.equal(report.gate, M1_FIRST_RUN_STATUS_GATE)
    assert.equal(report.generatedAt, '2026-06-18T08:30:00.000Z')
    assert.equal(report.ok, true)
    assert.equal(report.overallStatus, 'ready')
    assert.deepEqual(report.missingPlatformIds, [])
    assert.deepEqual(report.nextActions, [])
    assert.equal(report.audit.runtimeEvidence, true)
    assert.equal(report.operatorEvidence.totalRecordCount, 3)
    assert.equal(report.platformCoverage.every((coverage) => coverage.pass), true)
    assert.equal(report.privacy.artifactContentsCopied, false)
    assert.equal(json.includes('operator name'), true)
    assert.equal(json.includes('Private Release Operator'), false)
  } finally {
    await rm(directoryPath, { recursive: true, force: true })
  }
})

test('m1 first-run status rejects sample audit even when operator records exist', async () => {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'nexus-m1-status-sample-'))
  const auditPath = path.join(directoryPath, 'audit.json')
  try {
    await writeJson(auditPath, runtimeAudit({
      evidenceSource: 'sample-m1-first-run',
    }))
    for (const platform of REQUIRED_M1_FIRST_RUN_PLATFORMS) {
      await writeJson(path.join(directoryPath, `m1-first-run-operator-${platform}.json`), operatorEvidence(platform))
    }

    const report = await buildM1FirstRunStatusReport(parseM1FirstRunStatusArgs([
      '--audit-file',
      auditPath,
      '--operator-dir',
      directoryPath,
    ]), '2026-06-18T08:30:00Z')

    assert.equal(report.ok, false)
    assert.equal(report.overallStatus, 'runtime-and-platform-evidence-required')
    assert.equal(report.audit.scaffoldOnly, true)
    assert.ok(report.nextActions.includes('replace-sample-m1-audit-with-runtime-report'))
    assert.deepEqual(report.missingPlatformIds, [])
  } finally {
    await rm(directoryPath, { recursive: true, force: true })
  }
})

test('m1 first-run status reports missing and invalid platform evidence safely', async () => {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'nexus-m1-status-missing-'))
  const auditPath = path.join(directoryPath, 'audit.json')
  try {
    await writeJson(auditPath, runtimeAudit())
    await writeJson(path.join(directoryPath, 'm1-first-run-operator-macos.json'), operatorEvidence('macos'))
    await writeJson(path.join(directoryPath, 'm1-first-run-operator-windows.json'), {
      gate: 'wrong-gate',
      platform: 'windows',
      ok: true,
    })

    const report = await buildM1FirstRunStatusReport(parseM1FirstRunStatusArgs([
      '--audit-file',
      auditPath,
      '--operator-dir',
      directoryPath,
    ]), '2026-06-18T08:30:00Z')

    assert.equal(report.ok, false)
    assert.deepEqual(report.missingPlatformIds, ['windows', 'linux'])
    assert.equal(report.operatorEvidence.invalidRecordCount, 1)
    assert.ok(report.nextActions.includes('record-windows-first-run-operator-evidence'))
    assert.ok(report.nextActions.includes('record-linux-first-run-operator-evidence'))
  } finally {
    await rm(directoryPath, { recursive: true, force: true })
  }
})

test('m1 first-run status CLI persists reports and enforces readiness', async () => {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'nexus-m1-status-cli-'))
  const auditPath = path.join(directoryPath, 'audit.json')
  const outputPath = path.join(directoryPath, 'status.json')
  try {
    await writeJson(auditPath, runtimeAudit())
    for (const platform of REQUIRED_M1_FIRST_RUN_PLATFORMS) {
      await writeJson(path.join(directoryPath, `m1-first-run-operator-${platform}.json`), operatorEvidence(platform))
    }

    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/m1-first-run-status.mjs',
      '--audit-file',
      auditPath,
      '--operator-dir',
      directoryPath,
      '--output',
      outputPath,
      '--generated-at',
      '2026-06-18T08:30:00Z',
      '--require-ready',
    ], { cwd: process.cwd() })
    const stdoutReport = JSON.parse(stdout)
    const fileReport = JSON.parse(await readFile(outputPath, 'utf8'))

    assert.deepEqual(fileReport, stdoutReport)
    assert.equal(fileReport.ok, true)

    await writeJson(auditPath, runtimeAudit({ evidenceSource: 'sample-m1-first-run' }))
    await assert.rejects(
      execFileAsync(process.execPath, [
        'scripts/m1-first-run-status.mjs',
        '--audit-file',
        auditPath,
        '--operator-dir',
        directoryPath,
        '--require-ready',
      ], { cwd: process.cwd() }),
      (error: unknown) => {
        const err = error as { code?: number; stdout?: string }
        assert.equal(err.code, 1)
        const report = JSON.parse(err.stdout ?? '{}')
        assert.equal(report.ok, false)
        assert.ok(report.nextActions.includes('replace-sample-m1-audit-with-runtime-report'))
        return true
      },
    )
  } finally {
    await rm(directoryPath, { recursive: true, force: true })
  }
})

test('m1 first-run status package wiring stays available', () => {
  assert.equal(packageJson.scripts?.['m1:first-run:status'], 'node scripts/m1-first-run-status.mjs')
  assert.equal(DEFAULT_M1_FIRST_RUN_AUDIT_FILE, 'artifacts/v1/m1-first-run-audit.json')
  assert.equal(DEFAULT_M1_FIRST_RUN_OPERATOR_DIR, 'artifacts/v1')
  assert.deepEqual(REQUIRED_M1_FIRST_RUN_PLATFORMS, ['macos', 'windows', 'linux'])
})
