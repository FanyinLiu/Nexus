import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  getRedactedErrorMessage,
  redactSensitiveErrorText,
} from '../electron/services/errorRedaction.js'
import {
  getRedactedLogErrorMessage,
  redactSensitiveLogText,
} from '../src/lib/logRedaction.ts'
import { buildErrorRedactionReport } from '../scripts/error-redaction-audit.mjs'

test('main-process error redaction strips common API secrets', () => {
  const raw = [
    'Authorization: Bearer sk-ABCDEF1234567890XYZ',
    'api_key=AIza012345678901234567890123456789012',
    'client_secret=sup3rs3cr3tvalue',
    'refresh_token: local-refresh-secret',
    'password=hunter2-secret',
    '{"pwd":"main-process-pwd"}',
    '{"apiKey":"main-process-secret"}',
    'vault=settings:apiKey',
    'profile:text:openai:apiKey',
    'refresh_token=eyJabcdefghi.abcdefghi.abcd',
    'proxy=https://user:pass@my-proxy.example.com',
    'home=/Users/klein/.config/private.json',
  ].join(' ')

  const redacted = redactSensitiveErrorText(raw)

  assert.match(redacted, /Bearer \*\*\*/)
  assert.match(redacted, /api_key=\*\*\*/)
  assert.match(redacted, /client_secret=\*\*\*/)
  assert.match(redacted, /refresh_token: \*\*\*/)
  assert.match(redacted, /password=\*\*\*/)
  assert.match(redacted, /"pwd":"\*\*\*"/)
  assert.match(redacted, /"apiKey":"\*\*\*"/)
  assert.match(redacted, /vault=\[vault-slot\]/)
  assert.match(redacted, /refresh_token=\*\*\*/)
  assert.match(redacted, /\*\*\*:\*\*\*@my-proxy\.example\.com/)
  assert.match(redacted, /home=~\/\.config\/private\.json/)

  assert.doesNotMatch(redacted, /sk-ABCDEF1234567890XYZ/)
  assert.doesNotMatch(redacted, /AIza012345678901234567890123456789012/)
  assert.doesNotMatch(redacted, /sup3rs3cr3tvalue/)
  assert.doesNotMatch(redacted, /local-refresh-secret/)
  assert.doesNotMatch(redacted, /hunter2-secret/)
  assert.doesNotMatch(redacted, /main-process-pwd/)
  assert.doesNotMatch(redacted, /main-process-secret/)
  assert.doesNotMatch(redacted, /settings:apiKey/)
  assert.doesNotMatch(redacted, /profile:text:openai:apiKey/)
  assert.doesNotMatch(redacted, /eyJabcdefghi\.abcdefghi\.abcd/)
  assert.doesNotMatch(redacted, /user:pass/)
  assert.doesNotMatch(redacted, /\/Users\/klein/)
})

test('main-process error redaction handles Error objects', () => {
  const redacted = getRedactedErrorMessage(new Error('upstream echoed token=xai-abcdefghijklmnop'))

  assert.equal(redacted, 'upstream echoed token=***')
  assert.doesNotMatch(redacted, /xai-abcdefghijklmnop/)
})

test('renderer log redaction strips common API secrets', () => {
  const redacted = redactSensitiveLogText([
    'Authorization: Bearer sk-ABCDEF1234567890XYZ',
    'api_key=AIza012345678901234567890123456789012',
    'token=xai-abcdefghijklmnop',
    'client_secret: sup3rs3cr3tvalue',
    'passwd: local-renderer-password',
    '{"password":"renderer-password-secret"}',
    '{"apiKey":"local-development-secret"}',
    'vault=settings:apiKey',
    'profile:text:openai:apiKey',
    'file=/Users/klein/private/settings.json',
  ].join(' '))

  assert.match(redacted, /Bearer \*\*\*/)
  assert.match(redacted, /api_key=\*\*\*/)
  assert.match(redacted, /token=\*\*\*/)
  assert.match(redacted, /client_secret: \*\*\*/)
  assert.match(redacted, /passwd: \*\*\*/)
  assert.match(redacted, /"password":"\*\*\*"/)
  assert.match(redacted, /"apiKey":"\*\*\*"/)
  assert.match(redacted, /vault=\[vault-slot\]/)
  assert.match(redacted, /file=~\/private\/settings\.json/)
  assert.doesNotMatch(redacted, /sk-ABCDEF1234567890XYZ/)
  assert.doesNotMatch(redacted, /AIza012345678901234567890123456789012/)
  assert.doesNotMatch(redacted, /xai-abcdefghijklmnop/)
  assert.doesNotMatch(redacted, /sup3rs3cr3tvalue/)
  assert.doesNotMatch(redacted, /local-renderer-password/)
  assert.doesNotMatch(redacted, /renderer-password-secret/)
  assert.doesNotMatch(redacted, /local-development-secret/)
  assert.doesNotMatch(redacted, /settings:apiKey/)
  assert.doesNotMatch(redacted, /profile:text:openai:apiKey/)
  assert.doesNotMatch(redacted, /\/Users\/klein/)
})

