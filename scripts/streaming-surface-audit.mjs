#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const REQUIRED_FILES = [
  'docs/STREAMING_SURFACE_REFERENCE_REVIEW.md',
  'src/types/chat.ts',
  'src/components/MessageBubble.tsx',
  'src/app/views/PanelView.tsx',
  'src/app/App.css',
]

const REQUIRED_CONTRACTS = [
  {
    id: 'streaming-pro-contract-recorded',
    file: 'docs/STREAMING_SURFACE_REFERENCE_REVIEW.md',
    description: 'The accepted Pro streaming judgment is recorded as a bounded local contract.',
    patterns: [
      'append-only message continuity',
      'Composer reachability',
      'Bounded tool-result previews',
      'waiting',
      'streaming_text',
      'tool_pending',
      'tool_result_preview',
      'Vercel AI Chatbot',
      'assistant-ui',
      'LibreChat',
    ],
  },
  {
    id: 'chat-message-run-status',
    file: 'src/types/chat.ts',
    description: 'Chat messages have a message-scoped assistant run state instead of a panel-scoped streaming mode.',
    patterns: [
      'ChatMessageRunStatus',
      "'waiting'",
      "'streaming_text'",
      "'tool_pending'",
      "'tool_result_preview'",
      "'interrupted'",
      'runStatus?: ChatMessageRunStatus',
    ],
  },
  {
    id: 'message-bubble-streaming-boundary',
    file: 'src/components/MessageBubble.tsx',
    description: 'MessageBubble maps assistant run status to message-scoped surface states.',
    patterns: [
      'CHAT_MESSAGE_SURFACE_STATES',
      'CHAT_RUN_STATUS_TO_SURFACE_STATE',
      'CHAT_RUN_STATUS_LABEL_KEYS',
      'data-chat-surface-state',
      'message.runStatus',
      'message-bubble__run-status',
      'role="status"',
      'aria-live="polite"',
      'data-run-status={message.runStatus}',
      'ToolResultCard',
      'message.toolResult',
    ],
  },
  {
    id: 'composer-remains-mounted',
    file: 'src/app/views/PanelView.tsx',
    description: 'Composer stays mounted in the companion chat surface while busy state only gates send behavior.',
    patterns: [
      "import { deriveImage4ComposerState } from './image4ComposerState'",
      'const image4ComposerState = deriveImage4ComposerState({',
      'companion-chat__composer',
      'composerTextareaRef',
      'value={chat.input}',
      'onChange={(event) => chat.setInput(event.target.value)}',
      'data-composer-state={image4ComposerState.mode}',
      'data-send-state={image4ComposerState.sendState}',
      'disabled={image4ComposerState.sendDisabled}',
    ],
  },
  {
    id: 'tool-result-is-bounded-message-child',
    file: 'src/app/App.css',
    description: 'Tool result styling stays a bounded chat child surface, not a workspace or cockpit panel.',
    patterns: [
      '.tool-result-card',
      '.tool-result-card__summary',
      '.tool-result-card__list',
      '.tool-result-item',
    ],
  },
  {
    id: 'tool-result-preview-is-visually-bounded',
    file: 'src/app/App.css',
    description: 'Tool result lists and long previews stay locally scrollable inside the assistant message.',
    patterns: [
      '--tool-result-list-max-height: min(240px, 38vh);',
      '--tool-result-body-max-height: min(180px, 30vh);',
      'max-height: var(--tool-result-list-max-height);',
      'max-height: var(--tool-result-body-max-height);',
      'overflow-y: auto;',
      'overscroll-behavior: contain;',
      '.tool-result-card__previewBody',
      '.tool-result-card__sourceList',
    ],
  },
]

const FORBIDDEN_SOURCE_PATTERNS = [
  {
    id: 'streaming-global-overlay',
    files: ['src/app/views/PanelView.tsx', 'src/app/App.css'],
    description: 'Streaming should not introduce a global overlay or page-level loading surface.',
    patterns: [
      'streaming-overlay',
      'global-loading-overlay',
      'assistant-run-overlay',
      'chat-loading-backdrop',
      'companion-chat__streaming-overlay',
    ],
  },
  {
    id: 'streaming-workbench-chrome',
    files: ['src/components/MessageBubble.tsx', 'src/app/views/PanelView.tsx', 'src/app/App.css'],
    description: 'Streaming and tool-result UI must not become terminal, diff, cockpit, artifact workspace, or task-board chrome.',
    patterns: [
      'terminal-log',
      'diff-viewer',
      'agent-cockpit',
      'artifact-workspace',
      'task-board',
      'tool-terminal',
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
      missing.push({
        id: contract.id,
        file: contract.file,
        description: contract.description,
        missingPatterns,
      })
    }
  }
  return missing
}

function findForbiddenPatterns(files) {
  const matches = []
  for (const rule of FORBIDDEN_SOURCE_PATTERNS) {
    for (const file of rule.files) {
      const text = files.get(file)
      if (text == null) continue
      const foundPatterns = rule.patterns.filter((pattern) => text.includes(pattern))
      if (foundPatterns.length) {
        matches.push({
          id: rule.id,
          file,
          description: rule.description,
          foundPatterns,
        })
      }
    }
  }
  return matches
}

