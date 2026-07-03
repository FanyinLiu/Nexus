// Required phrase inventory for the source-only error-redaction audit.
// Split from the executable script so each file stays within source-size limits.

export const REQUIRED_PHRASES = [
  {
    id: 'runtime-log-dev-directory-ignored',
    file: '.gitignore',
    phrases: [
      '.dev/',
      '*.log',
    ],
  },
  {
    id: 'main-error-redaction-helper',
    file: 'electron/services/errorRedaction.js',
    phrases: [
      'export function redactSensitiveErrorText',
      'export function getRedactedErrorMessage',
      'Bearer ***',
      'sk-***',
      'AIza***',
      'jwt***',
      '[vault-slot]',
    ],
  },
  {
    id: 'audit-log-redacts-write-errors',
    file: 'electron/services/auditLog.js',
    phrases: [
      "import { getRedactedErrorMessage } from './errorRedaction.js'",
      "console.error('[AuditLog] write error:', getRedactedErrorMessage(err))",
    ],
  },
  {
    id: 'window-assets-redacts-support-logs',
    file: 'electron/windowAssets.js',
    phrases: [
      "import { getRedactedErrorMessage } from './services/errorRedaction.js'",
      "console.warn('[window] Failed to set window icon:', getRedactedErrorMessage(err))",
      "console.warn('[windows] Failed to set window app details:', getRedactedErrorMessage(err))",
    ],
  },
  {
    id: 'window-manager-redacts-support-logs',
    file: 'electron/windowManager.js',
    phrases: [
      "import { getRedactedErrorMessage } from './services/errorRedaction.js'",
      "console.warn('[macOS] Failed to show dock icon:', getRedactedErrorMessage(err))",
      "console.warn('[macOS] Failed to hide dock icon:', getRedactedErrorMessage(err))",
      "console.warn('[pet-window] setVisibleOnAllWorkspaces failed:', getRedactedErrorMessage(err))",
      "console.warn('[pet-window:linux] setVisibleOnAllWorkspaces failed:', getRedactedErrorMessage(err))",
      "console.warn('[tray] failed to create system tray:', getRedactedErrorMessage(err))",
    ],
  },
  {
    id: 'mac-permissions-redacts-support-logs',
    file: 'electron/services/macPermissions.js',
    phrases: [
      "import { getRedactedErrorMessage } from './errorRedaction.js'",
      "console.warn('[mac-perm] failed to open settings:', getRedactedErrorMessage(err))",
      "console.warn('[mac-perm] microphone check failed:', getRedactedErrorMessage(err))",
      "console.warn('[mac-perm] screen check failed:', getRedactedErrorMessage(err))",
    ],
  },
  {
    id: 'windows-permissions-redacts-support-logs',
    file: 'electron/services/windowsPermissions.js',
    phrases: [
      "import { getRedactedErrorMessage } from './errorRedaction.js'",
      "console.warn('[windows-perm] failed to open settings:', getRedactedErrorMessage(err))",
      'console.warn(`[windows-perm] ${kind} check failed:`, getRedactedErrorMessage(err))',
    ],
  },
  {
    id: 'pet-prefs-store-redacts-persist-errors',
    file: 'electron/services/petPrefsStore.js',
    phrases: [
      "import { getRedactedErrorMessage } from './errorRedaction.js'",
      "console.warn('[petPrefs] persist failed:', getRedactedErrorMessage(err))",
    ],
  },
  {
    id: 'window-bounds-store-redacts-persist-errors',
    file: 'electron/services/windowBoundsStore.js',
    phrases: [
      "import { getRedactedErrorMessage } from './errorRedaction.js'",
      "console.warn('[windowBounds] persist failed:', getRedactedErrorMessage(err))",
    ],
  },
  {
    id: 'window-navigation-security-logs-stay-shaped',
    file: 'electron/windowManager.js',
    phrases: [
      'summarizeWindowNavigationUrlForLog',
      'summarizeWindowNavigationErrorForLog',
      'summarizeWindowNavigationUrlForLog(safeUrl)',
      'summarizeWindowNavigationUrlForLog(url)',
      'summarizeWindowNavigationErrorForLog(err)',
    ],
  },
  {
    id: 'runtime-renderer-console-logs-stay-sanitized',
    file: 'electron/windowManager.js',
    phrases: [
      'createRendererRuntimeLogEntry(details, label)',
      'RuntimeLogWriteBuffer',
      'RUNTIME_LOG_DISPLAY_PATH',
      'console.info(`[runtime-log] capturing renderer console to ${RUNTIME_LOG_DISPLAY_PATH}`)',
      'getRuntimeLogWriteBuffer()?.enqueue(serializeRuntimeLogEntry(entry))',
      'sanitizeRuntimeLogMessage(details.message)',
      'sanitizeRuntimeLogMessage(err?.message ?? err)',
    ],
  },
  {
    id: 'runtime-log-flushes-on-before-quit',
    file: 'electron/main.js',
    phrases: [
      "import { getRedactedErrorMessage } from './services/errorRedaction.js'",
      'flushRuntimeLogWriteBuffer',
      'void flushRuntimeLogWriteBuffer()',
    ],
  },
  {
    id: 'main-process-redacts-startup-support-logs',
    file: 'electron/main.js',
    phrases: [
      '[main] stream error: ${getRedactedErrorMessage(err)}',
      "console.warn('[windows] Failed to set AppUserModelId:', getRedactedErrorMessage(err))",
      'console.warn(`[${tag}] Spawn error: ${getRedactedErrorMessage(err)}`)',
      "console.warn('[macOS] Failed to hide dock icon:', getRedactedErrorMessage(err))",
      "console.warn('[mac-perm] auto-check error:', getRedactedErrorMessage(err))",
      "console.warn('[windows-perm] auto-check error:', getRedactedErrorMessage(err))",
      "console.warn('[pluginHost] auto-start error:', getRedactedErrorMessage(err))",
      "console.warn('[OmniVoice] auto-start error:', getRedactedErrorMessage(err))",
      "console.warn('[GLM-ASR] auto-start error:', getRedactedErrorMessage(err))",
      "console.warn('[Python] Runtime probe failed:', getRedactedErrorMessage(err))",
    ],
  },
  {
    id: 'runtime-log-sanitizer-helper',
    file: 'electron/runtimeLogSanitizer.js',
    phrases: [
      'redactSensitiveErrorText',
      'RUNTIME_LOG_MESSAGE_MAX_LENGTH',
      'RUNTIME_LOG_DISPLAY_PATH',
      'RUNTIME_LOG_FLUSH_INTERVAL_MS',
      'RUNTIME_LOG_FLUSH_BATCH_SIZE',
      'RUNTIME_LOG_MAX_BUFFERED_LINES',
      'RUNTIME_LOG_MAX_SESSION_BYTES',
      'sanitizeRuntimeLogMessage',
      'formatRuntimeLogSource',
      'createRendererRuntimeLogEntry',
      'serializeRuntimeLogEntry',
      'serializeRuntimeLogDropNotice',
      'serializeRuntimeLogLimitNotice',
      'truncateUtf8StringToBytes',
      'RuntimeLogWriteBuffer',
      'trimBufferedLines',
      'droppedLineCount',
      'sessionLimitReached',
      'applySessionByteLimit',
      'async drain()',
    ],
  },
  {
    id: 'runtime-log-sanitizer-tests',
    file: 'tests/runtime-log-sanitizer.test.ts',
    phrases: [
      'runtime log sanitizer redacts secrets and local paths',
      'runtime log exposes only the relative display path',
      'runtime log sanitizer caps oversized renderer console messages',
      'runtime log source labels omit raw directories and missing line suffixes',
      'renderer runtime log entries never include raw source paths or raw message secrets',
      'runtime log write buffer batches entries before disk writes',
      'runtime log write buffer drain waits for in-flight writes and queued tails',
      'runtime log write buffer trims old entries when renderer logging bursts',
      'runtime log write buffer caps disk writes per session',
      'runtime log drop notice is metadata-only',
      'runtime log limit notice is metadata-only',
    ],
  },
  {
    id: 'window-navigation-log-summary-helper',
    file: 'electron/windowNavigation.js',
    phrases: [
      'export function summarizeWindowNavigationUrlForLog',
      'export function summarizeWindowNavigationErrorForLog',
      'hostnameLength',
      'pathnameLength',
      'searchLength',
      'messageLength',
    ],
  },
  {
    id: 'window-navigation-log-summary-tests',
    file: 'tests/window-navigation.test.ts',
    phrases: [
      'summarize URLs without exposing hosts paths queries or fragments',
      'summarize navigation errors without exposing raw messages',
    ],
  },
  {
    id: 'chat-ipc-redacts-network-errors',
    file: 'electron/ipc/chatIpc.js',
    phrases: [
      "import { getRedactedErrorMessage, redactSensitiveErrorText } from '../services/errorRedaction.js'",
      'const reason = getRedactedErrorMessage(error)',
      'message: redactSensitiveErrorText(data?.error?.message ?? data?.message ?? \'\')',
      'error: getRedactedErrorMessage(streamError)',
      'if (streamError) throw new Error(getRedactedErrorMessage(streamError))',
    ],
  },
  {
    id: 'audio-ipc-redacts-network-errors',
    file: 'electron/ipc/audioIpc.js',
    phrases: [
      "import { getRedactedErrorMessage, redactSensitiveErrorText } from '../services/errorRedaction.js'",
      'const reason = getRedactedErrorMessage(error)',
      'redactSensitiveErrorText(data?.error?.message ?? data?.detail?.message ?? data?.message)',
      'redactSensitiveErrorText(result.errorMessage)',
      'redactSensitiveErrorText(result.reason)',
    ],
  },
  {
    id: 'net-redacts-shared-response-errors',
    file: 'electron/net.js',
    phrases: [
      "import { redactSensitiveErrorText } from './services/errorRedaction.js'",
      'return redactSensitiveErrorText(',
    ],
  },
  {
    id: 'telegram-gateway-redacts-status-errors',
    file: 'electron/services/telegramGateway.js',
    phrases: [
      "import { getRedactedErrorMessage } from './errorRedaction.js'",
      "console.warn('[telegram] pairing reply failed:', getRedactedErrorMessage(err))",
      "console.warn('[telegram] voice download failed:', getRedactedErrorMessage(err))",
      'const message = getRedactedErrorMessage(err)',
      '_lastError = getRedactedErrorMessage(err)',
    ],
  },
  {
    id: 'discord-gateway-redacts-status-errors',
    file: 'electron/services/discordGateway.js',
    phrases: [
      "import { getRedactedErrorMessage, redactSensitiveErrorText } from './errorRedaction.js'",
      "console.warn('[discord] pairing reply failed:', getRedactedErrorMessage(err))",
      "console.error('[discord] Dropping malformed gateway frame:', getRedactedErrorMessage(err))",
      'redactSensitiveErrorText(reason)',
      'const message = getRedactedErrorMessage(err)',
      '_lastError = getRedactedErrorMessage(err)',
    ],
  },
  {
    id: 'tencent-asr-redacts-server-errors',
    file: 'electron/services/tencentAsr.js',
    phrases: [
      "import { getRedactedErrorMessage } from './errorRedaction.js'",
      "console.error('[TencentASR] server error:', data.code, getRedactedErrorMessage(data.message))",
    ],
  },
  {
    id: 'tts-service-redacts-retry-errors',
    file: 'electron/services/ttsService.js',
    phrases: [
      "import { getRedactedErrorMessage } from './errorRedaction.js'",
      'error ? `error=${getRedactedErrorMessage(error)}` : \'\'',
    ],
  },
  {
    id: 'tts-stream-redacts-pcm-errors',
    file: 'electron/ttsStreamService.js',
    phrases: [
      "import { getRedactedErrorMessage } from './services/errorRedaction.js'",
      'const message = getRedactedErrorMessage(err) || \'流式音频传输中断。\'',
      "console.error('[TTS-Stream] PCM stream error:', message)",
      'message,',
    ],
  },
  {
    id: 'mac-notification-watcher-redacts-status-errors',
    file: 'electron/services/macNotificationWatcher.js',
    phrases: [
      "import { getRedactedErrorMessage } from './errorRedaction.js'",
      "console.warn('[mac-notification-watcher] failed to persist state:', getRedactedErrorMessage(err))",
      'const rawMessage = err instanceof Error ? err.message : String(err ?? \'\')',
      'const message = getRedactedErrorMessage(err)',
      'setStatus(kind, message)',
      'setStatus(classifyMacWatcherError(rawMessage), message)',
    ],
  },
  {
    id: 'notification-bridge-redacts-support-logs',
    file: 'electron/services/notificationBridge.js',
    phrases: [
      "import { getRedactedErrorMessage } from './errorRedaction.js'",
      'function formatChannelLogLabel(channel)',
      "console.warn('[notification-bridge] failed to read webhook token:', getRedactedErrorMessage(err))",
      'RSS channel missing URL (${formatChannelLogLabel(channel)})',
      'RSS fetch failed (${formatChannelLogLabel(channel)}): status=${resp.status}',
      'RSS poll error (${formatChannelLogLabel(channel)}):',
      "console.error('[notification-bridge] Webhook server error:', getRedactedErrorMessage(err))",
    ],
  },
  {
    id: 'notification-bridge-utils-redacts-channel-logs',
    file: 'electron/services/notificationBridgeUtils.js',
    phrases: [
      'function formatChannelInputLogLabel(raw, kind = \'unknown\')',
      'function classifyUrlSafetyReason(reason)',
      'dropped channel: invalid kind (${formatChannelInputLogLabel(raw)})',
      'dropped channel: missing id/name (${formatChannelInputLogLabel(raw, kind)})',
      'dropped RSS channel (${formatChannelInputLogLabel(raw, kind)}): reason=${classifyUrlSafetyReason(safety.reason)}',
    ],
  },
  {
    id: 'mcp-host-redacts-support-logs',
    file: 'electron/services/mcpHost.js',
    phrases: [
      "import { getRedactedErrorMessage } from './errorRedaction.js'",
      'function mcpLogScope(id)',
      'notification send failed (methodLength=${String(method ?? \'\').length})',
      'unparseable line: ${summarizeMcpOutputLineForLog(trimmed)}',
      'new Error(getRedactedErrorMessage(message.error.message ?? JSON.stringify(message.error)))',
      'server notification: methodLength=${String(message.method ?? \'\').length}',
      'discovered tools: ${summarizeMcpToolNamesForLog([...this.tools.keys()])}',
      'spawning: ${summarizeMcpCommandForLog(command, args)}',
      'getRedactedErrorMessage(err)',
    ],
  },
  {
    id: 'mcp-host-utils-log-summarizers',
    file: 'electron/services/mcpHostUtils.js',
    phrases: [
      'export function formatMcpHostLogLabel(id)',
      'export function summarizeMcpCommandForLog(command, args = [])',
      'export function summarizeMcpToolNamesForLog(names = [])',
      'export function summarizeMcpOutputLineForLog(line)',
      'Buffer.byteLength(text, \'utf8\')',
    ],
  },
  {
    id: 'model-downloader-redacts-progress-errors',
    file: 'electron/services/modelDownloader.js',
    phrases: [
      "import { getRedactedErrorMessage } from './errorRedaction.js'",
      "emit({ phase: 'error', message: getRedactedErrorMessage(error) })",
    ],
  },
  {
    id: 'model-manager-redacts-progress-errors',
    file: 'electron/services/modelManager.js',
    phrases: [
      "import { getRedactedErrorMessage } from './errorRedaction.js'",
      'message: getRedactedErrorMessage(error)',
    ],
  },
  {
    id: 'updater-service-redacts-update-errors',
    file: 'electron/services/updaterService.js',
    phrases: [
      "import { getRedactedErrorMessage } from './errorRedaction.js'",
      "console.warn('[updater] failed to send event to renderer:', getRedactedErrorMessage(error))",
      "console.warn('[updater] initial manual check failed:', getRedactedErrorMessage(error))",
      "message: getRedactedErrorMessage(error ?? 'unknown error')",
      'const reason = getRedactedErrorMessage(error)',
      'reason: getRedactedErrorMessage(error)',
      "console.warn('[updater] failed to open release page:', getRedactedErrorMessage(error))",
    ],
  },
  {
    id: 'vts-bridge-redacts-status-errors',
    file: 'electron/services/vtsBridge.js',
    phrases: [
      "import { getRedactedErrorMessage } from './errorRedaction.js'",
      'const message = getRedactedErrorMessage(error)',
      "const message = getRedactedErrorMessage(error || 'WebSocket connection failed')",
    ],
  },
  {
    id: 'vts-ipc-redacts-audit-errors',
    file: 'electron/ipc/vtsBridgeIpc.js',
    phrases: [
      "import { getRedactedErrorMessage } from '../services/errorRedaction.js'",
      'error: getRedactedErrorMessage(error)',
    ],
  },
  {
    id: 'error-redaction-tests',
    file: 'tests/error-redaction.test.ts',
    phrases: [
      'main-process error redaction strips common API secrets',
      'main-process error redaction handles Error objects',
    ],
  },
  {
    id: 'renderer-log-redaction-helper',
    file: 'src/lib/logRedaction.ts',
    phrases: [
      'export function redactSensitiveLogText',
      'export function getRedactedLogErrorMessage',
      'Bearer ***',
      'sk-***',
      'AIza***',
      'jwt***',
      '[vault-slot]',
    ],
  },
  {
    id: 'app-error-boundaries-redact-support-logs-and-ui',
    file: 'src/app/errorBoundarySupport.ts',
    phrases: [
      "import { getRedactedLogErrorMessage, redactSensitiveLogText } from '../lib/logRedaction.ts'",
      'export function formatErrorBoundaryDetail',
      'export function formatComponentStackForLog',
    ],
  },
  {
    id: 'app-error-boundary-uses-redacted-detail',
    file: 'src/app/App.tsx',
    phrases: [
      "import { formatComponentStackForLog, formatErrorBoundaryDetail } from './errorBoundarySupport.ts'",
      "formatErrorBoundaryDetail(error, translate('app.error_boundary.unknown_detail'))",
      'formatComponentStackForLog(info.componentStack)',
      "formatErrorBoundaryDetail(this.state.error, translate('app.error_boundary.unknown_detail'))",
    ],
  },
  {
    id: 'root-error-boundary-uses-redacted-detail',
    file: 'src/app/ErrorBoundary.tsx',
    phrases: [
      "import { formatComponentStackForLog, formatErrorBoundaryDetail } from './errorBoundarySupport.ts'",
      "formatErrorBoundaryDetail(error, translate('app.error_boundary.unknown_detail'))",
      'formatComponentStackForLog(info.componentStack)',
      "formatErrorBoundaryDetail(this.state.error, translate('app.error_boundary.unknown_detail'))",
    ],
  },
  {
    id: 'app-error-boundary-redaction-tests',
    file: 'tests/app-error-boundary.test.ts',
    phrases: [
      'error boundary detail redacts secrets before rendering fallback UI',
      'error boundary component stack log redacts local paths',
    ],
  },
  {
    id: 'chat-migration-preview-redacts-ui-errors',
    file: 'src/lib/storage/chatMigrationPreview.ts',
    phrases: [
      "import { getRedactedLogErrorMessage } from '../logRedaction.ts'",
      'export function formatChatMigrationUiError',
      'getRedactedLogErrorMessage(error).trim()',
    ],
  },
  {
    id: 'chat-migration-preview-panel-uses-redacted-ui-errors',
    file: 'src/components/settingsSections/ChatMigrationPreviewPanel.tsx',
    phrases: [
      'formatChatMigrationUiError',
      'result: createMigrationStatusError(error)',
      'result: createMigrationComparisonError(error)',
      'error: formatChatMigrationUiError(error)',
      'error: formatChatMigrationUiError(result.errorMessage || result.errorKind || \'unknown\')',
      'error: formatChatMigrationUiError(localStatusResult.errorMessage || localStatusResult.errorKind || \'unknown\')',
      'error: formatChatMigrationUiError(comparisonResult.errorMessage || comparisonResult.errorKind || \'unknown\')',
    ],
  },
  {
    id: 'chat-section-redacts-character-card-errors',
    file: 'src/components/settingsSections/ChatSection.tsx',
    phrases: [
      "import { getRedactedLogErrorMessage } from '../../lib/logRedaction.ts'",
      'error: getRedactedLogErrorMessage(err)',
    ],
  },
  {
    id: 'diagnostics-panel-redacts-copy-errors',
    file: 'src/components/settingsSections/DiagnosticsPanel.tsx',
    phrases: [
      "import { getRedactedLogErrorMessage } from '../../lib/logRedaction.ts'",
      'message: getRedactedLogErrorMessage(err)',
    ],
  },
  {
    id: 'settings-integrations-redacts-inspection-errors',
    file: 'src/components/settingsSections/IntegrationsSection.tsx',
    phrases: [
      "import { getRedactedLogErrorMessage } from '../../lib/logRedaction.ts'",
      'setInspectionError(getRedactedLogErrorMessage(error))',
    ],
  },
  {
    id: 'settings-context-redacts-reminder-errors',
    file: 'src/components/settingsSections/ContextSection.tsx',
    phrases: [
      "import { getRedactedLogErrorMessage } from '../../lib/logRedaction.ts'",
      "message: getRedactedLogErrorMessage(error) || ti('settings.context.error.save_failed')",
      "message: getRedactedLogErrorMessage(error) || ti('settings.context.error.template_failed')",
    ],
  },
  {
    id: 'settings-chat-history-redacts-action-errors',
    file: 'src/components/settingsDrawerHooks/useChatHistoryActions.ts',
    phrases: [
      "import { getRedactedLogErrorMessage } from '../../lib/logRedaction.ts'",
      "message: getRedactedLogErrorMessage(error) || t('settings.chat_history.export_error')",
      "message: getRedactedLogErrorMessage(error) || t('settings.chat_history.import_error')",
      "message: getRedactedLogErrorMessage(error) || t('settings.chat_history.clear_error')",
    ],
  },
  {
    id: 'settings-memory-archive-redacts-action-errors',
    file: 'src/components/settingsDrawerHooks/useMemoryArchiveActions.ts',
    phrases: [
      "import { getRedactedLogErrorMessage } from '../../lib/logRedaction.ts'",
      "message: getRedactedLogErrorMessage(error) || t('settings.memory.export_error')",
      "message: getRedactedLogErrorMessage(error) || t('settings.memory.import_error')",
      "message: getRedactedLogErrorMessage(error) || t('settings.memory.clear_error')",
    ],
  },
  {
    id: 'settings-speech-redacts-action-errors',
    file: 'src/components/settingsDrawerHooks/useSpeechVoiceManagement.ts',
    phrases: [
      "import { getRedactedLogErrorMessage } from '../../lib/logRedaction.ts'",
      "message: getRedactedLogErrorMessage(error) || t('settings.voice.fetch_voices_error')",
      "message: getRedactedLogErrorMessage(error) || t('settings.voice.preview_error')",
      "message: getRedactedLogErrorMessage(error) || t('settings.voice.audio_smoke_error')",
    ],
  },
  {
    id: 'settings-pet-import-redacts-action-errors',
    file: 'src/components/settingsDrawerHooks/usePetModelImport.ts',
    phrases: [
      "import { getRedactedLogErrorMessage } from '../../lib/logRedaction.ts'",
      'function getPetImportErrorMessage(error: unknown)',
      "return getRedactedLogErrorMessage(error) || t('settings.pet.import_error')",
      'message: getPetImportErrorMessage(error)',
    ],
  },
  {
    id: 'settings-export-panels-redact-support-logs',
    file: 'src/components/settingsSections/LettersSection.tsx',
    phrases: [
      "import { getRedactedLogErrorMessage } from '../../lib/logRedaction.ts'",
      "console.warn('[letter-export] failed:', getRedactedLogErrorMessage(err))",
    ],
  },
  {
    id: 'settings-yearbook-redacts-support-logs',
    file: 'src/components/settingsSections/MoodMapPanel.tsx',
    phrases: [
      "import { getRedactedLogErrorMessage } from '../../lib/logRedaction.ts'",
      "console.warn('[yearbook] failed:', getRedactedLogErrorMessage(err))",
    ],
  },
  {
    id: 'settings-drawer-redacts-locale-load-errors',
    file: 'src/components/SettingsDrawer.tsx',
    phrases: [
      "import { getRedactedLogErrorMessage } from '../lib/logRedaction.ts'",
      "console.error('[settings] Failed to load locale:', nextLanguage, getRedactedLogErrorMessage(error))",
      "console.error('[settings] Failed to load locale:', draft.uiLanguage, getRedactedLogErrorMessage(error))",
    ],
  },
  {
    id: 'i18n-provider-redacts-locale-load-errors',
    file: 'src/app/providers/I18nProvider.tsx',
    phrases: [
      "import { getRedactedLogErrorMessage } from '../../lib/logRedaction.ts'",
      "console.error('[i18n] Failed to load locale:', normalizedLocale, getRedactedLogErrorMessage(error))",
    ],
  },
  {
    id: 'memory-recall-redacts-vector-support-logs',
    file: 'src/features/memory/recall.ts',
    phrases: [
      "import { getRedactedLogErrorMessage } from '../../lib/logRedaction.ts'",
      "console.warn('[memory] Vector index queue job failed:', getRedactedLogErrorMessage(err))",
      "console.warn('[Memory] Vector index batch failed:', getRedactedLogErrorMessage(error))",
      "console.warn('[Memory] Hybrid search failed, falling back to vector-only:', getRedactedLogErrorMessage(error))",
      "console.warn('[Memory] Vector search failed, falling back to per-item embeddings:', getRedactedLogErrorMessage(error))",
      "console.warn('[Memory] Score map build failed, falling back to keyword-only:', getRedactedLogErrorMessage(error))",
    ],
  },
  {
    id: 'lorebook-injection-redacts-semantic-support-logs',
    file: 'src/features/chat/lorebookInjection.ts',
    phrases: [
      "import { getRedactedLogErrorMessage } from '../../lib/logRedaction.ts'",
      "console.warn('[lorebook] semantic query embedding failed; keyword-only:', getRedactedLogErrorMessage(err))",
    ],
  },
  {
    id: 'scheduler-hooks-redact-support-logs',
    file: 'src/hooks/useReminderScheduler.ts',
    phrases: [
      "import { getRedactedLogErrorMessage } from '../lib/logRedaction.ts'",
      "console.warn('[reminder] onTrigger failed:', getRedactedLogErrorMessage(err))",
    ],
  },
  {
    id: 'away-scheduler-redacts-support-logs',
    file: 'src/hooks/useAwayNotificationScheduler.ts',
    phrases: [
      "import { getRedactedLogErrorMessage } from '../lib/logRedaction.ts'",
      "console.warn('[awayNotification] fire failed:', getRedactedLogErrorMessage(err))",
    ],
  },
  {
    id: 'future-capsule-scheduler-redacts-support-logs',
    file: 'src/hooks/useFutureCapsuleScheduler.ts',
    phrases: [
      "import { getRedactedLogErrorMessage } from '../lib/logRedaction.ts'",
      "console.warn('[future-capsule] delivery failed:', getRedactedLogErrorMessage(err))",
    ],
  },
  {
    id: 'errand-scheduler-redacts-support-logs',
    file: 'src/hooks/useErrandScheduler.ts',
    phrases: [
      "import { getRedactedLogErrorMessage } from '../lib/logRedaction.ts'",
      "console.warn('[errand] scheduler tick failed:', getRedactedLogErrorMessage(err))",
    ],
  },
  {
    id: 'open-arc-scheduler-redacts-support-logs',
    file: 'src/hooks/useOpenArcScheduler.ts',
    phrases: [
      "import { getRedactedLogErrorMessage } from '../lib/logRedaction.ts'",
      "console.warn('[open-arc] check-in delivery failed:', getRedactedLogErrorMessage(err))",
    ],
  },
  {
    id: 'bracket-scheduler-redacts-support-logs',
    file: 'src/hooks/useBracketScheduler.ts',
    phrases: [
      "import { getRedactedLogErrorMessage } from '../lib/logRedaction.ts'",
      "console.warn('[bracket] fire failed:', getRedactedLogErrorMessage(err))",
    ],
  },
  {
    id: 'autonomy-tick-redacts-support-logs',
    file: 'src/hooks/useAutonomyTick.ts',
    phrases: [
      "import { getRedactedLogErrorMessage } from '../lib/logRedaction.ts'",
      "console.warn('[Autonomy] tick callback rejected:', getRedactedLogErrorMessage(err))",
      "console.warn('[Autonomy] tick callback error:', getRedactedLogErrorMessage(error))",
    ],
  },
  {
    id: 'letter-scheduler-redacts-debug-errors',
    file: 'src/hooks/useLetterScheduler.ts',
    phrases: [
      "import { getRedactedLogErrorMessage } from '../lib/logRedaction.ts'",
      'detail: getRedactedLogErrorMessage(err)',
    ],
  },
  {
    id: 'memory-dream-redacts-debug-errors',
    file: 'src/hooks/useMemoryDream.ts',
    phrases: [
      "import { getRedactedLogErrorMessage } from '../lib/logRedaction.ts'",
      'detail: getRedactedLogErrorMessage(callbackError)',
      'detail: getRedactedLogErrorMessage(error)',
    ],
  },
  {
    id: 'gateway-hooks-redact-renderer-status-errors',
    file: 'src/hooks/useTelegramGateway.ts',
    phrases: [
      "import { getRedactedLogErrorMessage } from '../lib/logRedaction.ts'",
      'lastError: s.lastError ? getRedactedLogErrorMessage(s.lastError) : null',
      'lastError: getRedactedLogErrorMessage(err)',
    ],
  },
  {
    id: 'discord-gateway-hook-redacts-renderer-status-errors',
    file: 'src/hooks/useDiscordGateway.ts',
    phrases: [
      "import { getRedactedLogErrorMessage } from '../lib/logRedaction.ts'",
      'lastError: s.lastError ? getRedactedLogErrorMessage(s.lastError) : null',
      'lastError: getRedactedLogErrorMessage(err)',
    ],
  },
  {
    id: 'game-integration-redacts-support-logs',
    file: 'src/hooks/useGameIntegration.ts',
    phrases: [
      "import { getRedactedLogErrorMessage } from '../lib/logRedaction.ts'",
      "console.warn('[game-integration] minecraft auto-connect failed:', getRedactedLogErrorMessage(err))",
      "console.warn('[game-integration] factorio auto-connect failed:', getRedactedLogErrorMessage(err))",
    ],
  },
  {
    id: 'mcp-server-sync-redacts-support-logs',
    file: 'src/hooks/useMcpServerSync.ts',
    phrases: [
      "import { getRedactedLogErrorMessage } from '../lib/logRedaction.ts'",
      "console.warn('[MCP] sync failed:', getRedactedLogErrorMessage(error))",
    ],
  },
  {
    id: 'local-data-status-uses-renderer-safe-fields',
    file: 'electron/services/localDataStore.js',
    phrases: [
      'function statusFromSqliteState(state, initialized = true)',
      'function statusFromError(error)',
      'storageDirectoryName: LOCAL_DATA_DIR_NAME',
      'export function getLocalDataStatus()',
      'return { ...runtimeStatus }',
      'Local data adapter is unavailable; existing renderer storage remains authoritative.',
    ],
  },
  {
    id: 'local-data-status-ipc-stays-trusted-and-shaped',
    file: 'electron/ipc/localDataIpc.js',
    phrases: [
      "ipcMain.handle('local-data:status'",
      'requireTrustedSender(event)',
      'return getLocalDataStatus()',
    ],
  },
  {
    id: 'renderer-storage-core-redacts-support-logs',
    file: 'src/lib/storage/core.ts',
    phrases: [
      "import { getRedactedLogErrorMessage } from '../logRedaction.ts'",
      'export function formatStorageKeyForLog',
      'formatStorageKeyForLog(key)',
      'getRedactedLogErrorMessage(err)',
    ],
  },
  {
    id: 'chat-storage-redacts-legacy-migration-logs',
    file: 'src/lib/storage/chatSessions.ts',
    phrases: [
      "import { getRedactedLogErrorMessage } from '../logRedaction.ts'",
      "console.error('[chatSessions] legacy migration failed:', getRedactedLogErrorMessage(err))",
    ],
  },
  {
    id: 'chat-runtime-mirror-redacts-support-logs',
    file: 'src/hooks/chat/useChatPersistence.ts',
    phrases: [
      "import { getRedactedLogErrorMessage } from '../../lib/logRedaction'",
      "console.warn('[chatLocalDataRuntimeMirror] mirror failed:', getRedactedLogErrorMessage(reason))",
      "console.warn('[chatLocalDataRuntimeMirror] mirror failed:', getRedactedLogErrorMessage(error))",
    ],
  },
  {
    id: 'system-prompt-builder-redacts-persona-support-logs',
    file: 'src/features/chat/systemPromptBuilder.ts',
    phrases: [
      "import { getRedactedLogErrorMessage } from '../../lib/logRedaction.ts'",
      "console.warn('[runtime] Per-profile persona load failed, using global SOUL.md:', getRedactedLogErrorMessage(err))",
      "console.warn('[runtime] Persona file loading failed, using settings fallback:', getRedactedLogErrorMessage(err))",
    ],
  },
  {
    id: 'renderer-vts-redacts-support-logs',
    file: 'src/features/pet/vts/useVTSBridge.ts',
    phrases: [
      "import { getRedactedLogErrorMessage } from '../../../lib/logRedaction'",
      "console.warn('[VTS] Failed to update bridge input:', getRedactedLogErrorMessage(error))",
      "console.warn('[VTS]', getRedactedLogErrorMessage(error))",
      "console.warn('[VTS] Failed to migrate legacy auth token:', getRedactedLogErrorMessage(error))",
    ],
  },
  {
    id: 'plugin-host-redacts-support-logs',
    file: 'electron/services/pluginHost.js',
    phrases: [
      "import { getRedactedErrorMessage } from './errorRedaction.js'",
      'formatPluginDirectoryEntryLogLabel(entry)',
      'formatPluginLogLabel(plugin)',
      "console.error('[pluginHost] Failed to load approved plugins:', getRedactedErrorMessage(err))",
      'skipping plugin entry (${formatPluginDirectoryEntryLogLabel(entry)}):',
      'user approved plugin (${formatPluginLogLabel(plugin)})',
      'user rejected plugin (${formatPluginLogLabel(plugin)})',
      'auto-started plugin (${formatPluginLogLabel(plugin)})',
      'auto-start failed (${formatPluginLogLabel(plugin)}):',
      'getRedactedErrorMessage(err)',
    ],
  },
  {
    id: 'plugin-ipc-returns-renderer-safe-plugin-surfaces',
    file: 'electron/ipc/pluginIpc.js',
    phrases: [
      'await pluginHost.scanPlugins()',
      'return pluginHost.listPlugins()',
      'return pluginHost.getPluginsDisplayDir_()',
    ],
  },
  {
    id: 'plugin-host-display-directory-helper',
    file: 'electron/services/pluginHost.js',
    phrases: [
      "const USER_DATA_DISPLAY_ROOT = 'app-user-data'",
      'function getPluginsDisplayDir()',
      'return `${USER_DATA_DISPLAY_ROOT}/${PLUGINS_DIR_NAME}`',
      'export function getPluginsDisplayDir_()',
    ],
  },
  {
    id: 'plugin-host-utils-log-summarizers',
    file: 'electron/services/pluginHostUtils.js',
    phrases: [
      'export function formatPluginLogLabel(plugin)',
      'export function formatPluginDirectoryEntryLogLabel(entry)',
      'idLength=${String(plugin?.id ?? \'\').length}',
      'entryLength=${String(entry ?? \'\').length}',
    ],
  },
  {
    id: 'memory-vector-store-redacts-support-logs',
    file: 'electron/services/memoryVectorStore.js',
    phrases: [
      "import { getRedactedErrorMessage } from './errorRedaction.js'",
      "console.error('[memoryVectorStore] worker error:', getRedactedErrorMessage(err))",
      "console.warn('[memoryVectorStore] periodic compact failed:', getRedactedErrorMessage(err))",
      "console.warn('[memoryVectorStore] log append failed:', getRedactedErrorMessage(err))",
      "console.error('[memoryVectorStore] compaction rename failed:', getRedactedErrorMessage(err))",
      "console.error('[memoryVectorStore] compaction failed:', getRedactedErrorMessage(err))",
    ],
  },
  {
    id: 'memory-vector-store-batches-log-appends',
    file: 'electron/services/memoryVectorStore.js',
    phrases: [
      "import { MemoryVectorLogAppendBuffer } from './memoryVectorLogBuffer.js'",
      'let _logAppendBuffer = null',
      'function getLogAppendBuffer()',
      'new MemoryVectorLogAppendBuffer',
      '.enqueue(line)',
      'async function drainLogAppends()',
      'await drainLogAppends()',
    ],
  },
  {
    id: 'memory-vector-stats-use-renderer-safe-paths',
    file: 'electron/services/memoryVectorStore.js',
    phrases: [
      "const STORE_DISPLAY_PATH = `app-user-data/${STORE_FILENAME}`",
      "const LOG_DISPLAY_PATH = `app-user-data/${LOG_FILENAME}`",
      'storePath: STORE_DISPLAY_PATH',
      'logPath: LOG_DISPLAY_PATH',
    ],
  },
  {
    id: 'persona-loader-uses-renderer-safe-display-paths',
    file: 'electron/services/personaLoader.js',
    phrases: [
      "const USER_DATA_DISPLAY_ROOT = 'app-user-data'",
      'function getDisplayPath(...segments)',
      'return getPersonaPaths()',
      'export function getPersonaAbsolutePaths()',
      'export function getPersonaPaths()',
      'personaDir: getDisplayPath(PERSONA_DIR)',
      'soulPath: getDisplayPath(PERSONA_DIR, SOUL_FILE)',
      'memoryPath: getDisplayPath(PERSONA_DIR, MEMORY_FILE)',
      'export function getPersonaProfileDisplayDir(profileId)',
      'return getDisplayPath(V2_PERSONAS_DIR, safe || \'default\')',
      'rootDir: getPersonaProfileDisplayDir(profileId)',
    ],
  },
  {
    id: 'persona-ipc-keeps-open-dir-absolute-and-renderer-paths-safe',
    file: 'electron/ipc/personaIpc.js',
    phrases: [
      'const paths = personaLoader.getPersonaAbsolutePaths()',
      'shell.openPath(paths.personaDir)',
      'return { dir: personaLoader.getPersonaProfileDisplayDir(profileId) }',
    ],
  },
  {
    id: 'skill-store-uses-renderer-safe-stats-path',
    file: 'electron/services/skillStore.js',
    phrases: [
      "const USER_DATA_DISPLAY_ROOT = 'app-user-data'",
      'function getSkillsDisplayDir()',
      'return `${USER_DATA_DISPLAY_ROOT}/${SKILLS_DIR}`',
      'skillsDir: getSkillsDisplayDir()',
    ],
  },
  {
    id: 'memory-vector-log-buffer-helper',
    file: 'electron/services/memoryVectorLogBuffer.js',
    phrases: [
      'MEMORY_VECTOR_LOG_FLUSH_INTERVAL_MS',
      'MEMORY_VECTOR_LOG_FLUSH_BATCH_SIZE',
      'export class MemoryVectorLogAppendBuffer',
      'this.lines = []',
      'this.waiters = []',
      'enqueue(line)',
      'scheduleFlush()',
      'async drain()',
    ],
  },
  {
    id: 'memory-vector-log-buffer-tests',
    file: 'tests/memory-vector-log-buffer.test.ts',
    phrases: [
      'memory vector log buffer batches mutation lines before append',
      'memory vector log buffer drain flushes partial tails',
      'memory vector log buffer drains lines queued during an in-flight append',
      'memory vector log buffer rejects queued lines when append fails',
      'memory vector log buffer exposes conservative batching defaults',
    ],
  },
]
