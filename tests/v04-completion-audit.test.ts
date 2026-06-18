import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import {
  buildV04CompletionAuditReport,
  parseV04CompletionAuditArgs,
  V04_COMPLETION_AUDIT_GATE,
} from '../scripts/v04-completion-audit.mjs'
import {
  buildMessageAwarenessEvidence,
  normalizeLiveEvidenceChecks,
  redactMessageAwarenessEvidence,
} from '../scripts/validate-message-awareness.mjs'
import { buildPrivacySafetyEvidenceReport } from '../src/features/stabilization/privacySafetyEvidence.ts'
import packageJson from '../package.json' with { type: 'json' }

const execFileAsync = promisify(execFile)

async function writeJson(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function checks(ids: string[]) {
  return ids.map((id) => ({ id, pass: true, detail: `${id} passed` }))
}

async function writeReadyArtifacts(artifactDir: string) {
  await writeJson(path.join(artifactDir, 'companion-readiness.json'), {
    gate: 'companion-readiness-health',
    generatedAt: '2026-06-17T12:00:00Z',
    ok: true,
    status: 'ready',
    readyCount: 9,
    totalCount: 9,
    requiredItemIds: [
      'standard_companion',
      'presence_state',
      'text_model',
      'microphone',
      'tts',
      'live2d',
      'notification_permission',
      'local_webhook',
      'privacy_boundary',
    ],
    coveredItemIds: [
      'standard_companion',
      'presence_state',
      'text_model',
      'microphone',
      'tts',
      'live2d',
      'notification_permission',
      'local_webhook',
      'privacy_boundary',
    ],
    privateValue: 'private readiness endpoint',
  })
  await writeJson(path.join(artifactDir, 'memory-map.json'), {
    gate: 'memory-map-observability',
    generatedAt: '2026-06-17T12:01:00Z',
    ok: true,
    viewSchema: 'nexus.memory-map.v1',
    nodeCount: 10,
    edgeCount: 9,
    relationshipTimelineCount: 3,
    summary: {
      sourceRefCount: 3,
      openableSourceRefCount: 3,
      pinnedCount: 1,
      recallPausedCount: 1,
    },
    checks: checks([
      'has-long-term-memories',
      'has-daily-entries',
      'has-graph-nodes',
      'has-graph-edges',
      'has-source-ref-edges',
      'has-openable-source-refs',
      'has-relationship-timeline',
      'has-relationship-state-summary',
      'has-recall-governance',
      'has-core-node-kinds',
    ]),
    privateValue: 'private memory body',
  })
  await writeJson(path.join(artifactDir, 'proactive-care-evidence.json'), {
    gate: 'proactive-care-observability',
    generatedAt: '2026-06-17T12:02:00Z',
    ok: true,
    evidenceSource: 'runtime-events',
    totalEvents: 4,
    v2EventCount: 4,
    userVisibleReasonCount: 4,
    openableSourceRefCount: 4,
    userActionCounts: {
      less_like_this: 0,
      mute_source: 0,
      open_source: 1,
      snooze: 0,
    },
    checks: checks([
      'has-all-sources-observed',
      'has-v2-policy-events',
      'has-user-visible-reasons',
      'has-user-feedback-actions',
      'has-openable-source-ref-coverage',
    ]),
    privateValue: 'private proactive event detail',
  })
  await writeJson(path.join(artifactDir, 'live2d-action-map.json'), {
    gate: 'live2d-action-map-coverage',
    generatedAt: '2026-06-17T12:03:00Z',
    ok: true,
    model: 'mao',
    summary: {
      coverage: 1,
      missing: 0,
      presenceStates: 7,
      mappedPresenceStates: 7,
    },
    checks: checks([
      'model-available',
      'expressions-covered',
      'gestures-covered',
      'lifecycle-covered',
      'presence-states-covered',
      'no-missing-live2d-targets',
    ]),
    privateValue: 'private action target',
  })
  await writeJson(path.join(artifactDir, 'character-card-import.json'), {
    gate: 'character-card-import',
    generatedAt: '2026-06-17T12:04:00Z',
    ok: true,
  })
  await writeJson(path.join(artifactDir, 'voice-diagnostics.json'), {
    schema: 'nexus.voice-diagnostics.v1',
    generatedAt: '2026-06-17T12:05:00Z',
    ok: true,
    summary: {
      status: 'ok',
      traceCount: 5,
      errorCount: 1,
    },
    privateValue: 'private voice transcript',
  })
  await writeJson(path.join(artifactDir, 'tts-adapter-smoke.json'), {
    gate: 'nexus-tts-adapter-smoke',
    generatedAt: '2026-06-17T12:06:00Z',
    ok: false,
    error: {
      kind: 'network-error',
      detail: 'private adapter endpoint should not copy',
    },
  })
  await writeJson(path.join(artifactDir, 'privacy-safety.json'), buildPrivacySafetyEvidenceReport({
    generatedAt: '2026-06-17T12:07:00Z',
  }))
}

function completeLiveEvidenceChecks() {
  return normalizeLiveEvidenceChecks([
    {
      id: 'macos-notification-center-live',
      status: 'pass',
      observedAt: '2026-06-17T12:10:00Z',
      operator: 'Release Operator',
      notes: ['Observed one real app notification once.'],
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
      notes: ['Owner DM replied and reconnect did not replay.'],
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
      notes: ['Approved Discord channel replied once.'],
      evidence: {
        approvedChannelReplyReturned: true,
        botEchoSuppressed: true,
        messageContentIntentEnabled: true,
        reconnectStatusVisible: true,
      },
    },
  ])
}

function completeMessageEvidence() {
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
    liveEvidenceChecks: completeLiveEvidenceChecks(),
    startedAt: '2026-06-17T12:39:00Z',
  })
}

