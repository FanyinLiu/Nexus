import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import {
  buildM1FirstRunOperatorEvidence,
  DEFAULT_M1_FIRST_RUN_OPERATOR_EVIDENCE_FILE,
  M1_FIRST_RUN_OPERATOR_EVIDENCE_GATE,
  parseM1FirstRunRecordArgs,
} from '../scripts/m1-first-run-record.mjs'

const execFileAsync = promisify(execFile)

const readyArgs = [
  '--observed-at',
  '2026-06-18T08:30:00Z',
  '--operator',
  'Private Release Operator',
  '--platform',
  'darwin',
  '--provider-id',
  'ollama',
  '--latency-ms',
  '1800',
  '--app-started',
  '--model-connection-checked',
  '--first-message-sent',
  '--assistant-reply-observed',
  '--panel-guide-ready',
  '--private-safe-report-copied',
  '--no-transcript-copied',
  '--note',
  'Private note: SecretAlphaPrompt and SecretBetaReply were visible but not copied.',
]

test('m1 first-run record args normalize platform, latency and proof flags', () => {
  const parsed = parseM1FirstRunRecordArgs([
    ...readyArgs,
    '--first-conversation-budget-minutes=2',
    '--output',
    'artifacts/v1/custom-m1-operator.json',
    '--require-ready',
  ])

  assert.equal(parsed.appStarted, true)
  assert.equal(parsed.assistantReplyObserved, true)
  assert.equal(parsed.firstConversationBudgetMinutes, 2)
  assert.equal(parsed.latencyMs, 1800)
  assert.equal(parsed.noTranscriptCopied, true)
  assert.equal(parsed.outputPath, 'artifacts/v1/custom-m1-operator.json')
  assert.equal(parsed.platform, 'macos')
  assert.equal(parsed.providerId, 'ollama')
  assert.equal(parsed.requireReady, true)
})

test('m1 first-run operator evidence is ready and private-safe', () => {
  const report = buildM1FirstRunOperatorEvidence(
    parseM1FirstRunRecordArgs(readyArgs),
    '2026-06-18T08:31:00Z',
  )
  const json = JSON.stringify(report)

  assert.equal(report.gate, M1_FIRST_RUN_OPERATOR_EVIDENCE_GATE)
  assert.equal(report.generatedAt, '2026-06-18T08:31:00.000Z')
  assert.equal(report.ok, true)
  assert.equal(report.overallStatus, 'ready')
  assert.equal(report.platform, 'macos')
  assert.equal(report.operatorProvided, true)
  assert.equal(report.noteProvided, true)
  assert.deepEqual(report.missingCheckIds, [])
  assert.deepEqual(report.nextActions, [])
  assert.equal(report.modelSetup.connectionChecked, true)
  assert.equal(report.modelSetup.modelAvailable, true)
  assert.equal(report.firstConversation.attempted, true)
  assert.equal(report.firstConversation.succeeded, true)
  assert.equal(report.firstConversation.latencyMs, 1800)
  assert.equal(report.firstConversation.latencyWithinBudget, true)
  assert.equal(report.privacy.artifactContentsCopied, false)
  assert.equal(json.includes('Private Release Operator'), false)
  assert.equal(json.includes('Private note'), false)
  assert.equal(json.includes('SecretAlphaPrompt'), false)
  assert.equal(json.includes('SecretBetaReply'), false)
})

test('m1 first-run operator evidence blocks missing privacy and slow first reply proof', () => {
  const report = buildM1FirstRunOperatorEvidence(parseM1FirstRunRecordArgs([
    '--observed-at',
    '2026-06-18T08:30:00Z',
    '--operator',
    'Release Operator',
    '--latency-ms',
    '61000',
    '--app-started',
    '--model-connection-checked',
    '--first-message-sent',
    '--assistant-reply-observed',
    '--panel-guide-ready',
    '--private-safe-report-copied',
  ]), '2026-06-18T08:31:00Z')

  assert.equal(report.ok, false)
  assert.equal(report.overallStatus, 'needs-first-run-operator-evidence')
  assert.ok(report.missingCheckIds.includes('no-transcript-copied'))
  assert.ok(report.missingCheckIds.includes('first-reply-latency-within-budget'))
  assert.ok(report.nextActions.includes('avoid-copying-prompts-replies-transcripts-or-model-names'))
  assert.ok(report.nextActions.includes('reduce-first-conversation-latency'))
})

test('m1 first-run record CLI persists ready evidence and enforces failures', async () => {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'nexus-m1-first-run-record-'))
  const outputPath = path.join(directoryPath, 'm1-first-run-operator.json')
  try {
    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/m1-first-run-record.mjs',
      ...readyArgs,
      '--output',
      outputPath,
      '--require-ready',
    ], { cwd: process.cwd() })
    const stdoutReport = JSON.parse(stdout)
    const fileReport = JSON.parse(await readFile(outputPath, 'utf8'))

    assert.deepEqual(fileReport, stdoutReport)
    assert.equal(fileReport.ok, true)
    assert.equal(fileReport.gate, M1_FIRST_RUN_OPERATOR_EVIDENCE_GATE)

    await assert.rejects(
      execFileAsync(process.execPath, [
        'scripts/m1-first-run-record.mjs',
        '--stdout-only',
        '--require-ready',
        '--observed-at',
        'bad-date',
      ], { cwd: process.cwd() }),
      (error: unknown) => {
        const err = error as { code?: number; stdout?: string }
        assert.equal(err.code, 1)
        const report = JSON.parse(err.stdout ?? '{}')
        assert.equal(report.ok, false)
        assert.ok(report.nextActions.includes('record-first-reply-observed-at'))
        assert.ok(report.nextActions.includes('record-operator-presence-without-name'))
        return true
      },
    )
  } finally {
    await rm(directoryPath, { recursive: true, force: true })
  }
})

test('m1 first-run record package default output stays documented in the script', () => {
  assert.equal(DEFAULT_M1_FIRST_RUN_OPERATOR_EVIDENCE_FILE, 'artifacts/v1/m1-first-run-operator.json')
})
