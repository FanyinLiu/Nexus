import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { test } from 'node:test'

import {
  buildMessageWebhookPayload,
  getDefaultTokenFileCandidates,
  normalizeWebhookToken,
  parseMessageWebhookArgs,
  postMessageWebhookPayload,
  readWebhookToken,
} from '../scripts/send-message-webhook.mjs'
import {
  getElectronSmokeInstallIssue,
  parseMessageAwarenessLocalSmokeArgs,
} from '../scripts/message-awareness-local-smoke.mjs'
import {
  buildMessageAwarenessLiveRecordDryRun,
  buildMessageAwarenessLiveRecordPreflightWarnings,
  buildMessageAwarenessLiveRecordValidationArgs,
  parseMessageAwarenessLiveRecordArgs,
} from '../scripts/record-message-awareness-live-evidence.mjs'
import {
  buildMessageAwarenessReleaseStatusReport,
  parseMessageAwarenessReleaseStatusArgs,
} from '../scripts/message-awareness-release-status.mjs'
import {
  buildMessageAwarenessLivePreflightReport,
  parseMessageAwarenessLivePreflightArgs,
} from '../scripts/message-awareness-live-preflight.mjs'
import {
  finalizeV04MessageRelease,
  parseV04MessageReleaseFinalizeArgs,
} from '../scripts/v04-message-release-finalize.mjs'
import {
  buildMessageAwarenessEvidence,
  buildMessageAwarenessGateEvidenceAudit,
  buildMessageAwarenessLiveEvidenceAudit,
  buildMessageAwarenessLiveEvidenceTemplate,
  mergeMessageAwarenessEvidence,
  normalizeLiveEvidenceChecks,
  parseMessageAwarenessValidationArgs,
  redactMessageAwarenessEvidence,
} from '../scripts/validate-message-awareness.mjs'
import {
  extractStringsFromBlobHex,
  filterNewNotificationMessages,
  parseMacNotificationWatchArgs,
} from '../scripts/communication-adapters/macos-notification-center-watch.mjs'

const execFileAsync = promisify(execFile)

async function withTempDirectory<T>(body: (directoryPath: string) => Promise<T>) {
  const directoryPath = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-message-webhook-cli-'))
  try {
    return await body(directoryPath)
  } finally {
    await fs.rm(directoryPath, { recursive: true, force: true })
  }
}

function buildCompleteLiveEvidenceChecks() {
  return normalizeLiveEvidenceChecks([
    {
      id: 'macos-notification-center-live',
      status: 'pass',
      observedAt: '2026-06-16T15:00:00Z',
      operator: 'Klein',
      notes: 'Real WeChat notification appeared once and did not replay.',
      evidence: {
        appName: 'WeChat',
        fullDiskAccessGranted: true,
        notificationObservedOnce: true,
        replayCheckedAfterRestart: true,
      },
    },
    {
      id: 'telegram-live-bridge',
      status: 'pass',
      observedAt: '2026-06-16T16:00:00Z',
      operator: 'Klein',
      notes: 'Owner Telegram DM paired, replied, queued while busy, and did not replay.',
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
      observedAt: '2026-06-16T17:00:00Z',
      operator: 'Klein',
      notes: 'Allowed Discord target replied, suppressed echoes, and showed reconnect status.',
      evidence: {
        messageContentIntentEnabled: true,
        approvedChannelReplyReturned: true,
        botEchoSuppressed: true,
        reconnectStatusVisible: true,
      },
    },
  ])
}

test('message webhook cli parses common automation arguments', () => {
  const options = parseMessageWebhookArgs([
    '--app',
    '微信',
    '--from=张三',
    '--chat-title',
    '项目群',
    '--conversation-id',
    'room-1',
    '--message-id',
    'msg-1',
    '--text',
    '晚上同步一下',
  ])

  assert.equal(options.source, '微信')
  assert.equal(options.sender, '张三')
  assert.equal(options.chatTitle, '项目群')
  assert.equal(options.conversationId, 'room-1')
  assert.equal(options.messageId, 'msg-1')
  assert.equal(options.text, '晚上同步一下')
})

test('message webhook cli builds a normalized message payload', () => {
  const payload = buildMessageWebhookPayload(
    {
      source: ' 企业微信 ',
      sender: ' 李四 ',
      chatTitle: ' 发布群 ',
      conversationId: ' room-2 ',
      messageId: '',
      text: '  看一下\n发布清单 ',
    },
    { now: new Date('2026-06-05T12:00:00Z') },
  )

  assert.deepEqual(payload, {
    kind: 'message',
    source: '企业微信',
    sender: '李四',
    chatTitle: '发布群',
    conversationId: 'room-2',
    messageId: '企业微信:1780660800000',
    text: '看一下 发布清单',
  })
})

test('message webhook cli reads bearer tokens from an explicit token file', async () => {
  await withTempDirectory(async (directoryPath) => {
    const tokenPath = path.join(directoryPath, 'token.txt')
    await fs.writeFile(tokenPath, 'Bearer nexus_test_token\n')

    assert.equal(normalizeWebhookToken('Bearer nexus_inline'), 'nexus_inline')
    assert.equal(await readWebhookToken({ tokenFile: tokenPath }), 'nexus_test_token')
  })
})

test('message webhook cli resolves default token candidates for each platform', () => {
  const macCandidates = getDefaultTokenFileCandidates({
    platform: 'darwin',
    home: '/Users/test',
    env: {},
  })
  const winCandidates = getDefaultTokenFileCandidates({
    platform: 'win32',
    home: 'C:\\Users\\test',
    env: { APPDATA: 'C:\\Users\\test\\AppData\\Roaming' },
  })

  assert.ok(macCandidates.some((candidate) => candidate.includes(path.join(
    'Library',
    'Application Support',
    'Nexus',
    'notification-webhook-token.txt',
  ))))
  assert.ok(winCandidates.some((candidate) => candidate.includes('Nexus')))
})

test('message webhook cli post helper sends bearer auth and JSON payload', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const result = await postMessageWebhookPayload(
    { kind: 'message', source: 'QQ', text: 'hi' },
    {
      url: 'http://127.0.0.1:47830/webhook',
      token: 'Bearer nexus_token',
      fetchImpl: async (url: string, init: RequestInit) => {
        calls.push({ url, init })
        return new Response(JSON.stringify({ ok: true, id: 'abc' }), { status: 200 })
      },
    },
  )

  assert.deepEqual(result, { ok: true, id: 'abc' })
  assert.equal(calls[0]?.url, 'http://127.0.0.1:47830/webhook')
  assert.equal(calls[0]?.init.headers?.['Authorization' as keyof HeadersInit], 'Bearer nexus_token')
  assert.equal(JSON.parse(String(calls[0]?.init.body)).source, 'QQ')
})

test('message webhook cli post helper explains unreachable local webhook', async () => {
  await assert.rejects(
    postMessageWebhookPayload(
      { kind: 'message', source: 'QQ', text: 'hi' },
      {
        url: 'http://127.0.0.1:47830/webhook',
        token: 'nexus_token',
        fetchImpl: async () => {
          throw Object.assign(new Error('fetch failed'), {
            cause: { code: 'ECONNREFUSED' },
          })
        },
      },
    ),
    /Webhook request could not reach Nexus at http:\/\/127\.0\.0\.1:47830\/webhook: ECONNREFUSED/,
  )
})

test('message webhook cli --dry-run emits a machine-readable payload', async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    'scripts/send-message-webhook.mjs',
    '--source',
    '微信',
    '--sender',
    '张三',
    '--chat-title',
    '项目群',
    '--message-id',
    'msg-2',
    '--text',
    '晚上同步一下',
    '--dry-run',
  ], { cwd: process.cwd() })

  const payload = JSON.parse(stdout)
  assert.equal(payload.kind, 'message')
  assert.equal(payload.source, '微信')
  assert.equal(payload.sender, '张三')
  assert.equal(payload.chatTitle, '项目群')
  assert.equal(payload.messageId, 'msg-2')
  assert.equal(payload.text, '晚上同步一下')
})

test('message awareness validation dry-run emits a stable validation payload', async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    'scripts/validate-message-awareness.mjs',
    '--dry-run',
  ], { cwd: process.cwd() })

  const result = JSON.parse(stdout)
  assert.equal(result.payload.kind, 'message')
  assert.equal(result.payload.source, 'Nexus Validation')
  assert.equal(result.payload.sender, 'Validation Probe')
  assert.equal(result.payload.chatTitle, 'Stabilization Gate')
  assert.equal(result.payload.conversationId, 'nexus-validation')
  assert.match(result.payload.messageId, /^nexus-validation-\d{14}$/)
  assert.match(result.payload.text, /^Nexus message-awareness validation \d{14}$/)
  assert.ok(result.nextChecks.some((item: string) => item.includes('Notification Center')))
  assert.equal(result.evidence.gate, 'v0.3.4-message-awareness')
  assert.equal(result.evidence.releaseGateComplete, false)
  assert.equal(result.evidence.checks[0]?.status, 'not-run')
  assert.equal(result.evidence.checks[1]?.status, 'manual-required')
})

test('message awareness validation dry-run labels v0.4 evidence paths', async () => {
  await withTempDirectory(async (directoryPath) => {
    const evidencePath = path.join(directoryPath, 'artifacts', 'v0.4.0', 'message-awareness-local.json')

    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/validate-message-awareness.mjs',
      '--dry-run',
      '--evidence-file',
      evidencePath,
    ], { cwd: process.cwd() })

    const result = JSON.parse(stdout)
    const fileResult = JSON.parse(await fs.readFile(evidencePath, 'utf8'))
    assert.equal(result.evidence.gate, 'v0.4-message-awareness')
    assert.equal(fileResult.gate, 'v0.4-message-awareness')
  })
})

test('message awareness validation parses evidence file without swallowing webhook args', () => {
  const parsed = parseMessageAwarenessValidationArgs([
    '--evidence-file',
    'artifacts/message-awareness.json',
    '--merge-evidence-file',
    'artifacts/message-awareness-local.json',
    '--check-evidence-file',
    'artifacts/message-awareness-complete.json',
    '--redact-evidence-file',
    'artifacts/message-awareness-complete-private.json',
    '--redacted-output-file',
    'docs/release-evidence/v0.3.4-message-awareness.json',
    '--require-release-complete',
    '--live-evidence-file',
    'artifacts/live-evidence.json',
    '--write-live-template',
    'artifacts/live-template.json',
    '--force-live-template',
    '--check-live-evidence',
    'artifacts/live-check.json',
    '--require-live-complete',
    '--source',
    'Telegram',
    '--sender',
    'Alice',
    '--text',
    'live probe',
  ])

  assert.equal(parsed.validation.evidenceFile, 'artifacts/message-awareness.json')
  assert.equal(parsed.validation.mergeEvidenceFile, 'artifacts/message-awareness-local.json')
  assert.equal(parsed.validation.evidenceCheckFile, 'artifacts/message-awareness-complete.json')
  assert.equal(parsed.validation.redactEvidenceFile, 'artifacts/message-awareness-complete-private.json')
  assert.equal(parsed.validation.redactedOutputFile, 'docs/release-evidence/v0.3.4-message-awareness.json')
  assert.equal(parsed.validation.requireReleaseComplete, true)
  assert.equal(parsed.validation.liveEvidenceFile, 'artifacts/live-evidence.json')
  assert.equal(parsed.validation.liveTemplateFile, 'artifacts/live-template.json')
  assert.equal(parsed.validation.liveCheckFile, 'artifacts/live-check.json')
  assert.equal(parsed.validation.forceLiveTemplate, true)
  assert.equal(parsed.validation.requireLiveComplete, true)
  assert.equal(parsed.webhook.source, 'Telegram')
  assert.equal(parsed.webhook.sender, 'Alice')
  assert.equal(parsed.webhook.text, 'live probe')
})

test('message awareness local smoke parses defaults and validation passthrough', () => {
  const parsed = parseMessageAwarenessLocalSmokeArgs([
    '--evidence-file',
    'artifacts/local.json',
    '--timeout-ms=5000',
    '--',
    '--source',
    'Telegram',
    '--text',
    'probe',
  ])

  assert.equal(parsed.evidenceFile, 'artifacts/local.json')
  assert.equal(parsed.timeoutMs, 5000)
  assert.deepEqual(parsed.validateArgs, ['--source', 'Telegram', '--text', 'probe'])
})

test('message awareness local smoke preflight explains incomplete Electron installs', async () => {
  await withTempDirectory(async (directoryPath) => {
    const binDir = path.join(directoryPath, 'node_modules', '.bin')
    const electronDir = path.join(directoryPath, 'node_modules', 'electron')
    await fs.mkdir(binDir, { recursive: true })
    await fs.mkdir(electronDir, { recursive: true })
    await fs.writeFile(path.join(binDir, process.platform === 'win32' ? 'electron.cmd' : 'electron'), '', 'utf8')

    assert.match(
      getElectronSmokeInstallIssue(directoryPath) ?? '',
      /path\.txt is missing/,
    )

    await fs.writeFile(path.join(electronDir, 'path.txt'), 'dist/MissingElectron', 'utf8')
    assert.match(
      getElectronSmokeInstallIssue(directoryPath) ?? '',
      /Electron runtime is missing/,
    )
  })
})

test('message awareness live recorder maps Telegram proof flags to the strict validator command', () => {
  const parsed = parseMessageAwarenessLiveRecordArgs([
    'telegram',
    '--live-evidence-file',
    'artifacts/live.json',
    '--observed-at',
    '2026-06-16T16:00:00Z',
    '--operator',
    'Klein',
    '--pairing-approved',
    '--owner-text-reply-returned',
    '--busy-message-queued-or-retried',
    '--reconnect-replay-checked',
    '--update-offset',
    '401',
    '--last-outbound-at',
    '2026-06-16T16:01:00Z',
    '--last-outbound-kind',
    'text',
    '--last-outbound-target',
    '42',
    '--note',
    'Owner DM paired and replied.',
  ])

  assert.equal(parsed.command, 'telegram')
  assert.deepEqual(buildMessageAwarenessLiveRecordValidationArgs(parsed), [
    'scripts/validate-message-awareness.mjs',
    '--live-evidence-file',
    'artifacts/live.json',
    '--record-live-check',
    'telegram-live-bridge',
    '--live-status',
    'pass',
    '--observed-at',
    '2026-06-16T16:00:00Z',
    '--operator',
    'Klein',
    '--note',
    'Owner DM paired and replied.',
    '--pairing-approved',
    '--owner-text-reply-returned',
    '--busy-message-queued-or-retried',
    '--reconnect-replay-checked',
    '--evidence',
    'updateOffset=401',
    '--evidence',
    'lastOutboundAt=2026-06-16T16:01:00Z',
    '--evidence',
    'lastOutboundKind=text',
    '--evidence',
    'lastOutboundTarget=42',
  ])
})