async function writeCompleteMessageEvidencePair(completePath: string, redactedPath: string) {
  const evidence = completeMessageEvidence()
  await writeJson(completePath, evidence)
  await writeJson(redactedPath, redactMessageAwarenessEvidence(evidence))
}

test('v0.4 completion audit args support evidence paths and completion enforcement', () => {
  assert.deepEqual(parseV04CompletionAuditArgs([
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
    'artifacts/v04-completion.json',
    '--require-complete',
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
    outputPath: 'artifacts/v04-completion.json',
    privacySafetyFile: 'artifacts/privacy-safety.json',
    redactedOutputFile: 'docs/release-evidence/v0.4.0-message-awareness.json',
    requireComplete: true,
    verifyReleaseRan: true,
  })
})

test('v0.4 completion audit passes when every requirement has release evidence', async () => {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'nexus-v04-complete-'))
  try {
    const artifactDir = path.join(directoryPath, 'artifacts')
    const completeEvidenceFile = path.join(directoryPath, 'message-awareness-complete.json')
    const redactedEvidenceFile = path.join(directoryPath, 'message-awareness-redacted.json')
    await writeReadyArtifacts(artifactDir)
    await writeCompleteMessageEvidencePair(completeEvidenceFile, redactedEvidenceFile)

    const report = await buildV04CompletionAuditReport({
      artifactDir,
      completeEvidenceFile,
      generatedAt: '2026-06-17T13:00:00Z',
      liveEvidenceFile: path.join(directoryPath, 'missing-live.json'),
      localEvidenceFile: path.join(directoryPath, 'missing-local.json'),
      redactedOutputFile: redactedEvidenceFile,
      verifyReleaseRan: true,
    })
    const releaseRequirement = report.requirements.find((entry: { id: string }) => entry.id === 'release_evidence_gate')
    const json = JSON.stringify(report)

    assert.equal(report.gate, V04_COMPLETION_AUDIT_GATE)
    assert.equal(report.generatedAt, '2026-06-17T13:00:00.000Z')
    assert.equal(report.ok, true)
    assert.equal(report.overallStatus, 'complete')
    assert.deepEqual(report.blockingRequirementIds, [])
    assert.equal(report.completeCount, report.totalCount)
    assert.equal(report.requirements.every((entry: { status: string }) => entry.status === 'complete'), true)
    assert.equal(releaseRequirement?.evidence.verifyReleaseRan, true)
    assert.equal(releaseRequirement?.evidence.verifyReleaseCommandRequired, false)
    assert.deepEqual(releaseRequirement?.nextCommands, [])
    assert.equal(json.includes('private local webhook payload'), false)
    assert.equal(json.includes('Private Sender'), false)
    assert.equal(json.includes('private-response-id'), false)
    assert.equal(json.includes('private adapter endpoint'), false)
    assert.equal(json.includes('private memory body'), false)
  } finally {
    await rm(directoryPath, { recursive: true, force: true })
  }
})

