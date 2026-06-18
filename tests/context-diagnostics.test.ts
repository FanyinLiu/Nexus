import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildDiscordLiveEvidenceRecordCommand,
  buildLiveEvidenceGateCommand,
  buildLiveEvidenceTemplateCommand,
  buildLocalWebhookSmokeCommand,
  buildMacOSLiveEvidenceRecordCommand,
  buildMessageAwarenessLiveEvidenceTemplate,
  buildReleaseEvidenceMergeCommand,
  buildReleaseEvidenceStatusCommand,
  buildReleaseEvidenceGateCommand,
  buildReleaseEvidenceRedactionCommand,
  buildTelegramLiveEvidenceRecordCommand,
  buildV04MessageBridgeTraceReport,
  buildWebhookValidationCommand,
  getContextDiagnosticStatusLabelKey,
  resolveContextDiagnosticsSummary,
} from '../src/features/context/contextDiagnostics.ts'
import { normalizeLiveEvidenceChecks } from '../scripts/validate-message-awareness.mjs'
import type { AppSettings, PlatformProfile } from '../src/types/app.ts'

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    autonomyNotificationsEnabled: false,
    clipboardContextEnabled: false,
    contextAwarenessEnabled: false,
    activeWindowContextEnabled: false,
    discordBotToken: '',
    discordIntegrationEnabled: false,
    macosMessageWatcherEnabled: false,
    screenContextEnabled: false,
    telegramBotToken: '',
    telegramIntegrationEnabled: false,
    ...overrides,
  } as AppSettings
}

function makePlatformProfile(
  overrides: Partial<PlatformProfile['desktopContext']> = {},
): Pick<PlatformProfile, 'desktopContext'> {
  return {
    desktopContext: {
      activeWindowSupported: true,
      activeWindowAvailable: true,
      activeWindowDependencyHint: null,
      clipboardSupported: true,
      clipboardAvailable: true,
      screenshotSupported: true,
      screenshotAvailable: true,
      screenshotDependencyHint: null,
      ...overrides,
    },
  }
}

test('context diagnostics reports all surfaces disabled by default', () => {
  const summary = resolveContextDiagnosticsSummary({
    settings: makeSettings(),
    platformProfile: makePlatformProfile(),
  })

  assert.equal(summary.readyCount, 0)
  assert.equal(summary.actionCount, 7)
  assert.equal(summary.items.every((item) => item.status === 'disabled'), true)
  const webhookActions = summary.items.find((item) => item.id === 'local_webhook')?.actions ?? []
  assert.equal(webhookActions.length, 8)
  assert.equal(webhookActions[0]?.labelKey, 'settings.console.context_diagnostics.action.local_webhook_smoke_command')
  assert.equal(webhookActions[0]?.command, 'npm run message:smoke:local')
  assert.equal(webhookActions[1]?.labelKey, 'settings.console.context_diagnostics.action.live_evidence_template')
  assert.equal(webhookActions[1]?.command, 'npm run message:live:template')
  assert.equal(webhookActions[2]?.labelKey, 'settings.console.context_diagnostics.action.live_evidence_template_preview')
  assert.equal(JSON.parse(webhookActions[2]?.command ?? '{}').checks.length, 3)
  assert.equal(webhookActions[3]?.command, 'npm run message:gate:live')
  assert.equal(webhookActions[4]?.command, 'npm run message:status:release')
  assert.equal(webhookActions[5]?.command, 'npm run message:merge:release')
  assert.equal(webhookActions[6]?.command, 'npm run message:gate:release')
  assert.equal(webhookActions[7]?.labelKey, 'settings.console.context_diagnostics.action.release_evidence_redaction')
  assert.equal(webhookActions[7]?.command, 'npm run message:release:redact')
})

test('context diagnostics separates ready desktop context from missing OS permission', () => {
  const summary = resolveContextDiagnosticsSummary({
    settings: makeSettings({
      contextAwarenessEnabled: true,
      activeWindowContextEnabled: true,
      clipboardContextEnabled: true,
      screenContextEnabled: true,
    }),
    platformProfile: makePlatformProfile({
      screenshotAvailable: false,
    }),
  })

  assert.equal(summary.items.find((item) => item.id === 'active_window')?.status, 'ready')
  assert.equal(summary.items.find((item) => item.id === 'clipboard')?.status, 'ready')
  assert.equal(summary.items.find((item) => item.id === 'screen_ocr')?.status, 'needs_permission')
})

