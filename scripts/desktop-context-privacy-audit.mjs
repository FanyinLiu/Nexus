#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const CHECKED_FILES = [
  'electron/ipc/windowIpc.js',
  'electron/services/desktopContextPrivacy.js',
  'src/hooks/useDesktopContext.ts',
  'src/features/context/desktopContext.ts',
  'src/lib/privacy/desktopContextPrivacy.ts',
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
      'return stripDesktopContextScreenshotPayload(snapshot)',
      'return stripDesktopContextScreenshotPayload(enrichedSnapshot)',
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