test('v0.4 completion audit blocks raw message evidence until redacted release evidence is ready', async () => {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'nexus-v04-redaction-'))
  try {
    const artifactDir = path.join(directoryPath, 'artifacts')
    const completeEvidenceFile = path.join(directoryPath, 'message-awareness-complete.json')
    const redactedEvidenceFile = path.join(directoryPath, 'message-awareness-redacted.json')
    await writeReadyArtifacts(artifactDir)
    await writeJson(completeEvidenceFile, completeMessageEvidence())

    const report = await buildV04CompletionAuditReport({
      artifactDir,
      completeEvidenceFile,
      generatedAt: '2026-06-17T13:00:00Z',
      liveEvidenceFile: path.join(directoryPath, 'missing-live.json'),
      localEvidenceFile: path.join(directoryPath, 'missing-local.json'),
      redactedOutputFile: redactedEvidenceFile,
    })
    const messageRequirement = report.requirements.find((entry: { id: string }) => entry.id === 'message_awareness')

    assert.equal(report.ok, false)
    assert.equal(report.overallStatus, 'needs-work')
    assert.deepEqual(report.blockingRequirementIds, ['message_awareness'])
    assert.equal(messageRequirement?.status, 'partial')
    assert.deepEqual(messageRequirement?.blockers, ['redacted-release-evidence'])
    assert.equal(messageRequirement?.evidence.rawReleaseGateComplete, true)
    assert.equal(messageRequirement?.evidence.redactionGateComplete, false)
    assert.equal(messageRequirement?.evidence.releaseGateComplete, false)
    assert.ok(messageRequirement?.nextCommands.some((command: string) => (
      command.includes('message:validate -- --redact-evidence-file')
        && command.includes(completeEvidenceFile)
        && command.includes(redactedEvidenceFile)
    )))
  } finally {
    await rm(directoryPath, { recursive: true, force: true })
  }
})