test('context diagnostics surfaces live message-awareness readiness and gaps', () => {
  const summary = resolveContextDiagnosticsSummary({
    settings: makeSettings({
      autonomyNotificationsEnabled: true,
      macosMessageWatcherEnabled: true,
      telegramIntegrationEnabled: true,
      telegramBotToken: 'tg-token',
      discordIntegrationEnabled: true,
      discordBotToken: '',
    }),
    platformProfile: makePlatformProfile(),
    watcherStatus: {
      status: 'running',
      lastError: null,
      platformSupported: true,
      lastEventAt: '2026-06-16T10:00:00Z',
      lastEventSource: 'WeChat',
      lastEventId: 'msg-1',
    },
    webhookInfo: {
      url: 'http://127.0.0.1:47830/webhook',
      authHeader: 'Bearer nexus_token',
    },
    telegramStatus: {
      state: 'connected',
      botUsername: 'nexus_bot',
      lastError: null,
      lastSkipReason: 'unauthorized_sender:created',
      lastSkipAt: '2026-06-16T10:05:00Z',
    },
    discordStatus: {
      state: 'disconnected',
      botUsername: null,
      lastError: null,
    },
  })

  assert.equal(summary.items.find((item) => item.id === 'notification_center')?.status, 'ready')
  assert.equal(
    summary.items.find((item) => item.id === 'notification_center')?.actions?.[0]?.command,
    'npm run message:live:record -- macos --live-evidence-file artifacts/v0.3.4/message-awareness-live.json --observed-at "2026-06-16T10:00:00.000Z" --operator "REPLACE_WITH_OPERATOR" --app-name "WeChat" --full-disk-access-granted --notification-observed-once --replay-checked-after-restart --note "One real app notification appeared once in Nexus after Full Disk Access and did not replay after restart."',
  )
  assert.deepEqual(
    summary.items.find((item) => item.id === 'notification_center')?.traces?.map((trace) => trace.labelKey),
    [
      'settings.console.context_diagnostics.trace.last_event',
      'settings.console.context_diagnostics.trace.last_source',
    ],
  )
  assert.equal(summary.items.find((item) => item.id === 'local_webhook')?.status, 'configured')
  assert.equal(
    summary.items.find((item) => item.id === 'local_webhook')?.actions?.[0]?.command,
    'npm run message:smoke:local',
  )
  assert.equal(
    summary.items.find((item) => item.id === 'local_webhook')?.actions?.[1]?.command,
    'npm run message:validate -- --url "http://127.0.0.1:47830/webhook" --token "Bearer nexus_token" --evidence-file artifacts/v0.3.4/message-awareness-local.json',
  )
  const liveEvidenceTemplate = JSON.parse(
    summary.items.find((item) => item.id === 'local_webhook')?.actions?.[3]?.command ?? '',
  )
  assert.deepEqual(
    liveEvidenceTemplate.checks.map((check: { id: string }) => check.id),
    ['macos-notification-center-live', 'telegram-live-bridge', 'discord-live-bridge'],
  )
  assert.equal(liveEvidenceTemplate.checks[0]?.status, 'manual-required')
  assert.equal(liveEvidenceTemplate.checks[0]?.observedAt, '2026-06-16T10:00:00.000Z')
  assert.equal(liveEvidenceTemplate.checks[0]?.evidence.appName, 'WeChat')
  assert.equal(liveEvidenceTemplate.checks[0]?.evidence.notificationObservedOnce, false)
  assert.equal(normalizeLiveEvidenceChecks(liveEvidenceTemplate).length, 3)
  assert.equal(
    summary.items.find((item) => item.id === 'local_webhook')?.actions?.[4]?.command,
    'npm run message:gate:live',
  )
  assert.equal(
    summary.items.find((item) => item.id === 'local_webhook')?.actions?.[5]?.command,
    'npm run message:status:release',
  )
  assert.equal(
    summary.items.find((item) => item.id === 'local_webhook')?.actions?.[6]?.command,
    'npm run message:merge:release',
  )
  assert.equal(
    summary.items.find((item) => item.id === 'local_webhook')?.actions?.[7]?.command,
    'npm run message:gate:release',
  )
  assert.equal(
    summary.items.find((item) => item.id === 'local_webhook')?.actions?.[8]?.command,
    'npm run message:release:redact',
  )
  assert.equal(summary.items.find((item) => item.id === 'telegram')?.status, 'ready')
  assert.equal(
    summary.items.find((item) => item.id === 'telegram')?.actions?.[0]?.command,
    'npm run message:live:record -- telegram --live-evidence-file artifacts/v0.3.4/message-awareness-live.json --operator "REPLACE_WITH_OPERATOR" --pairing-approved --owner-text-reply-returned --busy-message-queued-or-retried --reconnect-replay-checked --note "Owner DM paired, replied, queued or retried while busy, and did not replay after reconnect."',
  )
  assert.equal(summary.items.find((item) => item.id === 'telegram')?.detailParams?.bot, 'nexus_bot')
  assert.equal(
    summary.items.find((item) => item.id === 'telegram')?.traces?.[0]?.labelKey,
    'settings.console.context_diagnostics.trace.last_skip',
  )
  assert.equal(summary.items.find((item) => item.id === 'discord')?.status, 'needs_setup')
  assert.equal(summary.items.find((item) => item.id === 'discord')?.actions, undefined)
})

