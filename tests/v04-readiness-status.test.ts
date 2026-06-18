import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import {
  buildV04ReadinessStatusReport,
  DEFAULT_V04_ARTIFACT_DIR,
  DEFAULT_V04_COMPLETE_EVIDENCE_FILE,
  DEFAULT_V04_LIVE_EVIDENCE_FILE,
  DEFAULT_V04_LIVE_PREFLIGHT_FILE,
  DEFAULT_V04_LIVE_SESSION_FILE,
  DEFAULT_V04_LIVE_SESSION_MARKDOWN_FILE,
  DEFAULT_V04_LOCAL_EVIDENCE_FILE,
  DEFAULT_V04_MACOS_LIVE_PROBE_FILE,
  DEFAULT_V04_PRIVACY_SAFETY_FILE,
  DEFAULT_V04_REDACTED_OUTPUT_FILE,
  parseV04ReadinessStatusArgs,
  V04_READINESS_STATUS_GATE,
} from '../scripts/v04-readiness-status.mjs'
import { buildPrivacySafetyEvidenceReport } from '../src/features/stabilization/privacySafetyEvidence.ts'
import {
  buildMessageAwarenessEvidence,
  normalizeLiveEvidenceChecks,
  redactMessageAwarenessEvidence,
} from '../scripts/validate-message-awareness.mjs'
import packageJson from '../package.json' with { type: 'json' }

const execFileAsync = promisify(execFile)