test('v0.4 completion audit marks pending live checks as external required', async () => {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'nexus-v04-external-'))
  try {
    const artifactDir = path.join(directoryPath, 'artifacts')
    const localEvidenceFile = path.join(directoryPath, 'message-awareness-local.json')
    const macosLiveProbeFile = path.join(directoryPath, 'message-awareness-macos-live-probe.json')
    const liveSessionFile = path.join(directoryPath, 'message-awareness-live-session.json')
    const liveSessionMarkdownFile = path.join(directoryPath, 'message-awareness-live-session.md')
    await writeReadyArtifacts(artifactDir)
    await writeJson(localEvidenceFile, buildMessageAwarenessEvidence({
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
    }))
    await writeJson(macosLiveProbeFile, {
      schemaVersion: 1,
      gate: 'message-awareness-macos-live-probe',
      generatedAt: '2026-06-17T13:00:00Z',
      ok: true,
      status: 'observed-once',
      releaseEvidenceCandidate: true,
      releaseEvidenceRecorded: false,
      diagnostics: {
        platform: 'darwin',
        machineChecked: true,
        observedFreshCount: 1,
        replayFreshCount: 0,
        privateSender: 'Private Sender',
      },
      privateNotificationBody: 'private notification body',
    })
    await writeJson(liveSessionFile, {
      schemaVersion: 1,
      gate: 'nexus-v04-message-live-session',
      generatedAt: '2026-06-17T13:01:00Z',
      ok: false,
      overallStatus: 'manual-live-evidence-required',
      readyToRecordPendingChecks: true,
      safeToRunPendingRecordCommands: false,
      pendingCheckIds: [
        'macos-notification-center-live',
        'telegram-live-bridge',
        'discord-live-bridge',
      ],
      recordSafetySummary: {
        pendingRecordCount: 1,
        readyToAttemptCount: 1,
        safeToRunCount: 0,
        blockedCount: 0,
        needsOperatorValuesCount: 1,
        unavailableCount: 0,
        unknownCount: 0,
        unsafeRecordStepIds: ['record-macos-notification-center-live'],
      },
      stepExecutionSummary: {
        automationSafeCommandCount: 2,
        manualRecordStepCount: 1,
        blockedStepCount: 0,
        unsafeRecordStepCount: 1,
        automationSafeCommandIds: ['live-preflight', 'macos-live-probe'],
        manualRecordStepIds: ['record-macos-notification-center-live'],
        blockedStepIds: [],
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
          },
          discord: {
            hasTraceEvidence: true,
            lastOutboundError: 'Discord API 403 for discord:private-channel',
          },
        },
      },
      steps: [
        {
          id: 'record-macos-notification-center-live',
          checkId: 'macos-notification-center-live',
          status: 'manual-required',
          readyToAttempt: true,
          machinePrerequisite: {
            id: 'macos-live-probe',
            status: 'observed-once',
            releaseEvidenceCandidate: true,
          },
          recordCommandSafety: {
            status: 'needs-operator-values',
            safeToRunRecordCommand: false,
            dryRunRecommended: true,
            preflightRecommended: true,
            placeholderTokens: ['REPLACE_WITH_OPERATOR', 'REPLACE_WITH_OBSERVED_AT'],
            missingProofFieldIds: ['observedAt'],
            reasons: [
              'replace every template placeholder before recording release evidence',
              'missing proof field(s): observedAt',
            ],
          },
        },
      ],
    })
    await writeFile(
      liveSessionMarkdownFile,
      '# Operator packet\n\nprivate operator note with telegram:private-chat and Discord API 403\n',
      'utf8',
    )

    const report = await buildV04CompletionAuditReport({
      artifactDir,
      completeEvidenceFile: path.join(directoryPath, 'missing-complete.json'),
      generatedAt: '2026-06-17T13:00:00Z',
      liveEvidenceFile: path.join(directoryPath, 'missing-live.json'),
      liveSessionFile,
      liveSessionMarkdownFile,
      localEvidenceFile,
      macosLiveProbeFile,
    })
    const messageRequirement = report.requirements.find((entry: { id: string }) => entry.id === 'message_awareness')
    const json = JSON.stringify(report)

    assert.equal(report.ok, false)
    assert.equal(report.overallStatus, 'external-live-evidence-required')
    assert.deepEqual(report.externalRequirementIds, ['message_awareness'])
    assert.deepEqual(report.blockingRequirementIds, ['message_awareness'])
    assert.equal(messageRequirement?.status, 'external_required')
    assert.deepEqual(messageRequirement?.blockers, [
      'macos-notification-center-live',
      'telegram-live-bridge',
      'discord-live-bridge',
    ])
    assert.equal(messageRequirement?.evidence.macosLiveProbe.status, 'observed-once')
    assert.equal(messageRequirement?.evidence.macosLiveProbe.releaseEvidenceCandidate, true)
    assert.equal(messageRequirement?.evidence.liveSession.readyToRecordPendingChecks, true)
    assert.equal(messageRequirement?.evidence.liveSession.safeToRunPendingRecordCommands, false)
    assert.equal(messageRequirement?.evidence.liveSession.recordSafetySummary.needsOperatorValuesCount, 1)
    assert.equal(messageRequirement?.evidence.liveSession.stepExecutionSummary.manualRecordStepCount, 1)
    assert.deepEqual(messageRequirement?.evidence.liveSession.stepExecutionSummary.manualRecordStepIds, [
      'record-macos-notification-center-live',
    ])
    assert.equal(messageRequirement?.evidence.liveSession.bridgeTrace.telegramHasTraceEvidence, true)
    assert.equal(messageRequirement?.evidence.liveSession.bridgeTrace.discordHasTraceEvidence, true)
    assert.equal(messageRequirement?.evidence.liveSession.operatorPacket.exists, true)
    assert.equal(messageRequirement?.evidence.liveSession.operatorPacket.path, liveSessionMarkdownFile)
    assert.equal(messageRequirement?.evidence.liveSession.recordSteps[0].readyToAttempt, true)
    assert.equal(messageRequirement?.evidence.liveSession.recordSteps[0].recordCommandSafety.status, 'needs-operator-values')
    assert.equal(messageRequirement?.evidence.liveSession.recordSteps[0].recordCommandSafety.safeToRunRecordCommand, false)
    assert.equal(report.sourceReports.messageMacosLiveProbe.status, 'observed-once')
    assert.equal(report.sourceReports.messageLiveSession.readyToRecordPendingChecks, true)
    assert.equal(report.sourceReports.messageLiveSession.safeToRunPendingRecordCommands, false)
    assert.equal(report.sourceReports.messageLiveSession.recordSafetySummary.needsOperatorValuesCount, 1)
    assert.deepEqual(report.sourceReports.messageLiveSession.stepExecutionSummary.automationSafeCommandIds, [
      'live-preflight',
      'macos-live-probe',
    ])
    assert.equal(report.sourceReports.messageLiveSession.recordSteps[0].readyToAttempt, true)
    assert.equal(report.sourceReports.messageLiveSession.recordSteps[0].recordCommandSafety.status, 'needs-operator-values')
    assert.equal(report.sourceReports.messageLiveSession.operatorPacket.exists, true)
    assert.doesNotMatch(json, /private notification body|Private Sender|private-response-id|private local webhook payload|telegram:private-chat|discord:private-channel|Discord API 403|private operator note|private command text/)
    assert.ok(messageRequirement?.nextCommands.some((command: string) => (
      command.includes('message:live:record')
        && command.includes('telegram')
        && command.includes('--pairing-approved')
    )))
    const macosCommandDetail = messageRequirement?.nextCommandDetails?.find((entry: { id: string }) => (
      entry.id === 'message-record-macos-notification-center-live'
    ))
    assert.equal(macosCommandDetail?.isTemplate, true)
    assert.equal(macosCommandDetail?.mustReplacePlaceholders, true)
    assert.ok(macosCommandDetail?.dryRunCommand.includes('message:live:record -- macos'))
    assert.ok(macosCommandDetail?.dryRunCommand.includes('--dry-run'))
    assert.ok(macosCommandDetail?.preflightCommand.includes('message:live:record -- macos'))
    assert.ok(macosCommandDetail?.preflightCommand.includes('--preflight'))
    assert.ok(macosCommandDetail?.command.includes('--observed-at "REPLACE_WITH_OBSERVED_AT"'))
    assert.equal(macosCommandDetail?.readyToAttempt, true)
    assert.equal(macosCommandDetail?.liveSessionStepStatus, 'manual-required')
    assert.equal(macosCommandDetail?.safeToRun, false)
    assert.equal(macosCommandDetail?.executionMode, 'manual-template-record-command')
    assert.equal(macosCommandDetail?.recordCommandSafety.status, 'needs-operator-values')
    assert.equal(macosCommandDetail?.recordCommandSafety.safeToRunRecordCommand, false)
    assert.deepEqual(macosCommandDetail?.recordCommandSafety.placeholderTokens, [
      'REPLACE_WITH_OPERATOR',
      'REPLACE_WITH_OBSERVED_AT',
    ])
    assert.deepEqual(macosCommandDetail?.machinePrerequisite, {
      id: 'macos-live-probe',
      status: 'observed-once',
      releaseEvidenceCandidate: true,
    })
    assert.deepEqual(macosCommandDetail?.placeholderFields, ['operator', 'appName', 'observedAt'])
    assert.deepEqual(macosCommandDetail?.placeholderValues, [
      'REPLACE_WITH_OPERATOR',
      'REPLACE_WITH_REAL_APP',
      'REPLACE_WITH_OBSERVED_AT',
    ])
    assert.equal(
      messageRequirement?.automationSafeNextCommands?.some((entry: { id: string }) => (
        entry.id === 'message-record-macos-notification-center-live'
      )),
      false,
    )
    assert.ok(messageRequirement?.nextCommandAutomation.unsafeCommandIds.includes(
      'message-record-macos-notification-center-live',
    ))
    assert.ok(messageRequirement?.nextCommandAutomation.manualCommandIds.includes(
      'message-record-macos-notification-center-live',
    ))
    assert.equal(messageRequirement?.nextCommandAutomation.recordCommandExecutionSummary.blockedCount, 0)
    assert.ok(
      messageRequirement?.nextCommandAutomation.recordCommandExecutionSummary.manualTemplateCount >= 1,
    )
    assert.ok(
      messageRequirement?.nextCommandAutomation.recordCommandExecutionSummary.unsafeRecordCommandIds.includes(
        'message-record-macos-notification-center-live',
      ),
    )

    await assert.rejects(
      execFileAsync(process.execPath, [
        '--experimental-strip-types',
        'scripts/v04-completion-audit.mjs',
        '--artifact-dir',
        artifactDir,
        '--local-evidence-file',
        localEvidenceFile,
        '--live-evidence-file',
        path.join(directoryPath, 'missing-live.json'),
        '--complete-evidence-file',
        path.join(directoryPath, 'missing-complete.json'),
        '--require-complete',
      ], { cwd: process.cwd() }),
      (error: unknown) => {
        const err = error as { code?: number; stdout?: string }
        assert.equal(err.code, 1)
        const stdoutReport = JSON.parse(err.stdout ?? '{}')
        assert.equal(stdoutReport.overallStatus, 'external-live-evidence-required')
        assert.equal(JSON.stringify(stdoutReport).includes('private local webhook payload'), false)
        return true
      },
    )
  } finally {
    await rm(directoryPath, { recursive: true, force: true })
  }
})

