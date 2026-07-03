#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const REQUIRED_FILES = [
  'docs/AGENT_ACTIVITY_SURFACE_REFERENCE_REVIEW.md',
  'docs/V0.4_DESKTOP_COMPANION_AWARENESS.md',
  'src/features/context/companionAwareness.ts',
  'src/features/context/companionCheckInPolicy.ts',
  'src/features/context/companionTimeLanguage.ts',
  'src/features/pet/activityState.ts',
  'src/app/views/PanelView.tsx',
  'src/app/views/image4ActivityLabel.ts',
  'src/app/views/image4CompanionState.ts',
  'src/i18n/locales/en.ts',
  'src/i18n/locales/zh-CN.ts',
  'src/i18n/locales/zh-TW.ts',
  'src/i18n/locales/ja.ts',
  'src/i18n/locales/ko.ts',
]

const REQUIRED_CONTRACTS = [
  {
    id: 'agent-activity-pro-contract-recorded',
    file: 'docs/AGENT_ACTIVITY_SURFACE_REFERENCE_REVIEW.md',
    patterns: [
      'companion activity, not agent execution',
      'context_available',
      'preparing_reply',
      'needs_confirmation',
      'coarse context',
      'explicit confirmation',
      'OpenHands',
      'Cline',
      'LibreChat',
    ],
  },
  {
    id: 'coarse-time-language',
    file: 'src/features/context/companionTimeLanguage.ts',
    patterns: [
      'just_started',
      'about_half_hour',
      'about_hour',
      'two_hours_or_more',
    ],
  },
  {
    id: 'check-in-policy-keeps-companion-boundary',
    file: 'src/features/context/companionCheckInPolicy.ts',
    patterns: [
      'CompanionCheckInDecision',
      'shouldCheckIn',
      'reason',
    ],
  },
  {
    id: 'panel-shows-companion-state-not-task-run',
    file: 'src/app/views/PanelView.tsx',
    patterns: [
      'assistantActivityLabel',
      'companionStatusChipLabel',
      'resolveImage4ActivityLabelKey',
      'data-companion-activity={image4CompanionState.activityState}',
      'panelElapsedLabel',
      'image4CompanionState',
    ],
  },
  {
    id: 'image4-activity-label-is-companion-copy',
    file: 'src/app/views/image4ActivityLabel.ts',
    patterns: [
      'IMAGE4_ACTIVITY_LABEL_KEYS',
      'Image4CompanionActivityState',
      'resolveImage4ActivityLabelKey',
      'panel.activity.context_available',
      'panel.activity.preparing_reply',
      'panel.activity.speaking',
      'panel.activity.quiet',
    ],
  },
  {
    id: 'image4-state-is-companion-state',
    file: 'src/app/views/image4CompanionState.ts',
    patterns: [
      'Image4CompanionActivityState',
      'deriveImage4CompanionState',
      'activityState',
      'context_available',
      'preparing_reply',
      'contextTone',
      'signalActive',
    ],
  },
  {
    id: 'pet-activity-state-has-display-boundary',
    file: 'src/features/pet/activityState.ts',
    patterns: [
      'CompanionActivityDisplayAction',
      'CompanionActivityDisplayActionSource',
      'displayActionSource',
      'displayStatusKey',
    ],
  },
]

const PET_ACTIVITY_COPY_FILES = [
  'src/i18n/locales/en.ts',
  'src/i18n/locales/zh-CN.ts',
  'src/i18n/locales/zh-TW.ts',
  'src/i18n/locales/ja.ts',
  'src/i18n/locales/ko.ts',
]