async function writeJson(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function writeReadyStabilizationArtifacts(artifactDir: string) {
  await writeJson(path.join(artifactDir, 'companion-readiness.json'), {
    gate: 'companion-readiness-health',
    generatedAt: '2026-06-17T11:58:00Z',
    ok: true,
    privateValue: 'private readiness endpoint',
  })
  await writeJson(path.join(artifactDir, 'memory-map.json'), {
    gate: 'memory-map-observability',
    generatedAt: '2026-06-17T11:59:00Z',
    ok: true,
    privateValue: 'private memory body',
  })
  await writeJson(path.join(artifactDir, 'proactive-care-evidence.json'), {
    gate: 'proactive-care-observability',
    generatedAt: '2026-06-17T12:00:00Z',
    ok: true,
    evidenceSource: 'runtime-events',
    privateValue: 'private proactive event detail',
  })
  await writeJson(path.join(artifactDir, 'live2d-action-map.json'), {
    gate: 'live2d-action-map-coverage',
    generatedAt: '2026-06-17T12:01:00Z',
    ok: true,
    privateValue: 'private expression target',
  })
  await writeJson(path.join(artifactDir, 'character-card-import.json'), {
    gate: 'character-card-import',
    generatedAt: '2026-06-17T12:02:00Z',
    ok: true,
    privateValue: 'private character card text',
  })
  await writeJson(path.join(artifactDir, 'voice-diagnostics.json'), {
    schema: 'nexus.voice-diagnostics.v1',
    generatedAt: '2026-06-17T12:03:00Z',
    ok: true,
    privateValue: 'private voice transcript',
  })
  await writeJson(path.join(artifactDir, 'tts-adapter-smoke.json'), {
    gate: 'nexus-tts-adapter-smoke',
    generatedAt: '2026-06-17T12:04:00Z',
    ok: false,
    error: {
      kind: 'network-error',
      detail: 'private adapter endpoint should not copy',
    },
    nextActions: [
      'Start the local TTS adapter and confirm its /audio/speech endpoint is reachable.',
    ],
  })
  await writeJson(path.join(artifactDir, 'privacy-safety.json'), buildPrivacySafetyEvidenceReport({
    generatedAt: '2026-06-17T12:05:00Z',
  }))
}

function buildCompleteLiveEvidenceChecks() {
  return normalizeLiveEvidenceChecks([
    {
      id: 'macos-notification-center-live',
      status: 'pass',
      observedAt: '2026-06-17T12:10:00Z',
      operator: 'Release Operator',
      notes: ['Observed one real app notification once after permission setup.'],
      evidence: {
        appName: 'Messages',
        fullDiskAccessGranted: true,
        notificationObservedOnce: true,
        replayCheckedAfterRestart: true,
      },
    },
    {
      id: 'telegram-live-bridge',
      status: 'pass',
      observedAt: '2026-06-17T12:20:00Z',
      operator: 'Release Operator',
      notes: ['Owner DM paired, replied, queued while busy, and did not replay.'],
      evidence: {
        pairingApproved: true,
        ownerTextReplyReturned: true,
        busyMessageQueuedOrRetried: true,
        reconnectReplayChecked: true,
      },
    },
    {
      id: 'discord-live-bridge',
      status: 'pass',
      observedAt: '2026-06-17T12:30:00Z',
      operator: 'Release Operator',
      notes: ['Approved Discord channel replied and reconnect status was visible.'],
      evidence: {
        approvedChannelReplyReturned: true,
        botEchoSuppressed: true,
        messageContentIntentEnabled: true,
        reconnectStatusVisible: true,
      },
    },
  ])
}

function buildCompleteMessageEvidence() {
  return buildMessageAwarenessEvidence({
    mode: 'local-webhook',
    payload: {
      kind: 'message',
      sender: 'Private Sender',
      source: 'Nexus Validation',
      text: 'private local webhook payload',
    },
    response: {
      id: 'private-response-id',
      ok: true,
    },
    completedAt: '2026-06-17T12:40:00Z',
    liveEvidenceChecks: buildCompleteLiveEvidenceChecks(),
    startedAt: '2026-06-17T12:39:00Z',
  })
}

async function writeCompleteMessageEvidencePair(completePath: string, redactedPath: string) {
  const evidence = buildCompleteMessageEvidence()
  await writeJson(completePath, evidence)
  await writeJson(redactedPath, redactMessageAwarenessEvidence(evidence))
}

test('v0.4 readiness status defaults to v0.4 message evidence paths', () => {
  assert.deepEqual(parseV04ReadinessStatusArgs([]), {
    artifactDir: DEFAULT_V04_ARTIFACT_DIR,
    completeEvidenceFile: DEFAULT_V04_COMPLETE_EVIDENCE_FILE,
    generatedAt: '',
    help: false,
    liveEvidenceFile: DEFAULT_V04_LIVE_EVIDENCE_FILE,
    livePreflightFile: DEFAULT_V04_LIVE_PREFLIGHT_FILE,
    liveSessionFile: DEFAULT_V04_LIVE_SESSION_FILE,
    liveSessionMarkdownFile: DEFAULT_V04_LIVE_SESSION_MARKDOWN_FILE,
    macosLiveProbeFile: DEFAULT_V04_MACOS_LIVE_PROBE_FILE,
    localEvidenceFile: DEFAULT_V04_LOCAL_EVIDENCE_FILE,
    outputPath: '',
    privacySafetyFile: '',
    redactedOutputFile: DEFAULT_V04_REDACTED_OUTPUT_FILE,
    requireReady: false,
    verifyReleaseRan: false,
  })
})

test('v0.4 readiness status args support evidence paths and readiness enforcement', () => {
  assert.deepEqual(parseV04ReadinessStatusArgs([
    '--artifact-dir',
    'artifacts/v0.3.4',
    '--generated-at=2026-06-17T12:00:00Z',
    '--local-evidence-file',
    'artifacts/local.json',
    '--live-evidence-file',
    'artifacts/live.json',
    '--live-preflight-file',
    'artifacts/live-preflight.json',
    '--live-session-file',
    'artifacts/live-session.json',
    '--live-session-markdown-file',
    'artifacts/live-session.md',
    '--macos-live-probe-file',
    'artifacts/macos-probe.json',
    '--complete-evidence-file',
    'artifacts/complete.json',
    '--redacted-output-file',
    'docs/release-evidence/v0.4.0-message-awareness.json',
    '--privacy-safety-file',
    'artifacts/privacy-safety.json',
    '--output',
    'artifacts/v04-status.json',
    '--require-ready',
    '--verify-release-ran',
  ]), {
    artifactDir: 'artifacts/v0.3.4',
    completeEvidenceFile: 'artifacts/complete.json',
    generatedAt: '2026-06-17T12:00:00Z',
    help: false,
    liveEvidenceFile: 'artifacts/live.json',
    livePreflightFile: 'artifacts/live-preflight.json',
    liveSessionFile: 'artifacts/live-session.json',
    liveSessionMarkdownFile: 'artifacts/live-session.md',
    macosLiveProbeFile: 'artifacts/macos-probe.json',
    localEvidenceFile: 'artifacts/local.json',
    outputPath: 'artifacts/v04-status.json',
    privacySafetyFile: 'artifacts/privacy-safety.json',
    redactedOutputFile: 'docs/release-evidence/v0.4.0-message-awareness.json',
    requireReady: true,
    verifyReleaseRan: true,
  })
})

test('v0.4 readiness status aggregates stabilization, message and safety evidence safely', async () => {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'nexus-v04-ready-'))
  try {
    const artifactDir = path.join(directoryPath, 'artifacts')
    const completeEvidencePath = path.join(directoryPath, 'message-awareness-complete.json')
    const redactedEvidencePath = path.join(directoryPath, 'message-awareness-redacted.json')
    await writeReadyStabilizationArtifacts(artifactDir)
    await writeCompleteMessageEvidencePair(completeEvidencePath, redactedEvidencePath)

    const report = await buildV04ReadinessStatusReport({
      artifactDir,
      completeEvidenceFile: completeEvidencePath,
      generatedAt: '2026-06-17T13:00:00Z',
      liveEvidenceFile: path.join(directoryPath, 'missing-live.json'),
      localEvidenceFile: path.join(directoryPath, 'missing-local.json'),
      redactedOutputFile: redactedEvidencePath,
    })
    const json = JSON.stringify(report)

    assert.equal(report.gate, V04_READINESS_STATUS_GATE)
    assert.equal(report.generatedAt, '2026-06-17T13:00:00.000Z')
    assert.equal(report.ok, true)
    assert.equal(report.overallStatus, 'evidence-ready-release-command-required')
    assert.deepEqual(report.blockingCheckIds, [])
    assert.equal(report.sourceReports.stabilization.ok, true)
    assert.equal(report.sourceReports.messageAwareness.releaseGateComplete, true)
    assert.equal(report.sourceReports.messageAwareness.rawReleaseGateComplete, true)
    assert.equal(report.sourceReports.messageAwareness.redactionGateComplete, true)
    assert.equal(report.sourceReports.privacySafety.ok, true)
    assert.ok(report.nextCommands.some((entry: { command: string }) => entry.command === 'npm run verify:release'))
    assert.equal(json.includes('private local webhook payload'), false)
    assert.equal(json.includes('Private Sender'), false)
    assert.equal(json.includes('private-response-id'), false)
    assert.equal(json.includes('private adapter endpoint'), false)
  } finally {
    await rm(directoryPath, { recursive: true, force: true })
  }
})