test('message awareness live recorder dry-run previews mapped validator args without recording', async () => {
  const parsed = parseMessageAwarenessLiveRecordArgs([
    'macos',
    '--live-evidence-file',
    'artifacts/v0.4.0/message-awareness-live.json',
    '--macos-live-probe-file',
    'artifacts/v0.4.0/message-awareness-macos-live-probe.json',
    '--require-macos-live-probe-candidate',
    '--macos-live-probe-max-age-ms',
    '0',
    '--dry-run',
    '--observed-at',
    '2026-06-16T15:00:00Z',
    '--operator',
    'Klein',
    '--app-name',
    'WeChat',
    '--full-disk-access-granted',
    '--notification-observed-once',
    '--replay-checked-after-restart',
    '--note',
    'One real WeChat notification appeared once in Nexus.',
  ])

  assert.equal(parsed.dryRun, true)
  assert.equal(parsed.macosLiveProbeFile, 'artifacts/v0.4.0/message-awareness-macos-live-probe.json')
  assert.equal(parsed.requireMacosLiveProbeCandidate, true)
  assert.equal(parsed.macosLiveProbeMaxAgeMs, 0)
  const dryRun = buildMessageAwarenessLiveRecordDryRun(parsed, {
    path: 'artifacts/v0.4.0/message-awareness-macos-live-probe.json',
    exists: true,
    error: null,
    gate: 'message-awareness-macos-live-probe',
    generatedAt: new Date().toISOString(),
    status: 'observed-once',
    releaseEvidenceCandidate: true,
    diagnostics: {
      machineChecked: true,
      errorKind: null,
      testNotificationRequested: false,
      observedFreshCount: 1,
      replayFreshCount: 0,
    },
  })
  assert.equal(dryRun.dryRun, true)
  assert.equal(dryRun.target, 'macos')
  assert.equal(dryRun.checkId, 'macos-notification-center-live')
  assert.equal(dryRun.liveEvidenceFile, 'artifacts/v0.4.0/message-awareness-live.json')
  assert.equal(dryRun.requireMacosLiveProbeCandidate, true)
  assert.equal(dryRun.macosLiveProbe?.releaseEvidenceCandidate, true)
  assert.equal(dryRun.writesEvidence, false)
  assert.equal(dryRun.readyToRecord, true)
  assert.deepEqual(dryRun.preflightWarnings, [])
  assert.deepEqual(dryRun.validationArgs, [
    'scripts/validate-message-awareness.mjs',
    '--live-evidence-file',
    'artifacts/v0.4.0/message-awareness-live.json',
    '--record-live-check',
    'macos-notification-center-live',
    '--live-status',
    'pass',
    '--observed-at',
    '2026-06-16T15:00:00Z',
    '--operator',
    'Klein',
    '--note',
    'One real WeChat notification appeared once in Nexus.',
    '--app-name',
    'WeChat',
    '--full-disk-access-granted',
    '--notification-observed-once',
    '--replay-checked-after-restart',
  ])

  await withTempDirectory(async (directoryPath) => {
    const liveEvidencePath = path.join(directoryPath, 'message-awareness-live.json')
    const macosProbePath = path.join(directoryPath, 'message-awareness-macos-live-probe.json')
    await fs.writeFile(macosProbePath, JSON.stringify({
      gate: 'message-awareness-macos-live-probe',
      generatedAt: new Date().toISOString(),
      status: 'observed-once',
      releaseEvidenceCandidate: true,
      diagnostics: {
        machineChecked: true,
        testNotificationRequested: false,
        observedFreshCount: 1,
        replayFreshCount: 0,
      },
    }), 'utf8')
    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/record-message-awareness-live-evidence.mjs',
      'macos',
      '--live-evidence-file',
      liveEvidencePath,
      '--macos-live-probe-file',
      macosProbePath,
      '--require-macos-live-probe-candidate',
      '--macos-live-probe-max-age-ms',
      '0',
      '--dry-run',
      '--observed-at',
      '2026-06-16T15:00:00Z',
      '--operator',
      'Klein',
      '--app-name',
      'WeChat',
      '--full-disk-access-granted',
      '--notification-observed-once',
      '--replay-checked-after-restart',
      '--note',
      'One real WeChat notification appeared once in Nexus.',
    ], { cwd: process.cwd() })

    const cliDryRun = JSON.parse(stdout)
    assert.equal(cliDryRun.dryRun, true)
    assert.equal(cliDryRun.preflight, false)
    assert.equal(cliDryRun.writesEvidence, false)
    assert.equal(cliDryRun.readyToRecord, true)
    assert.equal(cliDryRun.requireMacosLiveProbeCandidate, true)
    assert.equal(cliDryRun.macosLiveProbe.releaseEvidenceCandidate, true)
    assert.deepEqual(cliDryRun.preflightWarnings, [])
    assert.equal(cliDryRun.liveEvidenceFile, liveEvidencePath)
    assert.deepEqual(cliDryRun.validationArgs.slice(0, 5), [
      'scripts/validate-message-awareness.mjs',
      '--live-evidence-file',
      liveEvidencePath,
      '--record-live-check',
      'macos-notification-center-live',
    ])
    await assert.rejects(fs.access(liveEvidencePath), /ENOENT/)
  })
})

test('message awareness live recorder preflight is scriptable and never records evidence', async () => {
  await withTempDirectory(async (directoryPath) => {
    const liveEvidencePath = path.join(directoryPath, 'message-awareness-live.json')
    const ready = await execFileAsync(process.execPath, [
      'scripts/record-message-awareness-live-evidence.mjs',
      'telegram',
      '--live-evidence-file',
      liveEvidencePath,
      '--preflight',
      '--observed-at',
      '2026-06-16T16:00:00Z',
      '--operator',
      'Klein',
      '--pairing-approved',
      '--owner-text-reply-returned',
      '--busy-message-queued-or-retried',
      '--reconnect-replay-checked',
      '--note',
      'Owner DM paired, replied, queued while busy, and did not replay after reconnect.',
    ], { cwd: process.cwd() })
    const readyReport = JSON.parse(ready.stdout)
    assert.equal(readyReport.preflight, true)
    assert.equal(readyReport.readyToRecord, true)
    assert.deepEqual(readyReport.preflightWarnings, [])
    await assert.rejects(fs.access(liveEvidencePath), /ENOENT/)

    await assert.rejects(
      execFileAsync(process.execPath, [
        'scripts/record-message-awareness-live-evidence.mjs',
        'telegram',
        '--live-evidence-file',
        liveEvidencePath,
        '--preflight',
        '--observed-at',
        'REPLACE_WITH_OBSERVED_AT',
        '--operator',
        'REPLACE_WITH_OPERATOR',
        '--pairing-approved',
        '--owner-text-reply-returned',
        '--busy-message-queued-or-retried',
        '--reconnect-replay-checked',
        '--note',
        'Owner DM paired, replied, queued while busy, and did not replay after reconnect.',
      ], { cwd: process.cwd() }),
      (error: unknown) => {
        const err = error as { code?: number; stdout?: string }
        const report = JSON.parse(err.stdout ?? '{}')
        assert.equal(err.code, 2)
        assert.equal(report.preflight, true)
        assert.equal(report.readyToRecord, false)
        assert.deepEqual(
          report.preflightWarnings.map((entry: { field: string }) => entry.field).sort(),
          ['observedAt', 'operator'],
        )
        return true
      },
    )
    await assert.rejects(fs.access(liveEvidencePath), /ENOENT/)
  })
})

test('message awareness live recorder can require macOS probe candidate before recording', async () => {
  await withTempDirectory(async (directoryPath) => {
    const liveEvidencePath = path.join(directoryPath, 'message-awareness-live.json')
    const macosProbePath = path.join(directoryPath, 'message-awareness-macos-live-probe.json')

    await assert.rejects(
      execFileAsync(process.execPath, [
        'scripts/record-message-awareness-live-evidence.mjs',
        'macos',
        '--live-evidence-file',
        liveEvidencePath,
        '--macos-live-probe-file',
        macosProbePath,
        '--require-macos-live-probe-candidate',
        '--preflight',
        '--observed-at',
        '2026-06-16T15:00:00Z',
        '--operator',
        'Klein',
        '--app-name',
        'WeChat',
        '--full-disk-access-granted',
        '--notification-observed-once',
        '--replay-checked-after-restart',
        '--note',
        'One real WeChat notification appeared once in Nexus.',
      ], { cwd: process.cwd() }),
      (error: unknown) => {
        const err = error as { code?: number; stdout?: string }
        const report = JSON.parse(err.stdout ?? '{}')
        assert.equal(err.code, 2)
        assert.equal(report.readyToRecord, false)
        assert.equal(report.macosLiveProbe.exists, false)
        assert.deepEqual(report.preflightWarnings.map((entry: { field: string }) => entry.field), [
          'macosLiveProbe',
        ])
        return true
      },
    )
    await assert.rejects(fs.access(liveEvidencePath), /ENOENT/)

    await fs.writeFile(macosProbePath, JSON.stringify({
      gate: 'message-awareness-macos-live-probe',
      generatedAt: new Date().toISOString(),
      status: 'observed-once',
      releaseEvidenceCandidate: true,
      diagnostics: {
        machineChecked: true,
        testNotificationRequested: false,
        observedFreshCount: 1,
        replayFreshCount: 0,
      },
    }), 'utf8')

    const ready = await execFileAsync(process.execPath, [
      'scripts/record-message-awareness-live-evidence.mjs',
      'macos',
      '--live-evidence-file',
      liveEvidencePath,
      '--macos-live-probe-file',
      macosProbePath,
      '--require-macos-live-probe-candidate',
      '--macos-live-probe-max-age-ms',
      '0',
      '--preflight',
      '--observed-at',
      '2026-06-16T15:00:00Z',
      '--operator',
      'Klein',
      '--app-name',
      'WeChat',
      '--full-disk-access-granted',
      '--notification-observed-once',
      '--replay-checked-after-restart',
      '--note',
      'One real WeChat notification appeared once in Nexus.',
    ], { cwd: process.cwd() })
    const readyReport = JSON.parse(ready.stdout)
    assert.equal(readyReport.readyToRecord, true)
    assert.equal(readyReport.macosLiveProbe.releaseEvidenceCandidate, true)
    assert.deepEqual(readyReport.preflightWarnings, [])
    await assert.rejects(fs.access(liveEvidencePath), /ENOENT/)
  })
})

test('message awareness live recorder refuses macOS writes when required probe is not release ready', async () => {
  await withTempDirectory(async (directoryPath) => {
    const liveEvidencePath = path.join(directoryPath, 'message-awareness-live.json')
    const macosProbePath = path.join(directoryPath, 'message-awareness-macos-live-probe.json')
    await fs.writeFile(macosProbePath, JSON.stringify({
      gate: 'message-awareness-macos-live-probe',
      generatedAt: new Date().toISOString(),
      status: 'no-fresh-notification',
      releaseEvidenceCandidate: false,
      diagnostics: {
        machineChecked: true,
        testNotificationRequested: false,
        observedFreshCount: 0,
        replayFreshCount: 0,
        privateNotificationBody: 'private notification body',
      },
    }), 'utf8')

    await assert.rejects(
      execFileAsync(process.execPath, [
        'scripts/record-message-awareness-live-evidence.mjs',
        'macos',
        '--live-evidence-file',
        liveEvidencePath,
        '--macos-live-probe-file',
        macosProbePath,
        '--require-macos-live-probe-candidate',
        '--observed-at',
        '2026-06-16T15:00:00Z',
        '--operator',
        'Klein',
        '--app-name',
        'WeChat',
        '--full-disk-access-granted',
        '--notification-observed-once',
        '--replay-checked-after-restart',
        '--note',
        'One real WeChat notification appeared once in Nexus.',
      ], { cwd: process.cwd() }),
      (error: unknown) => {
        const err = error as { code?: number; stderr?: string }
        assert.equal(err.code, 2)
        assert.match(err.stderr ?? '', /Live evidence record preflight failed/)
        assert.match(err.stderr ?? '', /not a release evidence candidate/)
        assert.doesNotMatch(err.stderr ?? '', /private notification body/)
        return true
      },
    )
    await assert.rejects(fs.access(liveEvidencePath), /ENOENT/)
  })
})

test('message awareness live recorder refuses stale macOS probe candidates', async () => {
  await withTempDirectory(async (directoryPath) => {
    const liveEvidencePath = path.join(directoryPath, 'message-awareness-live.json')
    const macosProbePath = path.join(directoryPath, 'message-awareness-macos-live-probe.json')
    await fs.writeFile(macosProbePath, JSON.stringify({
      gate: 'message-awareness-macos-live-probe',
      generatedAt: '2000-01-01T00:00:00.000Z',
      status: 'observed-once',
      releaseEvidenceCandidate: true,
      diagnostics: {
        machineChecked: true,
        testNotificationRequested: false,
        observedFreshCount: 1,
        replayFreshCount: 0,
        privateNotificationBody: 'private notification body',
      },
    }), 'utf8')

    await assert.rejects(
      execFileAsync(process.execPath, [
        'scripts/record-message-awareness-live-evidence.mjs',
        'macos',
        '--live-evidence-file',
        liveEvidencePath,
        '--macos-live-probe-file',
        macosProbePath,
        '--require-macos-live-probe-candidate',
        '--macos-live-probe-max-age-ms',
        '1000',
        '--observed-at',
        '2026-06-16T15:00:00Z',
        '--operator',
        'Klein',
        '--app-name',
        'WeChat',
        '--full-disk-access-granted',
        '--notification-observed-once',
        '--replay-checked-after-restart',
        '--note',
        'One real WeChat notification appeared once in Nexus.',
      ], { cwd: process.cwd() }),
      (error: unknown) => {
        const err = error as { code?: number; stderr?: string }
        assert.equal(err.code, 2)
        assert.match(err.stderr ?? '', /candidate is stale/)
        assert.match(err.stderr ?? '', /maxAgeMs=1000/)
        assert.doesNotMatch(err.stderr ?? '', /private notification body/)
        return true
      },
    )
    await assert.rejects(fs.access(liveEvidencePath), /ENOENT/)
  })
})

test('message awareness live recorder dry-run warns before copied placeholders can be recorded', async () => {
  const parsed = parseMessageAwarenessLiveRecordArgs([
    'macos',
    '--dry-run',
    '--observed-at',
    'REPLACE_WITH_OBSERVED_AT',
    '--operator',
    'REPLACE_WITH_OPERATOR',
    '--app-name',
    'REPLACE_WITH_REAL_APP',
    '--full-disk-access-granted',
    '--notification-observed-once',
    '--replay-checked-after-restart',
    '--note',
    'One real app notification appeared once in Nexus after Full Disk Access and did not replay after restart.',
  ])

  const warnings = buildMessageAwarenessLiveRecordPreflightWarnings(parsed)
  assert.equal(warnings.some((entry) => entry.field === 'operator'), true)
  assert.equal(warnings.some((entry) => entry.field === 'appName'), true)
  assert.equal(warnings.some((entry) => entry.field === 'observedAt'), true)
  assert.match(
    warnings.find((entry) => entry.field === 'observedAt')?.message ?? '',
    /placeholder/,
  )

  await withTempDirectory(async (directoryPath) => {
    const liveEvidencePath = path.join(directoryPath, 'message-awareness-live.json')
    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/record-message-awareness-live-evidence.mjs',
      'macos',
      '--live-evidence-file',
      liveEvidencePath,
      '--dry-run',
      '--observed-at',
      'REPLACE_WITH_OBSERVED_AT',
      '--operator',
      'REPLACE_WITH_OPERATOR',
      '--app-name',
      'REPLACE_WITH_REAL_APP',
      '--full-disk-access-granted',
      '--notification-observed-once',
      '--replay-checked-after-restart',
      '--note',
      'One real app notification appeared once in Nexus after Full Disk Access and did not replay after restart.',
    ], { cwd: process.cwd() })

    const cliDryRun = JSON.parse(stdout)
    assert.equal(cliDryRun.dryRun, true)
    assert.equal(cliDryRun.writesEvidence, false)
    assert.equal(cliDryRun.readyToRecord, false)
    assert.deepEqual(
      cliDryRun.preflightWarnings.map((entry: { field: string }) => entry.field).sort(),
      ['appName', 'observedAt', 'operator'],
    )
    await assert.rejects(fs.access(liveEvidencePath), /ENOENT/)
  })
})

test('message awareness live recorder help labels examples as non-runnable templates', async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    'scripts/record-message-awareness-live-evidence.mjs',
    '--help',
  ], { cwd: process.cwd() })

  assert.match(stdout, /Examples below are templates/)
  assert.match(stdout, /--dry-run\s+Print the mapped validator command without writing evidence/)
  assert.match(stdout, /--preflight\s+Like --dry-run, but exits non-zero unless readyToRecord=true/)
  assert.match(stdout, /replace YOUR_NAME/)
  assert.match(stdout, /Placeholder values are\s+rejected by the validator/)
  assert.match(stdout, /Examples \(templates; replace placeholders before running\):/)
})

test('message awareness release status parser accepts evidence file overrides', () => {
  const parsed = parseMessageAwarenessReleaseStatusArgs([
    '--local-evidence-file',
    'tmp/local.json',
    '--live-evidence-file=tmp/live.json',
    '--complete-evidence-file',
    'tmp/complete.json',
    '--macos-live-probe-file',
    'tmp/macos-probe.json',
    '--redacted-output-file',
    'tmp/redacted.json',
    '--output',
    'tmp/status.json',
  ])

  assert.equal(parsed.localEvidenceFile, 'tmp/local.json')
  assert.equal(parsed.liveEvidenceFile, 'tmp/live.json')
  assert.equal(parsed.completeEvidenceFile, 'tmp/complete.json')
  assert.equal(parsed.macosLiveProbeFile, 'tmp/macos-probe.json')
  assert.equal(parsed.redactedOutputFile, 'tmp/redacted.json')
  assert.equal(parsed.outputPath, 'tmp/status.json')
})

test('message awareness live preflight parser accepts privacy-safe output options', () => {
  const parsed = parseMessageAwarenessLivePreflightArgs([
    '--apps',
    'Telegram|Discord',
    '--db=/tmp/notifications.db',
    '--sqlite',
    '/usr/bin/sqlite3',
    '--limit',
    '7',
    '--output',
    'artifacts/preflight.json',
    '--require-ready',
  ])

  assert.equal(parsed.apps, 'Telegram|Discord')
  assert.equal(parsed.db, '/tmp/notifications.db')
  assert.equal(parsed.sqlite, '/usr/bin/sqlite3')
  assert.equal(parsed.limit, 7)
  assert.equal(parsed.outputPath, 'artifacts/preflight.json')
  assert.equal(parsed.requireReady, true)
})

