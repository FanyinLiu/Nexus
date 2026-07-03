import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { buildErrorRedactionReport } from '../scripts/error-redaction-audit.mjs'
import { REQUIRED_PHRASES } from '../scripts/error-redaction-audit-phrases.mjs'
import { CHECKED_FILES } from '../scripts/error-redaction-audit-rules.mjs'

function buildBaselineContentByFile() {
  const contentByFile = new Map<string, string[]>()
  for (const file of CHECKED_FILES) {
    contentByFile.set(file, [`// Minimal fixture for ${file}`])
  }
  for (const item of REQUIRED_PHRASES) {
    const lines = contentByFile.get(item.file) ?? [`// Minimal fixture for ${item.file}`]
    lines.push(...item.phrases)
    contentByFile.set(item.file, lines)
  }
  return contentByFile
}

function createErrorRedactionFixture(overrides: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'nexus-error-redaction-audit-'))
  const contentByFile = buildBaselineContentByFile()

  for (const [relativePath, lines] of contentByFile.entries()) {
    const absolutePath = join(root, relativePath)
    mkdirSync(join(absolutePath, '..'), { recursive: true })
    writeFileSync(absolutePath, overrides[relativePath] ?? `${lines.join('\n')}\n`)
  }

  return root
}

function withErrorRedactionFixture<T>(overrides: Record<string, string>, callback: (root: string) => T): T {
  const root = createErrorRedactionFixture(overrides)
  try {
    return callback(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('error redaction audit passes a minimal required-phrase fixture', () => {
  withErrorRedactionFixture({}, (root) => {
    const report = buildErrorRedactionReport(root)

    assert.equal(report.summary.ok, true)
    assert.equal(report.summary.errors, 0)
    assert.equal(report.privacy.staticSourceOnly, true)
    assert.equal(report.privacy.readsSecrets, false)
  })
})

test('error redaction audit rejects raw chat IPC error messages', () => {
  withErrorRedactionFixture({
    'electron/ipc/chatIpc.js': `${buildBaselineContentByFile().get('electron/ipc/chatIpc.js')?.join('\n')}
const reason = error instanceof Error ? error.message : String(error)
`,
  }, (root) => {
    const report = buildErrorRedactionReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(
      report.errors.unsafePatterns.some((item) => item.id === 'chat-ipc-raw-error-message'),
    )
  })
})

test('error redaction audit rejects raw updater renderer events', () => {
  withErrorRedactionFixture({
    'electron/services/updaterService.js': `${buildBaselineContentByFile().get('electron/services/updaterService.js')?.join('\n')}
message: error instanceof Error ? error.message : String(error)
`,
  }, (root) => {
    const report = buildErrorRedactionReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(
      report.errors.unsafePatterns.some((item) => item.id === 'updater-service-raw-event-error'),
    )
  })
})

test('error redaction audit rejects raw audit log write errors', () => {
  withErrorRedactionFixture({
    'electron/services/auditLog.js': `${buildBaselineContentByFile().get('electron/services/auditLog.js')?.join('\n')}
console.error('[AuditLog] write error:', err.message)
`,
  }, (root) => {
    const report = buildErrorRedactionReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(
      report.errors.unsafePatterns.some((item) => item.id === 'audit-log-raw-write-error-log'),
    )
  })
})

test('error redaction audit rejects raw window asset support logs', () => {
  withErrorRedactionFixture({
    'electron/windowAssets.js': `${buildBaselineContentByFile().get('electron/windowAssets.js')?.join('\n')}
console.warn('[window] Failed to set window icon:', err?.message)
console.warn('[windows] Failed to set window app details:', err?.message)
`,
  }, (root) => {
    const report = buildErrorRedactionReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(
      report.errors.unsafePatterns.some((item) => item.id === 'window-assets-raw-icon-error-log'),
    )
    assert.ok(
      report.errors.unsafePatterns.some((item) => item.id === 'window-assets-raw-app-details-error-log'),
    )
  })
})

test('error redaction audit rejects raw window manager support logs', () => {
  withErrorRedactionFixture({
    'electron/windowManager.js': `${buildBaselineContentByFile().get('electron/windowManager.js')?.join('\n')}
console.warn('[macOS] Failed to show dock icon:', err?.message)
console.warn('[macOS] Failed to hide dock icon:', err?.message)
console.warn('[pet-window] setVisibleOnAllWorkspaces failed:', err?.message)
console.warn('[pet-window:linux] setVisibleOnAllWorkspaces failed:', err?.message)
console.warn('[tray] failed to create system tray:', err?.message)
`,
  }, (root) => {
    const report = buildErrorRedactionReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(
      report.errors.unsafePatterns.some((item) => item.id === 'window-manager-raw-dock-error-log'),
    )
    assert.ok(
      report.errors.unsafePatterns.some((item) => item.id === 'window-manager-raw-workspace-error-log'),
    )
    assert.ok(
      report.errors.unsafePatterns.some((item) => item.id === 'window-manager-raw-tray-error-log'),
    )
  })
})

test('error redaction audit rejects raw main process startup support logs', () => {
  withErrorRedactionFixture({
    'electron/main.js': `${buildBaselineContentByFile().get('electron/main.js')?.join('\n')}
process.stderr.write(\`[main] stream error: \${err?.message}\\n\`)
console.warn('[windows] Failed to set AppUserModelId:', err?.message)
console.warn(\`[\${tag}] Spawn error: \${err?.message}\`)
console.warn('[macOS] Failed to hide dock icon:', err?.message)
console.warn('[mac-perm] auto-check error:', err?.message)
console.warn('[windows-perm] auto-check error:', err?.message)
console.warn('[pluginHost] auto-start error:', err.message)
console.warn('[OmniVoice] auto-start error:', err.message)
console.warn('[GLM-ASR] auto-start error:', err.message)
console.warn('[Python] Runtime probe failed:', err?.message)
`,
  }, (root) => {
    const report = buildErrorRedactionReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(
      report.errors.unsafePatterns.some((item) => item.id === 'main-process-raw-stream-error-log'),
    )
    assert.ok(
      report.errors.unsafePatterns.some((item) => item.id === 'main-process-raw-app-user-model-id-log'),
    )
    assert.ok(
      report.errors.unsafePatterns.some((item) => item.id === 'main-process-raw-sidecar-spawn-error-log'),
    )
    assert.ok(
      report.errors.unsafePatterns.some((item) => item.id === 'main-process-raw-dock-error-log'),
    )
    assert.ok(
      report.errors.unsafePatterns.some((item) => item.id === 'main-process-raw-auto-start-error-log'),
    )
  })
})

test('error redaction audit rejects raw permission support logs', () => {
  withErrorRedactionFixture({
    'electron/services/macPermissions.js': `${buildBaselineContentByFile().get('electron/services/macPermissions.js')?.join('\n')}
console.warn('[mac-perm] failed to open settings:', err?.message)
console.warn('[mac-perm] microphone check failed:', err?.message)
console.warn('[mac-perm] screen check failed:', err?.message)
`,
    'electron/services/windowsPermissions.js': `${buildBaselineContentByFile().get('electron/services/windowsPermissions.js')?.join('\n')}
console.warn('[windows-perm] failed to open settings:', err?.message)
console.warn(\`[windows-perm] \${kind} check failed:\`, err?.message)
`,
  }, (root) => {
    const report = buildErrorRedactionReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(
      report.errors.unsafePatterns.some((item) => item.id === 'mac-permissions-raw-open-settings-log'),
    )
    assert.ok(
      report.errors.unsafePatterns.some((item) => item.id === 'mac-permissions-raw-check-error-log'),
    )
    assert.ok(
      report.errors.unsafePatterns.some((item) => item.id === 'windows-permissions-raw-open-settings-log'),
    )
    assert.ok(
      report.errors.unsafePatterns.some((item) => item.id === 'windows-permissions-raw-check-error-log'),
    )
  })
})

test('error redaction audit rejects raw local UI persistence logs', () => {
  withErrorRedactionFixture({
    'electron/services/petPrefsStore.js': `${buildBaselineContentByFile().get('electron/services/petPrefsStore.js')?.join('\n')}
console.warn('[petPrefs] persist failed:', err?.message ?? err)
`,
    'electron/services/windowBoundsStore.js': `${buildBaselineContentByFile().get('electron/services/windowBoundsStore.js')?.join('\n')}
console.warn('[windowBounds] persist failed:', err?.message ?? err)
`,
  }, (root) => {
    const report = buildErrorRedactionReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(
      report.errors.unsafePatterns.some((item) => item.id === 'pet-prefs-store-raw-persist-error-log'),
    )
    assert.ok(
      report.errors.unsafePatterns.some((item) => item.id === 'window-bounds-store-raw-persist-error-log'),
    )
  })
})

test('error redaction audit rejects raw speech service logs', () => {
  withErrorRedactionFixture({
    'electron/services/tencentAsr.js': `${buildBaselineContentByFile().get('electron/services/tencentAsr.js')?.join('\n')}
console.error('[TencentASR] server error:', data.code, data.message)
`,
    'electron/services/ttsService.js': `${buildBaselineContentByFile().get('electron/services/ttsService.js')?.join('\n')}
console.warn(
  \`[TTS-Retry] attempt=\${attempt} reason=\${reason} host=\${host}\`,
  error?.message ? \`error=\${error.message}\` : '',
)
`,
  }, (root) => {
    const report = buildErrorRedactionReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(
      report.errors.unsafePatterns.some((item) => item.id === 'tencent-asr-raw-server-error-log'),
    )
    assert.ok(
      report.errors.unsafePatterns.some((item) => item.id === 'tts-service-raw-retry-error-log'),
    )
  })
})

test('error redaction audit rejects raw TTS stream errors', () => {
  withErrorRedactionFixture({
    'electron/ttsStreamService.js': `${buildBaselineContentByFile().get('electron/ttsStreamService.js')?.join('\n')}
console.error('[TTS-Stream] PCM stream error:', err?.message)
emit(session.sender, {
  type: 'error',
  requestId: session.requestId,
  message: err instanceof Error ? err.message : '流式音频传输中断。',
})
`,
  }, (root) => {
    const report = buildErrorRedactionReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(
      report.errors.unsafePatterns.some((item) => item.id === 'tts-stream-raw-pcm-error-log'),
    )
    assert.ok(
      report.errors.unsafePatterns.some((item) => item.id === 'tts-stream-raw-pcm-error-renderer-message'),
    )
  })
})