test('v0.4 readiness status accepts release-gate verify assertion', async () => {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'nexus-v04-verified-'))
  try {
    const artifactDir = path.join(directoryPath, 'artifacts')
    const completeEvidencePath = path.join(directoryPath, 'message-awareness-complete.json')
    const redactedEvidencePath = path.join(directoryPath, 'message-awareness-redacted.json')
    await writeReadyStabilizationArtifacts(artifactDir)
    await writeCompleteMessageEvidencePair(completeEvidencePath, redactedEvidencePath)

    const report = await buildV04ReadinessStatusReport({
      artifactDir,
      completeEvidenceFile: completeEvidencePath,
      generatedAt: '2026-06-17T13:00:00Z',
      liveEvidenceFile: path.join(directoryPath, 'missing-live.json'),
      localEvidenceFile: path.join(directoryPath, 'missing-local.json'),
      redactedOutputFile: redactedEvidencePath,
      verifyReleaseRan: true,
    })
    const releaseCheck = report.checks.find((check: { id: string }) => check.id === 'release.verify_release_command')

    assert.equal(report.ok, true)
    assert.equal(report.overallStatus, 'ready')
    assert.equal(report.releaseCommandRequired, false)
    assert.equal(releaseCheck?.pass, true)
    assert.equal(releaseCheck?.status, 'ready')
    assert.equal(releaseCheck?.evidence.assertedByCaller, true)
    assert.equal(report.nextCommands.some((entry: { id: string }) => entry.id === 'verify-release'), false)
  } finally {
    await rm(directoryPath, { recursive: true, force: true })
  }
})

test('v0.4 readiness status blocks raw message evidence until redacted release evidence is green', async () => {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'nexus-v04-raw-message-'))
  try {
    const artifactDir = path.join(directoryPath, 'artifacts')
    const completeEvidencePath = path.join(directoryPath, 'message-awareness-complete.json')
    const redactedEvidencePath = path.join(directoryPath, 'message-awareness-redacted.json')
    await writeReadyStabilizationArtifacts(artifactDir)
    await writeJson(completeEvidencePath, buildCompleteMessageEvidence())

    const report = await buildV04ReadinessStatusReport({
      artifactDir,
      completeEvidenceFile: completeEvidencePath,
      generatedAt: '2026-06-17T13:00:00Z',
      liveEvidenceFile: path.join(directoryPath, 'missing-live.json'),
      localEvidenceFile: path.join(directoryPath, 'missing-local.json'),
      redactedOutputFile: redactedEvidencePath,
    })
    const messageCheck = report.checks.find((check: { id: string }) => check.id === 'message_awareness.release_gate')

    assert.equal(report.ok, false)
    assert.deepEqual(report.blockingCheckIds, ['message_awareness.release_gate'])
    assert.equal(messageCheck?.status, 'partial')
    assert.equal(messageCheck?.detail, 'Message-awareness release gate pending: redacted release evidence is not green.')
    assert.equal(messageCheck?.evidence.rawReleaseGateComplete, true)
    assert.equal(messageCheck?.evidence.redactionGateComplete, false)
    assert.equal(messageCheck?.evidence.releaseGateComplete, false)
    assert.ok(report.nextCommands.some((entry: { id: string; command: string }) => (
      entry.id === 'message-redact-release-evidence'
        && entry.command.includes('--redacted-output-file')
        && entry.command.includes(redactedEvidencePath)
    )))
  } finally {
    await rm(directoryPath, { recursive: true, force: true })
  }
})