test('v0.4 completion audit carries live-session operator packet recommendation', async () => {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'nexus-v04-missing-live-session-audit-'))
  try {
    const artifactDir = path.join(directoryPath, 'artifacts')
    const localEvidenceFile = path.join(directoryPath, 'message-awareness-local.json')
    await writeReadyArtifacts(artifactDir)
    await writeJson(localEvidenceFile, buildMessageAwarenessEvidence({
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
    }))

    const report = await buildV04CompletionAuditReport({
      artifactDir,
      completeEvidenceFile: path.join(directoryPath, 'missing-complete.json'),
      generatedAt: '2026-06-17T13:00:00Z',
      liveEvidenceFile: path.join(directoryPath, 'missing-live.json'),
      liveSessionFile: path.join(directoryPath, 'missing-live-session.json'),
      liveSessionMarkdownFile: path.join(directoryPath, 'missing-live-session.md'),
      localEvidenceFile,
    })
    const messageRequirement = report.requirements.find((entry: { id: string }) => entry.id === 'message_awareness')
    const packetCommand = messageRequirement?.nextCommandDetails?.find((entry: { id: string }) => (
      entry.id === 'message-live-session'
    ))
    const json = JSON.stringify(report)

    assert.equal(report.overallStatus, 'external-live-evidence-required')
    assert.equal(messageRequirement?.status, 'external_required')
    assert.equal(messageRequirement?.evidence.liveSession.exists, false)
    assert.equal(messageRequirement?.evidence.liveSession.operatorPacket.exists, false)
    assert.equal(packetCommand?.command, 'npm run v04:message:live:session')
    assert.match(packetCommand?.reason ?? '', /private-safe JSON and Markdown/)
    assert.doesNotMatch(json, /Private Sender|private-response-id|private local webhook payload/)
  } finally {
    await rm(directoryPath, { recursive: true, force: true })
  }
})

