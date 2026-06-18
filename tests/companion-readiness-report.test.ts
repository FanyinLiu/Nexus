import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import {
  buildCompanionReadinessEvidenceReport,
  COMPANION_READINESS_EVIDENCE_GATE,
  parseCompanionReadinessReportArgs,
} from '../scripts/companion-readiness-report.mjs'

const execFileAsync = promisify(execFile)

test('companion readiness report args support sample, input, output and readiness', () => {
  assert.deepEqual(parseCompanionReadinessReportArgs([
    '--sample',
    '--input',
    'ignored-when-sample.json',
    '--generated-at=2026-06-17T12:00:00Z',
    '--output',
    'artifacts/v0.3.4/companion-readiness.json',
    '--require-ready',
  ]), {
    generatedAt: '2026-06-17T12:00:00Z',
    help: false,
    inputPath: 'ignored-when-sample.json',
    outputPath: 'artifacts/v0.3.4/companion-readiness.json',
    requireReady: true,
    sample: true,
  })
})

test('companion readiness sample report is private-safe and covers the standard companion path', () => {
  const report = buildCompanionReadinessEvidenceReport(undefined, '2026-06-17T12:00:00Z')
  const json = JSON.stringify(report)

  assert.equal(report.gate, COMPANION_READINESS_EVIDENCE_GATE)
  assert.equal(report.generatedAt, '2026-06-17T12:00:00.000Z')
  assert.equal(report.ok, true)
  assert.equal(report.status, 'ready')
  assert.equal(report.readyCount, 9)
  assert.deepEqual(report.missingRequiredItemIds, [])
  assert.deepEqual(report.failedCheckIds, [])
  assert.deepEqual(report.requiredItemIds, [
    'standard_companion',
    'presence_state',
    'text_model',
    'microphone',
    'tts',
    'live2d',
    'notification_permission',
    'local_webhook',
    'privacy_boundary',
  ])
  assert.equal(json.includes('Release User'), false)
  assert.equal(json.includes('sample-token'), false)
  assert.equal(json.includes('127.0.0.1'), false)
  assert.equal(json.includes('http://localhost'), false)
})

test('companion readiness CLI persists reports and enforces readiness', async () => {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'nexus-companion-readiness-'))
  const outputPath = path.join(directoryPath, 'companion-readiness.json')
  const blockedInputPath = path.join(directoryPath, 'blocked-input.json')
  try {
    const { stdout } = await execFileAsync(process.execPath, [
      '--experimental-strip-types',
      'scripts/companion-readiness-report.mjs',
      '--sample',
      '--generated-at',
      '2026-06-17T12:00:00Z',
      '--output',
      outputPath,
      '--require-ready',
    ], { cwd: process.cwd() })
    const stdoutReport = JSON.parse(stdout)
    const fileReport = JSON.parse(await readFile(outputPath, 'utf8'))

    assert.deepEqual(fileReport, stdoutReport)
    assert.equal(fileReport.ok, true)

    await writeFile(blockedInputPath, JSON.stringify({
      settings: {
        apiBaseUrl: '',
        autonomyNotificationMessagePreviewEnabled: true,
      },
    }), 'utf8')

    await assert.rejects(
      execFileAsync(process.execPath, [
        '--experimental-strip-types',
        'scripts/companion-readiness-report.mjs',
        '--input',
        blockedInputPath,
        '--require-ready',
      ], { cwd: process.cwd() }),
      (error: unknown) => {
        const err = error as { code?: number; stdout?: string }
        assert.equal(err.code, 1)
        const report = JSON.parse(err.stdout ?? '{}')
        assert.equal(report.ok, false)
        assert.ok(report.failedCheckIds.includes('text_model'))
        assert.ok(report.failedCheckIds.includes('privacy_boundary'))
        return true
      },
    )
  } finally {
    await rm(directoryPath, { recursive: true, force: true })
  }
})