test('message awareness live preflight reports macOS readiness without leaking notification content', async () => {
  const report = await buildMessageAwarenessLivePreflightReport({
    apps: 'Telegram',
    limit: 10,
    sqlite: '/usr/bin/sqlite3',
  }, {
    now: new Date('2026-06-17T21:00:00.000Z'),
    platform: 'darwin',
    resolveMacNotificationDb: async () => '/Users/Private/Library/Group Containers/group.com.apple.usernoted/db2/db',
    queryMacNotificationRows: async () => [
      {
        source: 'Telegram',
        title: 'Private Room',
        subtitle: 'Private Sender',
        body: 'private live message content',
        id: 'evt-private-1',
      },
    ],
  })
  const json = JSON.stringify(report)
  const macos = report.checks.find((entry) => entry.id === 'macos-notification-center-live')

  assert.equal(report.generatedAt, '2026-06-17T21:00:00.000Z')
  assert.equal(report.ok, true)
  assert.equal(report.overallStatus, 'ready-for-live-observation')
  assert.equal(macos?.status, 'ready-for-observation')
  assert.equal(macos?.blocking, false)
  assert.equal(macos?.diagnostics.dbResolved, true)
  assert.equal(macos?.diagnostics.matchingCandidateCount, 1)
  assert.equal(report.checks.find((entry) => entry.id === 'telegram-live-bridge')?.status, 'manual-required')
  assert.doesNotMatch(json, /Private Room|Private Sender|private live message content|evt-private-1|Users\/Private/)
})

test('message awareness live preflight reports macOS permission blockers privately', async () => {
  const report = await buildMessageAwarenessLivePreflightReport({}, {
    now: new Date('2026-06-17T21:10:00.000Z'),
    platform: 'darwin',
    resolveMacNotificationDb: async () => '/private/NotificationCenter/db',
    queryMacNotificationRows: async () => {
      throw new Error('authorization denied opening /private/NotificationCenter/db')
    },
  })
  const macos = report.checks.find((entry) => entry.id === 'macos-notification-center-live')

  assert.equal(report.ok, false)
  assert.equal(report.overallStatus, 'environment-blocked')
  assert.deepEqual(report.blockingCheckIds, ['macos-notification-center-live'])
  assert.equal(macos?.status, 'needs-permission')
  assert.equal(macos?.diagnostics.errorKind, 'needs-permission')
  assert.doesNotMatch(JSON.stringify(report), /\/private\/NotificationCenter\/db/)
})

test('message awareness live recorder rejects proof flags for the wrong target', () => {
  assert.throws(
    () => parseMessageAwarenessLiveRecordArgs([
      'telegram',
      '--app-name',
      'Telegram',
    ]),
    /--app-name is not valid for Telegram live bridge/,
  )
})

test('message awareness validation builds a strict live evidence template', () => {
  const template = buildMessageAwarenessLiveEvidenceTemplate()

  assert.deepEqual(
    template.checks.map((check) => check.id),
    ['macos-notification-center-live', 'telegram-live-bridge', 'discord-live-bridge'],
  )
  assert.equal(template.checks.every((check) => check.status === 'manual-required'), true)
  assert.equal(template.checks[0]?.evidence.fullDiskAccessGranted, false)
  assert.equal(template.checks[1]?.evidence.ownerTextReplyReturned, false)
  assert.equal(template.checks[2]?.evidence.botEchoSuppressed, false)
  assert.equal(normalizeLiveEvidenceChecks(template).length, 3)
})

test('message awareness validation audits pending live evidence proof fields', () => {
  const audit = buildMessageAwarenessLiveEvidenceAudit(buildMessageAwarenessLiveEvidenceTemplate())

  assert.equal(audit.gate, 'v0.3.4-message-awareness-live')
  assert.equal(Number.isFinite(Date.parse(audit.generatedAt)), true)
  assert.equal(audit.overallStatus, 'live-check-pending')
  assert.equal(audit.liveGateComplete, false)
  assert.equal(audit.passedCount, 0)
  assert.equal(audit.totalCount, 3)
  assert.deepEqual(audit.pendingCheckIds, [
    'macos-notification-center-live',
    'telegram-live-bridge',
    'discord-live-bridge',
  ])
  assert.deepEqual(
    audit.checks[0]?.missingProofFields.map((field) => field.field),
    ['observedAt', 'operator', 'notes', 'appName', 'fullDiskAccessGranted', 'notificationObservedOnce', 'replayCheckedAfterRestart'],
  )
})

test('message awareness validation normalizes live evidence checks', () => {
  const checks = normalizeLiveEvidenceChecks({
    checks: {
      'macos-notification-center-live': {
        status: 'pass',
        observedAt: '2026-06-16T15:00:00-07:00',
        operator: ' Klein ',
        notes: [' Full Disk Access granted ', ' one WeChat notification observed once '],
        evidence: {
          appName: 'WeChat',
          eventId: 'msg-1',
          fullDiskAccessGranted: true,
          notificationObservedOnce: true,
          replayCheckedAfterRestart: true,
        },
      },
      'telegram-live-bridge': {
        status: 'fail',
        notes: 'reply did not return to Telegram',
        evidence: {
          updateOffset: '401',
          lastOutboundAt: '2026-06-16T16:01:00Z',
          lastOutboundKind: ' text ',
          lastOutboundTarget: 42,
          lastOutboundError: ' Telegram API 429 ',
        },
      },
    },
  })

  assert.equal(checks.length, 2)
  assert.equal(checks[0]?.id, 'macos-notification-center-live')
  assert.equal(checks[0]?.status, 'pass')
  assert.equal(checks[0]?.evidence.observedAt, '2026-06-16T22:00:00.000Z')
  assert.equal(checks[0]?.evidence.operator, 'Klein')
  assert.deepEqual(checks[0]?.evidence.notes, [
    'Full Disk Access granted',
    'one WeChat notification observed once',
  ])
  assert.equal(checks[1]?.status, 'fail')
  assert.equal(checks[1]?.evidence.updateOffset, 401)
  assert.equal(checks[1]?.evidence.lastOutboundAt, '2026-06-16T16:01:00.000Z')
  assert.equal(checks[1]?.evidence.lastOutboundKind, 'text')
  assert.equal(checks[1]?.evidence.lastOutboundTarget, '42')
  assert.equal(checks[1]?.evidence.lastOutboundError, 'Telegram API 429')
})

test('message awareness validation rejects unsupported live evidence ids', () => {
  assert.throws(
    () => normalizeLiveEvidenceChecks({
      checks: [{
        id: 'wechat-private-db-live',
        status: 'pass',
      }],
    }),
    /Unsupported live evidence check id/,
  )
})

test('message awareness validation rejects non-object live evidence entries', () => {
  assert.throws(
    () => normalizeLiveEvidenceChecks({
      checks: {
        'telegram-live-bridge': 'pass',
      },
    }),
    /must be an object/,
  )
})

test('message awareness validation rejects passing live evidence without required proof fields', () => {
  assert.throws(
    () => normalizeLiveEvidenceChecks({
      checks: [{
        id: 'telegram-live-bridge',
        status: 'pass',
        evidence: {
          pairingApproved: true,
        },
      }],
    }),
    /cannot pass without/,
  )
})

test('message awareness validation rejects passing live evidence with only template notes', () => {
  assert.throws(
    () => normalizeLiveEvidenceChecks({
      checks: [{
        id: 'telegram-live-bridge',
        status: 'pass',
        observedAt: '2026-06-16T16:00:00Z',
        operator: 'Klein',
        notes: [
          'Replace manual-required with pass only after a real owner DM, reply return, busy queue/retry, and reconnect no-replay are verified.',
        ],
        evidence: {
          pairingApproved: true,
          ownerTextReplyReturned: true,
          busyMessageQueuedOrRetried: true,
          reconnectReplayChecked: true,
        },
      }],
    }),
    /notes/,
  )
})

test('message awareness validation rejects passing live evidence placeholders', () => {
  assert.throws(
    () => normalizeLiveEvidenceChecks({
      checks: [{
        id: 'macos-notification-center-live',
        status: 'pass',
        observedAt: '2026-06-16T15:00:00Z',
        operator: 'REPLACE_WITH_OPERATOR',
        notes: 'One real app notification appeared once.',
        evidence: {
          appName: 'REPLACE_WITH_REAL_APP',
          fullDiskAccessGranted: true,
          notificationObservedOnce: true,
          replayCheckedAfterRestart: true,
        },
      }],
    }),
    /operator .*appName/,
  )
})

test('message awareness validation rejects failed live evidence without notes', () => {
  assert.throws(
    () => normalizeLiveEvidenceChecks({
      checks: [{
        id: 'discord-live-bridge',
        status: 'fail',
      }],
    }),
    /failed but has no notes/,
  )
})

test('message awareness validation evidence separates local pass from live gates', () => {
  const evidence = buildMessageAwarenessEvidence({
    mode: 'local-webhook',
    payload: {
      kind: 'message',
      source: 'Nexus Validation',
      text: 'probe',
      conversationId: 'nexus-validation',
      messageId: 'nexus-validation-20260616072000',
    },
    response: { ok: true, id: 'evt-1' },
    startedAt: new Date('2026-06-16T14:20:00.000Z'),
    completedAt: new Date('2026-06-16T14:20:01.000Z'),
  })

  assert.equal(evidence.gate, 'v0.3.4-message-awareness')
  assert.equal(evidence.overallStatus, 'local-webhook-pass-live-pending')
  assert.equal(evidence.releaseGateComplete, false)
  assert.equal(evidence.checks[0]?.status, 'pass')
  assert.deepEqual(
    evidence.checks.slice(1).map((check) => check.status),
    ['manual-required', 'manual-required', 'manual-required'],
  )
})

test('message awareness validation evidence becomes complete only when every live gate passes', () => {
  const evidence = buildMessageAwarenessEvidence({
    mode: 'local-webhook',
    payload: {
      kind: 'message',
      source: 'Nexus Validation',
      text: 'probe',
      conversationId: 'nexus-validation',
      messageId: 'nexus-validation-20260616072000',
    },
    response: { ok: true, id: 'evt-1' },
    startedAt: new Date('2026-06-16T14:20:00.000Z'),
    completedAt: new Date('2026-06-16T14:20:01.000Z'),
    liveEvidenceChecks: normalizeLiveEvidenceChecks([
      {
        id: 'macos-notification-center-live',
        status: 'pass',
        observedAt: '2026-06-16T14:30:00.000Z',
        operator: 'Klein',
        notes: 'Real WeChat notification appeared once and did not replay.',
        evidence: {
          appName: 'WeChat',
          fullDiskAccessGranted: true,
          notificationObservedOnce: true,
          replayCheckedAfterRestart: true,
        },
      },
      {
        id: 'telegram-live-bridge',
        status: 'pass',
        observedAt: '2026-06-16T14:35:00.000Z',
        operator: 'Klein',
        notes: 'Owner Telegram DM paired, replied, queued while busy, and did not replay.',
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
        observedAt: '2026-06-16T14:40:00.000Z',
        operator: 'Klein',
        notes: 'Allowed Discord target replied, suppressed echoes, and showed reconnect status.',
        evidence: {
          messageContentIntentEnabled: true,
          approvedChannelReplyReturned: true,
          botEchoSuppressed: true,
          reconnectStatusVisible: true,
        },
      },
    ]),
  })

  assert.equal(evidence.overallStatus, 'pass')
  assert.equal(evidence.releaseGateComplete, true)
  assert.deepEqual(
    evidence.checks.map((check) => check.status),
    ['pass', 'pass', 'pass', 'pass'],
  )
})

test('message awareness validation merges local evidence with live evidence without changing the local payload', () => {
  const localEvidence = buildMessageAwarenessEvidence({
    mode: 'local-webhook',
    payload: {
      kind: 'message',
      source: 'Nexus Validation',
      text: 'probe',
      conversationId: 'nexus-validation',
      messageId: 'nexus-validation-20260616072000',
    },
    response: { ok: true, id: 'evt-1' },
    startedAt: new Date('2026-06-16T14:20:00.000Z'),
    completedAt: new Date('2026-06-16T14:20:01.000Z'),
  })

  const merged = mergeMessageAwarenessEvidence(localEvidence, buildCompleteLiveEvidenceChecks(), {
    completedAt: new Date('2026-06-16T18:00:00.000Z'),
  })
  const audit = buildMessageAwarenessGateEvidenceAudit(merged)
  const localCheck = merged.checks.find((check) => check.id === 'local-webhook-injection')

  assert.equal(merged.generatedAt, '2026-06-16T18:00:00.000Z')
  assert.equal(merged.overallStatus, 'pass')
  assert.equal(merged.releaseGateComplete, true)
  assert.equal(localCheck?.evidence.payload.messageId, 'nexus-validation-20260616072000')
  assert.deepEqual(merged.checks.map((check) => check.status), ['pass', 'pass', 'pass', 'pass'])
  assert.equal(audit.releaseGateComplete, true)
})

test('message awareness validation evidence records live gate failures', () => {
  const evidence = buildMessageAwarenessEvidence({
    mode: 'local-webhook',
    payload: {
      kind: 'message',
      source: 'Nexus Validation',
      text: 'probe',
    },
    response: { ok: true },
    liveEvidenceChecks: normalizeLiveEvidenceChecks([
      {
        id: 'telegram-live-bridge',
        status: 'fail',
        notes: 'owner reply did not return to Telegram',
      },
    ]),
  })

  assert.equal(evidence.overallStatus, 'live-check-failed')
  assert.equal(evidence.releaseGateComplete, false)
  assert.equal(evidence.checks.find((check) => check.id === 'telegram-live-bridge')?.status, 'fail')
})

test('message awareness validation gate audit recomputes incomplete release evidence', () => {
  const evidence = buildMessageAwarenessEvidence({
    mode: 'local-webhook',
    payload: {
      kind: 'message',
      source: 'Nexus Validation',
      text: 'probe',
    },
    response: { ok: true },
  })
  const audit = buildMessageAwarenessGateEvidenceAudit(evidence)

  assert.equal(audit.gate, 'v0.3.4-message-awareness')
  assert.equal(audit.localWebhook.pass, true)
  assert.equal(audit.liveEvidence.liveGateComplete, false)
  assert.equal(audit.computedReleaseGateComplete, false)
  assert.equal(audit.releaseGateComplete, false)
  assert.equal(audit.overallStatus, 'live-check-pending')
  assert.deepEqual(audit.inconsistencies, [])
})

test('message awareness validation gate audit requires local and all live checks', () => {
  const evidence = buildMessageAwarenessEvidence({
    mode: 'local-webhook',
    payload: {
      kind: 'message',
      source: 'Nexus Validation',
      text: 'probe',
    },
    response: { ok: true },
    liveEvidenceChecks: normalizeLiveEvidenceChecks([
      {
        id: 'macos-notification-center-live',
        status: 'pass',
        observedAt: '2026-06-16T15:00:00Z',
        operator: 'Klein',
        notes: 'Real WeChat notification appeared once and did not replay.',
        evidence: {
          appName: 'WeChat',
          fullDiskAccessGranted: true,
          notificationObservedOnce: true,
          replayCheckedAfterRestart: true,
        },
      },
      {
        id: 'telegram-live-bridge',
        status: 'pass',
        observedAt: '2026-06-16T16:00:00Z',
        operator: 'Klein',
        notes: 'Owner Telegram DM paired, replied, queued while busy, and did not replay.',
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
        observedAt: '2026-06-16T17:00:00Z',
        operator: 'Klein',
        notes: 'Allowed Discord target replied, suppressed echoes, and showed reconnect status.',
        evidence: {
          messageContentIntentEnabled: true,
          approvedChannelReplyReturned: true,
          botEchoSuppressed: true,
          reconnectStatusVisible: true,
        },
      },
    ]),
  })
  const audit = buildMessageAwarenessGateEvidenceAudit(evidence)

  assert.equal(evidence.releaseGateComplete, true)
  assert.equal(audit.localWebhook.pass, true)
  assert.equal(audit.liveEvidence.liveGateComplete, true)
  assert.equal(audit.releaseGateComplete, true)
  assert.equal(audit.overallStatus, 'pass')
})