test('context diagnostics live evidence template mirrors the strict release gate contract', () => {
  const template = JSON.parse(buildMessageAwarenessLiveEvidenceTemplate({
    telegramStatus: {
      state: 'connected',
      botUsername: 'nexus_bot',
      lastError: null,
      lastEventAt: '2026-06-16T11:00:00Z',
      updateOffset: 401,
      lastOutboundAt: '2026-06-16T11:03:00Z',
      lastOutboundKind: 'text',
      lastOutboundTarget: '42',
    },
  }))

  assert.equal(template.checks[1]?.id, 'telegram-live-bridge')
  assert.equal(template.checks[1]?.observedAt, '2026-06-16T11:00:00.000Z')
  assert.equal(template.checks[1]?.evidence.updateOffset, 401)
  assert.equal(template.checks[1]?.evidence.lastOutboundAt, '2026-06-16T11:03:00.000Z')
  assert.equal(template.checks[1]?.evidence.lastOutboundKind, 'text')
  assert.equal(template.checks[1]?.evidence.lastOutboundTarget, '42')
  assert.deepEqual(Object.keys(template.checks[1]?.evidence), [
    'updateOffset',
    'lastOutboundAt',
    'lastOutboundKind',
    'lastOutboundTarget',
    'pairingApproved',
    'ownerTextReplyReturned',
    'busyMessageQueuedOrRetried',
    'reconnectReplayChecked',
  ])
  assert.equal(normalizeLiveEvidenceChecks(template).every((check) => check.status === 'manual-required'), true)
})

