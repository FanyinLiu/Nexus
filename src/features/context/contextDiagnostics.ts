import type { AppSettings, PlatformProfile } from '../../types/app.ts'
import type { TranslationKey, TranslationParams } from '../../types/i18n.ts'

export type ContextDiagnosticStatus =
  | 'ready'
  | 'configured'
  | 'disabled'
  | 'needs_setup'
  | 'needs_permission'
  | 'unsupported'
  | 'error'

export type ContextDiagnosticItemId =
  | 'active_window'
  | 'clipboard'
  | 'screen_ocr'
  | 'notification_center'
  | 'local_webhook'
  | 'telegram'
  | 'discord'

export type ContextDiagnosticTrace = {
  labelKey: TranslationKey
  value: string
  format?: 'timestamp'
}

export type ContextDiagnosticAction = {
  labelKey: TranslationKey
  detailKey?: TranslationKey
  command: string
}

export type ContextDiagnosticTraceStatus = {
  lastEventAt?: string | null
  lastEventSource?: string | null
  lastEventId?: string | number | null
  lastSkipReason?: string | null
  lastSkipAt?: string | null
  lastErrorAt?: string | null
  lastReconnectAt?: string | null
  lastReconnectReason?: string | null
  reconnectAttempt?: number | null
  updateOffset?: number | null
  lastOutboundAt?: string | null
  lastOutboundTarget?: string | number | null
  lastOutboundKind?: string | null
  lastOutboundError?: string | null
}

export type NotificationWatcherDiagnosticStatus = {
  status: 'stopped' | 'running' | 'needs-permission' | 'unsupported' | 'error'
  lastError: string | null
  platformSupported: boolean
} & ContextDiagnosticTraceStatus

export type MessagingGatewayDiagnosticStatus = {
  state: 'disconnected' | 'connecting' | 'connected' | 'error'
  botUsername: string | null
  lastError: string | null
} & ContextDiagnosticTraceStatus

export type WebhookDiagnosticInfo = {
  url: string
  authHeader: string
} & ContextDiagnosticTraceStatus

export type ContextDiagnosticItem = {
  id: ContextDiagnosticItemId
  labelKey: TranslationKey
  status: ContextDiagnosticStatus
  detailKey: TranslationKey
  detailParams?: TranslationParams
  traces?: ContextDiagnosticTrace[]
  actions?: ContextDiagnosticAction[]
}

export type ContextDiagnosticsSummary = {
  items: ContextDiagnosticItem[]
  readyCount: number
  actionCount: number
}

export type V04GatewayBridgeTrace = {
  state: string | null
  lastEventAt: string | null
  updateOffset: number | null
  lastOutboundAt: string | null
  lastOutboundKind: string | null
  lastOutboundTargetPresent: boolean
  lastOutboundErrorPresent: boolean
  lastReconnectAt?: string | null
  lastReconnectReason?: string | null
  reconnectAttempt?: number | null
  hasTraceEvidence: boolean
}

export type V04MessageBridgeTraceReport = {
  schemaVersion: 1
  gate: 'nexus-v04-message-bridge-trace'
  generatedAt: string
  ok: boolean
  overallStatus: 'trace-evidence-available' | 'no-bridge-trace-evidence'
  source: 'desktop-context-diagnostics'
  telegram: V04GatewayBridgeTrace
  discord: V04GatewayBridgeTrace
  privacy: {
    artifactContentsCopied: false
    privateFieldsOmitted: string[]
  }
}

type ContextDiagnosticsSettings = Pick<
  AppSettings,
  | 'autonomyNotificationsEnabled'
  | 'clipboardContextEnabled'
  | 'contextAwarenessEnabled'
  | 'activeWindowContextEnabled'
  | 'discordBotToken'
  | 'discordIntegrationEnabled'
  | 'macosMessageWatcherEnabled'
  | 'screenContextEnabled'
  | 'telegramBotToken'
  | 'telegramIntegrationEnabled'
>

export type ResolveContextDiagnosticsInput = {
  settings: ContextDiagnosticsSettings
  platformProfile: Pick<PlatformProfile, 'desktopContext'>
  watcherStatus?: NotificationWatcherDiagnosticStatus | null
  webhookInfo?: WebhookDiagnosticInfo | null
  telegramStatus?: MessagingGatewayDiagnosticStatus | null
  discordStatus?: MessagingGatewayDiagnosticStatus | null
}