const FORBIDDEN_SOURCE_PATTERNS = [
  {
    id: 'coding-agent-shell-language',
    files: [
      'src/features/context/companionAwareness.ts',
      'src/features/context/companionCheckInPolicy.ts',
      'src/features/context/companionTimeLanguage.ts',
      'src/app/views/PanelView.tsx',
      'src/app/views/image4CompanionState.ts',
    ],
    patterns: [
      /\bagent[-_\s]?cockpit\b/i,
      /\brun[-_\s]?panel\b/i,
      /\bterminal\b/i,
      /\bstdout\b/i,
      /\bstderr\b/i,
      /\bdiff\b/i,
      /\bpatch\b/i,
      /\btask[-_\s]?board\b/i,
      /\bexecuting\b/i,
      /\bautonomous\b/i,
      /代理正在执行/,
      /任务运行中/,
      /终端输出/,
      /执行命令/,
      /工作台/,
      /任务看板/,
    ],
  },
  {
    id: 'surveillance-language',
    files: [
      'src/features/context/companionAwareness.ts',
      'src/features/context/companionCheckInPolicy.ts',
      'src/app/views/PanelView.tsx',
    ],
    patterns: [
      /\bmonitoring desktop\b/i,
      /\bscanning screen\b/i,
      /\bwatching you\b/i,
      /正在监控/,
      /扫描桌面/,
      /读取窗口标题/,
      /精确记录/,
    ],
  },
  {
    id: 'agent-run-state-names',
    files: [
      'src/features/context/companionAwareness.ts',
      'src/features/context/companionCheckInPolicy.ts',
      'src/app/views/PanelView.tsx',
      'src/app/views/image4CompanionState.ts',
    ],
    patterns: [
      /\brunning_task\b/i,
      /\bexecuting_command\b/i,
      /\bagent_run\b/i,
      /\bautonomous_work\b/i,
    ],
  },
]

function readProjectFile(root, file) {
  const fullPath = join(root, file)
  if (!existsSync(fullPath)) return null
  return readFileSync(fullPath, 'utf8')
}

function readProjectFiles(root, files) {
  return new Map(files.map((file) => [file, readProjectFile(root, file)]))
}

function findMissingFiles(root) {
  return REQUIRED_FILES.filter((file) => !existsSync(join(root, file)))
}

function findMissingContracts(files) {
  const missing = []
  for (const contract of REQUIRED_CONTRACTS) {
    const text = files.get(contract.file)
    if (text == null) continue
    const missingPatterns = contract.patterns.filter((pattern) => !text.includes(pattern))
    if (missingPatterns.length) {
      missing.push({ id: contract.id, file: contract.file, missingPatterns })
    }
  }
  return missing
}