test('message awareness validation redacts private release evidence without breaking the gate audit', () => {
  const evidence = buildMessageAwarenessEvidence({
    mode: 'local-webhook',
    payload: {
      kind: 'message',
      source: 'Telegram',
      sender: 'Private Sender',
      chatTitle: 'Private Room',
      conversationId: 'telegram:123456',
      messageId: 'telegram:msg-1',
      text: 'private live message content',
    },
    response: { ok: true, id: 'evt-private-1' },
    liveEvidenceChecks: normalizeLiveEvidenceChecks([
      {
        id: 'macos-notification-center-live',
        status: 'pass',
        observedAt: '2026-06-16T15:00:00Z',
        operator: 'Klein',
        notes: 'The notification preview included private text.',
        evidence: {
          appName: 'WeChat',
          fullDiskAccessGranted: true,
          notificationObservedOnce: true,
          replayCheckedAfterRestart: true,
        },
      },
      {
        id: 'telegram-live-bridge',
        status: 'pass',
        observedAt: '2026-06-16T16:00:00Z',
        operator: 'Klein',
        notes: 'Owner DM mentioned a private project.',
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
        observedAt: '2026-06-16T17:00:00Z',
        operator: 'Klein',
        notes: 'Allowed channel name was private.',
        evidence: {
          messageContentIntentEnabled: true,
          approvedChannelReplyReturned: true,
          botEchoSuppressed: true,
          reconnectStatusVisible: true,
        },
      },
    ]),
  })

  const redacted = redactMessageAwarenessEvidence(evidence)
  const audit = buildMessageAwarenessGateEvidenceAudit(redacted)
  const localEvidence = redacted.checks.find((check) => check.id === 'local-webhook-injection')?.evidence
  const macosEvidence = redacted.checks.find((check) => check.id === 'macos-notification-center-live')?.evidence

  assert.equal(redacted.redacted, true)
  assert.equal(audit.releaseGateComplete, true)
  assert.equal(localEvidence.payload.redacted, true)
  assert.equal(localEvidence.payload.kind, 'message')
  assert.equal(localEvidence.payload.text, undefined)
  assert.equal(localEvidence.payload.sender, undefined)
  assert.equal(localEvidence.payload.chatTitle, undefined)
  assert.equal(localEvidence.payload.conversationId, undefined)
  assert.equal(localEvidence.payload.messageId, undefined)
  assert.deepEqual(localEvidence.response, { redacted: true, ok: true })
  assert.equal(macosEvidence.appName, 'WeChat')
  assert.equal(macosEvidence.fullDiskAccessGranted, true)
  assert.equal(macosEvidence.operator, 'redacted')
  assert.deepEqual(macosEvidence.notes, ['redacted'])
  assert.doesNotMatch(JSON.stringify(redacted), /private live message content|evt-private-1|Private Sender|Private Room|telegram:123456|Klein/)
})

test('message awareness validation gate audit rejects inconsistent releaseComplete claims', () => {
  const evidence = buildMessageAwarenessEvidence({
    mode: 'local-webhook',
    payload: {
      kind: 'message',
      source: 'Nexus Validation',
      text: 'probe',
    },
    response: { ok: true },
  })
  const audit = buildMessageAwarenessGateEvidenceAudit({
    ...evidence,
    releaseGateComplete: true,
  })

  assert.equal(audit.reportedReleaseGateComplete, true)
  assert.equal(audit.computedReleaseGateComplete, false)
  assert.equal(audit.releaseGateComplete, false)
  assert.equal(audit.overallStatus, 'evidence-inconsistent')
  assert.match(audit.inconsistencies[0], /releaseGateComplete/)
})

test('message awareness validation audit preserves normalized failure notes', () => {
  const [failedCheck] = normalizeLiveEvidenceChecks([{
    id: 'telegram-live-bridge',
    status: 'fail',
    notes: 'owner reply did not return',
  }])
  const audit = buildMessageAwarenessLiveEvidenceAudit([failedCheck])

  assert.equal(audit.overallStatus, 'live-check-failed')
  assert.deepEqual(audit.failedCheckIds, ['telegram-live-bridge'])
  assert.deepEqual(
    audit.checks.find((check) => check.id === 'telegram-live-bridge')?.notes,
    ['owner reply did not return'],
  )
})

test('message awareness validation writes an evidence file for dry-run probes', async () => {
  await withTempDirectory(async (directoryPath) => {
    const evidencePath = path.join(directoryPath, 'message-awareness.json')
    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/validate-message-awareness.mjs',
      '--dry-run',
      '--evidence-file',
      evidencePath,
    ], { cwd: process.cwd() })

    const stdoutResult = JSON.parse(stdout)
    const fileResult = JSON.parse(await fs.readFile(evidencePath, 'utf8'))
    assert.equal(fileResult.gate, 'v0.3.4-message-awareness')
    assert.equal(fileResult.mode, 'dry-run')
    assert.equal(fileResult.overallStatus, 'dry-run-live-pending')
    assert.equal(fileResult.checks[0]?.status, 'not-run')
    assert.equal(fileResult.checks[1]?.status, 'manual-required')
    assert.deepEqual(fileResult.payload, stdoutResult.evidence.payload)
  })
})

test('message awareness validation CLI merges live evidence file into dry-run reports', async () => {
  await withTempDirectory(async (directoryPath) => {
    const evidencePath = path.join(directoryPath, 'message-awareness.json')
    const liveEvidencePath = path.join(directoryPath, 'live-evidence.json')
    await fs.writeFile(liveEvidencePath, JSON.stringify({
      checks: [{
        id: 'macos-notification-center-live',
        status: 'pass',
        observedAt: '2026-06-16T15:00:00.000Z',
        operator: 'Klein',
        notes: 'Real Mail notification appeared once and did not replay.',
        evidence: {
          appName: 'Mail',
          fullDiskAccessGranted: true,
          notificationObservedOnce: true,
          replayCheckedAfterRestart: true,
        },
      }],
    }), 'utf8')

    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/validate-message-awareness.mjs',
      '--dry-run',
      '--evidence-file',
      evidencePath,
      '--live-evidence-file',
      liveEvidencePath,
    ], { cwd: process.cwd() })

    const stdoutResult = JSON.parse(stdout)
    const fileResult = JSON.parse(await fs.readFile(evidencePath, 'utf8'))
    const macosCheck = fileResult.checks.find((check) => check.id === 'macos-notification-center-live')
    assert.equal(stdoutResult.evidence.releaseGateComplete, false)
    assert.equal(macosCheck.status, 'pass')
    assert.deepEqual(macosCheck.evidence.appName, 'Mail')
    assert.equal(fileResult.checks[0]?.status, 'not-run')
  })
})

test('message awareness validation CLI merges release evidence without sending another webhook', async () => {
  await withTempDirectory(async (directoryPath) => {
    const localEvidencePath = path.join(directoryPath, 'message-awareness-local.json')
    const liveEvidencePath = path.join(directoryPath, 'message-awareness-live.json')
    const completeEvidencePath = path.join(directoryPath, 'message-awareness-complete.json')
    await fs.writeFile(localEvidencePath, JSON.stringify(buildMessageAwarenessEvidence({
      mode: 'local-webhook',
      payload: {
        kind: 'message',
        source: 'Nexus Validation',
        text: 'probe',
        conversationId: 'nexus-validation',
        messageId: 'nexus-validation-20260616072000',
      },
      response: { ok: true, id: 'evt-1' },
      startedAt: new Date('2026-06-16T14:20:00.000Z'),
      completedAt: new Date('2026-06-16T14:20:01.000Z'),
    })), 'utf8')
    await fs.writeFile(liveEvidencePath, JSON.stringify({
      checks: buildCompleteLiveEvidenceChecks(),
    }), 'utf8')

    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/validate-message-awareness.mjs',
      '--merge-evidence-file',
      localEvidencePath,
      '--live-evidence-file',
      liveEvidencePath,
      '--evidence-file',
      completeEvidencePath,
    ], { cwd: process.cwd() })

    const result = JSON.parse(stdout)
    const completeEvidence = JSON.parse(await fs.readFile(completeEvidencePath, 'utf8'))
    const localCheck = completeEvidence.checks.find((check) => check.id === 'local-webhook-injection')

    assert.equal(result.ok, true)
    assert.equal(result.audit.releaseGateComplete, true)
    assert.equal(result.mergedFrom, localEvidencePath)
    assert.equal(completeEvidence.releaseGateComplete, true)
    assert.equal(completeEvidence.overallStatus, 'pass')
    assert.equal(localCheck.evidence.payload.messageId, 'nexus-validation-20260616072000')
    assert.deepEqual(completeEvidence.checks.map((check) => check.status), ['pass', 'pass', 'pass', 'pass'])
  })
})

test('message awareness release status CLI reports pending proof without leaking private local evidence', async () => {
  await withTempDirectory(async (directoryPath) => {
    const localEvidencePath = path.join(directoryPath, 'message-awareness-local.json')
    const liveEvidencePath = path.join(directoryPath, 'message-awareness-live.json')
    const completeEvidencePath = path.join(directoryPath, 'message-awareness-complete.json')
    await fs.writeFile(localEvidencePath, JSON.stringify(buildMessageAwarenessEvidence({
      mode: 'local-webhook',
      payload: {
        kind: 'message',
        source: 'Telegram',
        sender: 'Private Sender',
        chatTitle: 'Private Room',
        conversationId: 'telegram:private-room',
        messageId: 'telegram:private-message',
        text: 'private live message content',
      },
      response: { ok: true, id: 'evt-private-1' },
    })), 'utf8')
    const liveEvidenceTemplate = buildMessageAwarenessLiveEvidenceTemplate()
    const telegramTemplate = liveEvidenceTemplate.checks.find((check) => check.id === 'telegram-live-bridge')
    if (telegramTemplate) {
      telegramTemplate.observedAt = '2026-06-16T16:00:00Z'
      telegramTemplate.evidence.updateOffset = 401
      telegramTemplate.evidence.lastOutboundAt = '2026-06-16T16:01:00Z'
      telegramTemplate.evidence.lastOutboundKind = 'text'
      telegramTemplate.evidence.lastOutboundTarget = 'telegram:private-target'
    }
    const discordTemplate = liveEvidenceTemplate.checks.find((check) => check.id === 'discord-live-bridge')
    if (discordTemplate) {
      discordTemplate.observedAt = '2026-06-16T17:00:00Z'
      discordTemplate.evidence.lastReconnectAt = '2026-06-16T17:02:00Z'
      discordTemplate.evidence.lastReconnectReason = 'gateway_reconnect_requested'
      discordTemplate.evidence.lastOutboundAt = '2026-06-16T17:03:00Z'
      discordTemplate.evidence.lastOutboundKind = 'audio'
      discordTemplate.evidence.lastOutboundTarget = 'discord:private-channel'
      discordTemplate.evidence.lastOutboundError = 'Discord API 403 for discord:private-channel'
    }
    await fs.writeFile(liveEvidencePath, JSON.stringify(liveEvidenceTemplate), 'utf8')

    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/message-awareness-release-status.mjs',
      '--local-evidence-file',
      localEvidencePath,
      '--live-evidence-file',
      liveEvidencePath,
      '--complete-evidence-file',
      completeEvidencePath,
    ], { cwd: process.cwd() })

    const report = JSON.parse(stdout)
    assert.equal(report.ok, false)
    assert.equal(report.localEvidence.audit.localWebhook.pass, true)
    assert.equal(report.liveEvidence.audit.liveGateComplete, false)
    assert.deepEqual(report.liveEvidence.audit.pendingCheckIds, [
      'macos-notification-center-live',
      'telegram-live-bridge',
      'discord-live-bridge',
    ])
    const macosNextCommand = report.nextCommands.find((entry) => entry.id === 'record-macos-notification-center-live')
    assert.ok(macosNextCommand?.command.includes('npm run message:live:record -- macos'))
    assert.ok(macosNextCommand?.dryRunCommand.includes('npm run message:live:record -- macos --dry-run'))
    assert.ok(macosNextCommand?.preflightCommand.includes('npm run message:live:record -- macos --preflight'))
    assert.equal(macosNextCommand?.isTemplate, true)
    assert.equal(macosNextCommand?.mustReplacePlaceholders, true)
    assert.ok(macosNextCommand?.command.includes('--observed-at "REPLACE_WITH_OBSERVED_AT"'))
    assert.deepEqual(macosNextCommand?.placeholderFields, ['operator', 'appName', 'observedAt'])
    assert.deepEqual(macosNextCommand?.placeholderValues, [
      'REPLACE_WITH_OPERATOR',
      'REPLACE_WITH_REAL_APP',
      'REPLACE_WITH_OBSERVED_AT',
    ])
    assert.ok(report.nextCommands.some((entry) => (
      entry.id === 'live-preflight'
      && entry.command === 'npm run message:preflight:live'
    )))
    assert.ok(report.nextCommands.some((entry) => (
      entry.id === 'macos-live-probe'
      && entry.command === 'npm run message:probe:macos'
    )))
    assert.ok(report.nextCommands.some((entry) => (
      entry.command.includes('npm run message:validate -- --check-live-evidence')
      && entry.command.includes(liveEvidencePath)
    )))
    const telegramChecklist = report.liveVerificationChecklist.find((entry) => entry.id === 'telegram-live-bridge')
    const discordChecklist = report.liveVerificationChecklist.find((entry) => entry.id === 'discord-live-bridge')
    const telegramEvidence = report.liveEvidence.audit.checks.find((entry) => entry.id === 'telegram-live-bridge')?.evidence
    const discordEvidence = report.liveEvidence.audit.checks.find((entry) => entry.id === 'discord-live-bridge')?.evidence
    assert.equal(telegramChecklist.readyForReleaseGate, false)
    assert.equal(telegramChecklist.recordCommandIsTemplate, true)
    assert.equal(telegramChecklist.mustReplacePlaceholders, true)
    assert.deepEqual(telegramChecklist.placeholderFields, ['operator'])
    assert.deepEqual(telegramChecklist.placeholderValues, ['REPLACE_WITH_OPERATOR'])
    assert.ok(telegramChecklist.diagnostics.some((step) => step.includes('update offset checkpoint')))
    assert.ok(telegramChecklist.diagnostics.some((step) => step.includes('outbound text/voice reply target')))
    assert.match(telegramChecklist.recordCommand, /--observed-at "2026-06-16T16:00:00\.000Z"/)
    assert.ok(telegramChecklist.dryRunCommand.includes('npm run message:live:record -- telegram --dry-run'))
    assert.ok(telegramChecklist.preflightCommand.includes('npm run message:live:record -- telegram --preflight'))
    assert.ok(telegramChecklist.recordCommand.includes(`--live-evidence-file "${liveEvidencePath}"`))
    assert.match(telegramChecklist.recordCommand, /--update-offset 401/)
    assert.match(telegramChecklist.recordCommand, /--last-outbound-at "2026-06-16T16:01:00\.000Z"/)
    assert.match(telegramChecklist.recordCommand, /--last-outbound-kind "text"/)
    assert.equal(telegramEvidence.lastOutboundTargetPresent, true)
    assert.doesNotMatch(telegramChecklist.recordCommand, /last-outbound-target|telegram:private-target/)
    assert.ok(discordChecklist.diagnostics.some((step) => step.includes('last reconnect reason/time')))
    assert.ok(discordChecklist.diagnostics.some((step) => step.includes('outbound text/audio reply target')))
    assert.match(discordChecklist.recordCommand, /--last-reconnect-at "2026-06-16T17:02:00\.000Z"/)
    assert.ok(discordChecklist.recordCommand.includes(`--live-evidence-file "${liveEvidencePath}"`))
    assert.match(discordChecklist.recordCommand, /--last-reconnect-reason "gateway_reconnect_requested"/)
    assert.match(discordChecklist.recordCommand, /--last-outbound-at "2026-06-16T17:03:00\.000Z"/)
    assert.match(discordChecklist.recordCommand, /--last-outbound-kind "audio"/)
    assert.equal(discordEvidence.lastOutboundTargetPresent, true)
    assert.equal(discordEvidence.lastOutboundErrorPresent, true)
    assert.doesNotMatch(discordChecklist.recordCommand, /last-outbound-target|last-outbound-error|discord:private-channel/)
    assert.ok(report.nextCommands.some((entry) => (
      entry.id === 'record-telegram-live-bridge'
      && entry.command.includes('--last-outbound-kind "text"')
      && !entry.command.includes('last-outbound-target')
    )))
    assert.equal(telegramChecklist.missingProofFields.length, 6)
    assert.equal(
      telegramChecklist.missingProofFields.some((field) => field.field === 'observedAt'),
      false,
    )
    assert.doesNotMatch(
      stdout,
      /private live message content|Private Sender|Private Room|telegram:private-room|telegram:private-message|evt-private-1|telegram:private-target|discord:private-channel|Discord API 403/,
    )
  })
})