type DesktopCapabilityInput = {
  id: Extract<ContextDiagnosticItemId, 'active_window' | 'clipboard' | 'screen_ocr'>
  labelKey: TranslationKey
  enabled: boolean
  supported: boolean
  available: boolean
  readyDetailKey?: TranslationKey
}

function isBlank(value: string | null | undefined): boolean {
  return !value || value.trim().length === 0
}

function normalizeTraceText(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return ''
  return String(value).replace(/\s+/g, ' ').trim()
}

function normalizeSafeTraceToken(value: unknown, maxLength = 80): string | null {
  const text = normalizeTraceText(value)
  if (!text || text.length > maxLength) return null
  return /^[A-Za-z0-9_.:-]+$/.test(text) ? text : null
}

function isValidTraceTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' && typeof value !== 'number') return false
  return Number.isFinite(Date.parse(String(value)))
}

function toTraceIsoTimestamp(value: unknown): string | null {
  return isValidTraceTimestamp(value) ? new Date(value).toISOString() : null
}

function positiveTraceInteger(value: unknown): number | null {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return Math.floor(parsed)
}

function buildTraces(status: ContextDiagnosticTraceStatus | null | undefined): ContextDiagnosticTrace[] | undefined {
  if (!status) return undefined

  const traces: ContextDiagnosticTrace[] = []
  if (isValidTraceTimestamp(status.lastEventAt)) {
    traces.push({
      labelKey: 'settings.console.context_diagnostics.trace.last_event',
      value: new Date(status.lastEventAt).toISOString(),
      format: 'timestamp',
    })
  }

  const source = normalizeTraceText(status.lastEventSource)
  const eventId = normalizeTraceText(status.lastEventId)
  if (source || eventId) {
    traces.push({
      labelKey: 'settings.console.context_diagnostics.trace.last_source',
      value: eventId ? `${source || 'event'} (${eventId})` : source,
    })
  }

  const skipReason = normalizeTraceText(status.lastSkipReason)
  if (skipReason) {
    const skipAt = isValidTraceTimestamp(status.lastSkipAt)
      ? new Date(status.lastSkipAt).toISOString()
      : null
    traces.push({
      labelKey: 'settings.console.context_diagnostics.trace.last_skip',
      value: skipAt ? `${skipReason} · ${skipAt}` : skipReason,
    })
  }

  if (isValidTraceTimestamp(status.lastOutboundAt)) {
    const outboundAt = new Date(status.lastOutboundAt).toISOString()
    const outboundKind = normalizeTraceText(status.lastOutboundKind) || 'message'
    const outboundTarget = normalizeTraceText(status.lastOutboundTarget)
    const outboundError = normalizeTraceText(status.lastOutboundError)
    const target = outboundTarget ? ` -> ${outboundTarget}` : ''
    const error = outboundError ? ` · failed: ${outboundError}` : ''
    traces.push({
      labelKey: 'settings.console.context_diagnostics.trace.last_outbound',
      value: `${outboundKind}${target} · ${outboundAt}${error}`,
    })
  }

  if (isValidTraceTimestamp(status.lastErrorAt)) {
    traces.push({
      labelKey: 'settings.console.context_diagnostics.trace.last_error_at',
      value: new Date(status.lastErrorAt).toISOString(),
      format: 'timestamp',
    })
  }

  if (isValidTraceTimestamp(status.lastReconnectAt)) {
    const reconnectReason = normalizeTraceText(status.lastReconnectReason)
    const reconnectAt = new Date(status.lastReconnectAt).toISOString()
    const attempt = typeof status.reconnectAttempt === 'number' && Number.isFinite(status.reconnectAttempt)
      ? Math.max(0, Number(status.reconnectAttempt))
      : 0
    const attemptSuffix = attempt > 0 ? ` · attempt ${attempt}` : ''
    traces.push({
      labelKey: 'settings.console.context_diagnostics.trace.last_reconnect',
      value: `${reconnectReason || 'reconnect'} · ${reconnectAt}${attemptSuffix}`,
    })
  }

  if (typeof status.updateOffset === 'number' && Number.isFinite(status.updateOffset) && status.updateOffset > 0) {
    traces.push({
      labelKey: 'settings.console.context_diagnostics.trace.last_checkpoint',
      value: `update offset ${Math.floor(status.updateOffset)}`,
    })
  }

  return traces.length ? traces : undefined
}