function findForbiddenPatterns(files) {
  const matches = []
  for (const rule of FORBIDDEN_SOURCE_PATTERNS) {
    for (const file of rule.files) {
      const text = (files.get(file) ?? '')
        .split(/\r?\n/)
        .filter((line) => !/^\s*surveillance:\s*\[/.test(line))
        .join('\n')
      if (text == null) continue
      const foundPatterns = rule.patterns
        .filter((pattern) => pattern.test(text))
        .map((pattern) => pattern.source)
      if (foundPatterns.length) {
        matches.push({ id: rule.id, file, foundPatterns })
      }
    }
  }
  return matches
}

function findPreciseTimeUi(files) {
  const matches = []
  const precisePatterns = [
    /\btoISOString\s*\(/,
    /\btoLocaleTimeString\s*\([^)]*second/,
    /\b\d+\s*(?:seconds?|秒)\b/i,
    /\b\d+\s*(?:minutes?|分钟)\b/i,
  ]
  for (const file of ['src/app/views/PanelView.tsx', 'src/features/context/companionTimeLanguage.ts']) {
    const text = files.get(file)
    if (text == null) continue
    const foundPatterns = precisePatterns
      .filter((pattern) => pattern.test(text))
      .map((pattern) => pattern.source)
    if (foundPatterns.length) {
      matches.push({ id: 'precise-time-activity-language', file, foundPatterns })
    }
  }
  return matches
}

function findTaskExecutionCopy(files) {
  const matches = []
  const forbiddenCopyByFile = {
    'src/i18n/locales/en.ts': /\b(?:Executing|Execution failed|Failed|Running)\b/,
    'src/i18n/locales/zh-CN.ts': /执行|任务/,
    'src/i18n/locales/zh-TW.ts': /執行|任務/,
    'src/i18n/locales/ja.ts': /実行/,
    'src/i18n/locales/ko.ts': /실행/,
  }

  for (const file of PET_ACTIVITY_COPY_FILES) {
    const text = files.get(file)
    if (text == null) continue
    const pattern = forbiddenCopyByFile[file]
    const riskyLines = text
      .split(/\r?\n/)
      .filter((line) => /'pet\.status\.(?:executing|done|failed)'/.test(line))
      .filter((line) => pattern.test(line))

    if (riskyLines.length) {
      matches.push({
        id: 'task-execution-copy-in-companion-status',
        file,
        foundPatterns: riskyLines.map((line) => line.trim()),
      })
    }
  }

  return matches
}

function countOccurrences(text, fragment) {
  return text.split(fragment).length - 1
}

function buildSummary({ missingFiles, missingContracts, forbiddenPatterns, preciseTimeUi, taskExecutionCopy }) {
  const errors = (
    missingFiles.length
    + missingContracts.length
    + forbiddenPatterns.length
    + preciseTimeUi.length
    + taskExecutionCopy.length
  )
  return { ok: errors === 0, errors }
}

export function buildAgentActivitySurfaceReport(root = ROOT) {
  const files = readProjectFiles(root, REQUIRED_FILES)
  const panelView = files.get('src/app/views/PanelView.tsx') ?? ''
  const timeLanguage = files.get('src/features/context/companionTimeLanguage.ts') ?? ''
  const awareness = files.get('src/features/context/companionAwareness.ts') ?? ''
  const image4ActivityLabel = files.get('src/app/views/image4ActivityLabel.ts') ?? ''
  const image4CompanionState = files.get('src/app/views/image4CompanionState.ts') ?? ''
  const missingFiles = findMissingFiles(root)
  const missingContracts = findMissingContracts(files)
  const forbiddenPatterns = findForbiddenPatterns(files)
  const preciseTimeUi = findPreciseTimeUi(files)
  const taskExecutionCopy = findTaskExecutionCopy(files)

  const report = {
    audit: 'agent-activity-surface',
    privacy: {
      staticSourceOnly: true,
      readsRuntimeUserData: false,
    },
    checkedFiles: REQUIRED_FILES,
    checkedContracts: REQUIRED_CONTRACTS.map((contract) => contract.id),
    activityDom: {
      panelActivityMarkers: countOccurrences(panelView, 'Activity') + countOccurrences(panelView, 'companionStatus'),
      coarseTimeMarkers: countOccurrences(timeLanguage, 'about_') + countOccurrences(timeLanguage, 'two_hours_or_more'),
      awarenessMarkers: (
        countOccurrences(awareness, 'desktop')
        + countOccurrences(awareness, 'context')
        + countOccurrences(panelView, 'data-companion-activity')
        + countOccurrences(image4ActivityLabel, 'panel.activity.')
        + countOccurrences(image4CompanionState, 'activityState')
      ),
    },
    missingFiles,
    missingContracts,
    forbiddenPatterns,
    preciseTimeUi,
    taskExecutionCopy,
  }

  return {
    ...report,
    summary: buildSummary(report),
  }
}

function formatHumanReport(report) {
  const lines = ['Agent activity surface audit']
  lines.push(`- checked files: ${report.checkedFiles.length}`)
  lines.push(`- checked contracts: ${report.checkedContracts.length}`)
  lines.push(`- panel activity markers: ${report.activityDom.panelActivityMarkers}`)
  lines.push(`- coarse time markers: ${report.activityDom.coarseTimeMarkers}`)
  lines.push(`- awareness markers: ${report.activityDom.awarenessMarkers}`)
  lines.push('')
  for (const [name, items] of Object.entries({
    missingFiles: report.missingFiles,
    missingContracts: report.missingContracts,
    forbiddenPatterns: report.forbiddenPatterns,
    preciseTimeUi: report.preciseTimeUi,
    taskExecutionCopy: report.taskExecutionCopy,
  })) {
    lines.push(`ERROR ${name}: ${items.length}`)
    for (const item of items) {
      lines.push(`  - ${item.file ?? item}`)
      if (item.missingPatterns) {
        for (const pattern of item.missingPatterns) lines.push(`    missing ${pattern}`)
      }
      if (item.foundPatterns) {
        for (const pattern of item.foundPatterns) lines.push(`    found ${pattern}`)
      }
    }
  }
  lines.push('')
  lines.push(`Summary: ok=${report.summary.ok} errors=${report.summary.errors}`)
  return lines.join('\n')
}

function main(argv) {
  const report = buildAgentActivitySurfaceReport(ROOT)
  const json = argv.includes('--json') || argv.includes('--format=json')
  process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : `${formatHumanReport(report)}\n`)
  if (!report.summary.ok) process.exit(1)
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (invokedPath && resolve(fileURLToPath(import.meta.url)) === invokedPath) {
  main(process.argv.slice(2))
}
