import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'

import {
  DEFAULT_V04_BRIDGE_TRACE_FILE,
  DEFAULT_V04_LIVE_PREFLIGHT_FILE,
  DEFAULT_V04_LIVE_SESSION_MARKDOWN_FILE,
  DEFAULT_V04_MACOS_LIVE_PROBE_FILE,
  DEFAULT_V04_MESSAGE_STATUS_FILE,
  buildV04MessageLiveSessionReport,
  formatV04MessageLiveSessionMarkdown,
  parseV04MessageLiveSessionArgs,
} from '../scripts/v04-message-live-session.mjs'

const execFileAsync = promisify(execFile)

async function withTempDirectory(fn: (directoryPath: string) => Promise<void>) {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'nexus-v04-live-session-'))
  try {
    await fn(directoryPath)
  } finally {
    await rm(directoryPath, { recursive: true, force: true })
  }
}

test('v0.4 message live session args default to v0.4 evidence files', () => {
  assert.deepEqual(parseV04MessageLiveSessionArgs([]), {
    help: false,
    messageStatusFile: DEFAULT_V04_MESSAGE_STATUS_FILE,
    preflightFile: DEFAULT_V04_LIVE_PREFLIGHT_FILE,
    macosLiveProbeFile: DEFAULT_V04_MACOS_LIVE_PROBE_FILE,
    bridgeTraceFile: DEFAULT_V04_BRIDGE_TRACE_FILE,
    outputPath: '',
    markdownOutputPath: '',
    requireReadyToRecord: false,
  })

  const parsed = parseV04MessageLiveSessionArgs([
    '--status-file',
    'tmp/status.json',
    '--preflight-file=tmp/preflight.json',
    '--macos-probe-file',
    'tmp/probe.json',
    '--bridge-trace-file',
    'tmp/bridge-trace.json',
    '--output',
    'tmp/session.json',
    '--markdown-output',
    'tmp/session.md',
    '--require-ready-to-record',
  ])

  assert.equal(parsed.messageStatusFile, 'tmp/status.json')
  assert.equal(parsed.preflightFile, 'tmp/preflight.json')
  assert.equal(parsed.macosLiveProbeFile, 'tmp/probe.json')
  assert.equal(parsed.bridgeTraceFile, 'tmp/bridge-trace.json')
  assert.equal(parsed.outputPath, 'tmp/session.json')
  assert.equal(parsed.markdownOutputPath, 'tmp/session.md')
  assert.equal(parsed.requireReadyToRecord, true)
})

