#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const REQUIRED_FILES = [
  'docs/CHAT_SURFACE_REFERENCE_REVIEW.md',
  'src/app/views/PanelView.tsx',
  'src/app/views/image4ChatPreview.ts',
  'src/app/styles/panel-companion-messages.css',
  'src/components/MessageBubble.tsx',
  'src/hooks/chat/useChatPersistence.ts',
]

const REQUIRED_CONTRACTS = [
  {
    id: 'chat-pro-contract-recorded',
    file: 'docs/CHAT_SURFACE_REFERENCE_REVIEW.md',
    description: 'The accepted Pro chat judgment is recorded as a bounded local contract.',
    patterns: [
      'quiet threaded companion chat',
      'chat = streaming feed + input dominance + tool boundary contract',
      'Chat Surface Contract',
      'Normal messages must not become a card stack.',
      'Do not add workspace sidebar, admin chrome, provider/model manager, agent cockpit, tool market, artifact split-pane, or runtime dashboard controls to default chat.',
    ],
  },
  {
    id: 'message-bubble-state-grammar',
    file: 'src/components/MessageBubble.tsx',
    description: 'MessageBubble exposes a bounded chat state grammar before visual polish.',
    patterns: [
      'CHAT_MESSAGE_SURFACE_STATES',
      "'final'",
      "'streaming'",
      "'waiting'",
      "'tool-running'",
      "'tool-result'",
      "'error'",
      "'resumable'",
      "'context-used'",
      'data-chat-surface-state={chatSurfaceState}',
    ],
  },
  {
    id: 'message-internal-boundaries',
    file: 'src/components/MessageBubble.tsx',
    description: 'Tool results and memory context stay inside the message boundary.',
    patterns: [
      '<ToolResultCard toolResult={message.toolResult} />',
      'message-bubble__memory-trace',
      'resolveChatMessageSurfaceState',
      "message.role === 'assistant' && message.memoryTrace",
    ],
  },
  {
    id: 'composer-priority-outside-message-list',
    file: 'src/app/views/PanelView.tsx',
    description: 'Chat keeps messages and composer as distinct layers so composer priority can be preserved.',
    patterns: [
      'image4ChatPreviewMode',
      'image4ChatPreviewVariant',
      'buildImage4ChatPreviewMessages(panelClock, image4ChatPreviewVariant)',
      'className={`message-list companion-chat__messages image4-message-list',
      '<MessageBubble',
      'className="composer composer--minimal companion-chat__composer image4-composer"',
      'className="error-banner"',
    ],
  },
  {
    id: 'image4-chat-preview-state-fixture',
    file: 'src/app/views/image4ChatPreview.ts',
    description: 'Image4 keeps a URL-gated active-chat fixture for screenshot review without runtime or persistence side effects.',
    patterns: [
      'getImage4ChatPreviewModeSync',
      'getImage4ChatPreviewVariantSync',
      'image4ChatPreview',
      "'density'",
      'buildImage4ChatPreviewMessages',
      "role: 'user'",
      "role: 'assistant'",
      "runStatus: 'final'",
      "runStatus: 'streaming_text'",
    ],
  },
  {
    id: 'chat-persistence-uses-bounded-session-record',
    file: 'src/hooks/chat/useChatPersistence.ts',
    description: 'Chat persistence keeps the existing bounded message record and redacted runtime mirror errors.',
    patterns: [
      'messagesSignature',
      'saveChatMessages(messages)',
      'upsertChatSession(sessionSnapshot)',
      'mirrorChatSessionToLocalData(session)',
      'getRedactedLogErrorMessage',
    ],
  },
  {
    id: 'image4-message-area-stays-atmospheric',
    file: 'src/app/styles/panel-companion-messages.css',
    description: 'Image4 active-chat containment is carried by atmosphere and bubble alignment instead of a card-like wrapper.',
    patterns: [
      'html[data-theme=\'warm-day\'] .panel-window--image4 .image4-message-list:not(.is-empty)::before',
      'radial-gradient(ellipse at 50% 100%, color-mix(in srgb, var(--image4-companion-primary-soft) 12%, transparent), transparent 64%)',
      'color-mix(in srgb, var(--image4-companion-surface-strong) 5%, transparent) 48%',
      'color-mix(in srgb, var(--image4-companion-surface-strong) 8%, transparent)',
      'border-radius: clamp(10px, 2.2vw, 16px);',
      'box-shadow: none;',
    ],
  },
]