test('message awareness release status labels the v0.4 evidence profile', async () => {
  const report = await buildMessageAwarenessReleaseStatusReport({
    localEvidenceFile: 'artifacts/v0.4.0/message-awareness-local.json',
    liveEvidenceFile: 'artifacts/v0.4.0/message-awareness-live.json',
    completeEvidenceFile: 'artifacts/v0.4.0/message-awareness-complete.json',
    redactedOutputFile: 'docs/release-evidence/v0.4.0-message-awareness.json',
  })

  assert.equal(report.gate, 'v0.4-message-awareness-release-status')
  assert.ok(report.nextCommands.some((entry: { id: string; command: string }) => (
    entry.id === 'live-preflight'
    && entry.command === 'npm run v04:message:preflight:live'
  )))
})

test('message awareness release status summarizes macOS probe without leaking notification content', async () => {
  await withTempDirectory(async (directoryPath) => {
    const macosProbePath = path.join(directoryPath, 'message-awareness-macos-live-probe.json')
    await fs.writeFile(macosProbePath, JSON.stringify({
      schemaVersion: 1,
      gate: 'message-awareness-macos-live-probe',
      generatedAt: '2026-06-17T14:00:00Z',
      ok: true,
      status: 'observed-once',
      releaseEvidenceCandidate: true,
      releaseEvidenceRecorded: false,
      diagnostics: {
        platform: 'darwin',
        machineChecked: true,
        errorKind: null,
        stateFileConfigured: true,
        testNotificationRequested: false,
        initialBacklogMarkedSeen: 2,
        observedFreshCount: 1,
        replayFreshCount: 0,
        rowsInspected: {
          initial: 10,
          observed: 11,
          replay: 11,
        },
        privateSender: 'Private Sender',
        privateMessageId: 'private-message-id',
      },
      privateNotificationBody: 'private notification body',
    }), 'utf8')

    const report = await buildMessageAwarenessReleaseStatusReport({
      liveEvidenceFile: path.join(directoryPath, 'missing-live.json'),
      localEvidenceFile: path.join(directoryPath, 'missing-local.json'),
      completeEvidenceFile: path.join(directoryPath, 'missing-complete.json'),
      macosLiveProbeFile: macosProbePath,
      redactedOutputFile: path.join(directoryPath, 'missing-redacted.json'),
    }, { now: '2026-06-17T14:01:00Z' })
    const json = JSON.stringify(report)
    const macosProbeCommand = report.nextCommands.find((entry) => entry.id === 'macos-live-probe')

    assert.equal(report.macosLiveProbe.ok, true)
    assert.equal(report.macosLiveProbe.status, 'observed-once')
    assert.equal(report.macosLiveProbe.releaseEvidenceCandidate, true)
    assert.equal(report.macosLiveProbe.diagnostics.observedFreshCount, 1)
    assert.equal(report.macosLiveProbe.diagnostics.replayFreshCount, 0)
    assert.equal(macosProbeCommand?.lastProbeStatus, 'observed-once')
    assert.equal(macosProbeCommand?.releaseEvidenceCandidate, true)
    assert.match(macosProbeCommand?.reason ?? '', /probe saw exactly one fresh candidate/)
    assert.doesNotMatch(json, /private notification body|Private Sender|private-message-id/)
  })
})

test('message awareness release status recommends v0.4 finalize after live proof passes', async () => {
  await withTempDirectory(async (directoryPath) => {
    const localEvidencePath = 'artifacts/v0.4.0/message-awareness-local.json'
    const liveEvidencePath = 'artifacts/v0.4.0/message-awareness-live.json'
    const completeEvidencePath = 'artifacts/v0.4.0/message-awareness-complete.json'
    const redactedEvidencePath = 'docs/release-evidence/v0.4.0-message-awareness.json'
    const localEvidence = buildMessageAwarenessEvidence({
      mode: 'local-webhook',
      payload: {
        kind: 'message',
        source: 'Nexus Validation',
        text: 'private local webhook payload',
      },
      response: {
        id: 'private-response-id',
        ok: true,
      },
      gateVersion: 'v0.4',
      liveEvidenceChecks: buildCompleteLiveEvidenceChecks(),
    })
    await fs.mkdir(path.join(directoryPath, 'artifacts/v0.4.0'), { recursive: true })
    await fs.writeFile(path.join(directoryPath, localEvidencePath), JSON.stringify(localEvidence), 'utf8')
    await fs.writeFile(
      path.join(directoryPath, liveEvidencePath),
      JSON.stringify({ checks: buildCompleteLiveEvidenceChecks() }),
      'utf8',
    )

    const { stdout } = await execFileAsync(process.execPath, [
      path.join(process.cwd(), 'scripts/message-awareness-release-status.mjs'),
      '--local-evidence-file',
      localEvidencePath,
      '--live-evidence-file',
      liveEvidencePath,
      '--complete-evidence-file',
      completeEvidencePath,
      '--redacted-output-file',
      redactedEvidencePath,
    ], { cwd: directoryPath })
    const report = JSON.parse(stdout)
    const finalize = report.nextCommands.find((entry: { id: string }) => (
      entry.id === 'finalize-release-evidence'
    ))

    assert.equal(report.gate, 'v0.4-message-awareness-release-status')
    assert.equal(report.ok, false)
    assert.equal(report.localEvidence.audit.localWebhook.pass, true)
    assert.equal(report.liveEvidence.audit.liveGateComplete, true)
    assert.equal(finalize?.command, 'npm run v04:message:finalize')
    assert.equal(JSON.stringify(report).includes('private local webhook payload'), false)
    assert.equal(JSON.stringify(report).includes('private-response-id'), false)
  })
})

test('message awareness release status report blocks raw complete evidence until redaction passes', async () => {
  await withTempDirectory(async (directoryPath) => {
    const completeEvidencePath = path.join(directoryPath, 'message-awareness-complete.json')
    const redactedEvidencePath = path.join(directoryPath, 'message-awareness-redacted.json')
    const completeEvidence = buildMessageAwarenessEvidence({
      mode: 'local-webhook',
      payload: {
        kind: 'message',
        source: 'Nexus Validation',
        text: 'probe',
      },
      response: { ok: true },
      liveEvidenceChecks: buildCompleteLiveEvidenceChecks(),
    })
    await fs.writeFile(completeEvidencePath, JSON.stringify(completeEvidence), 'utf8')

    const report = await buildMessageAwarenessReleaseStatusReport({
      localEvidenceFile: path.join(directoryPath, 'missing-local.json'),
      liveEvidenceFile: path.join(directoryPath, 'missing-live.json'),
      completeEvidenceFile: completeEvidencePath,
      redactedOutputFile: redactedEvidencePath,
    }, { now: new Date('2026-06-16T18:00:00.000Z') })

    assert.equal(report.generatedAt, '2026-06-16T18:00:00.000Z')
    assert.equal(report.ok, false)
    assert.equal(report.rawReleaseGateComplete, true)
    assert.equal(report.redactionGateComplete, false)
    assert.equal(report.releaseGateComplete, false)
    assert.equal(report.completeEvidence.audit.releaseGateComplete, true)
    assert.equal(report.redactedEvidence.exists, false)
    assert.equal(
      report.liveVerificationChecklist.every((entry) => entry.readyForReleaseGate),
      true,
    )
    assert.ok(report.nextCommands.some((entry) => (
      entry.command.includes('npm run message:validate -- --redact-evidence-file')
      && entry.command.includes(completeEvidencePath)
      && entry.command.includes(redactedEvidencePath)
    )))
  })
})

test('message awareness release status report passes after redacted evidence stays gate-green', async () => {
  await withTempDirectory(async (directoryPath) => {
    const completeEvidencePath = path.join(directoryPath, 'message-awareness-complete.json')
    const redactedEvidencePath = path.join(directoryPath, 'message-awareness-redacted.json')
    const completeEvidence = buildMessageAwarenessEvidence({
      mode: 'local-webhook',
      payload: {
        kind: 'message',
        source: 'Nexus Validation',
        text: 'private probe',
      },
      response: { id: 'private-response-id', ok: true },
      liveEvidenceChecks: buildCompleteLiveEvidenceChecks(),
    })
    await fs.writeFile(completeEvidencePath, JSON.stringify(completeEvidence), 'utf8')
    await fs.writeFile(redactedEvidencePath, JSON.stringify(redactMessageAwarenessEvidence(completeEvidence)), 'utf8')

    const report = await buildMessageAwarenessReleaseStatusReport({
      localEvidenceFile: path.join(directoryPath, 'missing-local.json'),
      liveEvidenceFile: path.join(directoryPath, 'missing-live.json'),
      completeEvidenceFile: completeEvidencePath,
      redactedOutputFile: redactedEvidencePath,
    })
    const json = JSON.stringify(report)

    assert.equal(report.ok, true)
    assert.equal(report.rawReleaseGateComplete, true)
    assert.equal(report.redactionGateComplete, true)
    assert.equal(report.releaseGateComplete, true)
    assert.equal(report.redactedEvidence.redacted, true)
    assert.equal(report.redactedEvidence.redactionGateComplete, true)
    assert.equal(
      report.nextCommands.some((entry: { id: string }) => entry.id === 'redact-release-evidence'),
      false,
    )
    assert.equal(json.includes('private probe'), false)
    assert.equal(json.includes('private-response-id'), false)
  })
})

test('message awareness release status CLI persists a private-safe runbook', async () => {
  await withTempDirectory(async (directoryPath) => {
    const localEvidencePath = 'message-awareness-local.json'
    const liveEvidencePath = 'message-awareness-live.json'
    const outputPath = 'message-awareness-status.json'
    const localEvidence = buildMessageAwarenessEvidence({
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
    })
    const liveEvidence = buildMessageAwarenessLiveEvidenceTemplate()
    await fs.writeFile(path.join(directoryPath, localEvidencePath), JSON.stringify(localEvidence), 'utf8')
    await fs.writeFile(path.join(directoryPath, liveEvidencePath), JSON.stringify(liveEvidence), 'utf8')

    const { stdout } = await execFileAsync(process.execPath, [
      path.join(process.cwd(), 'scripts/message-awareness-release-status.mjs'),
      '--local-evidence-file',
      localEvidencePath,
      '--live-evidence-file',
      liveEvidencePath,
      '--complete-evidence-file',
      'missing-complete.json',
      '--output',
      outputPath,
    ], { cwd: directoryPath })
    const stdoutReport = JSON.parse(stdout)
    const fileReport = JSON.parse(await fs.readFile(path.join(directoryPath, outputPath), 'utf8'))
    const json = JSON.stringify(fileReport)

    assert.deepEqual(fileReport, stdoutReport)
    assert.equal(fileReport.ok, false)
    assert.equal(fileReport.files.local.path, localEvidencePath)
    assert.equal('resolvedPath' in fileReport.files.local, false)
    assert.equal('resolvedPath' in fileReport.files.redactedOutput, false)
    assert.ok(fileReport.liveVerificationChecklist.some((entry: { id: string }) => entry.id === 'telegram-live-bridge'))
    assert.equal(json.includes('private local webhook payload'), false)
    assert.equal(json.includes('Private Sender'), false)
    assert.equal(json.includes('private-response-id'), false)
    assert.equal(json.includes(directoryPath), false)
  })
})

test('v0.4 message release finalize args use v0.4 release evidence defaults', () => {
  assert.deepEqual(parseV04MessageReleaseFinalizeArgs([
    '--local-evidence-file',
    'local.json',
    '--live-evidence-file=live.json',
    '--complete-evidence-file',
    'complete.json',
    '--redacted-output-file',
    'redacted.json',
    '--status-output',
    'status.json',
    '--generated-at',
    '2026-06-17T19:00:00Z',
  ]), {
    completeEvidenceFile: 'complete.json',
    generatedAt: '2026-06-17T19:00:00Z',
    help: false,
    liveEvidenceFile: 'live.json',
    localEvidenceFile: 'local.json',
    redactedOutputFile: 'redacted.json',
    statusOutputFile: 'status.json',
  })
})

test('v0.4 message release finalize writes complete redacted and status evidence after live proof passes', async () => {
  await withTempDirectory(async (directoryPath) => {
    const localEvidencePath = 'message-awareness-local.json'
    const liveEvidencePath = 'message-awareness-live.json'
    const completeEvidencePath = 'message-awareness-complete.json'
    const redactedEvidencePath = 'v0.4.0-message-awareness.json'
    const statusOutputPath = 'message-awareness-status.json'
    const localEvidence = buildMessageAwarenessEvidence({
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
      completedAt: '2026-06-17T18:59:30.000Z',
      gateVersion: 'v0.4',
      startedAt: '2026-06-17T18:59:00.000Z',
    })
    const liveEvidence = { checks: buildCompleteLiveEvidenceChecks() }
    await fs.writeFile(path.join(directoryPath, localEvidencePath), JSON.stringify(localEvidence), 'utf8')
    await fs.writeFile(path.join(directoryPath, liveEvidencePath), JSON.stringify(liveEvidence), 'utf8')

    const { stdout } = await execFileAsync(process.execPath, [
      path.join(process.cwd(), 'scripts/v04-message-release-finalize.mjs'),
      '--local-evidence-file',
      localEvidencePath,
      '--live-evidence-file',
      liveEvidencePath,
      '--complete-evidence-file',
      completeEvidencePath,
      '--redacted-output-file',
      redactedEvidencePath,
      '--status-output',
      statusOutputPath,
      '--generated-at',
      '2026-06-17T19:00:00.000Z',
    ], { cwd: directoryPath })
    const report = JSON.parse(stdout)
    const complete = JSON.parse(await fs.readFile(path.join(directoryPath, completeEvidencePath), 'utf8'))
    const redacted = JSON.parse(await fs.readFile(path.join(directoryPath, redactedEvidencePath), 'utf8'))
    const status = JSON.parse(await fs.readFile(path.join(directoryPath, statusOutputPath), 'utf8'))
    const safeJson = JSON.stringify({ report, redacted, status })

    assert.equal(report.ok, true)
    assert.equal(report.status, 'pass')
    assert.equal(report.releaseGate.releaseGateComplete, true)
    assert.equal(report.redactedGate.releaseGateComplete, true)
    assert.equal(complete.gate, 'v0.4-message-awareness')
    assert.equal(complete.releaseGateComplete, true)
    assert.equal(redacted.redacted, true)
    assert.equal(buildMessageAwarenessGateEvidenceAudit(redacted).releaseGateComplete, true)
    assert.equal(status.ok, true)
    assert.equal(status.releaseGateComplete, true)
    assert.equal(status.redactionGateComplete, true)
    assert.equal(status.files.complete.path, completeEvidencePath)
    assert.equal(safeJson.includes('private local webhook payload'), false)
    assert.equal(safeJson.includes('Private Sender'), false)
    assert.equal(safeJson.includes('private-response-id'), false)
    assert.equal(safeJson.includes(directoryPath), false)
  })
})

test('v0.4 message release finalize refuses final writes if redacted evidence fails the gate', async () => {
  await withTempDirectory(async (directoryPath) => {
    const localEvidencePath = path.join(directoryPath, 'message-awareness-local.json')
    const liveEvidencePath = path.join(directoryPath, 'message-awareness-live.json')
    const completeEvidencePath = path.join(directoryPath, 'message-awareness-complete.json')
    const redactedEvidencePath = path.join(directoryPath, 'v0.4.0-message-awareness.json')
    const statusOutputPath = path.join(directoryPath, 'message-awareness-status.json')
    const localEvidence = buildMessageAwarenessEvidence({
      mode: 'local-webhook',
      payload: {
        kind: 'message',
        source: 'Nexus Validation',
        text: 'private local webhook payload',
      },
      response: { id: 'private-response-id', ok: true },
      gateVersion: 'v0.4',
    })
    await fs.writeFile(localEvidencePath, JSON.stringify(localEvidence), 'utf8')
    await fs.writeFile(liveEvidencePath, JSON.stringify({ checks: buildCompleteLiveEvidenceChecks() }), 'utf8')

    const report = await finalizeV04MessageRelease({
      completeEvidenceFile: completeEvidencePath,
      generatedAt: '2026-06-17T19:00:00.000Z',
      liveEvidenceFile: liveEvidencePath,
      localEvidenceFile: localEvidencePath,
      redactedOutputFile: redactedEvidencePath,
      statusOutputFile: statusOutputPath,
    }, {
      redactMessageAwarenessEvidence(evidence: Record<string, unknown>) {
        return {
          ...redactMessageAwarenessEvidence(evidence),
          checks: [],
          releaseGateComplete: false,
        }
      },
    })

    const completeExists = await fs.stat(completeEvidencePath).then(() => true, () => false)
    const redactedExists = await fs.stat(redactedEvidencePath).then(() => true, () => false)
    const status = JSON.parse(await fs.readFile(statusOutputPath, 'utf8'))

    assert.equal(report.ok, false)
    assert.equal(report.status, 'redacted-release-gate-pending')
    assert.equal(report.releaseGate.releaseGateComplete, true)
    assert.equal(report.redactedGate.releaseGateComplete, false)
    assert.equal(completeExists, false)
    assert.equal(redactedExists, false)
    assert.equal(status.ok, false)
  })
})