test('v0.4 readiness status keeps pending live message evidence blocking', async () => {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'nexus-v04-pending-message-'))
  try {
    const artifactDir = path.join(directoryPath, 'artifacts')
    const localEvidencePath = path.join(directoryPath, 'message-awareness-local.json')
    const macosLiveProbePath = path.join(directoryPath, 'message-awareness-macos-live-probe.json')
    const liveSessionPath = path.join(directoryPath, 'message-awareness-live-session.json')
    const liveSessionMarkdownPath = path.join(directoryPath, 'message-awareness-live-session.md')
    await writeReadyStabilizationArtifacts(artifactDir)
    await writeJson(localEvidencePath, buildMessageAwarenessEvidence({
      mode: 'local-webhook',
      payload: {
        kind: 'message',
        source: 'Nexus Validation',
        text: 'private local webhook payload',
      },
      response: { ok: true },
    }))
    await writeJson(macosLiveProbePath, {
      schemaVersion: 1,
      gate: 'message-awareness-macos-live-probe',
      generatedAt: '2026-06-17T13:00:00Z',
      ok: false,
      status: 'no-fresh-notification',
      releaseEvidenceCandidate: false,
      releaseEvidenceRecorded: false,
      diagnostics: {
        platform: 'darwin',
        machineChecked: true,
        privateMessageId: 'private-message-id',
        observedFreshCount: 0,
        replayFreshCount: 0,
      },
      privateNotificationBody: 'private notification body',
    })
    await writeJson(liveSessionPath, {
      schemaVersion: 1,
      gate: 'nexus-v04-message-live-session',
      generatedAt: '2026-06-17T13:01:00Z',
      ok: false,
      overallStatus: 'manual-live-evidence-required',
      readyToRecordPendingChecks: false,
      safeToRunPendingRecordCommands: false,
      pendingCheckIds: [
        'macos-notification-center-live',
        'telegram-live-bridge',
        'discord-live-bridge',
      ],
      recordSafetySummary: {
        pendingRecordCount: 1,
        readyToAttemptCount: 0,
        safeToRunCount: 0,
        blockedCount: 1,
        needsOperatorValuesCount: 0,
        unavailableCount: 0,
        unknownCount: 0,
        unsafeRecordStepIds: ['record-macos-notification-center-live'],
      },
      stepExecutionSummary: {
        automationSafeCommandCount: 2,
        manualRecordStepCount: 1,
        blockedStepCount: 2,
        unsafeRecordStepCount: 1,
        automationSafeCommandIds: ['live-preflight', 'macos-live-probe'],
        manualRecordStepIds: ['record-macos-notification-center-live'],
        blockedStepIds: ['record-macos-notification-center-live', 'live-gate'],
        unsafeRecordStepIds: ['record-macos-notification-center-live'],
        automationSafeCommands: [
          { id: 'live-preflight', command: 'private command text should not be copied upward' },
        ],
      },
      sourceReports: {
        bridgeTrace: {
          exists: true,
          error: null,
          telegram: {
            hasTraceEvidence: true,
            lastOutboundTarget: 'telegram:private-chat',
            lastOutboundError: 'Telegram API 429 for telegram:private-chat',
          },
          discord: {
            hasTraceEvidence: false,
            lastOutboundTarget: 'discord:private-channel',
          },
        },
      },
      steps: [
        {
          id: 'record-macos-notification-center-live',
          checkId: 'macos-notification-center-live',
          status: 'manual-required',
          readyToAttempt: false,
          machinePrerequisite: {
            id: 'macos-live-probe',
            status: 'no-fresh-notification',
            releaseEvidenceCandidate: false,
          },
          recordCommandSafety: {
            status: 'blocked',
            safeToRunRecordCommand: false,
            dryRunRecommended: true,
            preflightRecommended: true,
            placeholderTokens: ['REPLACE_WITH_OPERATOR', 'REPLACE_WITH_OBSERVED_AT'],
            missingProofFieldIds: ['observedAt'],
            reasons: [
              'record step is not ready to attempt',
              'macos-live-probe status no-fresh-notification is not a release evidence candidate',
            ],
          },
        },
      ],
    })
    await writeFile(
      liveSessionMarkdownPath,
      '# Operator packet\n\nprivate operator note with telegram:private-chat and Discord API 429\n',
      'utf8',
    )

    const report = await buildV04ReadinessStatusReport({
      artifactDir,
      completeEvidenceFile: path.join(directoryPath, 'missing-complete.json'),
      generatedAt: '2026-06-17T13:00:00Z',
      liveEvidenceFile: path.join(directoryPath, 'missing-live.json'),
      localEvidenceFile: localEvidencePath,
      macosLiveProbeFile: macosLiveProbePath,
      liveSessionFile: liveSessionPath,
      liveSessionMarkdownFile: liveSessionMarkdownPath,
    })
    const messageCheck = report.checks.find((check: { id: string }) => check.id === 'message_awareness.release_gate')
    const json = JSON.stringify(report)

    assert.equal(report.ok, false)
    assert.deepEqual(report.blockingCheckIds, ['message_awareness.release_gate'])
    assert.equal(messageCheck?.status, 'partial')
    assert.equal(messageCheck?.evidence.macosLiveProbe.status, 'no-fresh-notification')
    assert.equal(messageCheck?.evidence.macosLiveProbe.releaseEvidenceCandidate, false)
    assert.equal(messageCheck?.evidence.liveSession.readyToRecordPendingChecks, false)
    assert.equal(messageCheck?.evidence.liveSession.safeToRunPendingRecordCommands, false)
    assert.equal(messageCheck?.evidence.liveSession.recordSafetySummary.blockedCount, 1)
    assert.equal(messageCheck?.evidence.liveSession.stepExecutionSummary.automationSafeCommandCount, 2)
    assert.deepEqual(messageCheck?.evidence.liveSession.stepExecutionSummary.automationSafeCommandIds, [
      'live-preflight',
      'macos-live-probe',
    ])
    assert.deepEqual(messageCheck?.evidence.liveSession.stepExecutionSummary.manualRecordStepIds, [
      'record-macos-notification-center-live',
    ])
    assert.deepEqual(messageCheck?.evidence.liveSession.recordSafetySummary.unsafeRecordStepIds, [
      'record-macos-notification-center-live',
    ])
    assert.equal(messageCheck?.evidence.liveSession.bridgeTrace.telegramHasTraceEvidence, true)
    assert.equal(messageCheck?.evidence.liveSession.bridgeTrace.discordHasTraceEvidence, false)
    assert.equal(messageCheck?.evidence.liveSession.macosRecord.readyToAttempt, false)
    assert.equal(messageCheck?.evidence.liveSession.recordSteps[0].id, 'record-macos-notification-center-live')
    assert.equal(messageCheck?.evidence.liveSession.recordSteps[0].readyToAttempt, false)
    assert.equal(messageCheck?.evidence.liveSession.recordSteps[0].recordCommandSafety.status, 'blocked')
    assert.equal(messageCheck?.evidence.liveSession.recordSteps[0].recordCommandSafety.safeToRunRecordCommand, false)
    assert.equal(messageCheck?.evidence.liveSession.operatorPacket.exists, true)
    assert.equal(messageCheck?.evidence.liveSession.operatorPacket.path, liveSessionMarkdownPath)
    assert.equal(typeof messageCheck?.evidence.liveSession.operatorPacket.sizeBytes, 'number')
    assert.equal(report.sourceReports.messageMacosLiveProbe.status, 'no-fresh-notification')
    assert.equal(report.sourceReports.messageLiveSession.readyToRecordPendingChecks, false)
    assert.equal(report.sourceReports.messageLiveSession.safeToRunPendingRecordCommands, false)
    assert.equal(report.sourceReports.messageLiveSession.recordSafetySummary.blockedCount, 1)
    assert.deepEqual(report.sourceReports.messageLiveSession.stepExecutionSummary.blockedStepIds, [
      'record-macos-notification-center-live',
      'live-gate',
    ])
    assert.equal(report.sourceReports.messageLiveSession.bridgeTrace.telegramHasTraceEvidence, true)
    assert.equal(report.sourceReports.messageLiveSession.operatorPacket.exists, true)
    assert.doesNotMatch(json, /private notification body|private-message-id|private local webhook payload|telegram:private-chat|discord:private-channel|Telegram API 429|private operator note|Discord API 429|private command text/)
    assert.deepEqual(messageCheck?.evidence.pendingCheckIds, [
      'macos-notification-center-live',
      'telegram-live-bridge',
      'discord-live-bridge',
    ])
    const macosRecordCommand = report.nextCommands.find((entry: { id: string }) => (
      entry.id === 'message-record-macos-notification-center-live'
    ))
    assert.equal(macosRecordCommand?.isTemplate, true)
    assert.equal(macosRecordCommand?.mustReplacePlaceholders, true)
    assert.ok(macosRecordCommand?.dryRunCommand.includes('message:live:record -- macos'))
    assert.ok(macosRecordCommand?.dryRunCommand.includes('--dry-run'))
    assert.ok(macosRecordCommand?.preflightCommand.includes('message:live:record -- macos'))
    assert.ok(macosRecordCommand?.preflightCommand.includes('--preflight'))
    assert.ok(macosRecordCommand?.command.includes('--observed-at "REPLACE_WITH_OBSERVED_AT"'))
    assert.deepEqual(macosRecordCommand?.placeholderFields, ['operator', 'appName', 'observedAt'])
    assert.equal(macosRecordCommand?.readyToAttempt, false)
    assert.equal(macosRecordCommand?.liveSessionStepStatus, 'manual-required')
    assert.equal(macosRecordCommand?.safeToRun, false)
    assert.equal(macosRecordCommand?.executionMode, 'blocked-record-command')
    assert.equal(macosRecordCommand?.recordCommandSafety.status, 'blocked')
    assert.deepEqual(macosRecordCommand?.recordCommandSafety.placeholderTokens, [
      'REPLACE_WITH_OPERATOR',
      'REPLACE_WITH_OBSERVED_AT',
    ])
    assert.deepEqual(macosRecordCommand?.machinePrerequisite, {
      id: 'macos-live-probe',
      status: 'no-fresh-notification',
      releaseEvidenceCandidate: false,
    })
    assert.ok(report.nextCommands.some((entry: { id: string }) => entry.id === 'message-record-telegram-live-bridge'))
    assert.equal(
      report.automationSafeNextCommands.some((entry: { id: string }) => (
        entry.id === 'message-record-macos-notification-center-live'
      )),
      false,
    )
    assert.ok(report.nextCommandAutomation.unsafeCommandIds.includes('message-record-macos-notification-center-live'))
    assert.ok(report.nextCommandAutomation.manualCommandIds.includes('message-record-macos-notification-center-live'))
    assert.ok(report.nextCommandAutomation.blockedCommandIds.includes('message-record-macos-notification-center-live'))
    assert.ok(report.nextCommandAutomation.unsafeCommandIds.includes('message-record-telegram-live-bridge'))
    assert.equal(report.nextCommandAutomation.recordCommandExecutionSummary.blockedCount, 1)
    assert.ok(
      report.nextCommandAutomation.recordCommandExecutionSummary.unsafeRecordCommandIds.includes(
        'message-record-macos-notification-center-live',
      ),
    )
  } finally {
    await rm(directoryPath, { recursive: true, force: true })
  }
})

