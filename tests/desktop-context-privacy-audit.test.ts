import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { buildDesktopContextPrivacyReport } from '../scripts/desktop-context-privacy-audit.mjs'

const BASELINE_FILES: Record<string, string> = {
  'electron/ipc/windowIpc.js': `
import { sanitizeDesktopContextSnapshot } from '../services/desktopContextPrivacy.js'
const sanitizedSnapshot = sanitizeDesktopContextSnapshot(snapshot)
return sanitizedSnapshot
`,
  'electron/services/desktopContextPrivacy.js': `
DESKTOP_CONTEXT_REDACTION
containsSensitiveDesktopContext
redactSensitiveDesktopContextText
sanitizeDesktopContextSnapshot
`,
  'electron/services/desktopContextService.js': `
import { redactSensitiveErrorText } from './errorRedaction.js'
function formatDesktopContextErrorForLog(error) {}
return redactSensitiveErrorText([message, stderr].filter(Boolean).join(' '))
console.warn('[desktop-context:mac] active window capture failed:', formatDesktopContextErrorForLog(error))
console.warn('[desktop-context:mac] parse failed:', formatDesktopContextErrorForLog(parseError))
console.warn('[desktop-context:linux] active window capture failed:', formatDesktopContextErrorForLog(error))
console.warn('[desktop-context:get] active window capture failed:', formatDesktopContextErrorForLog(error))
console.warn('[desktop-context:get] active window parse failed:', formatDesktopContextErrorForLog(parseError))
console.warn('[desktop-context:get] screenshot capture failed:', formatDesktopContextErrorForLog(error))
`,
  'src/hooks/useDesktopContext.ts': `
import { getRedactedLogErrorMessage } from '../lib/logRedaction'
import { stripDesktopContextScreenshotPayload } from '../lib/privacy/desktopContextPrivacy'
const strippedSnapshot = stripDesktopContextScreenshotPayload(snapshot)
const strippedEnrichedSnapshot = stripDesktopContextScreenshotPayload(enrichedSnapshot)
console.warn('[screen-ocr] failed to recognize screenshot text', getRedactedLogErrorMessage(error))
console.warn('[screen-vlm] failed to analyze screenshot', getRedactedLogErrorMessage(error))
`,
  'src/hooks/useContextScheduler.ts': `
createContextComparisonSalt
createContextTextFingerprint
const previousActiveWindowFingerprintRef = useRef<string | null>(null)
const previousClipboardFingerprintRef = useRef<string | null>(null)
activeWindowChanged:
clipboardChanged:
Save non-reversible comparison tokens, not desktop text.
`,
  'src/features/autonomy/contextScheduler.ts': `
createContextComparisonSalt
createContextTextFingerprint
activeWindowChanged: boolean
clipboardChanged: boolean
`,
  'src/features/context/desktopContext.ts': `
sanitizeDesktopContextSnapshotForPrompt(snapshot)
normalizeObservedText(sanitizedSnapshot.clipboardText)
normalizeObservedText(sanitizedSnapshot.screenText)
`,
  'src/lib/privacy/desktopContextPrivacy.ts': `
DESKTOP_CONTEXT_REDACTION
containsSensitiveDesktopContext
redactSensitiveDesktopContextText
sanitizeDesktopContextSnapshotForPrompt
stripDesktopContextScreenshotPayload
`,
  'tests/context-scheduler.test.ts': `
context scheduler detects app switches without retaining previous window title
context scheduler detects clipboard changes without retaining previous clipboard text
context text fingerprints are salted and do not expose source text
`,
  'tests/desktop-context.test.ts': `
desktop context prompt formatting redacts obvious secrets
desktop context IPC sanitizer redacts obvious secrets before renderer return
desktop context strips screenshot payload before chat/runtime reuse
`,
}

function createDesktopContextPrivacyFixture(overrides: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'nexus-desktop-context-privacy-audit-'))
  for (const [relativePath, baseline] of Object.entries(BASELINE_FILES)) {
    const absolutePath = join(root, relativePath)
    mkdirSync(join(absolutePath, '..'), { recursive: true })
    writeFileSync(absolutePath, overrides[relativePath] ?? baseline)
  }
  return root
}

function withDesktopContextPrivacyFixture<T>(
  overrides: Record<string, string>,
  callback: (root: string) => T,
): T {
  const root = createDesktopContextPrivacyFixture(overrides)
  try {
    return callback(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('desktop context privacy audit passes a minimal sanitized fixture', () => {
  withDesktopContextPrivacyFixture({}, (root) => {
    const report = buildDesktopContextPrivacyReport(root)

    assert.equal(report.summary.ok, true)
    assert.equal(report.summary.errors, 0)
    assert.equal(report.privacy.readsClipboard, false)
    assert.equal(report.privacy.readsScreenshots, false)
    assert.equal(report.privacy.readsActiveWindow, false)
  })
})

test('desktop context privacy audit rejects unsanitized IPC returns', () => {
  withDesktopContextPrivacyFixture({
    'electron/ipc/windowIpc.js': `
import { sanitizeDesktopContextSnapshot } from '../services/desktopContextPrivacy.js'
const sanitizedSnapshot = sanitizeDesktopContextSnapshot(snapshot)
return sanitizedSnapshot
return snapshot
`,
  }, (root) => {
    const report = buildDesktopContextPrivacyReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(
      report.errors.unsafePatterns.some((item) => item.id === 'desktop-context-ipc-returns-unsanitized-snapshot'),
    )
  })
})

test('desktop context privacy audit rejects raw desktop context error logs', () => {
  withDesktopContextPrivacyFixture({
    'electron/services/desktopContextService.js': `${BASELINE_FILES['electron/services/desktopContextService.js']}
console.warn('[desktop-context:get] screenshot capture failed', error)
`,
  }, (root) => {
    const report = buildDesktopContextPrivacyReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(
      report.errors.unsafePatterns.some((item) => item.id === 'desktop-context-service-raw-error-log'),
    )
  })
})