test('v0.4 completion audit carries stale live-session operator packet recommendation', async () => {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'nexus-v04-stale-live-session-audit-'))
  try {
    const artifactDir = path.join(directoryPath, 'artifacts')
    const localEvidenceFile = path.join(directoryPath, 'message-awareness-local.json')
    const liveSessionFile = path.join(directoryPath, 'message-awareness-live-session.json')
    const liveSessionMarkdownFile = path.join(directoryPath, 'message-awareness-live-session.md')
    await writeReadyArtifacts(artifactDir)
    await writeJson(localEvidenceFile, buildMessageAwarenessEvidence({
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
    }))
    await writeJson(liveSessionFile, {
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
      liveSessionMarkdownFile,
      '# Old operator packet\n\nprivate stale operator note\n',
      'utf8',
    )
    await utimes(liveSessionMarkdownFile, new Date('2026-06-17T13:00:00Z'), new Date('2026-06-17T13:00:00Z'))
    await utimes(liveSessionFile, new Date('2026-06-17T13:10:00Z'), new Date('2026-06-17T13:10:00Z'))

    const report = await buildV04CompletionAuditReport({
      artifactDir,
      completeEvidenceFile: path.join(directoryPath, 'missing-complete.json'),
      generatedAt: '2026-06-17T13:10:00Z',
      liveEvidenceFile: path.join(directoryPath, 'missing-live.json'),
      liveSessionFile,
      liveSessionMarkdownFile,
      localEvidenceFile,
    })
    const messageRequirement = report.requirements.find((entry: { id: string }) => entry.id === 'message_awareness')
    const packetCommand = messageRequirement?.nextCommandDetails?.find((entry: { id: string }) => (
      entry.id === 'message-live-session'
    ))
    const json = JSON.stringify(report)

    assert.equal(messageRequirement?.evidence.liveSession.operatorPacket.exists, true)
    assert.equal(messageRequirement?.evidence.liveSession.operatorPacket.stale, true)
    assert.equal(report.sourceReports.messageLiveSession.operatorPacket.stale, true)
    assert.equal(packetCommand?.command, 'npm run v04:message:live:session')
    assert.match(packetCommand?.reason ?? '', /stale private-safe Markdown/)
    assert.doesNotMatch(json, /Private Sender|private-response-id|private local webhook payload|private stale operator note/)
  } finally {
    await rm(directoryPath, { recursive: true, force: true })
  }
})

