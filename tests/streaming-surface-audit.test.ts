import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { buildStreamingSurfaceReport } from '../scripts/streaming-surface-audit.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const BASELINE_FILES: Record<string, string> = {
  'docs/STREAMING_SURFACE_REFERENCE_REVIEW.md': `
# Streaming Surface Reference Review

append-only message continuity.
Composer reachability.
Bounded tool-result previews.

waiting
streaming_text
tool_pending
tool_result_preview

- Vercel AI Chatbot
- assistant-ui
- LibreChat
`,
  'src/types/chat.ts': `
export type ChatMessageRunStatus =
  | 'waiting'
  | 'streaming_text'
  | 'tool_pending'
  | 'tool_result_preview'
  | 'interrupted'

export interface ChatMessage {
  runStatus?: ChatMessageRunStatus
}
`,
  'src/components/MessageBubble.tsx': `
const CHAT_MESSAGE_SURFACE_STATES = ['final', 'streaming']
const CHAT_RUN_STATUS_TO_SURFACE_STATE = { streaming_text: 'streaming' }
const CHAT_RUN_STATUS_LABEL_KEYS = { streaming_text: 'message_bubble.run_status.streaming_text' }
export function MessageBubble({ message }) {
  const state = message.runStatus
  return (
    <article data-chat-surface-state={state}>
      <div className="message-bubble__run-status" role="status" aria-live="polite" data-run-status={message.runStatus}>Replying</div>
      {message.toolResult ? <ToolResultCard toolResult={message.toolResult} /> : null}
    </article>
  )
}
`,
  'src/app/views/LegacyPanelView.tsx': `
import { deriveImage4ComposerState } from './image4ComposerState'

export function PanelView({ chat }) {
  const image4ComposerState = deriveImage4ComposerState({
    busy: chat.busy,
    input: chat.input,
    hasPendingImage: Boolean(chat.pendingImage),
    hasNotificationReply,
    canSendNotificationReply,
    voiceState: voice.voiceState,
  })

  return (
    <div>
      <div className="composer composer--minimal companion-chat__composer" data-composer-state={image4ComposerState.mode} data-send-state={image4ComposerState.sendState}>
        <textarea ref={composerTextareaRef} value={chat.input} onChange={(event) => chat.setInput(event.target.value)} />
        <button disabled={image4ComposerState.sendDisabled}>Send</button>
      </div>
    </div>
  )
}
`,
  'src/app/App.css': `
.tool-result-card {
  --tool-result-list-max-height: min(240px, 38vh);
  --tool-result-body-max-height: min(180px, 30vh);
}
.tool-result-card__summary {}
.tool-result-card__list {
  max-height: var(--tool-result-list-max-height);
  overflow-y: auto;
  overscroll-behavior: contain;
}
.tool-result-item {}
.tool-result-card__previewBody {
  max-height: var(--tool-result-body-max-height);
  overflow-y: auto;
  overscroll-behavior: contain;
}
.tool-result-card__sourceList {
  max-height: var(--tool-result-list-max-height);
  overflow-y: auto;
  overscroll-behavior: contain;
}
`,
}

function createFixture(overrides: Record<string, string | null> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'nexus-streaming-surface-audit-'))
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

test('streaming surface audit passes the protected streaming contract', () => {
  withFixture({}, (root) => {
    const report = buildStreamingSurfaceReport(root)

    assert.equal(report.summary.ok, true)
    assert.equal(report.summary.errors, 0)
    assert.equal(report.privacy.staticSourceOnly, true)
    assert.ok(report.streamingDom.runStatusOccurrences >= 1)
    assert.ok(report.streamingDom.runStatusLineOccurrences >= 1)
    assert.ok(report.streamingDom.composerOccurrences >= 1)
  })
})

test('streaming surface audit rejects missing Pro contract phrases', () => {
  withFixture({
    'docs/STREAMING_SURFACE_REFERENCE_REVIEW.md': BASELINE_FILES['docs/STREAMING_SURFACE_REFERENCE_REVIEW.md'].replace(
      'append-only message continuity',
      'loading polish',
    ),
  }, (root) => {
    const report = buildStreamingSurfaceReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.missingContracts.some((item) => item.id === 'streaming-pro-contract-recorded'))
  })
})

test('streaming surface audit rejects missing message run status', () => {
  withFixture({
    'src/types/chat.ts': 'export interface ChatMessage { content: string }',
  }, (root) => {
    const report = buildStreamingSurfaceReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.missingContracts.some((item) => item.id === 'chat-message-run-status'))
  })
})

test('streaming surface audit rejects hidden message run status UI', () => {
  withFixture({
    'src/components/MessageBubble.tsx': BASELINE_FILES['src/components/MessageBubble.tsx'].replace(
      'role="status"',
      'role="note"',
    ),
  }, (root) => {
    const report = buildStreamingSurfaceReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.missingContracts.some((item) => item.id === 'message-bubble-streaming-boundary'))
  })
})

test('streaming surface audit rejects global loading overlays', () => {
  withFixture({
    'src/app/views/LegacyPanelView.tsx': `${BASELINE_FILES['src/app/views/LegacyPanelView.tsx']}
export const bad = <div className="companion-chat__streaming-overlay" />
`,
  }, (root) => {
    const report = buildStreamingSurfaceReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.forbiddenPatterns.some((item) => item.id === 'streaming-global-overlay'))
  })
})

test('streaming surface audit rejects streaming wrapper motion', () => {
  withFixture({
    'src/app/App.css': `${BASELINE_FILES['src/app/App.css']}
.message-bubble[data-chat-surface-state='streaming'] { transform: scale(1.02); }
`,
  }, (root) => {
    const report = buildStreamingSurfaceReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.wrapperMotionRules.some((item) => item.id === 'streaming-wrapper-motion-or-lift'))
  })
})

test('streaming surface audit rejects unbounded tool result previews', () => {
  withFixture({
    'src/app/App.css': BASELINE_FILES['src/app/App.css'].replace(
      '--tool-result-list-max-height: min(240px, 38vh);',
      '--tool-result-list-block-size: auto;',
    ).replace(
      'max-height: var(--tool-result-list-max-height);',
      'max-block-size: none;',
    ),
  }, (root) => {
    const report = buildStreamingSurfaceReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.missingContracts.some((item) => item.id === 'tool-result-preview-is-visually-bounded'))
  })
})

test('streaming surface audit runs against the repository', () => {
  const report = buildStreamingSurfaceReport(ROOT)

  assert.equal(report.summary.ok, true)
  assert.equal(report.summary.errors, 0)
})
