#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const CHECKED_FILES = [
  'electron/ipc/windowIpc.js',
  'electron/services/desktopContextService.js',
  'electron/services/desktopContextPrivacy.js',
  'src/hooks/useDesktopContext.ts',
  'src/hooks/useContextScheduler.ts',
  'src/features/autonomy/contextScheduler.ts',
  'src/features/context/desktopContext.ts',
  'src/lib/privacy/desktopContextPrivacy.ts',
  'tests/context-scheduler.test.ts',
  'tests/desktop-context.test.ts',
]

const UNSAFE_PATTERNS = [
  {
    id: 'desktop-context-ipc-returns-unsanitized-snapshot',
    file: 'electron/ipc/windowIpc.js',
    pattern: /return\s+snapshot\b|summarizeDesktopContextSnapshot\(snapshot\)/,
    message: 'desktop-context:get must sanitize captured text before returning it to the renderer',
  },
  {
    id: 'desktop-context-prompt-uses-raw-snapshot',
    file: 'src/features/context/desktopContext.ts',
    pattern: /normalizeObservedText\(snapshot\.(?:activeWindowTitle|activeWindowAppName|activeWindowProcessPath|clipboardText|screenText|vlmAnalysis)\)/,
    message: 'desktop context prompt formatting must use the sanitized snapshot fields',
  },
  {
    id: 'desktop-context-hook-returns-screenshot-payload',
    file: 'src/hooks/useDesktopContext.ts',
    pattern: /return\s+(?:snapshot|enrichedSnapshot)\b/,
    message: 'desktop context snapshots returned to chat/runtime must strip screenshot image payloads first',
  },
  {
    id: 'context-scheduler-retains-previous-desktop-text',
    file: 'src/hooks/useContextScheduler.ts',
    pattern: /previous(?:Window|Clipboard)Ref|previousActiveWindowTitle|previousClipboardText/,
    message: 'context scheduler must retain only comparison fingerprints for previous desktop context text',
  },
  {
    id: 'context-scheduler-exposes-previous-desktop-text',
    file: 'src/features/autonomy/contextScheduler.ts',
    pattern: /previousActiveWindowTitle|previousClipboardText/,
    message: 'context scheduler snapshots must use explicit changed flags instead of previous desktop text',
  },
  {
    id: 'desktop-context-service-raw-error-log',
    file: 'electron/services/desktopContextService.js',
    pattern: /console\.warn\('\[desktop-context(?::[^\]]+)?\][^']*failed'[^,\n]*,\s*(?:error|parseError|message\s*\|\|\s*error)\)/,
    message: 'desktop context capture logs must not record raw errors, stderr, paths, or captured text',
  },
  {
    id: 'desktop-context-service-raw-parse-error-log',
    file: 'electron/services/desktopContextService.js',
    pattern: /console\.warn\('\[desktop-context(?::[^\]]+)?\][^']*parse failed'[^,\n]*,\s*parseError\)/,
    message: 'desktop context parse logs must redact errors before logging',
  },
]