test('renderer log redaction handles Error objects', () => {
  const redacted = getRedactedLogErrorMessage(new Error('VTS auth failed token=xai-abcdefghijklmnop at /Users/klein/app'))

  assert.equal(redacted, 'VTS auth failed token=*** at ~/app')
})

test('main-process and renderer log redaction stay behaviorally aligned', () => {
  const samples = [
    'Authorization: Bearer sk-ABCDEF1234567890XYZ',
    'api_key=AIza012345678901234567890123456789012',
    'token=xai-abcdefghijklmnop',
    'client_secret: sup3rs3cr3tvalue',
    'password=hunter2-secret',
    '{"pwd":"shared-pwd-secret"}',
    '{"apiKey":"shared-development-secret"}',
    'profile:text:openai:apiKey',
    'refresh_token=eyJabcdefghi.abcdefghi.abcd',
    'proxy=https://user:pass@my-proxy.example.com',
    'mac=/Users/klein/private/settings.json',
    'linux=/home/klein/private/settings.json',
    String.raw`win=C:\Users\klein\private\settings.json`,
  ]

  for (const sample of samples) {
    assert.equal(
      redactSensitiveErrorText(sample),
      redactSensitiveLogText(sample),
      `redaction drift for sample: ${sample}`,
    )
  }
})

test('error redaction audit covers VTS bridge renderer-facing errors', () => {
  const report = buildErrorRedactionReport()

  assert.equal(report.summary.errors, 0)
  assert.ok(report.checkedFiles.includes('electron/services/vtsBridge.js'))
  assert.ok(report.checkedFiles.includes('electron/ipc/vtsBridgeIpc.js'))
  assert.ok(report.checkedFiles.includes('src/features/pet/vts/useVTSBridge.ts'))
  assert.ok(report.checkedFiles.includes('src/lib/logRedaction.ts'))
})

test('error redaction audit covers updater renderer-facing errors', () => {
  const report = buildErrorRedactionReport()

  assert.equal(report.summary.errors, 0)
  assert.ok(report.checkedFiles.includes('electron/services/updaterService.js'))
})

test('error redaction audit covers model download renderer-facing errors', () => {
  const report = buildErrorRedactionReport()

  assert.equal(report.summary.errors, 0)
  assert.ok(report.checkedFiles.includes('electron/services/modelDownloader.js'))
  assert.ok(report.checkedFiles.includes('electron/services/modelManager.js'))
})

test('error redaction audit covers audit log support logs', () => {
  const report = buildErrorRedactionReport()

  assert.equal(report.summary.errors, 0)
  assert.ok(report.checkedFiles.includes('electron/services/auditLog.js'))
})

test('error redaction audit covers window asset support logs', () => {
  const report = buildErrorRedactionReport()

  assert.equal(report.summary.errors, 0)
  assert.ok(report.checkedFiles.includes('electron/windowAssets.js'))
})

test('error redaction audit covers window manager support logs', () => {
  const report = buildErrorRedactionReport()

  assert.equal(report.summary.errors, 0)
  assert.ok(report.checkedFiles.includes('electron/windowManager.js'))
})

test('error redaction audit covers main process startup support logs', () => {
  const report = buildErrorRedactionReport()

  assert.equal(report.summary.errors, 0)
  assert.ok(report.checkedFiles.includes('electron/main.js'))
})

test('error redaction audit covers permission support logs', () => {
  const report = buildErrorRedactionReport()

  assert.equal(report.summary.errors, 0)
  assert.ok(report.checkedFiles.includes('electron/services/macPermissions.js'))
  assert.ok(report.checkedFiles.includes('electron/services/windowsPermissions.js'))
})