const FORBIDDEN_SOURCE_PATTERNS = [
  {
    id: 'chat-default-workspace-chrome',
    files: ['src/app/views/PanelView.tsx', 'src/components/MessageBubble.tsx'],
    description: 'Default chat must not gain workspace, admin, provider, model, agent, tool-market, or artifact chrome.',
    patterns: [
      'workspace-sidebar',
      'admin-panel',
      'provider-manager',
      'model-manager',
      'agent-cockpit',
      'tool-market',
      'artifact-split',
      'runtime-dashboard',
      'message-action-bar',
      'branch-controls',
      'ActionBar',
    ],
  },
  {
    id: 'chat-persistence-raw-context-leak',
    files: ['src/hooks/chat/useChatPersistence.ts'],
    description: 'Chat persistence must not mirror raw desktop context or capture payloads into session records.',
    patterns: [
      'rawDesktopContext',
      'clipboardText',
      'screenshotData',
      'ocrText',
      'credential',
      'password',
      'secretKey',
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

function findMissingFiles(files) {
  return [...files.entries()]
    .filter(([, text]) => text == null)
    .map(([file]) => file)
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

function countOccurrences(text, fragment) {
  return text.split(fragment).length - 1
}

function buildSummary({ missingFiles, missingContracts, forbiddenPatterns }) {
  const errors = missingFiles.length + missingContracts.length + forbiddenPatterns.length
  return {
    ok: errors === 0,
    errors,
  }
}

export function buildChatSurfaceReport(root = ROOT) {
  const files = readProjectFiles(root, REQUIRED_FILES)
  const messageBubble = files.get('src/components/MessageBubble.tsx') ?? ''
  const panelView = files.get('src/app/views/PanelView.tsx') ?? ''
  const missingFiles = findMissingFiles(files)
  const missingContracts = findMissingContracts(files)
  const forbiddenPatterns = findForbiddenPatterns(files)

  const report = {
    audit: 'chat-surface',
    privacy: {
      staticSourceOnly: true,
      readsRuntimeUserData: false,
    },
    checkedFiles: REQUIRED_FILES,
    checkedContracts: REQUIRED_CONTRACTS.map((contract) => contract.id),
    chatDom: {
      messageBubbleStateAttributeOccurrences: countOccurrences(messageBubble, 'data-chat-surface-state'),
      toolResultRenderedInsideMessage: messageBubble.includes('<ToolResultCard toolResult={message.toolResult} />'),
      memoryBoundaryOccurrences: countOccurrences(messageBubble, 'message-bubble__memory-trace'),
      messageBubbleUsages: countOccurrences(panelView, '<MessageBubble'),
      composerOccurrences: countOccurrences(panelView, 'companion-chat__composer image4-composer'),
      image4ChatPreviewFixtures: countOccurrences(files.get('src/app/views/image4ChatPreview.ts') ?? '', 'image4-chat-preview-'),
    },
    missingFiles,
    missingContracts,
    forbiddenPatterns,
  }

  return {
    ...report,
    summary: buildSummary(report),
  }
}

export function formatChatSurfaceReport(report) {
  const lines = ['Chat surface audit']
  lines.push(`- checked files: ${report.checkedFiles.length}`)
  lines.push(`- checked contracts: ${report.checkedContracts.length}`)
  lines.push(`- message state attributes: ${report.chatDom.messageBubbleStateAttributeOccurrences}`)
  lines.push(`- MessageBubble usages: ${report.chatDom.messageBubbleUsages}`)
  lines.push(`- Image4 chat preview fixtures: ${report.chatDom.image4ChatPreviewFixtures}`)
  lines.push('')
  lines.push(`ERROR missingFiles: ${report.missingFiles.length}`)
  lines.push(`ERROR missingContracts: ${report.missingContracts.length}`)
  lines.push(`ERROR forbiddenPatterns: ${report.forbiddenPatterns.length}`)

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

  lines.push('')
  lines.push(`Summary: ok=${report.summary.ok} errors=${report.summary.errors}`)
  return lines.join('\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = buildChatSurfaceReport(ROOT)
  console.log(formatChatSurfaceReport(report))
  process.exitCode = report.summary.ok ? 0 : 1
}