function item(
  id: ContextDiagnosticItemId,
  labelKey: TranslationKey,
  status: ContextDiagnosticStatus,
  detailKey: TranslationKey,
  detailParams?: TranslationParams,
  traces?: ContextDiagnosticTrace[],
  actions?: ContextDiagnosticAction[],
): ContextDiagnosticItem {
  return { id, labelKey, status, detailKey, detailParams, traces, actions }
}

function shellQuote(value: string): string {
  return `"${String(value).replace(/(["\\$`])/g, '\\$1')}"`
}

const LIVE_EVIDENCE_FILE = 'artifacts/v0.3.4/message-awareness-live.json'
const LIVE_EVIDENCE_OPERATOR_PLACEHOLDER = 'REPLACE_WITH_OPERATOR'

const V04_BRIDGE_TRACE_PRIVATE_FIELD_LABELS = [
  'Telegram bot tokens and bot usernames',
  'Discord bot tokens and application identifiers',
  'chat ids, channel ids, sender ids, event ids, and target ids',
  'message text, notification title/body, webhook payloads, and raw replies',
  'lastOutboundTarget and lastOutboundError raw values',
  'allowedChatIds and allowedChannelIds allowlists',
  'raw gateway status objects',
]

function buildObservedAtArgs(status: ContextDiagnosticTraceStatus | null | undefined): string[] {
  if (!isValidTraceTimestamp(status?.lastEventAt)) return []
  return ['--observed-at', shellQuote(new Date(status.lastEventAt).toISOString())]
}

function buildTelegramUpdateOffsetArgs(status: ContextDiagnosticTraceStatus | null | undefined): string[] {
  if (typeof status?.updateOffset !== 'number' || !Number.isFinite(status.updateOffset) || status.updateOffset <= 0) {
    return []
  }
  return ['--update-offset', String(Math.floor(status.updateOffset))]
}

function buildDiscordReconnectEvidenceArgs(status: ContextDiagnosticTraceStatus | null | undefined): string[] {
  const args: string[] = []
  if (isValidTraceTimestamp(status?.lastReconnectAt)) {
    args.push('--last-reconnect-at', shellQuote(new Date(status.lastReconnectAt).toISOString()))
  }
  const reason = normalizeTraceText(status?.lastReconnectReason)
  if (reason) {
    args.push('--last-reconnect-reason', shellQuote(reason))
  }
  return args
}

function buildOutboundEvidenceArgs(status: ContextDiagnosticTraceStatus | null | undefined): string[] {
  const args: string[] = []
  if (isValidTraceTimestamp(status?.lastOutboundAt)) {
    args.push('--last-outbound-at', shellQuote(new Date(status.lastOutboundAt).toISOString()))
  }
  const kind = normalizeTraceText(status?.lastOutboundKind)
  if (kind) {
    args.push('--last-outbound-kind', shellQuote(kind))
  }
  const target = normalizeTraceText(status?.lastOutboundTarget)
  if (target) {
    args.push('--last-outbound-target', shellQuote(target))
  }
  const error = normalizeTraceText(status?.lastOutboundError)
  if (error) {
    args.push('--last-outbound-error', shellQuote(error))
  }
  return args
}

function buildOutboundEvidenceFields(status: ContextDiagnosticTraceStatus | null | undefined): Record<string, string> {
  const fields: Record<string, string> = {}
  if (isValidTraceTimestamp(status?.lastOutboundAt)) {
    fields.lastOutboundAt = new Date(status.lastOutboundAt).toISOString()
  }
  const kind = normalizeTraceText(status?.lastOutboundKind)
  if (kind) fields.lastOutboundKind = kind
  const target = normalizeTraceText(status?.lastOutboundTarget)
  if (target) fields.lastOutboundTarget = target
  const error = normalizeTraceText(status?.lastOutboundError)
  if (error) fields.lastOutboundError = error
  return fields
}