test('v0.4 message live session summarizes pending live work without leaking private evidence', async () => {
  await withTempDirectory(async (directoryPath) => {
    const statusFile = path.join(directoryPath, 'message-awareness-status.json')
    const preflightFile = path.join(directoryPath, 'message-awareness-live-preflight.json')
    const macosProbeFile = path.join(directoryPath, 'message-awareness-macos-live-probe.json')

    await writeFile(statusFile, JSON.stringify({
      gate: 'v0.4-message-awareness-release-status',
      ok: false,
      releaseGateComplete: false,
      rawReleaseGateComplete: false,
      redactionGateComplete: false,
      liveEvidence: {
        audit: {
          pendingCheckIds: [
            'macos-notification-center-live',
            'telegram-live-bridge',
            'discord-live-bridge',
          ],
          failedCheckIds: [],
          checks: [
            {
              id: 'telegram-live-bridge',
              status: 'manual-required',
              evidence: {
                lastOutboundTarget: 'telegram:private-chat-id',
                privateMessageText: 'private telegram body',
              },
            },
          ],
        },
      },
      liveVerificationChecklist: [
        {
          id: 'macos-notification-center-live',
          label: 'macOS Notification Center',
          status: 'manual-required',
          beforeRecording: ['Send one real app notification and confirm exactly one Nexus event appears.'],
          diagnostics: ['Notification Center should show a recent event or skip reason.'],
          recordCommand: 'npm run v04:message:live:record -- macos --observed-at "REPLACE_WITH_OBSERVED_AT" --operator "REPLACE_WITH_OPERATOR" --app-name "REPLACE_WITH_REAL_APP" --full-disk-access-granted --notification-observed-once --replay-checked-after-restart --note "One real app notification appeared once."',
          dryRunCommand: 'npm run v04:message:live:record -- macos --dry-run --observed-at "REPLACE_WITH_OBSERVED_AT" --operator "REPLACE_WITH_OPERATOR" --app-name "REPLACE_WITH_REAL_APP" --full-disk-access-granted --notification-observed-once --replay-checked-after-restart --note "One real app notification appeared once."',
          preflightCommand: 'npm run v04:message:live:record -- macos --preflight --observed-at "REPLACE_WITH_OBSERVED_AT" --operator "REPLACE_WITH_OPERATOR" --app-name "REPLACE_WITH_REAL_APP" --full-disk-access-granted --notification-observed-once --replay-checked-after-restart --note "One real app notification appeared once."',
          recordCommandIsTemplate: true,
          mustReplacePlaceholders: true,
          placeholderFields: ['operator', 'appName', 'observedAt'],
          missingProofFields: [{ field: 'observedAt', type: 'iso-timestamp' }],
        },
        {
          id: 'telegram-live-bridge',
          label: 'Telegram live bridge',
          status: 'manual-required',
          beforeRecording: ['Approve owner pairing and confirm one reply returns.'],
          diagnostics: ['Telegram trace should show a non-zero update offset checkpoint.'],
          recordCommand: 'npm run v04:message:live:record -- telegram --observed-at "REPLACE_WITH_OBSERVED_AT" --operator "REPLACE_WITH_OPERATOR" --pairing-approved --owner-text-reply-returned --busy-message-queued-or-retried --reconnect-replay-checked --note "Owner DM paired and replied."',
          dryRunCommand: 'npm run v04:message:live:record -- telegram --dry-run --observed-at "REPLACE_WITH_OBSERVED_AT" --operator "REPLACE_WITH_OPERATOR" --pairing-approved --owner-text-reply-returned --busy-message-queued-or-retried --reconnect-replay-checked --note "Owner DM paired and replied."',
          preflightCommand: 'npm run v04:message:live:record -- telegram --preflight --observed-at "REPLACE_WITH_OBSERVED_AT" --operator "REPLACE_WITH_OPERATOR" --pairing-approved --owner-text-reply-returned --busy-message-queued-or-retried --reconnect-replay-checked --note "Owner DM paired and replied."',
          recordCommandIsTemplate: true,
          mustReplacePlaceholders: true,
          placeholderFields: ['operator', 'observedAt'],
        },
        {
          id: 'discord-live-bridge',
          label: 'Discord live bridge',
          status: 'manual-required',
          beforeRecording: ['Confirm an approved channel or DM receives a companion reply.'],
          diagnostics: ['Discord trace should show reconnect status after interruption.'],
          recordCommand: 'npm run v04:message:live:record -- discord --observed-at "REPLACE_WITH_OBSERVED_AT" --operator "REPLACE_WITH_OPERATOR" --message-content-intent-enabled --approved-channel-reply-returned --bot-echo-suppressed --reconnect-status-visible --note "Allowed target replied once."',
          dryRunCommand: 'npm run v04:message:live:record -- discord --dry-run --observed-at "REPLACE_WITH_OBSERVED_AT" --operator "REPLACE_WITH_OPERATOR" --message-content-intent-enabled --approved-channel-reply-returned --bot-echo-suppressed --reconnect-status-visible --note "Allowed target replied once."',
          preflightCommand: 'npm run v04:message:live:record -- discord --preflight --observed-at "REPLACE_WITH_OBSERVED_AT" --operator "REPLACE_WITH_OPERATOR" --message-content-intent-enabled --approved-channel-reply-returned --bot-echo-suppressed --reconnect-status-visible --note "Allowed target replied once."',
          recordCommandIsTemplate: true,
          mustReplacePlaceholders: true,
          placeholderFields: ['operator', 'observedAt'],
        },
      ],
      privateWebhookPayload: 'private local webhook body',
    }), 'utf8')

    await writeFile(preflightFile, JSON.stringify({
      gate: 'message-awareness-live-preflight',
      ok: true,
      overallStatus: 'ready-for-live-observation',
      blockingCheckIds: [],
      checks: [
        { id: 'macos-notification-center-live', status: 'ready-for-observation', blocking: false },
        { id: 'telegram-live-bridge', status: 'manual-required', blocking: false },
        { id: 'discord-live-bridge', status: 'manual-required', blocking: false },
      ],
      privateNotificationBody: 'private notification text',
    }), 'utf8')

    await writeFile(macosProbeFile, JSON.stringify({
      gate: 'message-awareness-macos-live-probe',
      ok: false,
      status: 'no-fresh-notification',
      releaseEvidenceCandidate: false,
      diagnostics: {
        platform: 'darwin',
        machineChecked: true,
        errorKind: null,
        testNotificationRequested: false,
        observedFreshCount: 0,
        replayFreshCount: 0,
        privateSender: 'Private Sender',
      },
      privateNotificationBody: 'private probe body',
    }), 'utf8')

    const report = await buildV04MessageLiveSessionReport({
      messageStatusFile: statusFile,
      preflightFile,
      macosLiveProbeFile: macosProbeFile,
    }, { now: '2026-06-17T18:00:00Z' })
    const json = JSON.stringify(report)
    const macosProbeStep = report.steps.find((step) => step.id === 'macos-live-probe')
    const macosRecordStep = report.steps.find((step) => step.id === 'record-macos-notification-center-live')
    const telegramRecordStep = report.steps.find((step) => step.id === 'record-telegram-live-bridge')

    assert.equal(report.ok, false)
    assert.equal(report.overallStatus, 'manual-live-evidence-required')
    assert.deepEqual(report.pendingCheckIds, [
      'macos-notification-center-live',
      'telegram-live-bridge',
      'discord-live-bridge',
    ])
    assert.equal(report.readyToRecordPendingChecks, false)
    assert.equal(report.safeToRunPendingRecordCommands, false)
    assert.deepEqual(report.recordSafetySummary, {
      pendingRecordCount: 3,
      readyToAttemptCount: 2,
      safeToRunCount: 0,
      blockedCount: 1,
      needsOperatorValuesCount: 2,
      unavailableCount: 0,
      unknownCount: 0,
      unsafeRecordStepIds: [
        'record-macos-notification-center-live',
        'record-telegram-live-bridge',
        'record-discord-live-bridge',
      ],
    })
    assert.equal(report.stepExecutionSummary.automationSafeCommandCount, 3)
    assert.deepEqual(report.stepExecutionSummary.automationSafeCommandIds, [
      'live-preflight',
      'macos-live-probe',
      'live-gate',
    ])
    assert.deepEqual(report.stepExecutionSummary.manualRecordStepIds, [
      'record-macos-notification-center-live',
      'record-telegram-live-bridge',
      'record-discord-live-bridge',
    ])
    assert.deepEqual(report.stepExecutionSummary.blockedStepIds, [
      'record-macos-notification-center-live',
      'live-gate',
      'finalize-message-evidence',
    ])
    assert.deepEqual(report.stepExecutionSummary.unsafeRecordStepIds, [
      'record-macos-notification-center-live',
      'record-telegram-live-bridge',
      'record-discord-live-bridge',
    ])
    assert.equal(report.sourceReports.preflight.ok, true)
    assert.equal(report.sourceReports.macosLiveProbe.status, 'no-fresh-notification')
    assert.equal(macosProbeStep?.status, 'needs-real-notification')
    assert.equal(macosRecordStep?.readyToAttempt, false)
    assert.equal(macosRecordStep?.machinePrerequisite?.releaseEvidenceCandidate, false)
    assert.equal(macosRecordStep?.recordCommandSafety?.status, 'blocked')
    assert.equal(macosRecordStep?.recordCommandSafety?.safeToRunRecordCommand, false)
    assert.ok(macosRecordStep?.recordCommandSafety?.placeholderTokens.includes('REPLACE_WITH_OBSERVED_AT'))
    assert.ok(macosRecordStep?.recordCommandSafety?.reasons.some((reason: string) => (
      reason.includes('not a release evidence candidate')
    )))
    assert.match(macosRecordStep?.detail ?? '', /Run the macOS live probe/)
    assert.equal(telegramRecordStep?.readyToAttempt, true)
    assert.equal(telegramRecordStep?.recordCommandSafety?.status, 'needs-operator-values')
    assert.equal(telegramRecordStep?.recordCommandSafety?.safeToRunRecordCommand, false)
    assert.ok(telegramRecordStep?.recordCommandSafety?.dryRunRecommended)
    assert.ok(telegramRecordStep?.recordCommandSafety?.preflightRecommended)
    assert.ok(telegramRecordStep?.dryRunCommand?.includes('--dry-run'))
    assert.deepEqual(telegramRecordStep?.placeholderFields, ['operator', 'observedAt'])
    assert.doesNotMatch(
      json,
      /private telegram body|telegram:private-chat-id|private local webhook body|private notification text|private probe body|Private Sender/,
    )

    const markdown = formatV04MessageLiveSessionMarkdown(report)
    assert.match(markdown, /Nexus v0\.4 Message-Awareness Live Evidence Packet/)
    assert.match(markdown, /Step Execution Summary/)
    assert.match(markdown, /Automation-safe commands: 3/)
    assert.match(markdown, /Manual record steps: record-macos-notification-center-live, record-telegram-live-bridge, record-discord-live-bridge/)
    assert.match(markdown, /record-telegram-live-bridge/)
    assert.match(markdown, /Safe to run all pending record commands: no/)
    assert.match(markdown, /Record command safety/)
    assert.match(markdown, /safeToRunRecordCommand=no/)
    assert.match(markdown, /Do not treat v0\.4 message-awareness as complete/)
    assert.doesNotMatch(
      markdown,
      /private telegram body|telegram:private-chat-id|private local webhook body|private notification text|private probe body|Private Sender/,
    )
  })
})