test('error redaction audit covers local UI persistence support logs', () => {
  const report = buildErrorRedactionReport()

  assert.equal(report.summary.errors, 0)
  assert.ok(report.checkedFiles.includes('electron/services/petPrefsStore.js'))
  assert.ok(report.checkedFiles.includes('electron/services/windowBoundsStore.js'))
})

test('error redaction audit covers chat gateway renderer-facing errors', () => {
  const report = buildErrorRedactionReport()

  assert.equal(report.summary.errors, 0)
  assert.ok(report.checkedFiles.includes('electron/services/telegramGateway.js'))
  assert.ok(report.checkedFiles.includes('electron/services/discordGateway.js'))
})

test('error redaction audit covers speech service support logs', () => {
  const report = buildErrorRedactionReport()

  assert.equal(report.summary.errors, 0)
  assert.ok(report.checkedFiles.includes('electron/services/tencentAsr.js'))
  assert.ok(report.checkedFiles.includes('electron/services/ttsService.js'))
  assert.ok(report.checkedFiles.includes('electron/ttsStreamService.js'))
})

test('error redaction audit covers notification watcher renderer-facing errors', () => {
  const report = buildErrorRedactionReport()

  assert.equal(report.summary.errors, 0)
  assert.ok(report.checkedFiles.includes('electron/services/macNotificationWatcher.js'))
})

test('error redaction audit covers notification bridge support logs', () => {
  const report = buildErrorRedactionReport()

  assert.equal(report.summary.errors, 0)
  assert.ok(report.checkedFiles.includes('electron/services/notificationBridge.js'))
  assert.ok(report.checkedFiles.includes('electron/services/notificationBridgeUtils.js'))
})

test('error redaction audit covers MCP host support logs', () => {
  const report = buildErrorRedactionReport()

  assert.equal(report.summary.errors, 0)
  assert.ok(report.checkedFiles.includes('electron/services/mcpHost.js'))
  assert.ok(report.checkedFiles.includes('electron/services/mcpHostUtils.js'))
})

test('error redaction audit covers plugin host support logs and renderer-safe surfaces', () => {
  const report = buildErrorRedactionReport()

  assert.equal(report.summary.errors, 0)
  assert.ok(report.checkedFiles.includes('electron/services/pluginHost.js'))
  assert.ok(report.checkedFiles.includes('electron/services/pluginHostUtils.js'))
  assert.ok(report.checkedFiles.includes('electron/ipc/pluginIpc.js'))
})

test('error redaction audit covers memory vector store support logs and safe stats', () => {
  const report = buildErrorRedactionReport()

  assert.equal(report.summary.errors, 0)
  assert.ok(report.checkedFiles.includes('electron/services/memoryVectorStore.js'))
  assert.ok(report.checkedFiles.includes('electron/services/memoryVectorLogBuffer.js'))
  assert.ok(report.checkedFiles.includes('tests/memory-vector-log-buffer.test.ts'))
})

test('error redaction audit covers renderer memory recall support logs', () => {
  const report = buildErrorRedactionReport()

  assert.equal(report.summary.errors, 0)
  assert.ok(report.checkedFiles.includes('src/features/memory/recall.ts'))
})

test('error redaction audit covers scheduler support logs and debug events', () => {
  const report = buildErrorRedactionReport()

  assert.equal(report.summary.errors, 0)
  assert.ok(report.checkedFiles.includes('src/hooks/useReminderScheduler.ts'))
  assert.ok(report.checkedFiles.includes('src/hooks/useAwayNotificationScheduler.ts'))
  assert.ok(report.checkedFiles.includes('src/hooks/useFutureCapsuleScheduler.ts'))
  assert.ok(report.checkedFiles.includes('src/hooks/useErrandScheduler.ts'))
  assert.ok(report.checkedFiles.includes('src/hooks/useOpenArcScheduler.ts'))
  assert.ok(report.checkedFiles.includes('src/hooks/useBracketScheduler.ts'))
  assert.ok(report.checkedFiles.includes('src/hooks/useAutonomyTick.ts'))
  assert.ok(report.checkedFiles.includes('src/hooks/useLetterScheduler.ts'))
  assert.ok(report.checkedFiles.includes('src/hooks/useMemoryDream.ts'))
})