test('v0.4 readiness status recommends live-session operator packet when missing', async () => {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'nexus-v04-missing-live-session-'))
  try {
    const artifactDir = path.join(directoryPath, 'artifacts')
    const localEvidencePath = path.join(directoryPath, 'message-awareness-local.json')
    await writeReadyStabilizationArtifacts(artifactDir)
    await writeJson(localEvidencePath, buildMessageAwarenessEvidence({
      mode: 'local-webhook',
      payload: {
        kind: 'message',
        source: 'Nexus Validation',
        text: 'private local webhook payload',
      },
      response: { ok: true },
    }))

    const report = await buildV04ReadinessStatusReport({
      artifactDir,
      completeEvidenceFile: path.join(directoryPath, 'missing-complete.json'),
      generatedAt: '2026-06-17T13:00:00Z',
      liveEvidenceFile: path.join(directoryPath, 'missing-live.json'),
      localEvidenceFile: localEvidencePath,
      liveSessionFile: path.join(directoryPath, 'missing-live-session.json'),
      liveSessionMarkdownFile: path.join(directoryPath, 'missing-live-session.md'),
    })
    const messageCheck = report.checks.find((check: { id: string }) => check.id === 'message_awareness.release_gate')
    const packetCommand = report.nextCommands.find((entry: { id: string }) => entry.id === 'message-live-session')
    const json = JSON.stringify(report)

    assert.equal(report.ok, false)
    assert.equal(messageCheck?.evidence.liveSession.exists, false)
    assert.equal(messageCheck?.evidence.liveSession.operatorPacket.exists, false)
    assert.equal(packetCommand?.command, 'npm run v04:message:live:session')
    assert.match(packetCommand?.reason ?? '', /private-safe JSON and Markdown/)
    assert.ok(report.nextCommandAutomation.automationSafeCommandIds.includes('message-live-session'))
    assert.ok(report.automationSafeNextCommands.some((entry: { id: string }) => entry.id === 'message-live-session'))
    assert.doesNotMatch(json, /private local webhook payload/)
  } finally {
    await rm(directoryPath, { recursive: true, force: true })
  }
})

