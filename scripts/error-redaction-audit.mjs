#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const CHECKED_FILES = [
  'electron/services/errorRedaction.js',
  'electron/ipc/chatIpc.js',
  'electron/ipc/audioIpc.js',
  'electron/ipc/vtsBridgeIpc.js',
  'electron/net.js',
  'electron/services/discordGateway.js',
  'electron/services/macNotificationWatcher.js',
  'electron/services/mcpHost.js',
  'electron/services/mcpHostUtils.js',
  'electron/services/modelDownloader.js',
  'electron/services/modelManager.js',
  'electron/services/notificationBridge.js',
  'electron/services/notificationBridgeUtils.js',
  'electron/services/telegramGateway.js',
  'electron/services/updaterService.js',
  'electron/services/vtsBridge.js',
  'tests/error-redaction.test.ts',
]

const UNSAFE_PATTERNS = [
  {
    id: 'chat-ipc-raw-error-message',
    file: 'electron/ipc/chatIpc.js',
    pattern: /const\s+reason\s*=\s*error\s+instanceof\s+Error\s*\?\s*error\.message\s*:\s*String\(error\)/,
    message: 'chat IPC must redact caught error messages before logging or returning them',
  },
  {
    id: 'audio-ipc-raw-error-message',
    file: 'electron/ipc/audioIpc.js',
    pattern: /const\s+reason\s*=\s*error\s+instanceof\s+Error\s*\?\s*error\.message\s*:\s*String\(error\)/,
    message: 'audio IPC must redact caught error messages before logging or returning them',
  },
  {
    id: 'chat-ipc-raw-stream-error-to-renderer',
    file: 'electron/ipc/chatIpc.js',
    pattern: /error:\s*streamError\s+instanceof\s+Error\s*\?\s*streamError\.message\s*:\s*String\(streamError\)/,
    message: 'stream terminal frames must not send raw provider error text to the renderer',
  },
  {
    id: 'vts-bridge-raw-status-error',
    file: 'electron/services/vtsBridge.js',
    pattern: /const\s+message\s*=\s*error\s+instanceof\s+Error\s*\?\s*error\.message\s*:\s*String\(error\)/,
    message: 'VTS bridge status errors must be redacted before broadcasting to renderer windows',
  },
  {
    id: 'vts-ipc-raw-audit-error',
    file: 'electron/ipc/vtsBridgeIpc.js',
    pattern: /error:\s*error\s+instanceof\s+Error\s*\?\s*error\.message\s*:\s*String\(error\)/,
    message: 'VTS bridge audit entries must not record raw error text',
  },
  {
    id: 'updater-service-raw-event-error',
    file: 'electron/services/updaterService.js',
    pattern: /message:\s*error\s+instanceof\s+Error\s*\?\s*error\.message\s*:\s*String\(error(?:\s*\?\?\s*'unknown error')?\)/,
    message: 'updater renderer events must not expose raw update error text',
  },
  {
    id: 'updater-service-raw-check-reason',
    file: 'electron/services/updaterService.js',
    pattern: /reason:\s*error\s+instanceof\s+Error\s*\?\s*error\.message\s*:\s*String\(error\)/,
    message: 'updater check results must not expose raw update error text',
  },
  {
    id: 'model-downloader-raw-progress-error',
    file: 'electron/services/modelDownloader.js',
    pattern: /message:\s*error\s+instanceof\s+Error\s*\?\s*error\.message\s*:\s*String\(error\)/,
    message: 'model download progress errors must be redacted before renderer broadcast',
  },
  {
    id: 'model-manager-raw-progress-error',
    file: 'electron/services/modelManager.js',
    pattern: /message:\s*error\s+instanceof\s+Error\s*\?\s*error\.message\s*:\s*String\(error\)/,
    message: 'model manager progress/results must not expose raw download error text',
  },
  {
    id: 'telegram-gateway-raw-last-error',
    file: 'electron/services/telegramGateway.js',
    pattern: /_lastError\s*=\s*err\.message/,
    message: 'Telegram gateway status errors must be redacted before renderer exposure',
  },
  {
    id: 'telegram-gateway-raw-error-log',
    file: 'electron/services/telegramGateway.js',
    pattern: /console\.(?:warn|error)\([^\n]+err\.message/,
    message: 'Telegram gateway logs must not record raw gateway error text',
  },
  {
    id: 'discord-gateway-raw-last-error',
    file: 'electron/services/discordGateway.js',
    pattern: /_lastError\s*=\s*err\.message/,
    message: 'Discord gateway status errors must be redacted before renderer exposure',
  },
  {
    id: 'discord-gateway-raw-error-log',
    file: 'electron/services/discordGateway.js',
    pattern: /console\.(?:warn|error)\([^\n]+err\.message/,
    message: 'Discord gateway logs must not record raw gateway error text',
  },
  {
    id: 'mac-notification-watcher-raw-status-error',
    file: 'electron/services/macNotificationWatcher.js',
    pattern: /setStatus\([^,\n]+,\s*err\?\.message\s*\?\?\s*String\(err\)\)/,
    message: 'macOS notification watcher status errors must be redacted before renderer exposure',
  },
  {
    id: 'mac-notification-watcher-raw-error-log',
    file: 'electron/services/macNotificationWatcher.js',
    pattern: /console\.(?:warn|error)\([^\n]+err\.message/,
    message: 'macOS notification watcher logs must not record raw watcher error text',
  },
  {
    id: 'notification-bridge-raw-error-log',
    file: 'electron/services/notificationBridge.js',
    pattern: /console\.(?:warn|error)\([^\n]+err\?\.message/,
    message: 'notification bridge logs must not record raw bridge error text',
  },
  {
    id: 'notification-bridge-raw-channel-name-log',
    file: 'electron/services/notificationBridge.js',
    pattern: /console\.(?:warn|error)\([^\n]*\$\{channel\.name\}/,
    message: 'notification bridge logs must not record raw user-supplied channel names',
  },
  {
    id: 'notification-bridge-utils-raw-channel-name-log',
    file: 'electron/services/notificationBridgeUtils.js',
    pattern: /console\.warn\([^\n]*(?:\$\{name\}|raw\?\.kind|\$\{safety\.reason\})/,
    message: 'notification channel sanitization logs must stay metadata-only',
  },
  {
    id: 'mcp-host-raw-id-log',
    file: 'electron/services/mcpHost.js',
    pattern: /console\.(?:warn|error|info)\(\s*`?\[mcpHost:\$\{[^}]+}/,
    message: 'MCP host logs must not record raw server ids',
  },
  {
    id: 'mcp-host-raw-output-log',
    file: 'electron/services/mcpHost.js',
    pattern: /trimmed\.slice\(|unparseable line:\s*`,\s*trimmed/,
    message: 'MCP host logs must not record raw server stdout lines',
  },
  {
    id: 'mcp-host-raw-command-log',
    file: 'electron/services/mcpHost.js',
    pattern: /console\.info\([^\n]*(?:command,\s*args|spawning:)`?,\s*command/,
    message: 'MCP host logs must not record raw launch commands or arguments',
  },
  {
    id: 'mcp-host-raw-tool-list-log',
    file: 'electron/services/mcpHost.js',
    pattern: /console\.info\([^\n]*,\s*\[\.\.\.this\.tools\.keys\(\)\]/,
    message: 'MCP host logs must not record raw MCP tool names',
  },
  {
    id: 'mcp-host-raw-error-log',
    file: 'electron/services/mcpHost.js',
    pattern: /console\.(?:warn|error)\([^\n]+err(?:or)?\.message|err\?\.message/,
    message: 'MCP host logs must redact errors before support logs',
  },
  {
    id: 'net-extracts-raw-response-error',
    file: 'electron/net.js',
    pattern: /return\s+(?:data\?\.error\?\.message|text\.trim\(\)\s*\|\|)/,
    message: 'shared response-error extraction must redact provider response text',
  },
]

const REQUIRED_PHRASES = [
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
]

function readText(root, path) {
  return readFileSync(join(root, path), 'utf8')
}

export function buildErrorRedactionReport(root = ROOT) {
  const missingFiles = []
  const unsafePatterns = []
  const missingRequiredPhrases = []
  const sourceByFile = new Map()

  for (const file of CHECKED_FILES) {
    const fullPath = join(root, file)
    if (!existsSync(fullPath)) {
      missingFiles.push({ file })
      continue
    }
    sourceByFile.set(file, readText(root, file))
  }

  for (const item of UNSAFE_PATTERNS) {
    const source = sourceByFile.get(item.file)
    if (!source) continue
    if (item.pattern.test(source)) {
      unsafePatterns.push({
        id: item.id,
        file: item.file,
        message: item.message,
      })
    }
  }

  for (const item of REQUIRED_PHRASES) {
    const source = sourceByFile.get(item.file)
    if (!source) continue
    for (const phrase of item.phrases) {
      if (!source.includes(phrase)) {
        missingRequiredPhrases.push({ id: item.id, file: item.file, phrase })
      }
    }
  }

  const errors = { missingFiles, unsafePatterns, missingRequiredPhrases }
  const errorCount = Object.values(errors).reduce((sum, list) => sum + list.length, 0)

  return {
    checkedFiles: CHECKED_FILES,
    errors,
    summary: {
      ok: errorCount === 0,
      errors: errorCount,
      warnings: 0,
    },
    privacy: {
      staticSourceOnly: true,
      readsUserData: false,
      readsSecrets: false,
    },
  }
}

function formatHumanReport(report) {
  const lines = ['Error redaction audit']
  lines.push(`- checked files: ${report.checkedFiles.length}`)
  lines.push(`- static source only: ${report.privacy.staticSourceOnly}`)
  lines.push('')
  for (const [name, items] of Object.entries(report.errors)) {
    lines.push(`ERROR ${name}: ${items.length}`)
    if (items.length) {
      lines.push(`  ${items.slice(0, 8).map((item) => `${item.file}: ${item.id ?? item.phrase ?? item.message}`).join(', ')}`)
    }
  }
  lines.push('')
  lines.push(`Summary: ok=${report.summary.ok} errors=${report.summary.errors}`)
  return lines.join('\n')
}

function main(argv) {
  const report = buildErrorRedactionReport(ROOT)
  const json = argv.includes('--json') || argv.includes('--format=json')
  process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : `${formatHumanReport(report)}\n`)
  if (!report.summary.ok) process.exit(1)
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (invokedPath && resolve(fileURLToPath(import.meta.url)) === invokedPath) {
  main(process.argv.slice(2))
}