test('error redaction audit covers gateway and integration support logs', () => {
  const report = buildErrorRedactionReport()

  assert.equal(report.summary.errors, 0)
  assert.ok(report.checkedFiles.includes('src/hooks/useTelegramGateway.ts'))
  assert.ok(report.checkedFiles.includes('src/hooks/useDiscordGateway.ts'))
  assert.ok(report.checkedFiles.includes('src/hooks/useGameIntegration.ts'))
  assert.ok(report.checkedFiles.includes('src/hooks/useMcpServerSync.ts'))
  assert.ok(report.checkedFiles.includes('src/features/chat/lorebookInjection.ts'))
})

test('error redaction audit covers persona renderer-safe paths', () => {
  const report = buildErrorRedactionReport()

  assert.equal(report.summary.errors, 0)
  assert.ok(report.checkedFiles.includes('electron/services/personaLoader.js'))
  assert.ok(report.checkedFiles.includes('electron/ipc/personaIpc.js'))
})

test('error redaction audit covers skill stats renderer-safe paths', () => {
  const report = buildErrorRedactionReport()

  assert.equal(report.summary.errors, 0)
  assert.ok(report.checkedFiles.includes('electron/services/skillStore.js'))
  assert.ok(report.checkedFiles.includes('electron/ipc/skillIpc.js'))
})

test('error redaction audit covers local-data renderer-safe status', () => {
  const report = buildErrorRedactionReport()

  assert.equal(report.summary.errors, 0)
  assert.ok(report.checkedFiles.includes('electron/services/localDataStore.js'))
  assert.ok(report.checkedFiles.includes('electron/ipc/localDataIpc.js'))
})

test('error redaction audit covers diagnostics feedback errors', () => {
  const report = buildErrorRedactionReport()

  assert.equal(report.summary.errors, 0)
  assert.ok(report.checkedFiles.includes('src/components/settingsSections/DiagnosticsPanel.tsx'))
})

test('error redaction audit covers settings reminder and integration feedback errors', () => {
  const report = buildErrorRedactionReport()

  assert.equal(report.summary.errors, 0)
  assert.ok(report.checkedFiles.includes('src/components/settingsSections/ChatSection.tsx'))
  assert.ok(report.checkedFiles.includes('src/components/settingsSections/ContextSection.tsx'))
  assert.ok(report.checkedFiles.includes('src/components/settingsSections/IntegrationsSection.tsx'))
})

test('error redaction audit covers settings archive action feedback errors', () => {
  const report = buildErrorRedactionReport()

  assert.equal(report.summary.errors, 0)
  assert.ok(report.checkedFiles.includes('src/components/settingsDrawerHooks/useChatHistoryActions.ts'))
  assert.ok(report.checkedFiles.includes('src/components/settingsDrawerHooks/useMemoryArchiveActions.ts'))
})

test('error redaction audit covers settings speech feedback errors', () => {
  const report = buildErrorRedactionReport()

  assert.equal(report.summary.errors, 0)
  assert.ok(report.checkedFiles.includes('src/components/settingsDrawerHooks/useSpeechVoiceManagement.ts'))
})

test('error redaction audit covers settings pet import feedback errors', () => {
  const report = buildErrorRedactionReport()

  assert.equal(report.summary.errors, 0)
  assert.ok(report.checkedFiles.includes('src/components/settingsDrawerHooks/usePetModelImport.ts'))
})

test('error redaction audit covers settings export and locale support logs', () => {
  const report = buildErrorRedactionReport()

  assert.equal(report.summary.errors, 0)
  assert.ok(report.checkedFiles.includes('src/components/settingsSections/LettersSection.tsx'))
  assert.ok(report.checkedFiles.includes('src/components/settingsSections/MoodMapPanel.tsx'))
  assert.ok(report.checkedFiles.includes('src/components/SettingsDrawer.tsx'))
  assert.ok(report.checkedFiles.includes('src/app/providers/I18nProvider.tsx'))
})

test('error redaction audit keeps local runtime logs out of version control', () => {
  const report = buildErrorRedactionReport()

  assert.equal(report.summary.errors, 0)
  assert.ok(report.checkedFiles.includes('.gitignore'))
})