function buildGatewayBridgeTrace(
  status: MessagingGatewayDiagnosticStatus | null | undefined,
  kind: 'telegram' | 'discord',
): V04GatewayBridgeTrace {
  const trace: V04GatewayBridgeTrace = {
    state: normalizeSafeTraceToken(status?.state, 40),
    lastEventAt: toTraceIsoTimestamp(status?.lastEventAt),
    updateOffset: positiveTraceInteger(status?.updateOffset),
    lastOutboundAt: toTraceIsoTimestamp(status?.lastOutboundAt),
    lastOutboundKind: normalizeSafeTraceToken(status?.lastOutboundKind, 40),
    lastOutboundTargetPresent: Boolean(normalizeTraceText(status?.lastOutboundTarget)),
    lastOutboundErrorPresent: Boolean(normalizeTraceText(status?.lastOutboundError)),
    hasTraceEvidence: false,
  }

  if (kind === 'discord') {
    trace.lastReconnectAt = toTraceIsoTimestamp(status?.lastReconnectAt)
    trace.lastReconnectReason = normalizeSafeTraceToken(status?.lastReconnectReason, 80)
    trace.reconnectAttempt = positiveTraceInteger(status?.reconnectAttempt)
  }

  trace.hasTraceEvidence = Boolean(
    trace.lastEventAt
      || trace.updateOffset
      || trace.lastOutboundAt
      || trace.lastOutboundKind
      || trace.lastOutboundTargetPresent
      || trace.lastOutboundErrorPresent
      || trace.lastReconnectAt
      || trace.lastReconnectReason
      || trace.reconnectAttempt,
  )

  return trace
}

export function buildV04MessageBridgeTraceReport({
  telegramStatus,
  discordStatus,
}: Pick<
  ResolveContextDiagnosticsInput,
  'telegramStatus' | 'discordStatus'
> = {}, now: string | number | Date = Date.now()): V04MessageBridgeTraceReport {
  const telegram = buildGatewayBridgeTrace(telegramStatus, 'telegram')
  const discord = buildGatewayBridgeTrace(discordStatus, 'discord')
  const ok = telegram.hasTraceEvidence || discord.hasTraceEvidence

  return {
    schemaVersion: 1,
    gate: 'nexus-v04-message-bridge-trace',
    generatedAt: new Date(now).toISOString(),
    ok,
    overallStatus: ok ? 'trace-evidence-available' : 'no-bridge-trace-evidence',
    source: 'desktop-context-diagnostics',
    telegram,
    discord,
    privacy: {
      artifactContentsCopied: false,
      privateFieldsOmitted: V04_BRIDGE_TRACE_PRIVATE_FIELD_LABELS,
    },
  }
}

export function buildV04MessageBridgeTraceJson(
  input: Pick<ResolveContextDiagnosticsInput, 'telegramStatus' | 'discordStatus'> = {},
): string {
  return JSON.stringify(buildV04MessageBridgeTraceReport(input), null, 2)
}

export function buildWebhookValidationCommand(
  webhookInfo: Pick<WebhookDiagnosticInfo, 'url' | 'authHeader'>,
): string {
  return [
    'npm run message:validate --',
    '--url',
    shellQuote(webhookInfo.url),
    '--token',
    shellQuote(webhookInfo.authHeader),
    '--evidence-file',
    'artifacts/v0.3.4/message-awareness-local.json',
  ].join(' ')
}

export function buildLocalWebhookSmokeCommand(): string {
  return 'npm run message:smoke:local'
}

export function buildLiveEvidenceTemplateCommand(): string {
  return 'npm run message:live:template'
}

export function buildLiveEvidenceGateCommand(): string {
  return 'npm run message:gate:live'
}

export function buildReleaseEvidenceStatusCommand(): string {
  return 'npm run message:status:release'
}

export function buildReleaseEvidenceMergeCommand(): string {
  return 'npm run message:merge:release'
}

export function buildReleaseEvidenceGateCommand(): string {
  return 'npm run message:gate:release'
}

export function buildReleaseEvidenceRedactionCommand(): string {
  return 'npm run message:release:redact'
}

export function buildMacOSLiveEvidenceRecordCommand(
  watcherStatus?: NotificationWatcherDiagnosticStatus | null,
): string {
  const appName = normalizeTraceText(watcherStatus?.lastEventSource) || 'REPLACE_WITH_REAL_APP'
  return [
    'npm run message:live:record --',
    'macos',
    '--live-evidence-file',
    LIVE_EVIDENCE_FILE,
    ...buildObservedAtArgs(watcherStatus),
    '--operator',
    shellQuote(LIVE_EVIDENCE_OPERATOR_PLACEHOLDER),
    '--app-name',
    shellQuote(appName),
    '--full-disk-access-granted',
    '--notification-observed-once',
    '--replay-checked-after-restart',
    '--note',
    shellQuote('One real app notification appeared once in Nexus after Full Disk Access and did not replay after restart.'),
  ].join(' ')
}