test('v0.4 message release finalize refuses to write final evidence while live proof is pending', async () => {
  await withTempDirectory(async (directoryPath) => {
    const localEvidencePath = 'message-awareness-local.json'
    const liveEvidencePath = 'message-awareness-live.json'
    const completeEvidencePath = 'message-awareness-complete.json'
    const redactedEvidencePath = 'v0.4.0-message-awareness.json'
    const statusOutputPath = 'message-awareness-status.json'
    const localEvidence = buildMessageAwarenessEvidence({
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
    })
    await fs.writeFile(path.join(directoryPath, localEvidencePath), JSON.stringify(localEvidence), 'utf8')
    await fs.writeFile(
      path.join(directoryPath, liveEvidencePath),
      JSON.stringify(buildMessageAwarenessLiveEvidenceTemplate()),
      'utf8',
    )

    try {
      await execFileAsync(process.execPath, [
        path.join(process.cwd(), 'scripts/v04-message-release-finalize.mjs'),
        '--local-evidence-file',
        localEvidencePath,
        '--live-evidence-file',
        liveEvidencePath,
        '--complete-evidence-file',
        completeEvidencePath,
        '--redacted-output-file',
        redactedEvidencePath,
        '--status-output',
        statusOutputPath,
        '--generated-at',
        '2026-06-17T19:00:00.000Z',
      ], { cwd: directoryPath })
      assert.fail('Expected v0.4 message finalize to reject pending live proof')
    } catch (error) {
      const err = error as { code?: number; stdout?: string }
      const report = JSON.parse(err.stdout ?? '{}')
      const status = JSON.parse(await fs.readFile(path.join(directoryPath, statusOutputPath), 'utf8'))
      const completeExists = await fs.stat(path.join(directoryPath, completeEvidencePath)).then(() => true, () => false)
      const redactedExists = await fs.stat(path.join(directoryPath, redactedEvidencePath)).then(() => true, () => false)
      const safeJson = JSON.stringify({ report, status })

      assert.equal(err.code, 2)
      assert.equal(report.ok, false)
      assert.equal(report.status, 'live-evidence-pending')
      assert.equal(status.ok, false)
      assert.deepEqual(status.liveEvidence.audit.pendingCheckIds, [
        'macos-notification-center-live',
        'telegram-live-bridge',
        'discord-live-bridge',
      ])
      assert.equal(completeExists, false)
      assert.equal(redactedExists, false)
      assert.equal(safeJson.includes('private local webhook payload'), false)
      assert.equal(safeJson.includes('Private Sender'), false)
      assert.equal(safeJson.includes('private-response-id'), false)
    }
  })
})

test('message awareness release status checklist prefers fresh live evidence over stale complete evidence', async () => {
  await withTempDirectory(async (directoryPath) => {
    const liveEvidencePath = path.join(directoryPath, 'message-awareness-live.json')
    const completeEvidencePath = path.join(directoryPath, 'message-awareness-complete.json')
    const staleComplete = buildMessageAwarenessEvidence({
      mode: 'local-webhook',
      payload: {
        kind: 'message',
        source: 'Nexus Validation',
        text: 'probe',
      },
      response: { ok: true },
    })
    const freshLive = buildMessageAwarenessLiveEvidenceTemplate()
    const telegram = freshLive.checks.find((check) => check.id === 'telegram-live-bridge')
    if (telegram) {
      telegram.observedAt = '2026-06-16T16:00:00Z'
      telegram.evidence.updateOffset = 909
      telegram.evidence.lastOutboundAt = '2026-06-16T16:02:00Z'
      telegram.evidence.lastOutboundKind = 'voice'
      telegram.evidence.lastOutboundTarget = 'owner-chat'
    }
    await fs.writeFile(liveEvidencePath, JSON.stringify(freshLive), 'utf8')
    await fs.writeFile(completeEvidencePath, JSON.stringify(staleComplete), 'utf8')

    const report = await buildMessageAwarenessReleaseStatusReport({
      localEvidenceFile: path.join(directoryPath, 'missing-local.json'),
      liveEvidenceFile: liveEvidencePath,
      completeEvidenceFile: completeEvidencePath,
    })
    const telegramChecklist = report.liveVerificationChecklist.find((entry) => entry.id === 'telegram-live-bridge')
    const telegramEvidence = report.liveEvidence.audit.checks.find((entry) => entry.id === 'telegram-live-bridge')?.evidence

    assert.match(telegramChecklist.recordCommand, /--observed-at "2026-06-16T16:00:00\.000Z"/)
    assert.match(telegramChecklist.recordCommand, /--update-offset 909/)
    assert.match(telegramChecklist.recordCommand, /--last-outbound-at "2026-06-16T16:02:00\.000Z"/)
    assert.match(telegramChecklist.recordCommand, /--last-outbound-kind "voice"/)
    assert.equal(telegramEvidence.lastOutboundTargetPresent, true)
    assert.doesNotMatch(telegramChecklist.recordCommand, /last-outbound-target|owner-chat/)
  })
})

test('message awareness validation CLI requires an output file when merging release evidence', async () => {
  await withTempDirectory(async (directoryPath) => {
    const localEvidencePath = path.join(directoryPath, 'message-awareness-local.json')
    await fs.writeFile(localEvidencePath, JSON.stringify(buildMessageAwarenessEvidence({
      mode: 'local-webhook',
      payload: {
        kind: 'message',
        source: 'Nexus Validation',
        text: 'probe',
      },
      response: { ok: true },
    })), 'utf8')

    await assert.rejects(
      execFileAsync(process.execPath, [
        'scripts/validate-message-awareness.mjs',
        '--merge-evidence-file',
        localEvidencePath,
      ], { cwd: process.cwd() }),
      (error: unknown) => {
        const failure = error as { stderr?: string }
        assert.match(failure.stderr ?? '', /--merge-evidence-file requires --evidence-file/)
        return true
      },
    )
  })
})

test('message awareness validation CLI writes a live evidence template without sending webhook', async () => {
  await withTempDirectory(async (directoryPath) => {
    const liveTemplatePath = path.join(directoryPath, 'message-awareness-live.json')

    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/validate-message-awareness.mjs',
      '--write-live-template',
      liveTemplatePath,
    ], { cwd: process.cwd() })

    const stdoutResult = JSON.parse(stdout)
    const fileResult = JSON.parse(await fs.readFile(liveTemplatePath, 'utf8'))
    assert.equal(stdoutResult.ok, true)
    assert.equal(stdoutResult.liveEvidenceFile, liveTemplatePath)
    assert.deepEqual(fileResult.checks.map((check) => check.id), [
      'macos-notification-center-live',
      'telegram-live-bridge',
      'discord-live-bridge',
    ])
    assert.equal(fileResult.checks[0]?.status, 'manual-required')
    assert.equal(fileResult.checks[1]?.evidence.pairingApproved, false)
    assert.equal(normalizeLiveEvidenceChecks(fileResult).length, 3)
  })
})

test('message awareness validation CLI refuses to overwrite an existing live template by default', async () => {
  await withTempDirectory(async (directoryPath) => {
    const liveTemplatePath = path.join(directoryPath, 'message-awareness-live.json')
    await fs.writeFile(liveTemplatePath, '{"keep":true}\n', 'utf8')

    await assert.rejects(
      execFileAsync(process.execPath, [
        'scripts/validate-message-awareness.mjs',
        '--write-live-template',
        liveTemplatePath,
      ], { cwd: process.cwd() }),
      (error: unknown) => {
        const stderr = (error as { stderr?: string }).stderr ?? ''
        assert.match(stderr, /already exists/)
        assert.match(stderr, /--force-live-template/)
        return true
      },
    )

    assert.deepEqual(JSON.parse(await fs.readFile(liveTemplatePath, 'utf8')), { keep: true })
  })
})

test('message awareness validation CLI can force-overwrite a live template', async () => {
  await withTempDirectory(async (directoryPath) => {
    const liveTemplatePath = path.join(directoryPath, 'message-awareness-live.json')
    await fs.writeFile(liveTemplatePath, '{"keep":true}\n', 'utf8')

    await execFileAsync(process.execPath, [
      'scripts/validate-message-awareness.mjs',
      '--write-live-template',
      liveTemplatePath,
      '--force-live-template',
    ], { cwd: process.cwd() })

    const fileResult = JSON.parse(await fs.readFile(liveTemplatePath, 'utf8'))
    assert.equal(fileResult.checks[0]?.id, 'macos-notification-center-live')
  })
})

test('message awareness validation CLI checks incomplete live evidence without sending webhook', async () => {
  await withTempDirectory(async (directoryPath) => {
    const liveEvidencePath = path.join(directoryPath, 'message-awareness-live.json')
    await fs.writeFile(liveEvidencePath, JSON.stringify(buildMessageAwarenessLiveEvidenceTemplate()), 'utf8')

    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/validate-message-awareness.mjs',
      '--check-live-evidence',
      liveEvidencePath,
    ], { cwd: process.cwd() })

    const result = JSON.parse(stdout)
    assert.equal(result.ok, true)
    assert.equal(result.liveEvidenceFile, liveEvidencePath)
    assert.equal(result.audit.overallStatus, 'live-check-pending')
    assert.equal(result.audit.liveGateComplete, false)
    assert.deepEqual(result.audit.pendingCheckIds, [
      'macos-notification-center-live',
      'telegram-live-bridge',
      'discord-live-bridge',
    ])
  })
})

test('message awareness validation CLI labels v0.4 live evidence paths', async () => {
  await withTempDirectory(async (directoryPath) => {
    const liveEvidencePath = path.join(directoryPath, 'artifacts', 'v0.4.0', 'message-awareness-live.json')
    await fs.mkdir(path.dirname(liveEvidencePath), { recursive: true })
    await fs.writeFile(liveEvidencePath, JSON.stringify(buildMessageAwarenessLiveEvidenceTemplate()), 'utf8')

    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/validate-message-awareness.mjs',
      '--check-live-evidence',
      liveEvidencePath,
    ], { cwd: process.cwd() })

    const result = JSON.parse(stdout)
    assert.equal(result.audit.gate, 'v0.4-message-awareness-live')
    assert.equal(result.audit.liveGateComplete, false)
  })
})

test('message awareness validation CLI require-live-complete rejects pending evidence', async () => {
  await withTempDirectory(async (directoryPath) => {
    const liveEvidencePath = path.join(directoryPath, 'message-awareness-live.json')
    await fs.writeFile(liveEvidencePath, JSON.stringify(buildMessageAwarenessLiveEvidenceTemplate()), 'utf8')

    await assert.rejects(
      execFileAsync(process.execPath, [
        'scripts/validate-message-awareness.mjs',
        '--check-live-evidence',
        liveEvidencePath,
        '--require-live-complete',
      ], { cwd: process.cwd() }),
      (error: unknown) => {
        const failure = error as { code?: number, stdout?: string }
        assert.equal(failure.code, 2)
        const result = JSON.parse(failure.stdout ?? '{}')
        assert.equal(result.ok, false)
        assert.equal(result.audit.liveGateComplete, false)
        assert.equal(result.audit.overallStatus, 'live-check-pending')
        return true
      },
    )
  })
})

test('message awareness validation CLI require-live-complete passes complete live evidence', async () => {
  await withTempDirectory(async (directoryPath) => {
    const liveEvidencePath = path.join(directoryPath, 'message-awareness-live.json')
    await fs.writeFile(liveEvidencePath, JSON.stringify({
      checks: [
        {
          id: 'macos-notification-center-live',
          status: 'pass',
          observedAt: '2026-06-16T15:00:00-07:00',
          operator: 'Klein',
          notes: 'Real WeChat notification appeared once and did not replay.',
          evidence: {
            appName: 'WeChat',
            fullDiskAccessGranted: true,
            notificationObservedOnce: true,
            replayCheckedAfterRestart: true,
          },
        },
        {
          id: 'telegram-live-bridge',
          status: 'pass',
          observedAt: '2026-06-16T16:00:00Z',
          operator: 'Klein',
          notes: 'Owner Telegram DM paired, replied, queued while busy, and did not replay.',
          evidence: {
            pairingApproved: true,
            ownerTextReplyReturned: true,
            busyMessageQueuedOrRetried: true,
            reconnectReplayChecked: true,
            updateOffset: 401,
            lastOutboundAt: '2026-06-16T16:01:00Z',
            lastOutboundKind: 'text',
            lastOutboundTarget: 'telegram:123456',
            lastOutboundError: 'Telegram API 429 for telegram:123456',
          },
        },
        {
          id: 'discord-live-bridge',
          status: 'pass',
          observedAt: '2026-06-16T17:00:00Z',
          operator: 'Klein',
          notes: 'Allowed Discord target replied, suppressed echoes, and showed reconnect status.',
          evidence: {
            messageContentIntentEnabled: true,
            approvedChannelReplyReturned: true,
            botEchoSuppressed: true,
            reconnectStatusVisible: true,
            lastReconnectAt: '2026-06-16T17:02:00Z',
            lastReconnectReason: 'gateway_reconnect_requested',
            lastOutboundAt: '2026-06-16T17:03:00Z',
            lastOutboundKind: 'audio',
            lastOutboundTarget: 'discord:channel-private',
            lastOutboundError: 'Discord API 403 for discord:channel-private',
          },
        },
      ],
    }), 'utf8')

    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/validate-message-awareness.mjs',
      '--check-live-evidence',
      liveEvidencePath,
      '--require-live-complete',
    ], { cwd: process.cwd() })

    const result = JSON.parse(stdout)
    assert.equal(result.ok, true)
    assert.equal(result.audit.overallStatus, 'pass')
    assert.equal(result.audit.liveGateComplete, true)
    assert.equal(result.audit.passedCount, 3)
    assert.deepEqual(result.audit.pendingCheckIds, [])
  })
})

test('message awareness validation CLI explains a missing live evidence file', async () => {
  await withTempDirectory(async (directoryPath) => {
    const liveEvidencePath = path.join(directoryPath, 'missing-live.json')

    await assert.rejects(
      execFileAsync(process.execPath, [
        'scripts/validate-message-awareness.mjs',
        '--check-live-evidence',
        liveEvidencePath,
        '--require-live-complete',
      ], { cwd: process.cwd() }),
      (error: unknown) => {
        const failure = error as { stderr?: string }
        assert.match(failure.stderr ?? '', /Live evidence file is missing/)
        assert.match(failure.stderr ?? '', /Create the live evidence template first/)
        return true
      },
    )
  })
})

test('message awareness validation CLI require-release-complete rejects incomplete gate evidence', async () => {
  await withTempDirectory(async (directoryPath) => {
    const evidencePath = path.join(directoryPath, 'message-awareness-complete.json')
    await fs.writeFile(evidencePath, JSON.stringify(buildMessageAwarenessEvidence({
      mode: 'local-webhook',
      payload: {
        kind: 'message',
        source: 'Nexus Validation',
        text: 'probe',
      },
      response: { ok: true },
    })), 'utf8')

    await assert.rejects(
      execFileAsync(process.execPath, [
        'scripts/validate-message-awareness.mjs',
        '--check-evidence-file',
        evidencePath,
        '--require-release-complete',
      ], { cwd: process.cwd() }),
      (error: unknown) => {
        const failure = error as { code?: number, stdout?: string }
        assert.equal(failure.code, 2)
        const result = JSON.parse(failure.stdout ?? '{}')
        assert.equal(result.ok, false)
        assert.equal(result.audit.releaseGateComplete, false)
        assert.equal(result.audit.overallStatus, 'live-check-pending')
        return true
      },
    )
  })
})

test('message awareness validation CLI explains a missing release evidence file', async () => {
  await withTempDirectory(async (directoryPath) => {
    const evidencePath = path.join(directoryPath, 'missing-complete.json')

    await assert.rejects(
      execFileAsync(process.execPath, [
        'scripts/validate-message-awareness.mjs',
        '--check-evidence-file',
        evidencePath,
        '--require-release-complete',
      ], { cwd: process.cwd() }),
      (error: unknown) => {
        const failure = error as { stderr?: string }
        assert.match(failure.stderr ?? '', /Release evidence file is missing/)
        assert.match(failure.stderr ?? '', /before running the release gate again/)
        return true
      },
    )
  })
})