test('v0.4 completion audit treats live preflight blockers as local work', async () => {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'nexus-v04-live-preflight-blocked-'))
  try {
    const artifactDir = path.join(directoryPath, 'artifacts')
    const localEvidenceFile = path.join(directoryPath, 'message-awareness-local.json')
    const livePreflightFile = path.join(directoryPath, 'message-awareness-live-preflight.json')
    await writeReadyArtifacts(artifactDir)
    await writeJson(localEvidenceFile, buildMessageAwarenessEvidence({
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
    }))
    await writeJson(livePreflightFile, {
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

    const report = await buildV04CompletionAuditReport({
      artifactDir,
      completeEvidenceFile: path.join(directoryPath, 'missing-complete.json'),
      generatedAt: '2026-06-17T13:00:00Z',
      liveEvidenceFile: path.join(directoryPath, 'missing-live.json'),
      livePreflightFile,
      localEvidenceFile,
    })
    const messageRequirement = report.requirements.find((entry: { id: string }) => entry.id === 'message_awareness')
    const json = JSON.stringify(report)

    assert.equal(report.ok, false)
    assert.equal(report.overallStatus, 'needs-work')
    assert.deepEqual(report.externalRequirementIds, [])
    assert.deepEqual(report.blockingRequirementIds, ['message_awareness'])
    assert.equal(messageRequirement?.status, 'partial')
    assert.deepEqual(messageRequirement?.blockers, ['macos-notification-center-live'])
    assert.equal(messageRequirement?.evidence.livePreflight.overallStatus, 'environment-blocked')
    assert.deepEqual(messageRequirement?.evidence.livePreflight.blockingCheckIds, ['macos-notification-center-live'])
    assert.equal(report.sourceReports.messageLivePreflight.overallStatus, 'environment-blocked')
    assert.doesNotMatch(json, /private notification body|private-token|private local webhook payload|Private Sender|private-response-id/)
  } finally {
    await rm(directoryPath, { recursive: true, force: true })
  }
})

