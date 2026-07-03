import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { buildChatSurfaceReport } from '../scripts/chat-surface-audit.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const BASELINE_FILES: Record<string, string> = {
  'docs/CHAT_SURFACE_REFERENCE_REVIEW.md': `
# Chat Surface Reference Review

Chat should be treated as a quiet threaded companion chat and a streaming feed with input dominance and tool boundary contracts.

## Chat Surface Contract

- Chat is a quiet threaded companion chat, not an AI workbench.
- Normal messages must not become a card stack.
- Do not add workspace sidebar, admin chrome, provider/model manager, agent cockpit, tool market, artifact split-pane, or runtime dashboard controls to default chat.

\`\`\`text
chat = streaming feed + input dominance + tool boundary contract
\`\`\`
`,
  'src/components/MessageBubble.tsx': `
export const CHAT_MESSAGE_SURFACE_STATES = [
  'final',
  'streaming',
  'waiting',
  'tool-running',
  'tool-result',
  'error',
  'resumable',
  'context-used',
] as const

function resolveChatMessageSurfaceState(message) {
  if (message.role === 'system' && message.tone === 'error') return 'error'
  if (message.toolResult) return 'tool-result'
  if (message.role === 'assistant' && message.memoryTrace) return 'context-used'
  return 'final'
}

export function MessageBubble({ message }) {
  const chatSurfaceState = resolveChatMessageSurfaceState(message)
  return (
    <article className="message-bubble" data-chat-surface-state={chatSurfaceState}>
      {message.toolResult ? <ToolResultCard toolResult={message.toolResult} /> : null}
      <details className="message-bubble__memory-trace" />
    </article>
  )
}
`,
  'src/app/views/PanelView.tsx': `
export function PanelView() {
  const image4ChatPreviewMode = true
  const image4ChatPreviewVariant = 'density'
  const visibleMessages = image4ChatPreviewMode
    ? buildImage4ChatPreviewMessages(panelClock, image4ChatPreviewVariant)
    : chat.messages
  return (
    <section className="companion-chat image4-chat">
      <div className={\`message-list companion-chat__messages image4-message-list \${visibleMessages.length ? '' : 'is-empty'}\`}>
        <MessageBubble />
      </div>
      <div className="error-banner" />
      <div className="composer composer--minimal companion-chat__composer image4-composer" />
    </section>
  )
}
`,
  'src/app/views/image4ChatPreview.ts': `
export function getImage4ChatPreviewModeSync() {
  const value = new URLSearchParams(window.location.search).get('image4ChatPreview')
  return value === '1' || value === 'density'
}

export function getImage4ChatPreviewVariantSync() {
  return new URLSearchParams(window.location.search).get('image4ChatPreview') === 'density'
    ? 'density'
    : 'default'
}

export function buildImage4ChatPreviewMessages() {
  return [
    { id: 'image4-chat-preview-user', role: 'user', content: 'hi', createdAt: '2026-06-28T20:00:00.000Z' },
    { id: 'image4-chat-preview-assistant-final', role: 'assistant', content: 'done', createdAt: '2026-06-28T20:01:00.000Z', runStatus: 'final' },
    { id: 'image4-chat-preview-assistant-streaming', role: 'assistant', content: 'streaming', createdAt: '2026-06-28T20:02:00.000Z', runStatus: 'streaming_text' },
  ]
}
`,
  'src/app/styles/panel-companion-messages.css': `
html[data-theme='warm-day'] .panel-window--image4 .image4-message-list:not(.is-empty)::before {
  background:
    radial-gradient(ellipse at 50% 100%, color-mix(in srgb, var(--image4-companion-primary-soft) 12%, transparent), transparent 64%),
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--image4-companion-surface) 0%, transparent),
      color-mix(in srgb, var(--image4-companion-surface-strong) 5%, transparent) 48%,
      color-mix(in srgb, var(--image4-companion-surface-strong) 8%, transparent)
    );
  border-radius: clamp(10px, 2.2vw, 16px);
  box-shadow: none;
}
`,
  'src/hooks/chat/useChatPersistence.ts': `
function messagesSignature(messages) {
  return String(messages.length)
}

export function useChatPersistence({ messages }) {
  saveChatMessages(messages)
  upsertChatSession(sessionSnapshot)
  mirrorChatSessionToLocalData(session)
  console.warn(getRedactedLogErrorMessage(error))
}
`,
}