test('message awareness validation CLI require-release-complete passes complete gate evidence', async () => {
  await withTempDirectory(async (directoryPath) => {
    const evidencePath = path.join(directoryPath, 'message-awareness-complete.json')
    await fs.writeFile(evidencePath, JSON.stringify(buildMessageAwarenessEvidence({
      mode: 'local-webhook',
      payload: {
        kind: 'message',
        source: 'Nexus Validation',
        text: 'probe',
      },
      response: { ok: true },
      liveEvidenceChecks: normalizeLiveEvidenceChecks([
        {
          id: 'macos-notification-center-live',
          status: 'pass',
          observedAt: '2026-06-16T15:00:00Z',
          operator: 'Klein',
          notes: 'Real WeChat notification appeared once and did not replay.',
          evidence: {
            appName: 'WeChat',
            fullDiskAccessGranted: true,
            notificationObservedOnce: true,
            replayCheckedAfterRestart: true,
          },
        },
        {
          id: 'telegram-live-bridge',
          status: 'pass',
          observedAt: '2026-06-16T16:00:00Z',
          operator: 'Klein',
          notes: 'Owner Telegram DM paired, replied, queued while busy, and did not replay.',
          evidence: {
            pairingApproved: true,
            ownerTextReplyReturned: true,
            busyMessageQueuedOrRetried: true,
            reconnectReplayChecked: true,
            updateOffset: 401,
            lastOutboundAt: '2026-06-16T16:01:00Z',
            lastOutboundKind: 'text',
            lastOutboundTarget: 'telegram:123456',
            lastOutboundError: 'Telegram API 429 for telegram:123456',
          },
        },
        {
          id: 'discord-live-bridge',
          status: 'pass',
          observedAt: '2026-06-16T17:00:00Z',
          operator: 'Klein',
          notes: 'Allowed Discord target replied, suppressed echoes, and showed reconnect status.',
          evidence: {
            messageContentIntentEnabled: true,
            approvedChannelReplyReturned: true,
            botEchoSuppressed: true,
            reconnectStatusVisible: true,
            lastReconnectAt: '2026-06-16T17:02:00Z',
            lastReconnectReason: 'gateway_reconnect_requested',
            lastOutboundAt: '2026-06-16T17:03:00Z',
            lastOutboundKind: 'audio',
            lastOutboundTarget: 'discord:channel-private',
            lastOutboundError: 'Discord API 403 for discord:channel-private',
          },
        },
      ]),
    })), 'utf8')

    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/validate-message-awareness.mjs',
      '--check-evidence-file',
      evidencePath,
      '--require-release-complete',
    ], { cwd: process.cwd() })

    const result = JSON.parse(stdout)
    assert.equal(result.ok, true)
    assert.equal(result.audit.releaseGateComplete, true)
    assert.equal(result.audit.overallStatus, 'pass')
    assert.equal(result.audit.liveEvidence.passedCount, 3)
  })
})

test('message awareness validation CLI refuses to write redacted release evidence before the gate is complete', async () => {
  await withTempDirectory(async (directoryPath) => {
    const evidencePath = path.join(directoryPath, 'message-awareness-incomplete.json')
    const redactedPath = path.join(directoryPath, 'release-evidence', 'v0.3.4-message-awareness.json')
    await fs.writeFile(evidencePath, JSON.stringify(buildMessageAwarenessEvidence({
      mode: 'local-webhook',
      payload: {
        kind: 'message',
        source: 'Nexus Validation',
        text: 'probe',
      },
      response: { ok: true },
    })), 'utf8')

    await assert.rejects(
      execFileAsync(process.execPath, [
        'scripts/validate-message-awareness.mjs',
        '--redact-evidence-file',
        evidencePath,
        '--redacted-output-file',
        redactedPath,
      ], { cwd: process.cwd() }),
      (error: unknown) => {
        const failure = error as { stderr?: string, code?: number }
        assert.equal(failure.code, 1)
        assert.match(failure.stderr ?? '', /Cannot write redacted release evidence until the release gate is complete/)
        assert.match(failure.stderr ?? '', /pending=macos-notification-center-live, telegram-live-bridge, discord-live-bridge/)
        return true
      },
    )

    await assert.rejects(
      fs.access(redactedPath),
      /ENOENT/,
    )
  })
})

test('message awareness validation CLI writes redacted release evidence that still passes the gate', async () => {
  await withTempDirectory(async (directoryPath) => {
    const evidencePath = path.join(directoryPath, 'message-awareness-complete-private.json')
    const redactedPath = path.join(directoryPath, 'release-evidence', 'v0.3.4-message-awareness.json')
    await fs.writeFile(evidencePath, JSON.stringify(buildMessageAwarenessEvidence({
      mode: 'local-webhook',
      payload: {
        kind: 'message',
        source: 'Telegram',
        sender: 'Private Sender',
        chatTitle: 'Private Room',
        conversationId: 'telegram:123456',
        messageId: 'telegram:msg-1',
        text: 'private live message content',
      },
      response: { ok: true, id: 'evt-private-1' },
      liveEvidenceChecks: normalizeLiveEvidenceChecks([
        {
          id: 'macos-notification-center-live',
          status: 'pass',
          observedAt: '2026-06-16T15:00:00Z',
          operator: 'Klein',
          notes: 'Private notification text appeared once.',
          evidence: {
            appName: 'WeChat',
            fullDiskAccessGranted: true,
            notificationObservedOnce: true,
            replayCheckedAfterRestart: true,
          },
        },
        {
          id: 'telegram-live-bridge',
          status: 'pass',
          observedAt: '2026-06-16T16:00:00Z',
          operator: 'Klein',
          notes: 'Private Telegram DM replied.',
          evidence: {
            pairingApproved: true,
            ownerTextReplyReturned: true,
            busyMessageQueuedOrRetried: true,
            reconnectReplayChecked: true,
            updateOffset: 401,
            lastOutboundAt: '2026-06-16T16:01:00Z',
            lastOutboundKind: 'text',
            lastOutboundTarget: 'telegram:123456',
            lastOutboundError: 'Telegram API 429 for telegram:123456',
          },
        },
        {
          id: 'discord-live-bridge',
          status: 'pass',
          observedAt: '2026-06-16T17:00:00Z',
          operator: 'Klein',
          notes: 'Private Discord channel replied.',
          evidence: {
            messageContentIntentEnabled: true,
            approvedChannelReplyReturned: true,
            botEchoSuppressed: true,
            reconnectStatusVisible: true,
            lastReconnectAt: '2026-06-16T17:02:00Z',
            lastReconnectReason: 'gateway_reconnect_requested',
            lastOutboundAt: '2026-06-16T17:03:00Z',
            lastOutboundKind: 'audio',
            lastOutboundTarget: 'discord:channel-private',
            lastOutboundError: 'Discord API 403 for discord:channel-private',
          },
        },
      ]),
    })), 'utf8')

    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/validate-message-awareness.mjs',
      '--redact-evidence-file',
      evidencePath,
      '--redacted-output-file',
      redactedPath,
    ], { cwd: process.cwd() })

    const result = JSON.parse(stdout)
    const redacted = JSON.parse(await fs.readFile(redactedPath, 'utf8'))
    assert.equal(result.ok, true)
    assert.equal(result.audit.releaseGateComplete, true)
    assert.equal(redacted.redacted, true)
    assert.equal(redacted.checks[0]?.evidence.payload.redacted, true)
    assert.equal(redacted.checks[0]?.evidence.payload.text, undefined)
    assert.deepEqual(redacted.checks[0]?.evidence.response, { redacted: true, ok: true })
    const telegramCheck = redacted.checks.find((check) => check.id === 'telegram-live-bridge')
    const discordCheck = redacted.checks.find((check) => check.id === 'discord-live-bridge')
    assert.equal(telegramCheck?.evidence.lastOutboundAt, '2026-06-16T16:01:00.000Z')
    assert.equal(telegramCheck?.evidence.lastOutboundKind, 'text')
    assert.equal(telegramCheck?.evidence.lastOutboundTarget, 'redacted')
    assert.equal(telegramCheck?.evidence.lastOutboundError, 'redacted')
    assert.equal(discordCheck?.evidence.lastOutboundAt, '2026-06-16T17:03:00.000Z')
    assert.equal(discordCheck?.evidence.lastOutboundKind, 'audio')
    assert.equal(discordCheck?.evidence.lastOutboundTarget, 'redacted')
    assert.equal(discordCheck?.evidence.lastOutboundError, 'redacted')
    assert.doesNotMatch(
      JSON.stringify(redacted),
      /private live message content|evt-private-1|Private Sender|Private Room|telegram:123456|discord:channel-private|Klein/,
    )

    const checked = await execFileAsync(process.execPath, [
      'scripts/validate-message-awareness.mjs',
      '--check-evidence-file',
      redactedPath,
      '--require-release-complete',
    ], { cwd: process.cwd() })
    assert.equal(JSON.parse(checked.stdout).audit.releaseGateComplete, true)
  })
})

test('message awareness validation CLI records a passing macOS live check', async () => {
  await withTempDirectory(async (directoryPath) => {
    const liveEvidencePath = path.join(directoryPath, 'message-awareness-live.json')

    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/validate-message-awareness.mjs',
      '--record-live-check',
      'macos-notification-center-live',
      '--live-evidence-file',
      liveEvidencePath,
      '--observed-at',
      '2026-06-16T15:00:00-07:00',
      '--operator',
      'Klein',
      '--app-name',
      'WeChat',
      '--full-disk-access-granted',
      '--notification-observed-once',
      '--replay-checked-after-restart',
      '--note',
      'One real WeChat notification appeared once in Nexus.',
    ], { cwd: process.cwd() })

    const stdoutResult = JSON.parse(stdout)
    const fileResult = JSON.parse(await fs.readFile(liveEvidencePath, 'utf8'))
    const macosCheck = fileResult.checks.find((check) => check.id === 'macos-notification-center-live')
    assert.equal(stdoutResult.check.status, 'pass')
    assert.equal(macosCheck.status, 'pass')
    assert.equal(macosCheck.observedAt, '2026-06-16T22:00:00.000Z')
    assert.equal(macosCheck.operator, 'Klein')
    assert.equal(macosCheck.evidence.appName, 'WeChat')
    assert.equal(macosCheck.evidence.fullDiskAccessGranted, true)
    assert.deepEqual(macosCheck.notes, ['One real WeChat notification appeared once in Nexus.'])
    assert.equal(normalizeLiveEvidenceChecks(fileResult).find((check) => check.id === 'macos-notification-center-live')?.status, 'pass')
  })
})

test('message awareness live recorder CLI records a passing Discord check', async () => {
  await withTempDirectory(async (directoryPath) => {
    const liveEvidencePath = path.join(directoryPath, 'message-awareness-live.json')

    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/record-message-awareness-live-evidence.mjs',
      'discord',
      '--live-evidence-file',
      liveEvidencePath,
      '--observed-at',
      '2026-06-16T17:00:00Z',
      '--operator',
      'Klein',
      '--message-content-intent-enabled',
      '--approved-channel-reply-returned',
      '--bot-echo-suppressed',
      '--reconnect-status-visible',
      '--last-reconnect-at',
      '2026-06-16T17:02:00Z',
      '--last-reconnect-reason',
      'gateway_reconnect_requested',
      '--last-outbound-at',
      '2026-06-16T17:03:00Z',
      '--last-outbound-kind',
      'audio',
      '--last-outbound-target',
      'channel-1',
      '--last-outbound-error',
      'Discord API 403: missing permissions',
      '--note',
      'Allowed Discord channel replied once, ignored bot echoes, and exposed reconnect status.',
    ], { cwd: process.cwd() })

    const stdoutResult = JSON.parse(stdout)
    const fileResult = JSON.parse(await fs.readFile(liveEvidencePath, 'utf8'))
    const discordCheck = fileResult.checks.find((check) => check.id === 'discord-live-bridge')
    assert.equal(stdoutResult.check.status, 'pass')
    assert.equal(discordCheck.status, 'pass')
    assert.equal(discordCheck.observedAt, '2026-06-16T17:00:00.000Z')
    assert.equal(discordCheck.operator, 'Klein')
    assert.equal(discordCheck.evidence.messageContentIntentEnabled, true)
    assert.equal(discordCheck.evidence.approvedChannelReplyReturned, true)
    assert.equal(discordCheck.evidence.botEchoSuppressed, true)
    assert.equal(discordCheck.evidence.reconnectStatusVisible, true)
    assert.equal(discordCheck.evidence.lastReconnectAt, '2026-06-16T17:02:00.000Z')
    assert.equal(discordCheck.evidence.lastReconnectReason, 'gateway_reconnect_requested')
    assert.equal(discordCheck.evidence.lastOutboundAt, '2026-06-16T17:03:00.000Z')
    assert.equal(discordCheck.evidence.lastOutboundKind, 'audio')
    assert.equal(discordCheck.evidence.lastOutboundTarget, 'channel-1')
    assert.equal(discordCheck.evidence.lastOutboundError, 'Discord API 403: missing permissions')
    assert.deepEqual(discordCheck.notes, [
      'Allowed Discord channel replied once, ignored bot echoes, and exposed reconnect status.',
    ])
    assert.equal(normalizeLiveEvidenceChecks(fileResult).find((check) => check.id === 'discord-live-bridge')?.status, 'pass')
  })
})

test('message awareness validation CLI records a failed Telegram live check with notes', async () => {
  await withTempDirectory(async (directoryPath) => {
    const liveEvidencePath = path.join(directoryPath, 'message-awareness-live.json')

    await execFileAsync(process.execPath, [
      'scripts/validate-message-awareness.mjs',
      '--record-live-check',
      'telegram-live-bridge',
      '--live-status',
      'fail',
      '--live-evidence-file',
      liveEvidencePath,
      '--observed-at',
      '2026-06-16T16:00:00Z',
      '--note',
      'Owner reply did not return to Telegram.',
    ], { cwd: process.cwd() })

    const fileResult = JSON.parse(await fs.readFile(liveEvidencePath, 'utf8'))
    const telegramCheck = fileResult.checks.find((check) => check.id === 'telegram-live-bridge')
    assert.equal(telegramCheck.status, 'fail')
    assert.deepEqual(telegramCheck.notes, ['Owner reply did not return to Telegram.'])
    assert.equal(normalizeLiveEvidenceChecks(fileResult).find((check) => check.id === 'telegram-live-bridge')?.status, 'fail')
  })
})

test('message awareness validation CLI rejects passing records that lack required proof fields', async () => {
  await withTempDirectory(async (directoryPath) => {
    const liveEvidencePath = path.join(directoryPath, 'message-awareness-live.json')

    await assert.rejects(
      execFileAsync(process.execPath, [
        'scripts/validate-message-awareness.mjs',
        '--record-live-check',
        'telegram-live-bridge',
        '--live-evidence-file',
        liveEvidencePath,
        '--pairing-approved',
      ], { cwd: process.cwd() }),
      (error: unknown) => {
        const stderr = (error as { stderr?: string }).stderr ?? ''
        assert.match(stderr, /cannot pass without/)
        assert.match(stderr, /ownerTextReplyReturned/)
        return true
      },
    )
  })
})

test('message awareness live recorder rejects copied placeholder proof values', async () => {
  await withTempDirectory(async (directoryPath) => {
    const liveEvidencePath = path.join(directoryPath, 'message-awareness-live.json')

    await assert.rejects(
      execFileAsync(process.execPath, [
        'scripts/record-message-awareness-live-evidence.mjs',
        'macos',
        '--live-evidence-file',
        liveEvidencePath,
        '--operator',
        'REPLACE_WITH_OPERATOR',
        '--app-name',
        'REPLACE_WITH_REAL_APP',
        '--full-disk-access-granted',
        '--notification-observed-once',
        '--replay-checked-after-restart',
        '--note',
        'One real app notification appeared once in Nexus after Full Disk Access and did not replay after restart.',
      ], { cwd: process.cwd() }),
      (error: unknown) => {
        const stderr = (error as { stderr?: string }).stderr ?? ''
        assert.match(stderr, /cannot pass without/)
        assert.match(stderr, /operator/)
        assert.match(stderr, /appName/)
        return true
      },
    )

    await assert.rejects(
      fs.access(liveEvidencePath),
      /ENOENT/,
    )
  })
})

test('message awareness live recorder rejects malformed diagnostics fields', async () => {
  await withTempDirectory(async (directoryPath) => {
    const liveEvidencePath = path.join(directoryPath, 'message-awareness-live.json')

    await assert.rejects(
      execFileAsync(process.execPath, [
        'scripts/record-message-awareness-live-evidence.mjs',
        'telegram',
        '--live-evidence-file',
        liveEvidencePath,
        '--pairing-approved',
        '--owner-text-reply-returned',
        '--busy-message-queued-or-retried',
        '--reconnect-replay-checked',
        '--update-offset',
        'not-a-number',
      ], { cwd: process.cwd() }),
      /Invalid telegram-live-bridge\.updateOffset/,
    )

    await assert.rejects(
      execFileAsync(process.execPath, [
        'scripts/record-message-awareness-live-evidence.mjs',
        'telegram',
        '--live-evidence-file',
        liveEvidencePath,
        '--pairing-approved',
        '--owner-text-reply-returned',
        '--busy-message-queued-or-retried',
        '--reconnect-replay-checked',
        '--last-outbound-at',
        'not-a-date',
      ], { cwd: process.cwd() }),
      /Invalid telegram-live-bridge\.lastOutboundAt/,
    )
  })
})