export function buildTelegramLiveEvidenceRecordCommand(
  telegramStatus?: MessagingGatewayDiagnosticStatus | null,
): string {
  return [
    'npm run message:live:record --',
    'telegram',
    '--live-evidence-file',
    LIVE_EVIDENCE_FILE,
    ...buildObservedAtArgs(telegramStatus),
    '--operator',
    shellQuote(LIVE_EVIDENCE_OPERATOR_PLACEHOLDER),
    ...buildTelegramUpdateOffsetArgs(telegramStatus),
    ...buildOutboundEvidenceArgs(telegramStatus),
    '--pairing-approved',
    '--owner-text-reply-returned',
    '--busy-message-queued-or-retried',
    '--reconnect-replay-checked',
    '--note',
    shellQuote('Owner DM paired, replied, queued or retried while busy, and did not replay after reconnect.'),
  ].join(' ')
}

export function buildDiscordLiveEvidenceRecordCommand(
  discordStatus?: MessagingGatewayDiagnosticStatus | null,
): string {
  return [
    'npm run message:live:record --',
    'discord',
    '--live-evidence-file',
    LIVE_EVIDENCE_FILE,
    ...buildObservedAtArgs(discordStatus),
    '--operator',
    shellQuote(LIVE_EVIDENCE_OPERATOR_PLACEHOLDER),
    ...buildDiscordReconnectEvidenceArgs(discordStatus),
    ...buildOutboundEvidenceArgs(discordStatus),
    '--message-content-intent-enabled',
    '--approved-channel-reply-returned',
    '--bot-echo-suppressed',
    '--reconnect-status-visible',
    '--note',
    shellQuote('Allowed Discord channel or DM replied once, bot echoes were suppressed, and reconnect status was visible.'),
  ].join(' ')
}

export function buildMessageAwarenessLiveEvidenceTemplate({
  watcherStatus,
  telegramStatus,
  discordStatus,
}: Pick<
  ResolveContextDiagnosticsInput,
  'watcherStatus' | 'telegramStatus' | 'discordStatus'
> = {}): string {
  const notificationObservedAt = isValidTraceTimestamp(watcherStatus?.lastEventAt)
    ? new Date(watcherStatus.lastEventAt).toISOString()
    : null
  const telegramObservedAt = isValidTraceTimestamp(telegramStatus?.lastEventAt)
    ? new Date(telegramStatus.lastEventAt).toISOString()
    : null
  const discordObservedAt = isValidTraceTimestamp(discordStatus?.lastEventAt)
    ? new Date(discordStatus.lastEventAt).toISOString()
    : null

  return JSON.stringify({
    checks: [
      {
        id: 'macos-notification-center-live',
        status: 'manual-required',
        observedAt: notificationObservedAt,
        evidence: {
          appName: normalizeTraceText(watcherStatus?.lastEventSource),
          fullDiskAccessGranted: false,
          notificationObservedOnce: false,
          replayCheckedAfterRestart: false,
        },
        notes: [
          'Replace manual-required with pass only after one real notification is observed once and restart no-replay is checked.',
        ],
      },
      {
        id: 'telegram-live-bridge',
        status: 'manual-required',
        observedAt: telegramObservedAt,
        evidence: {
          ...(typeof telegramStatus?.updateOffset === 'number'
            && Number.isFinite(telegramStatus.updateOffset)
            && telegramStatus.updateOffset > 0
            ? { updateOffset: Math.floor(telegramStatus.updateOffset) }
            : {}),
          ...buildOutboundEvidenceFields(telegramStatus),
          pairingApproved: false,
          ownerTextReplyReturned: false,
          busyMessageQueuedOrRetried: false,
          reconnectReplayChecked: false,
        },
        notes: [
          'Replace manual-required with pass only after a real owner DM, reply return, busy queue/retry, and reconnect no-replay are verified.',
        ],
      },
      {
        id: 'discord-live-bridge',
        status: 'manual-required',
        observedAt: discordObservedAt,
        evidence: {
          ...(isValidTraceTimestamp(discordStatus?.lastReconnectAt)
            ? { lastReconnectAt: new Date(discordStatus.lastReconnectAt).toISOString() }
            : {}),
          ...(normalizeTraceText(discordStatus?.lastReconnectReason)
            ? { lastReconnectReason: normalizeTraceText(discordStatus?.lastReconnectReason) }
            : {}),
          ...buildOutboundEvidenceFields(discordStatus),
          messageContentIntentEnabled: false,
          approvedChannelReplyReturned: false,
          botEchoSuppressed: false,
          reconnectStatusVisible: false,
        },
        notes: [
          'Replace manual-required with pass only after a real approved channel or DM reply, echo suppression, and reconnect status are verified.',
        ],
      },
    ],
  }, null, 2)
}