const REQUIRED_PHRASES = [
  {
    id: 'ipc-sanitizes-before-return',
    file: 'electron/ipc/windowIpc.js',
    phrases: [
      "import { sanitizeDesktopContextSnapshot } from '../services/desktopContextPrivacy.js'",
      'const sanitizedSnapshot = sanitizeDesktopContextSnapshot(snapshot)',
      'return sanitizedSnapshot',
    ],
  },
  {
    id: 'main-desktop-context-redaction-helper',
    file: 'electron/services/desktopContextPrivacy.js',
    phrases: [
      'DESKTOP_CONTEXT_REDACTION',
      'containsSensitiveDesktopContext',
      'redactSensitiveDesktopContextText',
      'sanitizeDesktopContextSnapshot',
    ],
  },
  {
    id: 'main-desktop-context-support-logs-redact-errors',
    file: 'electron/services/desktopContextService.js',
    phrases: [
      "import { redactSensitiveErrorText } from './errorRedaction.js'",
      'function formatDesktopContextErrorForLog(error)',
      'return redactSensitiveErrorText([message, stderr].filter(Boolean).join(\' \'))',
      "console.warn('[desktop-context:mac] active window capture failed:', formatDesktopContextErrorForLog(error))",
      "console.warn('[desktop-context:mac] parse failed:', formatDesktopContextErrorForLog(parseError))",
      "console.warn('[desktop-context:linux] active window capture failed:', formatDesktopContextErrorForLog(error))",
      "console.warn('[desktop-context:get] active window capture failed:', formatDesktopContextErrorForLog(error))",
      "console.warn('[desktop-context:get] active window parse failed:', formatDesktopContextErrorForLog(parseError))",
      "console.warn('[desktop-context:get] screenshot capture failed:', formatDesktopContextErrorForLog(error))",
    ],
  },
  {
    id: 'renderer-prompt-sanitizes-before-formatting',
    file: 'src/features/context/desktopContext.ts',
    phrases: [
      'sanitizeDesktopContextSnapshotForPrompt(snapshot)',
      'normalizeObservedText(sanitizedSnapshot.clipboardText)',
      'normalizeObservedText(sanitizedSnapshot.screenText)',
    ],
  },
  {
    id: 'renderer-strips-screenshot-payload-before-runtime-return',
    file: 'src/hooks/useDesktopContext.ts',
    phrases: [
      "import { stripDesktopContextScreenshotPayload } from '../lib/privacy/desktopContextPrivacy'",
      'const strippedSnapshot = stripDesktopContextScreenshotPayload(snapshot)',
      'const strippedEnrichedSnapshot = stripDesktopContextScreenshotPayload(enrichedSnapshot)',
    ],
  },
  {
    id: 'context-scheduler-keeps-prior-context-fingerprinted',
    file: 'src/hooks/useContextScheduler.ts',
    phrases: [
      'createContextComparisonSalt',
      'createContextTextFingerprint',
      'const previousActiveWindowFingerprintRef = useRef<string | null>(null)',
      'const previousClipboardFingerprintRef = useRef<string | null>(null)',
      'activeWindowChanged:',
      'clipboardChanged:',
      'Save non-reversible comparison tokens, not desktop text.',
    ],
  },
  {
    id: 'context-scheduler-comparison-fingerprint-helper',
    file: 'src/features/autonomy/contextScheduler.ts',
    phrases: [
      'createContextComparisonSalt',
      'createContextTextFingerprint',
      'activeWindowChanged: boolean',
      'clipboardChanged: boolean',
    ],
  },
  {
    id: 'renderer-desktop-context-redaction-helper',
    file: 'src/lib/privacy/desktopContextPrivacy.ts',
    phrases: [
      'DESKTOP_CONTEXT_REDACTION',
      'containsSensitiveDesktopContext',
      'redactSensitiveDesktopContextText',
      'sanitizeDesktopContextSnapshotForPrompt',
      'stripDesktopContextScreenshotPayload',
    ],
  },
  {
    id: 'context-scheduler-privacy-tests',
    file: 'tests/context-scheduler.test.ts',
    phrases: [
      'context scheduler detects app switches without retaining previous window title',
      'context scheduler detects clipboard changes without retaining previous clipboard text',
      'context text fingerprints are salted and do not expose source text',
    ],
  },
  {
    id: 'desktop-context-redaction-tests',
    file: 'tests/desktop-context.test.ts',
    phrases: [
      'desktop context prompt formatting redacts obvious secrets',
      'desktop context IPC sanitizer redacts obvious secrets before renderer return',
      'desktop context strips screenshot payload before chat/runtime reuse',
    ],
  },
]

function readText(root, path) {
  return readFileSync(join(root, path), 'utf8')
}

export function buildDesktopContextPrivacyReport(root = ROOT) {
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
      readsClipboard: false,
      readsScreenshots: false,
      readsActiveWindow: false,
    },
  }
}

function formatHumanReport(report) {
  const lines = ['Desktop context privacy audit']
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
  const report = buildDesktopContextPrivacyReport(ROOT)
  const json = argv.includes('--json') || argv.includes('--format=json')
  process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : `${formatHumanReport(report)}\n`)
  if (!report.summary.ok) process.exit(1)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2))
}
