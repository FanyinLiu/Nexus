#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { walkFiles } from './lib/audit-framework.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_MAX_LINES = 800
const SOURCE_ROOTS = ['src', 'electron', 'scripts', 'tests']
const SOURCE_PATTERN = /\.(ts|tsx|js|mjs|cjs|css)$/
const IGNORED_DIRECTORIES = new Set(['node_modules', 'dist', 'release', 'release-smoke', '.git'])

const FILE_BUDGETS = {
  // Locale messages are split under src/i18n/locales/<locale>/*.ts (≤500 lines each).
  // localDataStore is a thin facade; SQLite core + chat domain live in sibling modules.
  'electron/chatRuntime.js': 1196,
  'electron/ipc/chatIpc.js': 891,
  'electron/services/localDataStoreCore.js': 1169,
  'electron/services/voiceSidecarService.js': 903,
  'electron/ttsStreamService.js': 861,
  'scripts/error-redaction-audit-phrases.mjs': 920,
  'scripts/live2d-three-model-smoke.mjs': 956,
  'scripts/open-source-ui-reference-audit.mjs': 1067,
  'scripts/open-source-ui-reference-pro-workflow.mjs': 994,
  'scripts/packaged-sustained-runtime.mjs': 902,
  'scripts/settings-surface-audit.mjs': 839,
  'src/app/App.css': 8400,
  'src/app/styles/settings-chat-final.css': 2600,
  'src/app/styles/settings-product-reference-final.css': 1022,
  'src/app/styles/settings-themes.css': 11000,
  'src/app/styles/settings.css': 7300,
  'src/app/views/LegacyPanelView.tsx': 917,
  'src/features/memory/reconcile.ts': 803,
  'src/features/models/providerCatalog.ts': 864,
  'src/features/onboarding/styles/onboarding-guide-shell.css': 870,
  'src/features/pet/components/Live2DCanvas.tsx': 959,
  'src/features/pet/performance.ts': 1016,
  'src/hooks/useVoice.ts': 879,
  'src/hooks/voice/streamingSpeechOutput.ts': 938,
  // Generated from electron/preload by scripts/generate-ipc-types.mjs (ipc:types:check).
  'src/types/generated/desktopPetBridge.generated.ts': 1066,
  'src/vite-env.d.ts': 1196,
  'tests/fixtures/settingsSurfaceAuditBaseline.ts': 1197,
  // IPC payload schema suite keeps one test per domain plus the high-risk
  // unknown-field rejection gate. The suite is one test per domain and stays
  // above the default 800-line budget.
  'tests/ipc-payload-schema.test.ts': 1400,
  'tests/settings-surface-audit.test.ts': 1300,
  'tests/storage-settings.test.ts': 1196,
}

function countLines(source) {
  if (!source.length) return 0
  return source.split(/\r\n|\r|\n/).length
}

export function buildSourceSizeReport(root = ROOT) {
  const files = SOURCE_ROOTS.flatMap((directory) => walkFiles(root, directory, (file) => SOURCE_PATTERN.test(file), { ignoreDirectories: IGNORED_DIRECTORIES })).sort()
  const overBudget = []
  const watchedLargeFiles = []
  let totalLines = 0

  for (const file of files) {
    const lines = countLines(readFileSync(join(root, file), 'utf8'))
    const budget = FILE_BUDGETS[file] ?? DEFAULT_MAX_LINES
    totalLines += lines

    if (lines > budget) {
      overBudget.push({ file, lines, budget })
    } else if (lines >= Math.floor(budget * 0.9)) {
      watchedLargeFiles.push({ file, lines, budget })
    }
  }

  const errors = { overBudget }
  const errorCount = Object.values(errors).reduce((sum, list) => sum + list.length, 0)

  return {
    checkedFiles: files.length,
    totalLines,
    defaultMaxLines: DEFAULT_MAX_LINES,
    customBudgets: FILE_BUDGETS,
    watchedLargeFiles,
    errors,
    summary: {
      ok: errorCount === 0,
      errors: errorCount,
    },
    privacy: {
      readsUserStorage: false,
      staticSourceOnly: true,
    },
  }
}

function formatHumanReport(report) {
  const lines = ['Source size audit']
  lines.push(`- checked files: ${report.checkedFiles}`)
  lines.push(`- total source lines: ${report.totalLines}`)
  lines.push(`- default max lines per file: ${report.defaultMaxLines}`)
  lines.push(`- watched large files: ${report.watchedLargeFiles.length}`)
  if (report.watchedLargeFiles.length) {
    lines.push(`  ${report.watchedLargeFiles.slice(0, 8).map((item) => `${item.file} ${item.lines}/${item.budget}`).join(', ')}`)
  }
  lines.push('')
  for (const [name, items] of Object.entries(report.errors)) {
    lines.push(`ERROR ${name}: ${items.length}`)
    if (items.length) {
      lines.push(`  ${items.slice(0, 8).map((item) => `${item.file} ${item.lines}/${item.budget}`).join(', ')}`)
    }
  }
  lines.push('')
  lines.push(`Summary: ok=${report.summary.ok} errors=${report.summary.errors}`)
  return lines.join('\n')
}

function main(argv) {
  const report = buildSourceSizeReport(ROOT)
  const json = argv.includes('--json') || argv.includes('--format=json')
  process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : `${formatHumanReport(report)}\n`)
  if (!report.summary.ok) process.exit(1)
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (invokedPath && resolve(fileURLToPath(import.meta.url)) === invokedPath) {
  main(process.argv.slice(2))
}