test('v0.4 message live session only unlocks macOS recording after a real probe candidate', async () => {
  await withTempDirectory(async (directoryPath) => {
    const statusFile = path.join(directoryPath, 'message-awareness-status.json')
    const preflightFile = path.join(directoryPath, 'message-awareness-live-preflight.json')
    const macosProbeFile = path.join(directoryPath, 'message-awareness-macos-live-probe.json')

    await writeFile(statusFile, JSON.stringify({
      releaseGateComplete: false,
      liveEvidence: {
        audit: {
          pendingCheckIds: ['macos-notification-center-live'],
          failedCheckIds: [],
          checks: [{ id: 'macos-notification-center-live', status: 'manual-required' }],
        },
      },
      liveVerificationChecklist: [
        {
          id: 'macos-notification-center-live',
          status: 'manual-required',
          recordCommand: 'npm run v04:message:live:record -- macos --observed-at "REPLACE_WITH_OBSERVED_AT" --operator "REPLACE_WITH_OPERATOR" --app-name "REPLACE_WITH_REAL_APP" --full-disk-access-granted --notification-observed-once --replay-checked-after-restart --note "One real app notification appeared once."',
          dryRunCommand: 'npm run v04:message:live:record -- macos --dry-run --observed-at "REPLACE_WITH_OBSERVED_AT" --operator "REPLACE_WITH_OPERATOR" --app-name "REPLACE_WITH_REAL_APP" --full-disk-access-granted --notification-observed-once --replay-checked-after-restart --note "One real app notification appeared once."',
          preflightCommand: 'npm run v04:message:live:record -- macos --preflight --observed-at "REPLACE_WITH_OBSERVED_AT" --operator "REPLACE_WITH_OPERATOR" --app-name "REPLACE_WITH_REAL_APP" --full-disk-access-granted --notification-observed-once --replay-checked-after-restart --note "One real app notification appeared once."',
          recordCommandIsTemplate: true,
          mustReplacePlaceholders: true,
          placeholderFields: ['operator', 'appName', 'observedAt'],
        },
      ],
    }), 'utf8')
    await writeFile(preflightFile, JSON.stringify({
      ok: true,
      overallStatus: 'ready-for-live-observation',
      blockingCheckIds: [],
      checks: [{ id: 'macos-notification-center-live', status: 'ready-for-observation', blocking: false }],
    }), 'utf8')
    await writeFile(macosProbeFile, JSON.stringify({
      gate: 'message-awareness-macos-live-probe',
      ok: true,
      status: 'observed-once',
      releaseEvidenceCandidate: true,
      diagnostics: {
        platform: 'darwin',
        machineChecked: true,
        testNotificationRequested: false,
        observedFreshCount: 1,
        replayFreshCount: 0,
      },
    }), 'utf8')

    const report = await buildV04MessageLiveSessionReport({
      messageStatusFile: statusFile,
      preflightFile,
      macosLiveProbeFile: macosProbeFile,
    })
    const macosRecordStep = report.steps.find((step) => step.id === 'record-macos-notification-center-live')

    assert.equal(report.readyToRecordPendingChecks, true)
    assert.equal(report.safeToRunPendingRecordCommands, false)
    assert.deepEqual(report.recordSafetySummary, {
      pendingRecordCount: 1,
      readyToAttemptCount: 1,
      safeToRunCount: 0,
      blockedCount: 0,
      needsOperatorValuesCount: 1,
      unavailableCount: 0,
      unknownCount: 0,
      unsafeRecordStepIds: ['record-macos-notification-center-live'],
    })
    assert.equal(report.sourceReports.macosLiveProbe.releaseEvidenceCandidate, true)
    assert.equal(macosRecordStep?.readyToAttempt, true)
    assert.equal(macosRecordStep?.machinePrerequisite?.releaseEvidenceCandidate, true)
    assert.equal(macosRecordStep?.recordCommandSafety?.status, 'needs-operator-values')
    assert.equal(macosRecordStep?.recordCommandSafety?.safeToRunRecordCommand, false)
  })
})

