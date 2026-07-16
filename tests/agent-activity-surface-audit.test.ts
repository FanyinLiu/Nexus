import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { buildAgentActivitySurfaceReport } from '../scripts/agent-activity-surface-audit.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const BASELINE_FILES: Record<string, string> = {
  'docs/AGENT_ACTIVITY_SURFACE_REFERENCE_REVIEW.md': `
# Agent Activity Surface Reference Review

companion activity, not agent execution
context_available
preparing_reply
needs_confirmation
coarse context
explicit confirmation
OpenHands
Cline
LibreChat
`,
  'docs/V0.4_DESKTOP_COMPANION_AWARENESS.md': 'desktop companion awareness',
  'src/features/context/companionAwareness.ts': 'export const desktopContext = true',
  'src/features/context/companionCheckInPolicy.ts': `
export type CompanionCheckInDecision = { shouldCheckIn: boolean; reason: string }
`,
  'src/features/context/companionTimeLanguage.ts': `
export type CompanionElapsedBucket = 'just_started' | 'about_half_hour' | 'about_hour' | 'two_hours_or_more'
`,
  'src/features/pet/activityState.ts': `
export type CompanionActivityDisplayAction = 'executing' | 'done' | 'failed'
export type CompanionActivityDisplayActionSource = 'task_state' | 'runtime_reflection'
export const displayActionSource = 'task_state'
export const displayStatusKey = 'pet.status.executing'
`,
  'src/app/views/LegacyPanelView.tsx': `
const assistantActivityLabel = ''
const companionStatusChipLabel = ''
const statusKey = resolveImage4ActivityLabelKey(image4CompanionState)
const panelElapsedLabel = ''
const image4CompanionState = {}
const marker = <section data-companion-activity={image4CompanionState.activityState} />
`,
  'src/app/views/image4ActivityLabel.ts': `
export const IMAGE4_ACTIVITY_LABEL_KEYS = { context_available: 'panel.activity.context_available', preparing_reply: 'panel.activity.preparing_reply', speaking: 'panel.activity.speaking' }
export type Image4CompanionActivityState = 'idle' | 'context_available' | 'preparing_reply'
export function resolveImage4ActivityLabelKey(state) {
  return state.mode === 'resting' ? 'panel.activity.quiet' : IMAGE4_ACTIVITY_LABEL_KEYS[state.activityState]
}
`,
  'src/app/views/image4CompanionState.ts': `
export type Image4CompanionActivityState = 'idle' | 'context_available' | 'preparing_reply'
export function deriveImage4CompanionState() {
  return { activityState: 'context_available', contextTone: 'calm', signalActive: false }
}
`,
  'src/i18n/locales/en.ts': `
'pet.status.executing': 'Preparing',
'pet.status.done': 'All set',
'pet.status.failed': 'Could not finish',
`,
  'src/i18n/locales/zh-CN.ts': `
'pet.status.executing': '准备中',
'pet.status.done': '好了',
'pet.status.failed': '没完成',
`,
  'src/i18n/locales/zh-TW.ts': `
'pet.status.executing': '準備中',
'pet.status.done': '好了',
'pet.status.failed': '沒完成',
`,
  'src/i18n/locales/ja.ts': `
'pet.status.executing': '準備中',
'pet.status.done': 'できました',
'pet.status.failed': '未完了',
`,
  'src/i18n/locales/ko.ts': `
'pet.status.executing': '준비 중',
'pet.status.done': '다 됐어요',
'pet.status.failed': '완료하지 못함',
`,
}

function createFixture(overrides: Record<string, string | null> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'nexus-agent-activity-surface-audit-'))
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

test('agent activity surface audit passes the protected companion activity contract', () => {
  withFixture({}, (root) => {
    const report = buildAgentActivitySurfaceReport(root)

    assert.equal(report.summary.ok, true)
    assert.equal(report.summary.errors, 0)
    assert.equal(report.privacy.staticSourceOnly, true)
    assert.ok(report.activityDom.coarseTimeMarkers >= 1)
    assert.ok(report.activityDom.awarenessMarkers >= 1)
  })
})

test('agent activity surface audit rejects missing Pro contract phrases', () => {
  withFixture({
    'docs/AGENT_ACTIVITY_SURFACE_REFERENCE_REVIEW.md': BASELINE_FILES['docs/AGENT_ACTIVITY_SURFACE_REFERENCE_REVIEW.md'].replace(
      'companion activity, not agent execution',
      'agent run panel',
    ),
  }, (root) => {
    const report = buildAgentActivitySurfaceReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.missingContracts.some((item) => item.id === 'agent-activity-pro-contract-recorded'))
  })
})

test('agent activity surface audit rejects coding-agent shell language', () => {
  withFixture({
    'src/app/views/LegacyPanelView.tsx': `${BASELINE_FILES['src/app/views/LegacyPanelView.tsx']}
const label = 'agent cockpit task board'
`,
  }, (root) => {
    const report = buildAgentActivitySurfaceReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.forbiddenPatterns.some((item) => item.id === 'coding-agent-shell-language'))
  })
})

test('agent activity surface audit rejects missing Image4 companion activity marker', () => {
  withFixture({
    'src/app/views/LegacyPanelView.tsx': BASELINE_FILES['src/app/views/LegacyPanelView.tsx'].replace(
      'data-companion-activity={image4CompanionState.activityState}',
      'data-companion-mode={image4CompanionState.mode}',
    ),
  }, (root) => {
    const report = buildAgentActivitySurfaceReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.missingContracts.some((item) => item.id === 'panel-shows-companion-state-not-task-run'))
  })
})

test('agent activity surface audit rejects surveillance wording', () => {
  withFixture({
    'src/features/context/companionCheckInPolicy.ts': `${BASELINE_FILES['src/features/context/companionCheckInPolicy.ts']}
export const bad = 'scanning screen'
`,
  }, (root) => {
    const report = buildAgentActivitySurfaceReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.forbiddenPatterns.some((item) => item.id === 'surveillance-language'))
  })
})

test('agent activity surface audit rejects precise time leakage', () => {
  withFixture({
    'src/features/context/companionTimeLanguage.ts': `${BASELINE_FILES['src/features/context/companionTimeLanguage.ts']}
export const bad = '3 minutes'
`,
  }, (root) => {
    const report = buildAgentActivitySurfaceReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.preciseTimeUi.some((item) => item.id === 'precise-time-activity-language'))
  })
})

test('agent activity surface audit rejects task-execution copy in pet companion status', () => {
  withFixture({
    'src/i18n/locales/zh-CN.ts': `
'pet.status.executing': '执行中',
'pet.status.done': '已完成',
'pet.status.failed': '执行失败',
`,
  }, (root) => {
    const report = buildAgentActivitySurfaceReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.taskExecutionCopy.some((item) => item.id === 'task-execution-copy-in-companion-status'))
  })
})

test('agent activity surface audit runs against the repository', () => {
  const report = buildAgentActivitySurfaceReport(ROOT)

  assert.equal(report.summary.ok, true)
  assert.equal(report.summary.errors, 0)
})