test('context diagnostics builds v0.4 bridge trace without leaking gateway private fields', () => {
  const report = buildV04MessageBridgeTraceReport({
    telegramStatus: {
      state: 'connected',
      botUsername: 'private_bot',
      lastError: 'private token error',
      lastEventAt: '2026-06-16T11:00:00Z',
      lastEventSource: 'telegram-private-source',
      lastEventId: 'telegram-private-event',
      updateOffset: 401,
      lastOutboundAt: '2026-06-16T11:03:00Z',
      lastOutboundKind: 'text',
      lastOutboundTarget: 'telegram:private-chat-id',
      lastOutboundError: 'Telegram API 429 for telegram:private-chat-id',
    },
    discordStatus: {
      state: 'connected',
      botUsername: 'private_discord_bot',
      lastError: null,
      lastEventAt: '2026-06-16T12:00:00Z',
      lastEventSource: 'discord-private-source',
      lastEventId: 'discord-private-message',
      lastReconnectAt: '2026-06-16T12:05:00Z',
      lastReconnectReason: 'gateway_reconnect_requested',
      reconnectAttempt: 2,
      lastOutboundAt: '2026-06-16T12:03:00Z',
      lastOutboundKind: 'audio',
      lastOutboundTarget: 'discord:private-channel-id',
      lastOutboundError: 'Discord API 403 for discord:private-channel-id',
    },
  }, '2026-06-16T13:00:00Z')
  const json = JSON.stringify(report)

  assert.equal(report.gate, 'nexus-v04-message-bridge-trace')
  assert.equal(report.generatedAt, '2026-06-16T13:00:00.000Z')
  assert.equal(report.ok, true)
  assert.equal(report.telegram.lastEventAt, '2026-06-16T11:00:00.000Z')
  assert.equal(report.telegram.updateOffset, 401)
  assert.equal(report.telegram.lastOutboundAt, '2026-06-16T11:03:00.000Z')
  assert.equal(report.telegram.lastOutboundKind, 'text')
  assert.equal(report.telegram.lastOutboundTargetPresent, true)
  assert.equal(report.telegram.lastOutboundErrorPresent, true)
  assert.equal(report.discord.lastReconnectAt, '2026-06-16T12:05:00.000Z')
  assert.equal(report.discord.lastReconnectReason, 'gateway_reconnect_requested')
  assert.equal(report.discord.reconnectAttempt, 2)
  assert.equal(report.discord.lastOutboundTargetPresent, true)
  assert.equal(report.privacy.artifactContentsCopied, false)
  assert.doesNotMatch(
    json,
    /private_bot|private token error|telegram-private-source|telegram-private-event|telegram:private-chat-id|Telegram API 429|private_discord_bot|discord-private-source|discord-private-message|discord:private-channel-id|Discord API 403/,
  )
})

test('context diagnostics exposes copyable v0.4 bridge trace JSON when gateway trace is available', () => {
  const summary = resolveContextDiagnosticsSummary({
    settings: makeSettings({
      autonomyNotificationsEnabled: true,
      telegramIntegrationEnabled: true,
      telegramBotToken: 'telegram-token',
      discordIntegrationEnabled: true,
      discordBotToken: 'discord-token',
    }),
    platformProfile: makePlatformProfile(),
    telegramStatus: {
      state: 'connected',
      botUsername: 'nexus_bot',
      lastError: null,
      lastEventAt: '2026-06-16T11:00:00Z',
      updateOffset: 401,
      lastOutboundTarget: 'telegram:private-chat-id',
    },
    discordStatus: {
      state: 'connected',
      botUsername: 'nexus_discord',
      lastError: null,
      lastEventAt: '2026-06-16T12:00:00Z',
      lastReconnectAt: '2026-06-16T12:05:00Z',
      lastReconnectReason: 'gateway_reconnect_requested',
      lastOutboundError: 'Discord API 403 for discord:private-channel-id',
    },
  })
  const bridgeTraceAction = summary.items
    .find((item) => item.id === 'local_webhook')
    ?.actions
    ?.find((action) => action.labelKey === 'settings.console.context_diagnostics.action.v04_bridge_trace_json')
  const trace = JSON.parse(bridgeTraceAction?.command ?? '{}')

  assert.equal(bridgeTraceAction?.detailKey, 'settings.console.context_diagnostics.action.v04_bridge_trace_json_hint')
  assert.equal(trace.gate, 'nexus-v04-message-bridge-trace')
  assert.equal(trace.source, 'desktop-context-diagnostics')
  assert.equal(trace.telegram.updateOffset, 401)
  assert.equal(trace.telegram.lastOutboundTargetPresent, true)
  assert.equal(trace.discord.lastReconnectReason, 'gateway_reconnect_requested')
  assert.equal(trace.discord.lastOutboundErrorPresent, true)
  assert.doesNotMatch(
    bridgeTraceAction?.command ?? '',
    /telegram:private-chat-id|discord:private-channel-id|Discord API 403/,
  )
})