function resolveDesktopCapability(input: DesktopCapabilityInput): ContextDiagnosticItem {
  if (!input.supported) {
    return item(
      input.id,
      input.labelKey,
      'unsupported',
      'settings.console.context_diagnostics.detail.platform_unavailable',
    )
  }

  if (!input.enabled) {
    return item(
      input.id,
      input.labelKey,
      'disabled',
      'settings.console.context_diagnostics.detail.disabled',
    )
  }

  if (!input.available) {
    return item(
      input.id,
      input.labelKey,
      'needs_permission',
      'settings.console.context_diagnostics.detail.needs_permission',
    )
  }

  return item(
    input.id,
    input.labelKey,
    'ready',
    input.readyDetailKey ?? 'settings.console.context_diagnostics.detail.enabled_ready',
  )
}

function resolveNotificationCenter(
  settings: ContextDiagnosticsSettings,
  watcherStatus: NotificationWatcherDiagnosticStatus | null | undefined,
): ContextDiagnosticItem {
  const traces = buildTraces(watcherStatus)
  const liveEvidenceRecordAction: ContextDiagnosticAction = {
    labelKey: 'settings.console.context_diagnostics.action.record_macos_live_evidence',
    detailKey: 'settings.console.context_diagnostics.action.record_macos_live_evidence_hint',
    command: buildMacOSLiveEvidenceRecordCommand(watcherStatus),
  }

  if (watcherStatus?.platformSupported === false || watcherStatus?.status === 'unsupported') {
    return item(
      'notification_center',
      'settings.console.context_diagnostics.label.notification_center',
      'unsupported',
      'settings.console.context_diagnostics.detail.platform_unavailable',
      undefined,
      traces,
    )
  }

  if (!settings.macosMessageWatcherEnabled) {
    return item(
      'notification_center',
      'settings.console.context_diagnostics.label.notification_center',
      'disabled',
      'settings.console.context_diagnostics.detail.disabled',
      undefined,
      traces,
    )
  }

  if (watcherStatus?.status === 'needs-permission') {
    return item(
      'notification_center',
      'settings.console.context_diagnostics.label.notification_center',
      'needs_permission',
      'settings.console.context_diagnostics.detail.needs_permission',
      undefined,
      traces,
      [liveEvidenceRecordAction],
    )
  }

  if (watcherStatus?.status === 'error') {
    return item(
      'notification_center',
      'settings.console.context_diagnostics.label.notification_center',
      'error',
      'settings.console.context_diagnostics.detail.error',
      { message: watcherStatus.lastError || 'unknown error' },
      traces,
      [liveEvidenceRecordAction],
    )
  }

  if (watcherStatus?.status === 'running') {
    return item(
      'notification_center',
      'settings.console.context_diagnostics.label.notification_center',
      'ready',
      'settings.console.context_diagnostics.detail.notification_running',
      undefined,
      traces,
      [liveEvidenceRecordAction],
    )
  }

  return item(
    'notification_center',
    'settings.console.context_diagnostics.label.notification_center',
    'configured',
    'settings.console.context_diagnostics.detail.notification_configured',
    undefined,
    traces,
    [liveEvidenceRecordAction],
  )
}

