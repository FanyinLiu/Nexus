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
    'refresh_token=eyJabcdefghi.abcdefghi.abcd',
    'proxy=https://user:pass@my-proxy.example.com',
    'home=/Users/klein/.config/private.json',
  ].join(' ')

  const redacted = redactSensitiveErrorText(raw)

  assert.match(redacted, /Bearer \*\*\*/)
  assert.match(redacted, /api_key=\*\*\*/)
  assert.match(redacted, /client_secret=\*\*\*/)
  assert.match(redacted, /refresh_token=\*\*\*/)
  assert.match(redacted, /\*\*\*:\*\*\*@my-proxy\.example\.com/)
  assert.match(redacted, /home=~\/\.config\/private\.json/)

  assert.doesNotMatch(redacted, /sk-ABCDEF1234567890XYZ/)
  assert.doesNotMatch(redacted, /AIza012345678901234567890123456789012/)
  assert.doesNotMatch(redacted, /sup3rs3cr3tvalue/)
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
    'file=/Users/klein/private/settings.json',
  ].join(' '))

  assert.match(redacted, /Bearer \*\*\*/)
  assert.match(redacted, /api_key=\*\*\*/)
  assert.match(redacted, /token=\*\*\*/)
  assert.match(redacted, /file=~\/private\/settings\.json/)
  assert.doesNotMatch(redacted, /sk-ABCDEF1234567890XYZ/)
  assert.doesNotMatch(redacted, /AIza012345678901234567890123456789012/)
  assert.doesNotMatch(redacted, /xai-abcdefghijklmnop/)
  assert.doesNotMatch(redacted, /\/Users\/klein/)
})

test('renderer log redaction handles Error objects', () => {
  const redacted = getRedactedLogErrorMessage(new Error('VTS auth failed token=xai-abcdefghijklmnop at /Users/klein/app'))

  assert.equal(redacted, 'VTS auth failed token=*** at ~/app')
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

test('error redaction audit covers chat gateway renderer-facing errors', () => {
  const report = buildErrorRedactionReport()

  assert.equal(report.summary.errors, 0)
  assert.ok(report.checkedFiles.includes('electron/services/telegramGateway.js'))
  assert.ok(report.checkedFiles.includes('electron/services/discordGateway.js'))
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

test('error redaction audit covers plugin host support logs', () => {
  const report = buildErrorRedactionReport()

  assert.equal(report.summary.errors, 0)
  assert.ok(report.checkedFiles.includes('electron/services/pluginHost.js'))
  assert.ok(report.checkedFiles.includes('electron/services/pluginHostUtils.js'))
})