test('context diagnostics exposes gateway reconnect traces for live validation', () => {
  const summary = resolveContextDiagnosticsSummary({
    settings: makeSettings({
      discordIntegrationEnabled: true,
      discordBotToken: 'discord-token',
    }),
    platformProfile: makePlatformProfile(),
    discordStatus: {
      state: 'connected',
      botUsername: 'nexus_discord',
      lastError: null,
      lastReconnectAt: '2026-06-16T12:05:00Z',
      lastReconnectReason: 'gateway_reconnect_requested',
      reconnectAttempt: 2,
    },
  })
  const discord = summary.items.find((item) => item.id === 'discord')

  assert.equal(discord?.status, 'ready')
  assert.deepEqual(
    discord?.traces?.map((trace) => trace.labelKey),
    ['settings.console.context_diagnostics.trace.last_reconnect'],
  )
  assert.equal(
    discord?.traces?.[0]?.value,
    'gateway_reconnect_requested · 2026-06-16T12:05:00.000Z · attempt 2',
  )
})

test('context diagnostics exposes Telegram update offset as a no-replay checkpoint', () => {
  const summary = resolveContextDiagnosticsSummary({
    settings: makeSettings({
      telegramIntegrationEnabled: true,
      telegramBotToken: 'telegram-token',
    }),
    platformProfile: makePlatformProfile(),
    telegramStatus: {
      state: 'connected',
      botUsername: 'nexus_bot',
      lastError: null,
      updateOffset: 401,
    },
  })
  const telegram = summary.items.find((item) => item.id === 'telegram')

  assert.equal(telegram?.status, 'ready')
  assert.deepEqual(
    telegram?.traces?.map((trace) => trace.labelKey),
    ['settings.console.context_diagnostics.trace.last_checkpoint'],
  )
  assert.equal(telegram?.traces?.[0]?.value, 'update offset 401')
})

test('context diagnostics exposes outbound bridge reply traces for live validation', () => {
  const summary = resolveContextDiagnosticsSummary({
    settings: makeSettings({
      telegramIntegrationEnabled: true,
      telegramBotToken: 'telegram-token',
      discordIntegrationEnabled: true,
      discordBotToken: 'discord-token',
    }),
    platformProfile: makePlatformProfile(),
    telegramStatus: {
      state: 'connected',
      botUsername: 'nexus_bot',
      lastError: null,
      lastOutboundAt: '2026-06-16T11:03:00Z',
      lastOutboundTarget: '42',
      lastOutboundKind: 'text',
    },
    discordStatus: {
      state: 'connected',
      botUsername: 'nexus_discord',
      lastError: null,
      lastOutboundAt: '2026-06-16T12:03:00Z',
      lastOutboundTarget: 'channel-1',
      lastOutboundKind: 'audio',
      lastOutboundError: 'Discord API 403: missing permissions',
    },
  })
  const telegram = summary.items.find((item) => item.id === 'telegram')
  const discord = summary.items.find((item) => item.id === 'discord')

  assert.deepEqual(
    telegram?.traces?.map((trace) => trace.labelKey),
    ['settings.console.context_diagnostics.trace.last_outbound'],
  )
  assert.equal(telegram?.traces?.[0]?.value, 'text -> 42 · 2026-06-16T11:03:00.000Z')
  assert.equal(discord?.traces?.[0]?.labelKey, 'settings.console.context_diagnostics.trace.last_outbound')
  assert.equal(
    discord?.traces?.[0]?.value,
    'audio -> channel-1 · 2026-06-16T12:03:00.000Z · failed: Discord API 403: missing permissions',
  )
})

test('context diagnostics shell-quotes webhook validation command values', () => {
  const command = buildWebhookValidationCommand({
    url: 'http://127.0.0.1:47830/webhook?name="$probe"',
    authHeader: 'Bearer nexus_$token',
  })

  assert.equal(
    command,
    'npm run message:validate -- --url "http://127.0.0.1:47830/webhook?name=\\"\\$probe\\"" --token "Bearer nexus_\\$token" --evidence-file artifacts/v0.3.4/message-awareness-local.json',
  )
})

test('context diagnostics exposes fixed message-awareness gate commands', () => {
  assert.equal(buildLocalWebhookSmokeCommand(), 'npm run message:smoke:local')
  assert.equal(buildLiveEvidenceTemplateCommand(), 'npm run message:live:template')
  assert.equal(buildLiveEvidenceGateCommand(), 'npm run message:gate:live')
  assert.equal(buildReleaseEvidenceStatusCommand(), 'npm run message:status:release')
  assert.equal(buildReleaseEvidenceMergeCommand(), 'npm run message:merge:release')
  assert.equal(buildReleaseEvidenceGateCommand(), 'npm run message:gate:release')
  assert.equal(buildReleaseEvidenceRedactionCommand(), 'npm run message:release:redact')
})