test('v0.4 message live session applies safe Telegram and Discord bridge traces without leaking targets', async () => {
  await withTempDirectory(async (directoryPath) => {
    const statusFile = path.join(directoryPath, 'message-awareness-status.json')
    const preflightFile = path.join(directoryPath, 'message-awareness-live-preflight.json')
    const macosProbeFile = path.join(directoryPath, 'message-awareness-macos-live-probe.json')
    const bridgeTraceFile = path.join(directoryPath, 'message-awareness-bridge-trace.json')

    await writeFile(statusFile, JSON.stringify({
      releaseGateComplete: false,
      liveEvidence: {
        audit: {
          pendingCheckIds: ['telegram-live-bridge', 'discord-live-bridge'],
          failedCheckIds: [],
          checks: [
            { id: 'telegram-live-bridge', status: 'manual-required' },
            { id: 'discord-live-bridge', status: 'manual-required' },
          ],
        },
      },
      liveVerificationChecklist: [
        {
          id: 'telegram-live-bridge',
          status: 'manual-required',
          recordCommand: 'npm run v04:message:live:record -- telegram --observed-at "REPLACE_WITH_OBSERVED_AT" --operator "REPLACE_WITH_OPERATOR" --pairing-approved --owner-text-reply-returned --busy-message-queued-or-retried --reconnect-replay-checked --note "Owner DM paired and replied."',
          dryRunCommand: 'npm run v04:message:live:record -- telegram --dry-run --observed-at "REPLACE_WITH_OBSERVED_AT" --operator "REPLACE_WITH_OPERATOR" --pairing-approved --owner-text-reply-returned --busy-message-queued-or-retried --reconnect-replay-checked --note "Owner DM paired and replied."',
          preflightCommand: 'npm run v04:message:live:record -- telegram --preflight --observed-at "REPLACE_WITH_OBSERVED_AT" --operator "REPLACE_WITH_OPERATOR" --pairing-approved --owner-text-reply-returned --busy-message-queued-or-retried --reconnect-replay-checked --note "Owner DM paired and replied."',
        },
        {
          id: 'discord-live-bridge',
          status: 'manual-required',
          recordCommand: 'npm run v04:message:live:record -- discord --observed-at "REPLACE_WITH_OBSERVED_AT" --operator "REPLACE_WITH_OPERATOR" --message-content-intent-enabled --approved-channel-reply-returned --bot-echo-suppressed --reconnect-status-visible --note "Allowed target replied once."',
          dryRunCommand: 'npm run v04:message:live:record -- discord --dry-run --observed-at "REPLACE_WITH_OBSERVED_AT" --operator "REPLACE_WITH_OPERATOR" --message-content-intent-enabled --approved-channel-reply-returned --bot-echo-suppressed --reconnect-status-visible --note "Allowed target replied once."',
          preflightCommand: 'npm run v04:message:live:record -- discord --preflight --observed-at "REPLACE_WITH_OBSERVED_AT" --operator "REPLACE_WITH_OPERATOR" --message-content-intent-enabled --approved-channel-reply-returned --bot-echo-suppressed --reconnect-status-visible --note "Allowed target replied once."',
        },
      ],
    }), 'utf8')
    await writeFile(preflightFile, JSON.stringify({
      ok: true,
      overallStatus: 'ready-for-live-observation',
      blockingCheckIds: [],
      checks: [
        { id: 'telegram-live-bridge', status: 'manual-required', blocking: false },
        { id: 'discord-live-bridge', status: 'manual-required', blocking: false },
      ],
    }), 'utf8')
    await writeFile(macosProbeFile, JSON.stringify({
      ok: false,
      status: 'no-fresh-notification',
      releaseEvidenceCandidate: false,
      diagnostics: { machineChecked: true },
    }), 'utf8')
    await writeFile(bridgeTraceFile, JSON.stringify({
      gate: 'nexus-v04-message-bridge-trace',
      ok: true,
      telegram: {
        state: 'connected',
        lastEventAt: '2026-06-17T20:00:00Z',
        updateOffset: 501,
        lastOutboundAt: '2026-06-17T20:01:00Z',
        lastOutboundKind: 'text',
        lastOutboundTargetPresent: true,
        lastOutboundErrorPresent: true,
        hasTraceEvidence: true,
      },
      discord: {
        state: 'connected',
        lastEventAt: '2026-06-17T21:00:00Z',
        lastReconnectAt: '2026-06-17T21:02:00Z',
        lastReconnectReason: 'gateway_reconnect_requested',
        lastOutboundAt: '2026-06-17T21:03:00Z',
        lastOutboundKind: 'audio',
        lastOutboundTargetPresent: true,
        lastOutboundErrorPresent: true,
        hasTraceEvidence: true,
      },
    }), 'utf8')

    const report = await buildV04MessageLiveSessionReport({
      messageStatusFile: statusFile,
      preflightFile,
      macosLiveProbeFile: macosProbeFile,
      bridgeTraceFile,
    })
    const telegramStep = report.steps.find((step) => step.id === 'record-telegram-live-bridge')
    const discordStep = report.steps.find((step) => step.id === 'record-discord-live-bridge')
    const json = JSON.stringify(report)

    assert.equal(report.readyToRecordPendingChecks, true)
    assert.equal(report.safeToRunPendingRecordCommands, false)
    assert.equal(report.recordSafetySummary.pendingRecordCount, 2)
    assert.equal(report.recordSafetySummary.needsOperatorValuesCount, 2)
    assert.deepEqual(report.recordSafetySummary.unsafeRecordStepIds, [
      'record-telegram-live-bridge',
      'record-discord-live-bridge',
    ])
    assert.equal(report.sourceReports.bridgeTrace.telegram.lastOutboundTargetPresent, true)
    assert.equal(report.sourceReports.bridgeTrace.telegram.lastOutboundErrorPresent, true)
    assert.equal(report.sourceReports.bridgeTrace.discord.lastOutboundTargetPresent, true)
    assert.equal(report.sourceReports.bridgeTrace.discord.lastOutboundErrorPresent, true)
    assert.equal(telegramStep?.bridgeTraceApplied, true)
    assert.match(telegramStep?.recordCommand ?? '', /--observed-at "2026-06-17T20:00:00\.000Z"/)
    assert.match(telegramStep?.recordCommand ?? '', /--update-offset 501/)
    assert.match(telegramStep?.recordCommand ?? '', /--last-outbound-at "2026-06-17T20:01:00\.000Z"/)
    assert.match(telegramStep?.recordCommand ?? '', /--last-outbound-kind "text"/)
    assert.equal(telegramStep?.recordCommandSafety?.status, 'needs-operator-values')
    assert.deepEqual(telegramStep?.recordCommandSafety?.placeholderTokens, ['REPLACE_WITH_OPERATOR'])
    assert.equal(discordStep?.bridgeTraceApplied, true)
    assert.match(discordStep?.recordCommand ?? '', /--observed-at "2026-06-17T21:00:00\.000Z"/)
    assert.match(discordStep?.recordCommand ?? '', /--last-reconnect-at "2026-06-17T21:02:00\.000Z"/)
    assert.match(discordStep?.recordCommand ?? '', /--last-reconnect-reason "gateway_reconnect_requested"/)
    assert.match(discordStep?.recordCommand ?? '', /--last-outbound-at "2026-06-17T21:03:00\.000Z"/)
    assert.match(discordStep?.recordCommand ?? '', /--last-outbound-kind "audio"/)
    assert.equal(discordStep?.recordCommandSafety?.status, 'needs-operator-values')
    assert.deepEqual(discordStep?.recordCommandSafety?.placeholderTokens, ['REPLACE_WITH_OPERATOR'])
    assert.doesNotMatch(
      json,
      /telegram:private-chat-id|discord:private-channel-id|Telegram API 429|Discord API 403/,
    )
  })
})