test('v0.4 completion audit recommends finalize after external live evidence passes', async () => {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'nexus-v04-finalize-'))
  try {
    const artifactDir = path.join(directoryPath, 'artifacts')
    const localEvidenceFile = path.join(directoryPath, 'message-awareness-local.json')
    const liveEvidenceFile = path.join(directoryPath, 'message-awareness-live.json')
    await writeReadyArtifacts(artifactDir)
    await writeJson(localEvidenceFile, buildMessageAwarenessEvidence({
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
    await writeJson(liveEvidenceFile, { checks: completeLiveEvidenceChecks() })

    const report = await buildV04CompletionAuditReport({
      artifactDir,
      completeEvidenceFile: path.join(directoryPath, 'missing-complete.json'),
      generatedAt: '2026-06-17T13:00:00Z',
      liveEvidenceFile,
      localEvidenceFile,
    })
    const messageRequirement = report.requirements.find((entry: { id: string }) => entry.id === 'message_awareness')
    const json = JSON.stringify(report)

    assert.equal(report.ok, false)
    assert.equal(report.overallStatus, 'needs-work')
    assert.deepEqual(report.externalRequirementIds, [])
    assert.deepEqual(report.blockingRequirementIds, ['message_awareness'])
    assert.equal(messageRequirement?.status, 'partial')
    assert.equal(messageRequirement?.evidence.localWebhookPass, true)
    assert.equal(messageRequirement?.evidence.liveGateComplete, true)
    assert.equal(messageRequirement?.evidence.releaseGateComplete, false)
    assert.deepEqual(messageRequirement?.blockers, ['complete-release-evidence'])
    assert.deepEqual(messageRequirement?.evidence.pendingCheckIds, [])
    assert.ok(messageRequirement?.nextCommands.some((command: string) => (
      command.startsWith('npm run v04:message:finalize --')
        && command.includes(`--local-evidence-file "${localEvidenceFile}"`)
        && command.includes(`--live-evidence-file "${liveEvidenceFile}"`)
    )))
    assert.equal(json.includes('private local webhook payload'), false)
    assert.equal(json.includes('Private Sender'), false)
    assert.equal(json.includes('private-response-id'), false)
  } finally {
    await rm(directoryPath, { recursive: true, force: true })
  }
})

test('v0.4 completion audit package wiring stays available', () => {
  assert.equal(
    packageJson.scripts?.['v04:completion:audit'],
    'node --experimental-strip-types scripts/v04-completion-audit.mjs',
  )
  assert.equal(
    packageJson.scripts?.['v04:release:gate'],
    'npm run verify:release && npm run v04:readiness:status -- --require-ready --verify-release-ran && npm run v04:completion:audit -- --require-complete --verify-release-ran',
  )
  assert.ok(packageJson.build?.files?.includes('scripts/v04-completion-audit.mjs'))
  assert.ok(packageJson.build?.asarUnpack?.includes('scripts/v04-completion-audit.mjs'))
})