test('message awareness validation CLI rejects failed records without notes', async () => {
  await withTempDirectory(async (directoryPath) => {
    const liveEvidencePath = path.join(directoryPath, 'message-awareness-live.json')

    await assert.rejects(
      execFileAsync(process.execPath, [
        'scripts/validate-message-awareness.mjs',
        '--record-live-check',
        'discord-live-bridge',
        '--live-status',
        'fail',
        '--live-evidence-file',
        liveEvidencePath,
      ], { cwd: process.cwd() }),
      /failed but has no notes/,
    )
  })
})

test('macOS shortcuts adapter forwards arguments to the message webhook cli', async () => {
  const { stdout } = await execFileAsync('bash', [
    'scripts/communication-adapters/macos-shortcuts-message.sh',
    '--source',
    '微信',
    '--sender',
    '张三',
    '--chat-title',
    '项目群',
    '--conversation-id',
    'room-3',
    '--message-id',
    'msg-3',
    '--text',
    '稍后开会',
    '--dry-run',
  ], { cwd: process.cwd() })

  const payload = JSON.parse(stdout)
  assert.equal(payload.kind, 'message')
  assert.equal(payload.source, '微信')
  assert.equal(payload.sender, '张三')
  assert.equal(payload.chatTitle, '项目群')
  assert.equal(payload.conversationId, 'room-3')
  assert.equal(payload.messageId, 'msg-3')
  assert.equal(payload.text, '稍后开会')
})

test('macOS notification center watcher parses watch options', () => {
  const options = parseMacNotificationWatchArgs([
    '--db',
    '/tmp/notifications.db',
    '--apps=微信|Telegram',
    '--poll-ms',
    '1500',
    '--limit',
    '20',
    '--once',
    '--dry-run',
  ])

  assert.equal(options.db, '/tmp/notifications.db')
  assert.equal(options.apps, '微信|Telegram')
  assert.equal(options.pollMs, 1500)
  assert.equal(options.limit, 20)
  assert.equal(options.once, true)
  assert.equal(options.dryRun, true)
})

test('macOS notification center watcher extracts message strings from blob data', () => {
  const utf8Hex = Buffer.from('Telegram\0Alice\0hello', 'utf8').toString('hex')
  const utf16Hex = Buffer.from('微信\0张三\0晚上同步一下', 'utf16le').toString('hex')

  assert.ok(extractStringsFromBlobHex(utf8Hex).some((value) => value.includes('Telegram')))
  assert.ok(extractStringsFromBlobHex(utf16Hex).some((value) => value.includes('晚上同步一下')))
})

test('macOS notification center watcher filters and normalizes chat notifications', () => {
  const messages = filterNewNotificationMessages([
    {
      __rowid: 2,
      id: 'noise-1',
      source: 'com.apple.Safari',
      title: 'News',
      subtitle: '',
      body: 'not a chat message',
    },
    {
      __rowid: 1,
      id: 'wx-1',
      source: 'com.tencent.xinWeChat',
      title: '项目群',
      subtitle: '张三',
      body: '晚上同步一下',
    },
  ], {
    pattern: '微信|WeChat|com.tencent',
    seenKeys: new Set(['com.tencent.xinWeChat:old']),
  })

  assert.equal(messages.length, 1)
  assert.equal(messages[0]?.source, 'com.tencent.xinWeChat')
  assert.equal(messages[0]?.sender, '张三')
  assert.equal(messages[0]?.chatTitle, '项目群')
  assert.equal(messages[0]?.text, '晚上同步一下')
  assert.equal(messages[0]?.conversationId, 'com.tencent.xinWeChat:项目群')
  assert.equal(messages[0]?.messageId, 'com.tencent.xinWeChat:wx-1')
})

test('macOS notification center watcher dry-runs one poll and persists dedupe state', async () => {
  await withTempDirectory(async (directoryPath) => {
    const fakeSqlitePath = path.join(directoryPath, 'fake-sqlite.mjs')
    const stateFile = path.join(directoryPath, 'seen.json')
    const dbPath = path.join(directoryPath, 'notifications.db')

    await fs.writeFile(fakeSqlitePath, [
      '#!/usr/bin/env node',
      "const sql = process.argv.at(-1) || ''",
      "if (sql.includes('sqlite_master')) {",
      "  console.log(JSON.stringify([{ name: 'notifications' }]))",
      "} else if (sql.includes('PRAGMA table_info')) {",
      "  console.log(JSON.stringify(['id', 'source', 'title', 'subtitle', 'body', 'delivered_at'].map((name, cid) => ({ cid, name }))))",
      '} else {',
      '  console.log(JSON.stringify([',
      "    { __rowid: 2, id: 'noise-1', source: 'com.apple.Safari', title: 'News', subtitle: '', body: 'not a chat message', delivered_at: 1 },",
      "    { __rowid: 1, id: 'wx-1', source: 'com.tencent.xinWeChat', title: '项目群', subtitle: '张三', body: '晚上同步一下', delivered_at: 2 },",
      '  ]))',
      '}',
      '',
    ].join('\n'))
    await fs.chmod(fakeSqlitePath, 0o755)
    await fs.writeFile(dbPath, '')

    const args = [
      'scripts/communication-adapters/macos-notification-center-watch.mjs',
      '--db',
      dbPath,
      '--sqlite',
      fakeSqlitePath,
      '--state-file',
      stateFile,
      '--apps',
      '微信|WeChat|com.tencent',
      '--once',
      '--dry-run',
    ]

    const firstRun = await execFileAsync(process.execPath, args, { cwd: process.cwd() })
    const firstPayloads = firstRun.stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))

    assert.equal(firstPayloads.length, 1)
    assert.equal(firstPayloads[0].kind, 'message')
    assert.equal(firstPayloads[0].source, 'com.tencent.xinWeChat')
    assert.equal(firstPayloads[0].sender, '张三')
    assert.equal(firstPayloads[0].chatTitle, '项目群')
    assert.equal(firstPayloads[0].text, '晚上同步一下')

    const secondRun = await execFileAsync(process.execPath, args, { cwd: process.cwd() })
    assert.equal(secondRun.stdout.trim(), '')

    const state = JSON.parse(await fs.readFile(stateFile, 'utf8'))
    assert.ok(state.seen.includes('com.tencent.xinWeChat:wx-1'))
  })
})

test('macOS notification center watcher explains Notification Center privacy denial', async () => {
  await withTempDirectory(async (directoryPath) => {
    const fakeSqlitePath = path.join(directoryPath, 'fake-sqlite-denied.mjs')
    const dbPath = path.join(
      directoryPath,
      'Library',
      'Group Containers',
      'group.com.apple.usernoted',
      'db2',
      'db',
    )

    await fs.mkdir(path.dirname(dbPath), { recursive: true })
    await fs.writeFile(dbPath, '')
    await fs.writeFile(fakeSqlitePath, [
      '#!/usr/bin/env node',
      "console.error('Error: unable to open database: authorization denied')",
      'process.exit(1)',
      '',
    ].join('\n'))
    await fs.chmod(fakeSqlitePath, 0o755)

    const args = [
      'scripts/communication-adapters/macos-notification-center-watch.mjs',
      '--db',
      dbPath,
      '--sqlite',
      fakeSqlitePath,
      '--once',
      '--dry-run',
    ]

    await assert.rejects(
      execFileAsync(process.execPath, args, { cwd: process.cwd() }),
      (error: unknown) => {
        const stderr = (error as { stderr?: string }).stderr ?? ''
        assert.match(stderr, /Full Disk Access/)
        assert.match(stderr, /Terminal, Codex, or the automation host/)
        assert.match(stderr, /authorization denied/)
        return true
      },
    )
  })
})

test('package config ships message webhook cli and adapters', async () => {
  const pkg = JSON.parse(await fs.readFile('package.json', 'utf8')) as {
    scripts?: Record<string, string>
    build?: {
      files?: string[]
      asarUnpack?: string[]
    }
  }

  assert.equal(pkg.scripts?.['message:send'], 'node scripts/send-message-webhook.mjs')
  assert.equal(pkg.scripts?.['message:smoke:local'], 'node scripts/message-awareness-local-smoke.mjs')
  assert.equal(pkg.scripts?.['message:validate'], 'node scripts/validate-message-awareness.mjs')
  assert.equal(pkg.scripts?.['message:preflight:live'], 'node scripts/message-awareness-live-preflight.mjs')
  assert.equal(pkg.scripts?.['message:probe:macos'], 'node scripts/message-awareness-macos-live-probe.mjs')
  assert.equal(pkg.scripts?.['message:live:record'], 'node scripts/record-message-awareness-live-evidence.mjs')
  assert.equal(
    pkg.scripts?.['message:live:template'],
    'node scripts/validate-message-awareness.mjs --write-live-template artifacts/v0.3.4/message-awareness-live.json',
  )
  assert.equal(
    pkg.scripts?.['message:gate:live'],
    'node scripts/validate-message-awareness.mjs --check-live-evidence artifacts/v0.3.4/message-awareness-live.json --require-live-complete',
  )
  assert.equal(pkg.scripts?.['message:status:release'], 'node scripts/message-awareness-release-status.mjs')
  assert.equal(
    pkg.scripts?.['message:merge:release'],
    'node scripts/validate-message-awareness.mjs --merge-evidence-file artifacts/v0.3.4/message-awareness-local.json --live-evidence-file artifacts/v0.3.4/message-awareness-live.json --evidence-file artifacts/v0.3.4/message-awareness-complete.json',
  )
  assert.equal(
    pkg.scripts?.['message:gate:release'],
    'node scripts/validate-message-awareness.mjs --check-evidence-file artifacts/v0.3.4/message-awareness-complete.json --require-release-complete',
  )
  assert.equal(
    pkg.scripts?.['message:release:redact'],
    'node scripts/validate-message-awareness.mjs --redact-evidence-file artifacts/v0.3.4/message-awareness-complete.json --redacted-output-file docs/release-evidence/v0.3.4-message-awareness.json',
  )
  assert.equal(
    pkg.scripts?.['v04:message:smoke:local'],
    'node scripts/message-awareness-local-smoke.mjs --evidence-file artifacts/v0.4.0/message-awareness-local.json',
  )
  assert.equal(
    pkg.scripts?.['v04:message:preflight:live'],
    'node scripts/message-awareness-live-preflight.mjs --output artifacts/v0.4.0/message-awareness-live-preflight.json',
  )
  assert.equal(
    pkg.scripts?.['v04:message:probe:macos'],
    'node scripts/message-awareness-macos-live-probe.mjs --output artifacts/v0.4.0/message-awareness-macos-live-probe.json',
  )
  assert.equal(
    pkg.scripts?.['v04:message:live:template'],
    'node scripts/validate-message-awareness.mjs --write-live-template artifacts/v0.4.0/message-awareness-live.json',
  )
  assert.equal(
    pkg.scripts?.['v04:message:live:record'],
    'node scripts/record-message-awareness-live-evidence.mjs --live-evidence-file artifacts/v0.4.0/message-awareness-live.json --macos-live-probe-file artifacts/v0.4.0/message-awareness-macos-live-probe.json --require-macos-live-probe-candidate --macos-live-probe-max-age-ms 1800000',
  )
  assert.equal(
    pkg.scripts?.['v04:message:gate:live'],
    'node scripts/validate-message-awareness.mjs --check-live-evidence artifacts/v0.4.0/message-awareness-live.json --require-live-complete',
  )
  assert.equal(
    pkg.scripts?.['v04:message:status:release'],
    'node scripts/message-awareness-release-status.mjs --local-evidence-file artifacts/v0.4.0/message-awareness-local.json --live-evidence-file artifacts/v0.4.0/message-awareness-live.json --complete-evidence-file artifacts/v0.4.0/message-awareness-complete.json --redacted-output-file docs/release-evidence/v0.4.0-message-awareness.json',
  )
  assert.equal(
    pkg.scripts?.['v04:message:merge:release'],
    'node scripts/validate-message-awareness.mjs --merge-evidence-file artifacts/v0.4.0/message-awareness-local.json --live-evidence-file artifacts/v0.4.0/message-awareness-live.json --evidence-file artifacts/v0.4.0/message-awareness-complete.json',
  )
  assert.equal(
    pkg.scripts?.['v04:message:gate:release'],
    'node scripts/validate-message-awareness.mjs --check-evidence-file artifacts/v0.4.0/message-awareness-complete.json --require-release-complete',
  )
  assert.equal(
    pkg.scripts?.['v04:message:release:redact'],
    'node scripts/validate-message-awareness.mjs --redact-evidence-file artifacts/v0.4.0/message-awareness-complete.json --redacted-output-file docs/release-evidence/v0.4.0-message-awareness.json',
  )
  assert.equal(pkg.scripts?.['v04:message:finalize'], 'node scripts/v04-message-release-finalize.mjs')
  assert.ok(pkg.build?.files?.includes('scripts/send-message-webhook.mjs'))
  assert.ok(pkg.build?.files?.includes('scripts/validate-message-awareness.mjs'))
  assert.ok(pkg.build?.files?.includes('scripts/message-awareness-local-smoke.mjs'))
  assert.ok(pkg.build?.files?.includes('scripts/message-awareness-live-preflight.mjs'))
  assert.ok(pkg.build?.files?.includes('scripts/message-awareness-macos-live-probe.mjs'))
  assert.ok(pkg.build?.files?.includes('scripts/record-message-awareness-live-evidence.mjs'))
  assert.ok(pkg.build?.files?.includes('scripts/message-awareness-release-status.mjs'))
  assert.ok(pkg.build?.files?.includes('scripts/v04-message-release-finalize.mjs'))
  assert.ok(pkg.build?.files?.includes('scripts/communication-adapters/**/*'))
  assert.ok(pkg.build?.asarUnpack?.includes('scripts/send-message-webhook.mjs'))
  assert.ok(pkg.build?.asarUnpack?.includes('scripts/validate-message-awareness.mjs'))
  assert.ok(pkg.build?.asarUnpack?.includes('scripts/message-awareness-local-smoke.mjs'))
  assert.ok(pkg.build?.asarUnpack?.includes('scripts/message-awareness-live-preflight.mjs'))
  assert.ok(pkg.build?.asarUnpack?.includes('scripts/message-awareness-macos-live-probe.mjs'))
  assert.ok(pkg.build?.asarUnpack?.includes('scripts/record-message-awareness-live-evidence.mjs'))
  assert.ok(pkg.build?.asarUnpack?.includes('scripts/message-awareness-release-status.mjs'))
  assert.ok(pkg.build?.asarUnpack?.includes('scripts/v04-message-release-finalize.mjs'))
  assert.ok(pkg.build?.asarUnpack?.includes('scripts/communication-adapters/**/*'))
})

// ── In-app watcher additions ─────────────────────────────────────────────────

import {
  classifyMacWatcherError,
  DEFAULT_COMMUNICATION_APP_PATTERN,
  matchesCommunicationFilter,
} from '../scripts/communication-adapters/macos-notification-center-watch.mjs'

test('classifyMacWatcherError maps Full Disk Access denials to needs-permission', () => {
  assert.equal(classifyMacWatcherError('SQLITE_AUTH: authorization denied'), 'needs-permission')
  assert.equal(classifyMacWatcherError('EPERM: operation not permitted, open ...'), 'needs-permission')
  assert.equal(classifyMacWatcherError('unable to open database file'), 'needs-permission')
  assert.equal(classifyMacWatcherError('database disk image is malformed'), 'error')
  assert.equal(classifyMacWatcherError(undefined), 'error')
})

test('default communication pattern matches the major messengers', () => {
  for (const source of ['微信', 'WeChat', 'QQ', '钉钉', '飞书', 'Telegram', 'Slack', 'com.tencent.xinWeChat']) {
    assert.equal(
      matchesCommunicationFilter({ source, sender: 'x', chatTitle: 'x', text: 'hello' }, DEFAULT_COMMUNICATION_APP_PATTERN),
      true,
      `expected pattern to match ${source}`,
    )
  }
  assert.equal(
    matchesCommunicationFilter({ source: 'Finder', sender: '', chatTitle: '', text: 'disk ejected' }, DEFAULT_COMMUNICATION_APP_PATTERN),
    false,
  )
})