test('v0.4 readiness status recommends refreshing stale live-session operator packet', async () => {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'nexus-v04-stale-live-session-'))
  try {
    const artifactDir = path.join(directoryPath, 'artifacts')
    const localEvidencePath = path.join(directoryPath, 'message-awareness-local.json')
    const liveSessionPath = path.join(directoryPath, 'message-awareness-live-session.json')
    const liveSessionMarkdownPath = path.join(directoryPath, 'message-awareness-live-session.md')
    await writeReadyStabilizationArtifacts(artifactDir)
    await writeJson(localEvidencePath, buildMessageAwarenessEvidence({
      mode: 'local-webhook',
      payload: {
        kind: 'message',
        source: 'Nexus Validation',
        text: 'private local webhook payload',
      },
      response: { ok: true },
    }))
    await writeJson(liveSessionPath, {
      schemaVersion: 1,
      gate: 'nexus-v04-message-live-session',
      generatedAt: '2026-06-17T13:10:00Z',
      ok: false,
      overallStatus: 'manual-live-evidence-required',
      readyToRecordPendingChecks: false,
      safeToRunPendingRecordCommands: false,
      pendingCheckIds: ['telegram-live-bridge'],
      recordSafetySummary: {
        pendingRecordCount: 0,
        readyToAttemptCount: 0,
        safeToRunCount: 0,
        blockedCount: 0,
        needsOperatorValuesCount: 0,
        unavailableCount: 0,
        unknownCount: 0,
        unsafeRecordStepIds: [],
      },
      sourceReports: { bridgeTrace: { exists: false, error: 'missing' } },
      steps: [],
    })
    await writeFile(
      liveSessionMarkdownPath,
      '# Old operator packet\n\nprivate stale operator note\n',
      'utf8',
    )
    await utimes(liveSessionMarkdownPath, new Date('2026-06-17T13:00:00Z'), new Date('2026-06-17T13:00:00Z'))
    await utimes(liveSessionPath, new Date('2026-06-17T13:10:00Z'), new Date('2026-06-17T13:10:00Z'))

    const report = await buildV04ReadinessStatusReport({
      artifactDir,
      completeEvidenceFile: path.join(directoryPath, 'missing-complete.json'),
      generatedAt: '2026-06-17T13:10:00Z',
      liveEvidenceFile: path.join(directoryPath, 'missing-live.json'),
      liveSessionFile: liveSessionPath,
      liveSessionMarkdownFile: liveSessionMarkdownPath,
      localEvidenceFile: localEvidencePath,
    })
    const messageCheck = report.checks.find((check: { id: string }) => check.id === 'message_awareness.release_gate')
    const packetCommand = report.nextCommands.find((entry: { id: string }) => entry.id === 'message-live-session')
    const json = JSON.stringify(report)

    assert.equal(messageCheck?.evidence.liveSession.operatorPacket.exists, true)
    assert.equal(messageCheck?.evidence.liveSession.operatorPacket.stale, true)
    assert.equal(report.sourceReports.messageLiveSession.operatorPacket.stale, true)
    assert.equal(packetCommand?.command, 'npm run v04:message:live:session')
    assert.match(packetCommand?.reason ?? '', /stale private-safe Markdown/)
    assert.doesNotMatch(json, /private local webhook payload|private stale operator note/)
  } finally {
    await rm(directoryPath, { recursive: true, force: true })
  }
})

test('v0.4 readiness status surfaces live preflight environment blockers privately', async () => {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'nexus-v04-live-preflight-'))
  try {
    const artifactDir = path.join(directoryPath, 'artifacts')
    const localEvidencePath = path.join(directoryPath, 'message-awareness-local.json')
    const livePreflightPath = path.join(directoryPath, 'message-awareness-live-preflight.json')
    await writeReadyStabilizationArtifacts(artifactDir)
    await writeJson(localEvidencePath, buildMessageAwarenessEvidence({
      mode: 'local-webhook',
      payload: {
        kind: 'message',
        source: 'Nexus Validation',
        text: 'private local webhook payload',
      },
      response: { ok: true },
    }))
    await writeJson(livePreflightPath, {
      schemaVersion: 1,
      gate: 'message-awareness-live-preflight',
      generatedAt: '2026-06-17T13:00:00Z',
      ok: false,
      overallStatus: 'environment-blocked',
      blockingCheckIds: ['macos-notification-center-live'],
      checks: [
        {
          id: 'macos-notification-center-live',
          status: 'needs-permission',
          blocking: true,
          detail: 'private notification body should not leak',
          diagnostics: {
            machineChecked: true,
            privateToken: 'private-token',
          },
        },
      ],
    })

    const report = await buildV04ReadinessStatusReport({
      artifactDir,
      completeEvidenceFile: path.join(directoryPath, 'missing-complete.json'),
      generatedAt: '2026-06-17T13:00:00Z',
      liveEvidenceFile: path.join(directoryPath, 'missing-live.json'),
      livePreflightFile: livePreflightPath,
      localEvidenceFile: localEvidencePath,
    })
    const messageCheck = report.checks.find((check: { id: string }) => check.id === 'message_awareness.release_gate')
    const json = JSON.stringify(report)

    assert.equal(report.ok, false)
    assert.deepEqual(report.blockingCheckIds, ['message_awareness.release_gate'])
    assert.equal(messageCheck?.status, 'environment-blocked')
    assert.equal(messageCheck?.evidence.livePreflight.exists, true)
    assert.equal(messageCheck?.evidence.livePreflight.ok, false)
    assert.equal(messageCheck?.evidence.livePreflight.overallStatus, 'environment-blocked')
    assert.deepEqual(messageCheck?.evidence.livePreflight.blockingCheckIds, ['macos-notification-center-live'])
    assert.equal(report.sourceReports.messageLivePreflight.fileExists, true)
    assert.deepEqual(report.sourceReports.messageLivePreflight.blockingCheckIds, ['macos-notification-center-live'])
    assert.doesNotMatch(json, /private notification body|private-token|private local webhook payload/)
  } finally {
    await rm(directoryPath, { recursive: true, force: true })
  }
})