test('context diagnostics exposes strict live evidence record commands', () => {
  assert.equal(
    buildMacOSLiveEvidenceRecordCommand({
      status: 'running',
      lastError: null,
      platformSupported: true,
      lastEventAt: '2026-06-16T10:00:00Z',
      lastEventSource: 'WeChat',
    }),
    'npm run message:live:record -- macos --live-evidence-file artifacts/v0.3.4/message-awareness-live.json --observed-at "2026-06-16T10:00:00.000Z" --operator "REPLACE_WITH_OPERATOR" --app-name "WeChat" --full-disk-access-granted --notification-observed-once --replay-checked-after-restart --note "One real app notification appeared once in Nexus after Full Disk Access and did not replay after restart."',
  )
  assert.equal(
    buildMacOSLiveEvidenceRecordCommand(),
    'npm run message:live:record -- macos --live-evidence-file artifacts/v0.3.4/message-awareness-live.json --operator "REPLACE_WITH_OPERATOR" --app-name "REPLACE_WITH_REAL_APP" --full-disk-access-granted --notification-observed-once --replay-checked-after-restart --note "One real app notification appeared once in Nexus after Full Disk Access and did not replay after restart."',
  )
  assert.equal(
    buildTelegramLiveEvidenceRecordCommand({
      state: 'connected',
      botUsername: 'nexus_bot',
      lastError: null,
      lastEventAt: '2026-06-16T11:00:00Z',
      updateOffset: 401,
      lastOutboundAt: '2026-06-16T11:03:00Z',
      lastOutboundKind: 'text',
      lastOutboundTarget: '42',
    }),
    'npm run message:live:record -- telegram --live-evidence-file artifacts/v0.3.4/message-awareness-live.json --observed-at "2026-06-16T11:00:00.000Z" --operator "REPLACE_WITH_OPERATOR" --update-offset 401 --last-outbound-at "2026-06-16T11:03:00.000Z" --last-outbound-kind "text" --last-outbound-target "42" --pairing-approved --owner-text-reply-returned --busy-message-queued-or-retried --reconnect-replay-checked --note "Owner DM paired, replied, queued or retried while busy, and did not replay after reconnect."',
  )
  assert.equal(
    buildDiscordLiveEvidenceRecordCommand({
      state: 'connected',
      botUsername: 'nexus_discord',
      lastError: null,
      lastEventAt: '2026-06-16T12:00:00Z',
      lastReconnectAt: '2026-06-16T12:05:00Z',
      lastReconnectReason: 'gateway_reconnect_requested',
      lastOutboundAt: '2026-06-16T12:03:00Z',
      lastOutboundKind: 'audio',
      lastOutboundTarget: 'channel-1',
      lastOutboundError: 'Discord API 403: missing permissions',
    }),
    'npm run message:live:record -- discord --live-evidence-file artifacts/v0.3.4/message-awareness-live.json --observed-at "2026-06-16T12:00:00.000Z" --operator "REPLACE_WITH_OPERATOR" --last-reconnect-at "2026-06-16T12:05:00.000Z" --last-reconnect-reason "gateway_reconnect_requested" --last-outbound-at "2026-06-16T12:03:00.000Z" --last-outbound-kind "audio" --last-outbound-target "channel-1" --last-outbound-error "Discord API 403: missing permissions" --message-content-intent-enabled --approved-channel-reply-returned --bot-echo-suppressed --reconnect-status-visible --note "Allowed Discord channel or DM replied once, bot echoes were suppressed, and reconnect status was visible."',
  )
})

test('context diagnostic status labels stay mapped for every status', () => {
  assert.equal(
    getContextDiagnosticStatusLabelKey('needs_permission'),
    'settings.console.context_diagnostics.status.needs_permission',
  )
  assert.equal(
    getContextDiagnosticStatusLabelKey('error'),
    'settings.console.context_diagnostics.status.error',
  )
})
