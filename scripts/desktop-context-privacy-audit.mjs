#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
// TypeScript 7 removed the classic compiler API from the main export.
// Audit tooling keeps using the TS 6 API via the typescript6 alias.
import ts from 'typescript6'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const CHECKED_FILES = [
  'electron/ipc/windowIpc.js',
  'electron/services/desktopContextService.js',
  'shared/desktopContextPrivacy.js',
  'electron/services/desktopContextPrivacy.js',
  'electron/services/desktopPresence.js',
  'electron/services/presenceInput.js',
  'electron/services/linuxPointer.js',
  'src/hooks/useDesktopContext.ts',
  'src/hooks/useContextScheduler.ts',
  'src/features/autonomy/contextScheduler.ts',
  'src/features/context/desktopContext.ts',
  'src/lib/privacy/desktopContextPrivacy.ts',
  'tests/context-scheduler.test.ts',
  'tests/desktop-context.test.ts',
]

// uiohook has no mouse-only mode: any running hook can observe the keyboard.
// Only the presence input owner may load it, and only while typing awareness
// is on. Every other source file must stay free of the import.
const UIOHOOK_OWNER = 'electron/services/presenceInput.js'
const UIOHOOK_SCAN_DIRS = ['electron', 'shared', 'src', 'scripts', 'tests']
const UIOHOOK_SCAN_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx'])

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
    id: 'desktop-context-hook-raw-vision-error-log',
    file: 'src/hooks/useDesktopContext.ts',
    pattern: /console\.warn\('\[screen-(?:ocr|vlm)\][^']*failed[^']*',\s*error\)/,
    message: 'renderer desktop context OCR/VLM logs must not record raw errors, paths, tokens, or captured text',
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
    // The pattern set and helpers are single-sourced in
    // shared/desktopContextPrivacy.js; both boundary files wrap it.
    id: 'shared-desktop-context-redaction-helper',
    file: 'shared/desktopContextPrivacy.js',
    phrases: [
      'DESKTOP_CONTEXT_REDACTION',
      'containsSensitiveDesktopContext',
      'redactSensitiveDesktopContextText',
      'sanitizeDesktopContextSnapshot',
    ],
  },
  {
    id: 'main-desktop-context-redaction-helper',
    file: 'electron/services/desktopContextPrivacy.js',
    phrases: [
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
      "import { getRedactedLogErrorMessage } from '../lib/logRedaction.ts'",
      "import { stripDesktopContextScreenshotPayload } from '../lib/privacy/desktopContextPrivacy.ts'",
      'const strippedSnapshot = stripDesktopContextScreenshotPayload(snapshot)',
      'const strippedEnrichedSnapshot = stripDesktopContextScreenshotPayload(enrichedSnapshot)',
      "console.warn('[screen-ocr] failed to recognize screenshot text', getRedactedLogErrorMessage(error))",
      "console.warn('[screen-vlm] failed to analyze screenshot', getRedactedLogErrorMessage(error))",
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
  {
    id: 'presence-hook-owned-by-typing',
    file: 'electron/services/presenceInput.js',
    phrases: [
      "await import('uiohook-napi')",
      'async function reconcileTyping()',
      'if (!typingEnabled) {',
      'stopHook()',
    ],
  },
  {
    id: 'presence-gaze-never-keeps-the-keyboard-hook',
    file: 'electron/services/desktopPresence.js',
    phrases: [
      "import { createPresenceInput } from './presenceInput.js'",
      'if (!preferences.typingAwarenessEnabled) {',
      'await input.applyPreferences({ gazeFollowEnabled, typingAwarenessEnabled: false })',
      'if (preferences.gazeFollowEnabled === true) void input.pollCursor()',
    ],
  },
  {
    id: 'linux-pointer-uses-xdotool-without-the-hook',
    file: 'electron/services/linuxPointer.js',
    phrases: [
      "command = 'xdotool'",
      "['getmouselocation', '--shell']",
    ],
  },
]

function readText(root, path) {
  return readFileSync(join(root, path), 'utf8')
}

function listSourceFiles(root, relativeDir, files = []) {
  const directory = join(root, relativeDir)
  if (!existsSync(directory)) return files
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const relative = `${relativeDir}/${entry.name}`
    if (entry.isDirectory()) {
      listSourceFiles(root, relative, files)
    } else if (entry.isFile() && UIOHOOK_SCAN_EXTENSIONS.has(extname(entry.name))) {
      files.push(relative)
    }
  }
  return files
}

function sourceKind(file) {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (file.endsWith('.ts')) return ts.ScriptKind.TS
  return ts.ScriptKind.JS
}

function hasUiohookImport(file, source) {
  if (!source.includes('uiohook-napi')) return false
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, sourceKind(file))
  let found = false

  function visit(node) {
    if (found) return
    if (ts.isImportDeclaration(node)) {
      if (ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === 'uiohook-napi') {
        found = true
        return
      }
    }
    if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier
        && ts.isStringLiteral(node.moduleSpecifier)
        && node.moduleSpecifier.text === 'uiohook-napi') {
        found = true
        return
      }
    }
    if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require'
      const [argument] = node.arguments
      if ((isDynamicImport || isRequire)
        && argument
        && ts.isStringLiteral(argument)
        && argument.text === 'uiohook-napi') {
        found = true
        return
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return found
}

function findUiohookImports(root) {
  const offenders = []
  for (const dir of UIOHOOK_SCAN_DIRS) {
    const files = listSourceFiles(root, dir).sort()
    for (const file of files) {
      if (file === UIOHOOK_OWNER) continue
      if (hasUiohookImport(file, readText(root, file))) {
        offenders.push(file)
      }
    }
  }
  return offenders
}

export function buildDesktopContextPrivacyReport(root = ROOT) {
  const missingFiles = []
  const unsafePatterns = []
  const missingRequiredPhrases = []
  const uiohookImports = findUiohookImports(root).map((file) => ({
    id: 'uiohook-import-outside-presence-input',
    file,
    message: 'uiohook-napi may only be imported by electron/services/presenceInput.js; a running hook can observe the keyboard',
  }))
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

  const errors = { missingFiles, unsafePatterns, missingRequiredPhrases, uiohookImports }
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