test('v0.4 readiness status recommends finalize when live evidence is complete but release evidence is missing', async () => {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'nexus-v04-finalize-message-'))
  try {
    const artifactDir = path.join(directoryPath, 'artifacts')
    const localEvidencePath = path.join(directoryPath, 'message-awareness-local.json')
    const liveEvidencePath = path.join(directoryPath, 'message-awareness-live.json')
    await writeReadyStabilizationArtifacts(artifactDir)
    await writeJson(localEvidencePath, buildMessageAwarenessEvidence({
      mode: 'local-webhook',
      payload: {
        kind: 'message',
        sender: 'Private Sender',
        source: 'Nexus Validation',
        text: 'private local webhook payload',
      },
      response: {
        id: 'private-response-id',
        ok: true,
      },
      gateVersion: 'v0.4',
    }))
    await writeJson(liveEvidencePath, { checks: buildCompleteLiveEvidenceChecks() })

    const report = await buildV04ReadinessStatusReport({
      artifactDir,
      completeEvidenceFile: path.join(directoryPath, 'missing-complete.json'),
      generatedAt: '2026-06-17T13:00:00Z',
      liveEvidenceFile: liveEvidencePath,
      localEvidenceFile: localEvidencePath,
    })
    const messageCheck = report.checks.find((check: { id: string }) => check.id === 'message_awareness.release_gate')
    const finalizeCommand = report.nextCommands.find((entry: { id: string }) => (
      entry.id === 'message-finalize-release-evidence'
    ))
    const json = JSON.stringify(report)

    assert.equal(report.ok, false)
    assert.deepEqual(report.blockingCheckIds, ['message_awareness.release_gate'])
    assert.equal(messageCheck?.status, 'partial')
    assert.equal(messageCheck?.evidence.localWebhookPass, true)
    assert.equal(messageCheck?.evidence.liveGateComplete, true)
    assert.equal(messageCheck?.evidence.releaseGateComplete, false)
    assert.deepEqual(messageCheck?.evidence.pendingCheckIds, [])
    assert.ok(finalizeCommand?.command.startsWith('npm run v04:message:finalize --'))
    assert.ok(finalizeCommand?.command.includes(`--local-evidence-file "${localEvidencePath}"`))
    assert.ok(finalizeCommand?.command.includes(`--live-evidence-file "${liveEvidencePath}"`))
    assert.ok(finalizeCommand?.command.includes(`--complete-evidence-file "${path.join(directoryPath, 'missing-complete.json')}"`))
    assert.ok(finalizeCommand?.command.includes('--redacted-output-file "docs/release-evidence/v0.4.0-message-awareness.json"'))
    assert.equal(json.includes('private local webhook payload'), false)
    assert.equal(json.includes('Private Sender'), false)
    assert.equal(json.includes('private-response-id'), false)
  } finally {
    await rm(directoryPath, { recursive: true, force: true })
  }
})

test('v0.4 readiness status requires source-backed privacy safety evidence', async () => {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'nexus-v04-missing-privacy-'))
  try {
    const artifactDir = path.join(directoryPath, 'artifacts')
    const completeEvidencePath = path.join(directoryPath, 'message-awareness-complete.json')
    const redactedEvidencePath = path.join(directoryPath, 'message-awareness-redacted.json')
    await writeReadyStabilizationArtifacts(artifactDir)
    await rm(path.join(artifactDir, 'privacy-safety.json'), { force: true })
    await writeCompleteMessageEvidencePair(completeEvidencePath, redactedEvidencePath)

    const report = await buildV04ReadinessStatusReport({
      artifactDir,
      completeEvidenceFile: completeEvidencePath,
      generatedAt: '2026-06-17T13:00:00Z',
      liveEvidenceFile: path.join(directoryPath, 'missing-live.json'),
      localEvidenceFile: path.join(directoryPath, 'missing-local.json'),
      redactedOutputFile: redactedEvidencePath,
    })
    const privacyCheck = report.checks.find((check: { id: string }) => check.id === 'privacy_safety.boundaries')

    assert.equal(report.ok, false)
    assert.deepEqual(report.blockingCheckIds, ['privacy_safety.boundaries'])
    assert.equal(privacyCheck?.status, 'needs-policy-evidence')
    assert.deepEqual(privacyCheck?.evidence.failedCheckIds, ['privacy-safety-evidence-file'])
    assert.equal(privacyCheck?.evidence.adultOrNsfwMarketplaceAllowed, null)
    assert.ok(report.nextCommands.some(
      (entry: { id: string; command: string }) => entry.id === 'privacy-safety-report'
        && entry.command === 'npm run privacy:safety:report -- --output artifacts/v0.3.4/privacy-safety.json --require-ready',
    ))
  } finally {
    await rm(directoryPath, { recursive: true, force: true })
  }
})

test('v0.4 readiness status CLI persists report and enforces readiness', async () => {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'nexus-v04-cli-'))
  try {
    const artifactDir = path.join(directoryPath, 'artifacts')
    const completeEvidencePath = path.join(directoryPath, 'message-awareness-complete.json')
    const redactedEvidencePath = path.join(directoryPath, 'message-awareness-redacted.json')
    const outputPath = path.join(directoryPath, 'v04-status.json')
    await writeReadyStabilizationArtifacts(artifactDir)
    await writeCompleteMessageEvidencePair(completeEvidencePath, redactedEvidencePath)

    const { stdout } = await execFileAsync(process.execPath, [
      '--experimental-strip-types',
      'scripts/v04-readiness-status.mjs',
      '--artifact-dir',
      artifactDir,
      '--complete-evidence-file',
      completeEvidencePath,
      '--live-evidence-file',
      path.join(directoryPath, 'missing-live.json'),
      '--local-evidence-file',
      path.join(directoryPath, 'missing-local.json'),
      '--redacted-output-file',
      redactedEvidencePath,
      '--output',
      outputPath,
      '--require-ready',
    ], { cwd: process.cwd() })
    const stdoutReport = JSON.parse(stdout)
    const fileReport = JSON.parse(await readFile(outputPath, 'utf8'))

    assert.deepEqual(fileReport, stdoutReport)
    assert.equal(fileReport.ok, true)

    await rm(completeEvidencePath, { force: true })
    await assert.rejects(
      execFileAsync(process.execPath, [
        '--experimental-strip-types',
        'scripts/v04-readiness-status.mjs',
        '--artifact-dir',
        artifactDir,
        '--complete-evidence-file',
        completeEvidencePath,
        '--redacted-output-file',
        redactedEvidencePath,
        '--require-ready',
      ], { cwd: process.cwd() }),
      (error: unknown) => {
        const err = error as { code?: number; stdout?: string }
        assert.equal(err.code, 1)
        const report = JSON.parse(err.stdout ?? '{}')
        assert.equal(report.ok, false)
        assert.deepEqual(report.blockingCheckIds, ['message_awareness.release_gate'])
        return true
      },
    )
  } finally {
    await rm(directoryPath, { recursive: true, force: true })
  }
})