test('v0.4 message live session CLI writes a private-safe report file', async () => {
  await withTempDirectory(async (directoryPath) => {
    const statusFile = path.join(directoryPath, 'message-awareness-status.json')
    const preflightFile = path.join(directoryPath, 'message-awareness-live-preflight.json')
    const macosProbeFile = path.join(directoryPath, 'message-awareness-macos-live-probe.json')
    const outputFile = path.join(directoryPath, 'message-awareness-live-session.json')
    const markdownOutputFile = path.join(directoryPath, 'message-awareness-live-session.md')

    await writeFile(statusFile, JSON.stringify({
      releaseGateComplete: true,
      liveEvidence: { audit: { pendingCheckIds: [], failedCheckIds: [], checks: [] } },
      liveVerificationChecklist: [],
    }), 'utf8')
    await writeFile(preflightFile, JSON.stringify({
      ok: true,
      overallStatus: 'ready-for-live-observation',
      blockingCheckIds: [],
      checks: [],
    }), 'utf8')
    await writeFile(macosProbeFile, JSON.stringify({
      ok: true,
      status: 'observed-once',
      releaseEvidenceCandidate: true,
      diagnostics: { machineChecked: true, observedFreshCount: 1, replayFreshCount: 0 },
    }), 'utf8')

    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/v04-message-live-session.mjs',
      '--message-status-file',
      statusFile,
      '--preflight-file',
      preflightFile,
      '--macos-live-probe-file',
      macosProbeFile,
      '--output',
      outputFile,
      '--markdown-output',
      markdownOutputFile,
    ], { cwd: process.cwd() })

    const stdoutReport = JSON.parse(stdout)
    const fileReport = JSON.parse(await readFile(outputFile, 'utf8'))
    const markdownReport = await readFile(markdownOutputFile, 'utf8')
    assert.equal(stdoutReport.ok, true)
    assert.equal(stdoutReport.overallStatus, 'release-gate-complete')
    assert.equal(fileReport.gate, 'nexus-v04-message-live-session')
    assert.equal(fileReport.safeToRunPendingRecordCommands, true)
    assert.equal(fileReport.recordSafetySummary.pendingRecordCount, 0)
    assert.equal(fileReport.stepExecutionSummary.manualRecordStepCount, 0)
    assert.equal(fileReport.sourceReports.macosLiveProbe.releaseEvidenceCandidate, true)
    assert.match(markdownReport, /Release gate complete: yes/)
    assert.match(markdownReport, /Nexus v0\.4 Message-Awareness Live Evidence Packet/)
  })
})

test('v0.4 message live session package wiring stays available', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'))
  const scriptText = await readFile('scripts/v04-message-live-session.mjs', 'utf8')
  const distributionAudit = await readFile('scripts/distribution-audit.mjs', 'utf8')
  const releasingDoc = await readFile('docs/RELEASING.md', 'utf8')

  assert.equal(
    packageJson.scripts?.['v04:message:live:session'],
    'node scripts/v04-message-live-session.mjs --output artifacts/v0.4.0/message-awareness-live-session.json --markdown-output artifacts/v0.4.0/message-awareness-live-session.md',
  )
  assert.equal(DEFAULT_V04_LIVE_SESSION_MARKDOWN_FILE, 'artifacts/v0.4.0/message-awareness-live-session.md')
  assert.equal(scriptText.includes('../src/'), false)
  assert.ok(packageJson.build?.files?.includes('scripts/v04-message-live-session.mjs'))
  assert.ok(packageJson.build?.asarUnpack?.includes('scripts/v04-message-live-session.mjs'))
  assert.match(distributionAudit, /v04:message:live:session/)
  assert.match(releasingDoc, /npm run v04:message:live:session/)
  assert.match(releasingDoc, /message-awareness-live-session\.md/)
})