function resolveWebhook(
  settings: ContextDiagnosticsSettings,
  webhookInfo: WebhookDiagnosticInfo | null | undefined,
  liveEvidenceTemplate: string,
  bridgeTraceJson: string | null,
): ContextDiagnosticItem {
  const traces = buildTraces(webhookInfo)
  const liveEvidenceTemplateAction: ContextDiagnosticAction = {
    labelKey: 'settings.console.context_diagnostics.action.live_evidence_template',
    detailKey: 'settings.console.context_diagnostics.action.live_evidence_template_hint',
    command: buildLiveEvidenceTemplateCommand(),
  }
  const liveEvidenceTemplatePreviewAction: ContextDiagnosticAction = {
    labelKey: 'settings.console.context_diagnostics.action.live_evidence_template_preview',
    detailKey: 'settings.console.context_diagnostics.action.live_evidence_template_preview_hint',
    command: liveEvidenceTemplate,
  }
  const v04BridgeTraceAction: ContextDiagnosticAction | null = bridgeTraceJson
    ? {
        labelKey: 'settings.console.context_diagnostics.action.v04_bridge_trace_json',
        detailKey: 'settings.console.context_diagnostics.action.v04_bridge_trace_json_hint',
        command: bridgeTraceJson,
      }
    : null
  const localWebhookSmokeAction: ContextDiagnosticAction = {
    labelKey: 'settings.console.context_diagnostics.action.local_webhook_smoke_command',
    detailKey: 'settings.console.context_diagnostics.action.local_webhook_smoke_command_hint',
    command: buildLocalWebhookSmokeCommand(),
  }
  const liveEvidenceGateAction: ContextDiagnosticAction = {
    labelKey: 'settings.console.context_diagnostics.action.live_evidence_gate',
    detailKey: 'settings.console.context_diagnostics.action.live_evidence_gate_hint',
    command: buildLiveEvidenceGateCommand(),
  }
  const releaseEvidenceStatusAction: ContextDiagnosticAction = {
    labelKey: 'settings.console.context_diagnostics.action.release_evidence_status',
    detailKey: 'settings.console.context_diagnostics.action.release_evidence_status_hint',
    command: buildReleaseEvidenceStatusCommand(),
  }
  const releaseEvidenceMergeAction: ContextDiagnosticAction = {
    labelKey: 'settings.console.context_diagnostics.action.release_evidence_merge',
    detailKey: 'settings.console.context_diagnostics.action.release_evidence_merge_hint',
    command: buildReleaseEvidenceMergeCommand(),
  }
  const releaseEvidenceGateAction: ContextDiagnosticAction = {
    labelKey: 'settings.console.context_diagnostics.action.release_evidence_gate',
    detailKey: 'settings.console.context_diagnostics.action.release_evidence_gate_hint',
    command: buildReleaseEvidenceGateCommand(),
  }
  const releaseEvidenceRedactionAction: ContextDiagnosticAction = {
    labelKey: 'settings.console.context_diagnostics.action.release_evidence_redaction',
    detailKey: 'settings.console.context_diagnostics.action.release_evidence_redaction_hint',
    command: buildReleaseEvidenceRedactionCommand(),
  }
  const releaseGateActions = [
    localWebhookSmokeAction,
    liveEvidenceTemplateAction,
    liveEvidenceTemplatePreviewAction,
    ...(v04BridgeTraceAction ? [v04BridgeTraceAction] : []),
    liveEvidenceGateAction,
    releaseEvidenceStatusAction,
    releaseEvidenceMergeAction,
    releaseEvidenceGateAction,
    releaseEvidenceRedactionAction,
  ]

  if (!settings.autonomyNotificationsEnabled) {
    return item(
      'local_webhook',
      'settings.autonomy.notifications.local_webhook',
      'disabled',
      'settings.console.context_diagnostics.detail.webhook_disabled',
      undefined,
      traces,
      releaseGateActions,
    )
  }

  if (!webhookInfo?.url || !webhookInfo.authHeader) {
    return item(
      'local_webhook',
      'settings.autonomy.notifications.local_webhook',
      'needs_setup',
      'settings.console.context_diagnostics.detail.webhook_missing',
      undefined,
      traces,
      releaseGateActions,
    )
  }

  return item(
    'local_webhook',
    'settings.autonomy.notifications.local_webhook',
    'configured',
    'settings.console.context_diagnostics.detail.webhook_ready',
    { url: webhookInfo.url },
    traces,
    [
      localWebhookSmokeAction,
      {
        labelKey: 'settings.console.context_diagnostics.action.local_webhook_command',
        detailKey: 'settings.console.context_diagnostics.action.local_webhook_command_hint',
        command: buildWebhookValidationCommand(webhookInfo),
      },
      liveEvidenceTemplateAction,
      liveEvidenceTemplatePreviewAction,
      ...(v04BridgeTraceAction ? [v04BridgeTraceAction] : []),
      liveEvidenceGateAction,
      releaseEvidenceStatusAction,
      releaseEvidenceMergeAction,
      releaseEvidenceGateAction,
      releaseEvidenceRedactionAction,
    ],
  )
}