test('v0.4 readiness status package wiring stays available', async () => {
  const scriptText = await readFile('scripts/v04-readiness-status.mjs', 'utf8')

  assert.equal(
    packageJson.scripts?.['v04:readiness:status'],
    'node --experimental-strip-types scripts/v04-readiness-status.mjs',
  )
  assert.equal(
    packageJson.scripts?.['companion:readiness:report'],
    'node --experimental-strip-types scripts/companion-readiness-report.mjs',
  )
  assert.equal(
    packageJson.scripts?.['memory:map:report'],
    'node --experimental-strip-types scripts/memory-map-report.mjs',
  )
  assert.equal(
    packageJson.scripts?.['privacy:safety:report'],
    'node --experimental-strip-types scripts/privacy-safety-report.mjs',
  )
  assert.equal(
    packageJson.scripts?.['v04:release:gate'],
    'npm run verify:release && npm run v04:readiness:status -- --require-ready --verify-release-ran && npm run v04:completion:audit -- --require-complete --verify-release-ran',
  )
  assert.equal(
    packageJson.scripts?.['v04:message:smoke:local'],
    'node scripts/message-awareness-local-smoke.mjs --evidence-file artifacts/v0.4.0/message-awareness-local.json',
  )
  assert.equal(
    packageJson.scripts?.['v04:message:live:template'],
    'node scripts/validate-message-awareness.mjs --write-live-template artifacts/v0.4.0/message-awareness-live.json',
  )
  assert.equal(
    packageJson.scripts?.['v04:message:live:record'],
    'node scripts/record-message-awareness-live-evidence.mjs --live-evidence-file artifacts/v0.4.0/message-awareness-live.json --macos-live-probe-file artifacts/v0.4.0/message-awareness-macos-live-probe.json --require-macos-live-probe-candidate --macos-live-probe-max-age-ms 1800000',
  )
  assert.equal(
    packageJson.scripts?.['v04:message:gate:live'],
    'node scripts/validate-message-awareness.mjs --check-live-evidence artifacts/v0.4.0/message-awareness-live.json --require-live-complete',
  )
  assert.equal(
    packageJson.scripts?.['v04:message:status:release'],
    'node scripts/message-awareness-release-status.mjs --local-evidence-file artifacts/v0.4.0/message-awareness-local.json --live-evidence-file artifacts/v0.4.0/message-awareness-live.json --complete-evidence-file artifacts/v0.4.0/message-awareness-complete.json --redacted-output-file docs/release-evidence/v0.4.0-message-awareness.json',
  )
  assert.equal(
    packageJson.scripts?.['v04:message:merge:release'],
    'node scripts/validate-message-awareness.mjs --merge-evidence-file artifacts/v0.4.0/message-awareness-local.json --live-evidence-file artifacts/v0.4.0/message-awareness-live.json --evidence-file artifacts/v0.4.0/message-awareness-complete.json',
  )
  assert.equal(
    packageJson.scripts?.['v04:message:gate:release'],
    'node scripts/validate-message-awareness.mjs --check-evidence-file artifacts/v0.4.0/message-awareness-complete.json --require-release-complete',
  )
  assert.equal(
    packageJson.scripts?.['v04:message:release:redact'],
    'node scripts/validate-message-awareness.mjs --redact-evidence-file artifacts/v0.4.0/message-awareness-complete.json --redacted-output-file docs/release-evidence/v0.4.0-message-awareness.json',
  )
  assert.equal(
    packageJson.scripts?.['v04:message:finalize'],
    'node scripts/v04-message-release-finalize.mjs',
  )
  assert.equal(scriptText.includes('artifacts/v0.4.0/message-awareness-complete.json'), true)
  assert.equal(DEFAULT_V04_MACOS_LIVE_PROBE_FILE, 'artifacts/v0.4.0/message-awareness-macos-live-probe.json')
  assert.equal(DEFAULT_V04_LIVE_SESSION_FILE, 'artifacts/v0.4.0/message-awareness-live-session.json')
  assert.equal(DEFAULT_V04_LIVE_SESSION_MARKDOWN_FILE, 'artifacts/v0.4.0/message-awareness-live-session.md')
  assert.equal(DEFAULT_V04_PRIVACY_SAFETY_FILE, 'artifacts/v0.3.4/privacy-safety.json')
  assert.equal(scriptText.includes('docs/release-evidence/v0.4.0-message-awareness.json'), true)
  assert.ok(packageJson.build?.files?.includes('scripts/v04-readiness-status.mjs'))
  assert.ok(packageJson.build?.files?.includes('scripts/companion-readiness-report.mjs'))
  assert.ok(packageJson.build?.files?.includes('scripts/memory-map-report.mjs'))
  assert.ok(packageJson.build?.files?.includes('scripts/privacy-safety-report.mjs'))
  assert.ok(packageJson.build?.files?.includes('scripts/v04-message-release-finalize.mjs'))
  assert.ok(packageJson.build?.asarUnpack?.includes('scripts/v04-readiness-status.mjs'))
  assert.ok(packageJson.build?.asarUnpack?.includes('scripts/companion-readiness-report.mjs'))
  assert.ok(packageJson.build?.asarUnpack?.includes('scripts/memory-map-report.mjs'))
  assert.ok(packageJson.build?.asarUnpack?.includes('scripts/privacy-safety-report.mjs'))
  assert.ok(packageJson.build?.asarUnpack?.includes('scripts/v04-message-release-finalize.mjs'))
  assert.equal(scriptText.includes('../src/'), false)
})