function findStreamingWrapperMotion(css) {
  if (css == null) return []
  const matches = []
  const rulePattern = /([^{}]*(?:streaming|data-chat-surface-state|run-status|chat-busy|tool-pending|tool-running)[^{}]*)\{([^{}]*)\}/g
  const motionPattern = /(?:^|[;\s])(?:transform|scale|translate|filter|z-index)\s*:/
  let match
  while ((match = rulePattern.exec(css)) !== null) {
    const selector = match[1].trim().replace(/\s+/g, ' ')
    const body = match[2]
    if (!motionPattern.test(body)) continue
    matches.push({
      id: 'streaming-wrapper-motion-or-lift',
      file: 'src/app/App.css',
      selector,
      description: 'Streaming run-state selectors should not use transform, filter, z-index, or layout movement as state feedback.',
    })
  }
  return matches
}

function countOccurrences(text, fragment) {
  return text.split(fragment).length - 1
}

function buildSummary({ missingFiles, missingContracts, forbiddenPatterns, wrapperMotionRules }) {
  const errors = (
    missingFiles.length
    + missingContracts.length
    + forbiddenPatterns.length
    + wrapperMotionRules.length
  )
  return {
    ok: errors === 0,
    errors,
  }
}

export function buildStreamingSurfaceReport(root = ROOT) {
  const files = readProjectFiles(root, REQUIRED_FILES)
  const panelView = files.get('src/app/views/PanelView.tsx') ?? ''
  const messageBubble = files.get('src/components/MessageBubble.tsx') ?? ''
  const appCss = files.get('src/app/App.css') ?? ''
  const missingFiles = findMissingFiles(root)
  const missingContracts = findMissingContracts(files)
  const forbiddenPatterns = findForbiddenPatterns(files)
  const wrapperMotionRules = findStreamingWrapperMotion(appCss)

  const report = {
    audit: 'streaming-surface',
    privacy: {
      staticSourceOnly: true,
      readsRuntimeUserData: false,
    },
    checkedFiles: REQUIRED_FILES,
    checkedContracts: REQUIRED_CONTRACTS.map((contract) => contract.id),
    streamingDom: {
      runStatusOccurrences: countOccurrences(messageBubble, 'runStatus') + countOccurrences(files.get('src/types/chat.ts') ?? '', 'runStatus'),
      runStatusLineOccurrences: countOccurrences(messageBubble, 'message-bubble__run-status'),
      toolResultCardOccurrences: countOccurrences(messageBubble, 'ToolResultCard'),
      composerOccurrences: countOccurrences(panelView, 'companion-chat__composer'),
      chatBusyOccurrences: countOccurrences(panelView, 'chat.busy'),
      toolResultCssOccurrences: countOccurrences(appCss, '.tool-result-card'),
    },
    missingFiles,
    missingContracts,
    forbiddenPatterns,
    wrapperMotionRules,
  }

  return {
    ...report,
    summary: buildSummary(report),
  }
}

export function formatStreamingSurfaceReport(report) {
  const lines = ['Streaming surface audit']
  lines.push(`- checked files: ${report.checkedFiles.length}`)
  lines.push(`- checked contracts: ${report.checkedContracts.length}`)
  lines.push(`- run status markers: ${report.streamingDom.runStatusOccurrences}`)
  lines.push(`- run status line markers: ${report.streamingDom.runStatusLineOccurrences}`)
  lines.push(`- tool result card markers: ${report.streamingDom.toolResultCardOccurrences}`)
  lines.push(`- composer markers: ${report.streamingDom.composerOccurrences}`)
  lines.push(`- chat busy markers: ${report.streamingDom.chatBusyOccurrences}`)
  lines.push('')
  lines.push(`ERROR missingFiles: ${report.missingFiles.length}`)
  lines.push(`ERROR missingContracts: ${report.missingContracts.length}`)
  lines.push(`ERROR forbiddenPatterns: ${report.forbiddenPatterns.length}`)
  lines.push(`ERROR wrapperMotionRules: ${report.wrapperMotionRules.length}`)

  if (report.missingContracts.length) {
    lines.push('')
    for (const item of report.missingContracts) {
      lines.push(`missing contract ${item.id} in ${item.file}`)
      for (const pattern of item.missingPatterns) {
        lines.push(`  - ${pattern}`)
      }
    }
  }

  if (report.forbiddenPatterns.length) {
    lines.push('')
    for (const item of report.forbiddenPatterns) {
      lines.push(`forbidden pattern ${item.id} in ${item.file}`)
      for (const pattern of item.foundPatterns) {
        lines.push(`  - ${pattern}`)
      }
    }
  }

  if (report.wrapperMotionRules.length) {
    lines.push('')
    for (const item of report.wrapperMotionRules) {
      lines.push(`streaming wrapper motion ${item.id} in ${item.file}`)
      lines.push(`  - ${item.selector}`)
    }
  }

  lines.push('')
  lines.push(`Summary: ok=${report.summary.ok} errors=${report.summary.errors}`)
  return lines.join('\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = buildStreamingSurfaceReport(ROOT)
  console.log(formatStreamingSurfaceReport(report))
  process.exitCode = report.summary.ok ? 0 : 1
}