function resolveGateway(
  id: Extract<ContextDiagnosticItemId, 'telegram' | 'discord'>,
  labelKey: TranslationKey,
  enabled: boolean,
  botToken: string,
  status: MessagingGatewayDiagnosticStatus | null | undefined,
): ContextDiagnosticItem {
  const traces = buildTraces(status)
  const liveEvidenceRecordAction: ContextDiagnosticAction = id === 'telegram'
    ? {
        labelKey: 'settings.console.context_diagnostics.action.record_telegram_live_evidence',
        detailKey: 'settings.console.context_diagnostics.action.record_telegram_live_evidence_hint',
        command: buildTelegramLiveEvidenceRecordCommand(status),
      }
    : {
        labelKey: 'settings.console.context_diagnostics.action.record_discord_live_evidence',
        detailKey: 'settings.console.context_diagnostics.action.record_discord_live_evidence_hint',
        command: buildDiscordLiveEvidenceRecordCommand(status),
      }

  if (!enabled) {
    return item(id, labelKey, 'disabled', 'settings.console.context_diagnostics.detail.gateway_disabled', undefined, traces)
  }

  if (isBlank(botToken)) {
    return item(id, labelKey, 'needs_setup', 'settings.console.context_diagnostics.detail.gateway_missing_token', undefined, traces)
  }

  if (status?.state === 'connected') {
    return item(
      id,
      labelKey,
      'ready',
      'settings.console.context_diagnostics.detail.gateway_connected',
      { bot: status.botUsername || 'bot' },
      traces,
      [liveEvidenceRecordAction],
    )
  }

  if (status?.state === 'error') {
    return item(
      id,
      labelKey,
      'error',
      'settings.console.context_diagnostics.detail.error',
      { message: status.lastError || 'unknown error' },
      traces,
      [liveEvidenceRecordAction],
    )
  }

  return item(id, labelKey, 'configured', 'settings.console.context_diagnostics.detail.gateway_configured', undefined, traces, [liveEvidenceRecordAction])
}

export function getContextDiagnosticStatusLabelKey(status: ContextDiagnosticStatus): TranslationKey {
  switch (status) {
    case 'ready':
      return 'settings.console.context_diagnostics.status.ready'
    case 'configured':
      return 'settings.console.context_diagnostics.status.configured'
    case 'disabled':
      return 'settings.console.context_diagnostics.status.disabled'
    case 'needs_setup':
      return 'settings.console.context_diagnostics.status.needs_setup'
    case 'needs_permission':
      return 'settings.console.context_diagnostics.status.needs_permission'
    case 'unsupported':
      return 'settings.console.context_diagnostics.status.unsupported'
    case 'error':
      return 'settings.console.context_diagnostics.status.error'
  }
}

export function resolveContextDiagnosticsSummary({
  settings,
  platformProfile,
  watcherStatus,
  webhookInfo,
  telegramStatus,
  discordStatus,
}: ResolveContextDiagnosticsInput): ContextDiagnosticsSummary {
  const desktopContext = platformProfile.desktopContext
  const contextEnabled = settings.contextAwarenessEnabled
  const v04BridgeTrace = buildV04MessageBridgeTraceReport({ telegramStatus, discordStatus })
  const v04BridgeTraceJson = v04BridgeTrace.ok ? JSON.stringify(v04BridgeTrace, null, 2) : null
  const items: ContextDiagnosticItem[] = [
    resolveDesktopCapability({
      id: 'active_window',
      labelKey: 'settings.memory.context.active_window',
      enabled: contextEnabled && settings.activeWindowContextEnabled,
      supported: desktopContext.activeWindowSupported,
      available: desktopContext.activeWindowAvailable,
    }),
    resolveDesktopCapability({
      id: 'clipboard',
      labelKey: 'settings.memory.context.clipboard',
      enabled: contextEnabled && settings.clipboardContextEnabled,
      supported: desktopContext.clipboardSupported,
      available: desktopContext.clipboardAvailable,
    }),
    resolveDesktopCapability({
      id: 'screen_ocr',
      labelKey: 'settings.memory.context.screen_ocr',
      enabled: contextEnabled && settings.screenContextEnabled,
      supported: desktopContext.screenshotSupported,
      available: desktopContext.screenshotAvailable,
      readyDetailKey: 'settings.console.context_diagnostics.detail.screen_ready',
    }),
    resolveNotificationCenter(settings, watcherStatus),
    resolveWebhook(settings, webhookInfo, buildMessageAwarenessLiveEvidenceTemplate({
      watcherStatus,
      telegramStatus,
      discordStatus,
    }), v04BridgeTraceJson),
    resolveGateway(
      'telegram',
      'integration.telegram.title',
      settings.telegramIntegrationEnabled,
      settings.telegramBotToken,
      telegramStatus,
    ),
    resolveGateway(
      'discord',
      'integration.discord.title',
      settings.discordIntegrationEnabled,
      settings.discordBotToken,
      discordStatus,
    ),
  ]

  const readyCount = items.filter((entry) => entry.status === 'ready').length

  return {
    items,
    readyCount,
    actionCount: items.length - readyCount,
  }
}