function createFixture(overrides: Record<string, string | null> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'nexus-chat-surface-audit-'))
  for (const [relativePath, baseline] of Object.entries(BASELINE_FILES)) {
    if (overrides[relativePath] === null) continue
    const absolutePath = join(root, relativePath)
    mkdirSync(dirname(absolutePath), { recursive: true })
    writeFileSync(absolutePath, overrides[relativePath] ?? baseline)
  }
  return root
}

function withFixture<T>(overrides: Record<string, string | null>, callback: (root: string) => T): T {
  const root = createFixture(overrides)
  try {
    return callback(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('chat surface audit passes the protected chat contract', () => {
  withFixture({}, (root) => {
    const report = buildChatSurfaceReport(root)

    assert.equal(report.summary.ok, true)
    assert.equal(report.summary.errors, 0)
    assert.equal(report.privacy.staticSourceOnly, true)
    assert.equal(report.chatDom.messageBubbleStateAttributeOccurrences, 1)
    assert.equal(report.chatDom.toolResultRenderedInsideMessage, true)
  })
})

test('chat surface audit rejects missing message state grammar', () => {
  withFixture({
    'src/components/MessageBubble.tsx': BASELINE_FILES['src/components/MessageBubble.tsx'].replace(
      'data-chat-surface-state={chatSurfaceState}',
      'data-chat-surface="message"',
    ),
  }, (root) => {
    const report = buildChatSurfaceReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.missingContracts.some((item) => item.id === 'message-bubble-state-grammar'))
  })
})

test('chat surface audit rejects default workspace or agent chrome', () => {
  withFixture({
    'src/app/views/PanelView.tsx': `${BASELINE_FILES['src/app/views/PanelView.tsx']}
<div className="workspace-sidebar agent-cockpit" />
`,
  }, (root) => {
    const report = buildChatSurfaceReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.forbiddenPatterns.some((item) => item.id === 'chat-default-workspace-chrome'))
  })
})

test('chat surface audit rejects missing Image4 active-chat preview fixture', () => {
  withFixture({
    'src/app/views/image4ChatPreview.ts': null,
  }, (root) => {
    const report = buildChatSurfaceReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.missingFiles.includes('src/app/views/image4ChatPreview.ts'))
  })
})

test('chat surface audit rejects raw context persistence fields', () => {
  withFixture({
    'src/hooks/chat/useChatPersistence.ts': `${BASELINE_FILES['src/hooks/chat/useChatPersistence.ts']}
const rawDesktopContext = screenshotData + ocrText
`,
  }, (root) => {
    const report = buildChatSurfaceReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.forbiddenPatterns.some((item) => item.id === 'chat-persistence-raw-context-leak'))
  })
})

test('chat surface audit rejects card-like Image4 message container drift', () => {
  withFixture({
    'src/app/styles/panel-companion-messages.css': BASELINE_FILES['src/app/styles/panel-companion-messages.css'].replace(
      'box-shadow: none;',
      'box-shadow: inset 1px 0 0 rgba(76, 101, 125, 0.08), inset -1px 0 0 rgba(76, 101, 125, 0.08);',
    ),
  }, (root) => {
    const report = buildChatSurfaceReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.missingContracts.some((item) => item.id === 'image4-message-area-stays-atmospheric'))
  })
})

test('chat surface audit runs against the repository', () => {
  const report = buildChatSurfaceReport(ROOT)

  assert.equal(report.summary.ok, true)
  assert.equal(report.summary.errors, 0)
})
