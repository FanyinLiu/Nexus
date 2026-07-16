import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { buildOpenSourceUiReferenceAuditReport } from '../scripts/open-source-ui-reference-audit.mjs'

const BASELINE_OPEN_SOURCE_DOC = `
# Open-Source UI Reference Audit

It does not authorize cloning another product's layout, palette, spacing, or component skin.

## Verified References

| Reference | Repository | Nexus use |
| --- | --- | --- |
| Open WebUI | https://github.com/open-webui/open-webui | Chat density. |
| Chatbox | https://github.com/chatboxai/chatbox | Composer ergonomics. |
| Cherry Studio | https://github.com/CherryHQ/cherry-studio | Settings organization. |
| LobeHub / LobeChat lineage | https://github.com/lobehub/lobehub | Agent identity. |
| Vercel AI Chatbot | https://github.com/vercel/ai-chatbot | Streaming composition. |
| OpenHands | https://github.com/All-Hands-AI/OpenHands | Agent activity boundaries. |
| Cline | https://github.com/cline/cline | Approval focus boundaries. |
| shadcn/ui | https://github.com/shadcn-ui/ui | Component recipes. |
| Radix UI Primitives | https://github.com/radix-ui/primitives | Accessible primitives. |

## Remote Head Evidence

This is a pinned evidence snapshot, not a live CI dependency. Do not run live GitHub checks in CI or release gates.

Manual refresh command pattern: run \`git ls-remote <repository> <observed branch>\` for each manifest reference, then update \`docs/open-source-ui-reference-manifest.json\` and this table in the same review change.

Convenience check: \`npm run ui:references:audit -- --reference-refresh-check\` reports remote head drift without changing files. Use it only during intentional reference refresh work, never as a default test or release gate.

\`docs/open-source-ui-reference-manifest.json\` is the machine-readable source of truth for the reference set, observed heads, surface mappings, and borrow/avoid summaries. Keep this table and the manifest synchronized.

| Reference | Branch | Commit |
| --- | --- | --- |
| Open WebUI | refs/heads/main | 02dc3e689ceac915a870b373318b99c029ddf603 |
| Chatbox | refs/heads/main | 8639c946c0baedfdd12bbc88ac10f5aa87431647 |
| Cherry Studio | refs/heads/main | 9b642d69532ca11ed62a3235838d0e62ef11feaa |
| LobeHub / LobeChat lineage | refs/heads/canary | a40ceb4d0e9556502f7207ca90fa1adf1d3fef59 |
| Vercel AI Chatbot | refs/heads/main | 2becdb4a56e7683ae08aef927cec1c6c52dfad5e |
| OpenHands | refs/heads/main | b897ce421df036dec48ca0b72c4928955df6d728 |
| Cline | refs/heads/main | 4175677e712e429e1847964f4cd4884077c4ef66 |
| shadcn/ui | refs/heads/main | 5a3ad36a5ed973c3246d5998e813b0313bb8ca1b |
| Radix UI Primitives | refs/heads/main | 71a7122a8f52cd2146a4fd0e5ac4016e394f6e9c |

## Reference Evidence Snapshot

Snapshot only.

## Borrowing Rules

1. Borrow constraints, not skins.
2. Borrow interaction hierarchy, not visual chrome.
3. Borrow component behavior, not exact dimensions.
4. Map every borrowed idea to a Nexus surface before applying it.
5. Keep Image4 hard contracts narrow; use human review for chat/settings visual quality.

## Non-Open-Source Benchmarks

Benchmarks are not part of the verified open-source set.

## Constraint Models

Constraint model table.

## Open-Source Pattern Matrix

Pattern matrix table.

## Reference Paradigm Axes

Paradigm axis table.

## Surface Acceptance Criteria

Surface acceptance table.

## Cross-Surface Behavior Rules

Rules.

## Visual Rhythm And Density Model

| Surface | Governance model | Do not use |
| --- | --- | --- |
| Image4 | Voice-first four-part rhythm: header, Live2D stage, conversation recap, composer. | Generic dashboard grids. |
| Companion tone | LobeHub-style ambient identity plus Jan and Chatbox desktop-local restraint. | Copying reference palettes. |
| Chat | Interaction density model: readable messages, stable composer anchoring, clear streaming/tool boundaries. | Image4 row grid. |
| Settings | Structural density model: compact form rows, predictable section grouping, clear focus order. | Image4 rhythm variables. |

Companion tone evidence: npm run image4:color:audit.
Queue includes matching --pro-send-payload command.
Browser flow must paste and send it only after user confirmation.

## Surface Mapping

Mapping.

Chat evidence: docs/CHAT_SURFACE_REFERENCE_REVIEW.md.
Composer evidence: docs/COMPOSER_SURFACE_REFERENCE_REVIEW.md.
Image4 evidence: docs/IMAGE4_COMPANION_FIELD_REFERENCE_REVIEW.md.
Settings evidence: docs/SETTINGS_SURFACE_REFERENCE_REVIEW.md.
Agent activity evidence: docs/AGENT_ACTIVITY_SURFACE_REFERENCE_REVIEW.md.

## Surface Coverage Matrix

Coverage.

## Decision Matrix

Matrix.

## CI Boundary

Boundary.

## Review Cadence

Cadence.
`

const BASELINE_IMAGE4_PATTERNS_DOC = `
# Image4 UI Reference Patterns

For the fuller cross-surface comparison, see \`docs/OPEN_SOURCE_UI_REFERENCE_AUDIT.md\`.

For the focused presence/dial companion-field review, see \`docs/IMAGE4_COMPANION_FIELD_REFERENCE_REVIEW.md\`.

## Visual Rhythm Grid

- Scope rule: do not extend this grid to chat or settings.

## Open-source UI reference governance

The canonical reference data lives in \`docs/open-source-ui-reference-manifest.json\`.
\`npm run ui:references:audit\` keeps the reference pool source-backed.

## Design To Contract Mapping

Mapping.

## Current Guardrails

Guardrails.
`

const BASELINE_COMPOSER_REVIEW_DOC = `
# Composer Surface Reference Review

Run:

\`\`\`sh
npm run ui:references:audit -- --surface=composer --pro-prompt
\`\`\`

The composer should be treated as an intent gateway and streaming controller.

## Composer State Model

States.

## Automatic Checks

- Tool entry stays one interaction layer deep.
- Streaming state does not introduce wrapper elevation.

## Human Review Checks

Checks.

\`\`\`text
composer = intent gateway + streaming controller
\`\`\`

\`\`\`text
composer = chat app center stage
\`\`\`
`

const BASELINE_CHAT_REVIEW_DOC = `
# Chat Surface Reference Review

Run:

\`\`\`sh
npm run ui:references:audit -- --surface=chat --pro-prompt
\`\`\`

For the fuller cross-surface comparison, see \`docs/OPEN_SOURCE_UI_REFERENCE_AUDIT.md\`.

Chat should be treated as a streaming feed with input dominance and tool boundary contracts.

## Chat State Model

States.

## Structure Model

StreamLayer
MessageLayer
ToolLayer
ComposerLayer

## Automatic Checks

- Streaming uses append-only delta behavior.

## Human Review Checks

Checks.

\`\`\`text
chat = streaming feed + input dominance + tool boundary contract
\`\`\`

\`\`\`text
chat = primary app surface
\`\`\`
`

const BASELINE_SETTINGS_REVIEW_DOC = `
# Settings Surface Reference Review

Run:

\`\`\`sh
npm run ui:references:audit -- --surface=settings --pro-prompt
\`\`\`

Settings should be treated as a companion behavior tuning surface.

For the fuller cross-surface comparison, see \`docs/OPEN_SOURCE_UI_REFERENCE_AUDIT.md\`.

Use a section graph, not cards.

## Settings State Model

States.

## Automatic Checks

- SettingRow primitive usage is preferred.
- Focus order remains predictable.
- Form rows stay compact and repeated.
- no Image4 rhythm variables.

## Human Review Checks

Checks.

\`\`\`text
settings = companion behavior tuning surface
\`\`\`

\`\`\`text
settings = system configuration dashboard
\`\`\`
`

const BASELINE_AGENT_ACTIVITY_REVIEW_DOC = '# Agent Activity Surface Reference Review\ncompanion activity, not agent execution\ncontext_available\npreparing_reply\nneeds_confirmation\ncoarse context\nexplicit confirmation\nAutomatic Checks\nHuman Review Checks\nAgent Activity Contract\nFuture Change Boundary\nFuture agent-activity changes should link back to this note.\n'

const BASELINE_IMAGE4_REVIEW_DOC = `
# Image4 Companion Field Reference Review

Run:

\`\`\`sh
npm run ui:references:audit -- --surface=image4-presence --pro-prompt
npm run ui:references:audit -- --surface=dial --pro-prompt
\`\`\`

For the fuller cross-surface comparison, see \`docs/OPEN_SOURCE_UI_REFERENCE_AUDIT.md\`.

Image4 presence and dial should be treated as one companion semantic field.
Companion State Contract
one state organism
presence = system heartbeat indicator
dial = environment lens

## Presence And Dial State Model

States.

## Structure Model

| Role | Purpose | Must not do |
| --- | --- | --- |
| Dial | Stable layout anchor and environment lens. | Dashboard widget. |
| Presence | Non-layout-affecting state layer. | Audio player. |

## Implementation Route

- Do not use a horizontal multi-column layout inside dial.

## Automatic Checks

Checks.

## Human Review Checks

Checks.

\`\`\`text
image4 = companion semantic field
\`\`\`

\`\`\`text
image4 = dashboard widget panel
\`\`\`
`

const BASELINE_DESIGN_CHECKLIST_DOC = `
# Nexus Design Review Checklist

Use \`docs/OPEN_SOURCE_UI_REFERENCE_AUDIT.md\` when a change borrows from external UI patterns.

## Before Review

Run \`npm run ui:references:audit\` when UI work adds or changes open-source reference guidance.
`

const BASELINE_PACKAGE = JSON.stringify({
  scripts: {
    'ui:references:audit': 'node scripts/open-source-ui-reference-audit.mjs',
    'focus:surface:audit': 'node scripts/focus-management-surface-audit.mjs',
    'streaming:surface:audit': 'node scripts/streaming-surface-audit.mjs',
    'agent-activity:surface:audit': 'node scripts/agent-activity-surface-audit.mjs',
    'verify:pr': 'npm run ui:references:audit && npm run image4:contract:check',
  },
}, null, 2)
const BASELINE_MANIFEST = JSON.stringify({
  schemaVersion: 1,
  lastChecked: '2026-06-29',
  policy: {
    staticSourceOnly: true,
    remoteChecked: false,
    liveNetworkGate: false,
    manualDesignGuard: true,
    borrowRule: 'constraints-not-skins',
  },
  requiredSurfaceCoverage: [
    { surface: 'chat', minReferences: 2, reason: 'Chat coverage.' },
    { surface: 'composer', minReferences: 2, reason: 'Composer coverage.' },
    { surface: 'settings', minReferences: 2, reason: 'Settings coverage.' },
    { surface: 'image4-presence', minReferences: 1, reason: 'Presence coverage.' },
    { surface: 'dial', minReferences: 1, reason: 'Dial coverage.' },
    { surface: 'companion-tone', minReferences: 2, reason: 'Companion tone coverage.' },
    { surface: 'forms', minReferences: 2, reason: 'Forms coverage.' },
    { surface: 'focus-management', minReferences: 2, reason: 'Focus coverage.' },
    { surface: 'streaming', minReferences: 2, reason: 'Streaming coverage.' },
    { surface: 'agent-activity', minReferences: 3, reason: 'Agent activity coverage.' },
  ],
  references: [
    {
      id: 'open-webui',
      name: 'Open WebUI',
      repository: 'https://github.com/open-webui/open-webui',
      observedHead: {
        branch: 'refs/heads/main',
        commit: '02dc3e689ceac915a870b373318b99c029ddf603',
      },
      surfaces: ['chat'],
      borrow: 'Chat density.',
      avoid: 'Workspace chrome.',
    },
    {
      id: 'chatbox',
      name: 'Chatbox',
      repository: 'https://github.com/chatboxai/chatbox',
      observedHead: {
        branch: 'refs/heads/main',
        commit: '8639c946c0baedfdd12bbc88ac10f5aa87431647',
      },
      surfaces: ['composer', 'companion-tone'],
      borrow: 'Composer ergonomics.',
      avoid: 'Floating action clusters.',
    },
    {
      id: 'cherry-studio',
      name: 'Cherry Studio',
      repository: 'https://github.com/CherryHQ/cherry-studio',
      observedHead: {
        branch: 'refs/heads/main',
        commit: '9b642d69532ca11ed62a3235838d0e62ef11feaa',
      },
      surfaces: ['settings'],
      borrow: 'Settings organization.',
      avoid: 'Dashboard density.',
    },
    {
      id: 'lobehub',
      name: 'LobeHub / LobeChat lineage',
      repository: 'https://github.com/lobehub/lobehub',
      observedHead: {
        branch: 'refs/heads/canary',
        commit: 'a40ceb4d0e9556502f7207ca90fa1adf1d3fef59',
      },
      surfaces: ['image4-presence', 'dial', 'companion-tone'],
      borrow: 'Agent identity.',
      avoid: 'Avatar chrome.',
    },
    {
      id: 'vercel-ai-chatbot',
      name: 'Vercel AI Chatbot',
      repository: 'https://github.com/vercel/ai-chatbot',
      observedHead: {
        branch: 'refs/heads/main',
        commit: '2becdb4a56e7683ae08aef927cec1c6c52dfad5e',
      },
      surfaces: ['chat', 'streaming', 'composer', 'agent-activity'],
      borrow: 'Streaming composition.',
      avoid: 'Browser shell.',
    },
    {
      id: 'openhands',
      name: 'OpenHands',
      repository: 'https://github.com/All-Hands-AI/OpenHands',
      observedHead: {
        branch: 'refs/heads/main',
        commit: 'b897ce421df036dec48ca0b72c4928955df6d728',
      },
      surfaces: ['chat', 'streaming', 'agent-activity'],
      borrow: 'Agent activity boundaries.',
      avoid: 'Workbench chrome.',
    },
    { id: 'cline', name: 'Cline', repository: 'https://github.com/cline/cline', observedHead: { branch: 'refs/heads/main', commit: '4175677e712e429e1847964f4cd4884077c4ef66' }, surfaces: ['focus-management', 'agent-activity'], borrow: 'Approval focus boundaries.', avoid: 'IDE extension shell.' },
    {
      id: 'shadcn-ui',
      name: 'shadcn/ui',
      repository: 'https://github.com/shadcn-ui/ui',
      observedHead: {
        branch: 'refs/heads/main',
        commit: '5a3ad36a5ed973c3246d5998e813b0313bb8ca1b',
      },
      surfaces: ['settings', 'forms'],
      borrow: 'Component recipes.',
      avoid: 'Demo skin.',
    },
    {
      id: 'radix-primitives',
      name: 'Radix UI Primitives',
      repository: 'https://github.com/radix-ui/primitives',
      observedHead: {
        branch: 'refs/heads/main',
        commit: '71a7122a8f52cd2146a4fd0e5ac4016e394f6e9c',
      },
      surfaces: ['settings', 'forms', 'focus-management'],
      borrow: 'Accessible primitives.',
      avoid: 'Abstraction churn.',
    },
  ],
}, null, 2)

const BASELINE_PRO_REVIEW_REGISTRY = JSON.stringify({
  schemaVersion: 1,
  lastUpdated: '2026-06-28',
  policy: {
    statusSource: 'local-review-registry',
    doesNotStoreProResponse: true,
    doesNotStoreSecrets: true,
    requiresAnswerQualityBeforeIntake: true,
    requiresIntakeBeforeImplementation: true,
    requiresImplementationReadinessBeforeCodeChange: true,
  },
  surfaces: [
    ['image4-presence', 'npm run image4:visual-contract:audit'],
    ['dial', 'npm run image4:visual-contract:audit'],
    ['companion-tone', 'npm run image4:color:audit'],
    ['composer', 'npm run composer:surface:audit'],
    ['chat', 'npm run chat:surface:audit'],
    ['settings', 'npm run settings:surface:audit'],
    ['forms', 'npm run forms:surface:audit'],
    ['focus-management', 'npm run focus:surface:audit'],
    ['streaming', 'npm run streaming:surface:audit'],
    ['agent-activity', 'npm run agent-activity:surface:audit'],
  ].map(([surface, check]) => ({
    surface,
    status: 'not-sent',
    decision: 'pending',
    nextAction: 'Generate the handoff package, ask Pro, then fill the intake template before UI changes.',
    commands: {
      handoff: `npm run ui:references:audit -- --surface=${surface} --pro-handoff`,
      quality: `npm run ui:references:audit -- --surface=${surface} --pro-answer-quality`,
      intake: `npm run ui:references:audit -- --surface=${surface} --review-intake-template`,
      record: `npm run ui:references:audit -- --surface=${surface} --record-template`,
      implementation: `npm run ui:references:audit -- --surface=${surface} --implementation-readiness`,
      check,
    },
  })),
}, null, 2)

const BASELINE_FILES: Record<string, string> = {
  'docs/open-source-ui-reference-manifest.json': BASELINE_MANIFEST,
  'docs/open-source-ui-pro-review-registry.json': BASELINE_PRO_REVIEW_REGISTRY,
  'docs/OPEN_SOURCE_UI_REFERENCE_AUDIT.md': BASELINE_OPEN_SOURCE_DOC,
  'docs/CHAT_SURFACE_REFERENCE_REVIEW.md': BASELINE_CHAT_REVIEW_DOC,
  'docs/COMPOSER_SURFACE_REFERENCE_REVIEW.md': BASELINE_COMPOSER_REVIEW_DOC,
  'docs/IMAGE4_COMPANION_FIELD_REFERENCE_REVIEW.md': BASELINE_IMAGE4_REVIEW_DOC,
  'docs/SETTINGS_SURFACE_REFERENCE_REVIEW.md': BASELINE_SETTINGS_REVIEW_DOC,
  'docs/AGENT_ACTIVITY_SURFACE_REFERENCE_REVIEW.md': BASELINE_AGENT_ACTIVITY_REVIEW_DOC,
  'docs/IMAGE4_UI_REFERENCE_PATTERNS.md': BASELINE_IMAGE4_PATTERNS_DOC,
  'docs/DESIGN_REVIEW_CHECKLIST.md': BASELINE_DESIGN_CHECKLIST_DOC,
  'package.json': BASELINE_PACKAGE,
}
function createFixture(overrides: Record<string, string | null> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'nexus-ui-reference-audit-'))
  for (const [relativePath, baseline] of Object.entries(BASELINE_FILES)) {
    if (overrides[relativePath] === null) continue
    const absolutePath = join(root, relativePath)
    mkdirSync(dirname(absolutePath), { recursive: true })
    writeFileSync(absolutePath, overrides[relativePath] ?? baseline)
  }

  return root
}
function withFixture<T>(
  overrides: Record<string, string | null>,
  callback: (root: string) => T,
): T {
  const root = createFixture(overrides)
  try {
    return callback(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}
test('open-source UI reference audit passes the source-backed governance baseline', () => {
  withFixture({}, (root) => {
    const report = buildOpenSourceUiReferenceAuditReport(root)

    assert.equal(report.summary.ok, true)
    assert.equal(report.summary.errors, 0)
    assert.equal(report.policy.staticSourceOnly, true)
    assert.equal(report.policy.remoteChecked, false)
    assert.equal(report.policy.liveNetworkGate, false)
    assert.equal(report.manifest.file, 'docs/open-source-ui-reference-manifest.json')
    assert.equal(report.references.length, 9)
    assert.equal(report.requiredSurfaceCoverage.length, 10)
    assert.equal(report.surfaceCoverage.length, 10)
    assert.equal(report.proReviewRegistry.file, 'docs/open-source-ui-pro-review-registry.json')
    assert.equal(report.proReviewRegistry.status.length, 10)
    assert.equal(report.referenceRefreshCheck, null)
    assert.equal(report.proReviewRegistry.status.find((item) => item.surface === 'composer')?.status, 'not-sent')
    assert.equal(report.proReviewRegistry.status.find((item) => item.surface === 'composer')?.decision, 'pending')
    assert.deepEqual(
      report.surfaceCoverage.find((item) => item.surface === 'composer')?.coveredReferences.map((item) => item.name),
      ['Chatbox', 'Vercel AI Chatbot'],
    )
    assert.deepEqual(
      report.surfaceCoverage.find((item) => item.surface === 'settings')?.coveredReferences.map((item) => item.name),
      ['Cherry Studio', 'shadcn/ui', 'Radix UI Primitives'],
    )
    assert.deepEqual(
      report.surfaceCoverage.find((item) => item.surface === 'companion-tone')?.coveredReferences.map((item) => item.name),
      ['Chatbox', 'LobeHub / LobeChat lineage'],
    )
  })
})


test('open-source UI reference audit rejects missing Pro review registry surfaces', () => {
  const registry = JSON.parse(BASELINE_PRO_REVIEW_REGISTRY)
  registry.surfaces = registry.surfaces.filter((entry) => entry.surface !== 'composer')

  withFixture({
    'docs/open-source-ui-pro-review-registry.json': JSON.stringify(registry, null, 2),
  }, (root) => {
    const report = buildOpenSourceUiReferenceAuditReport(root)
    assert.equal(report.summary.ok, false)
    assert.ok(report.errors.proReviewRegistryIssues.some((item) => (
      item.surface === 'composer'
        && item.issue === 'missing required surface'
    )))
  })
})

test('open-source UI reference audit rejects Pro review registry command drift', () => {
  const registry = JSON.parse(BASELINE_PRO_REVIEW_REGISTRY)
  const composer = registry.surfaces.find((entry) => entry.surface === 'composer')
  composer.commands.handoff = 'npm run ui:references:audit -- --surface=composer --pro-prompt'

  withFixture({
    'docs/open-source-ui-pro-review-registry.json': JSON.stringify(registry, null, 2),
  }, (root) => {
    const report = buildOpenSourceUiReferenceAuditReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.errors.proReviewRegistryIssues.some((item) => (
      item.path === 'surfaces[3].commands.handoff'
        && item.issue === 'command drift'
    )))
  })
})

test('open-source UI reference audit rejects inconsistent Pro review registry state', () => {
  const registry = JSON.parse(BASELINE_PRO_REVIEW_REGISTRY)
  const image4 = registry.surfaces.find((entry) => entry.surface === 'image4-presence')
  image4.status = 'rejected'
  image4.decision = 'pending'

  withFixture({
    'docs/open-source-ui-pro-review-registry.json': JSON.stringify(registry, null, 2),
  }, (root) => {
    const report = buildOpenSourceUiReferenceAuditReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.errors.proReviewRegistryIssues.some((item) => (
      item.path === 'surfaces[0].decision'
        && item.issue === 'status/decision mismatch'
    )))
  })
})

test('open-source UI reference audit rejects invalid manifest policy', () => {
  const manifest = JSON.parse(BASELINE_MANIFEST)
  manifest.policy.liveNetworkGate = true

  withFixture({
    'docs/open-source-ui-reference-manifest.json': JSON.stringify(manifest, null, 2),
  }, (root) => {
    const report = buildOpenSourceUiReferenceAuditReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.errors.manifestIssues.some((item) => item.path === 'policy.liveNetworkGate'))
  })
})

test('open-source UI reference audit builds focused surface review guidance', () => {
  withFixture({}, (root) => {
    const report = buildOpenSourceUiReferenceAuditReport(root, { surface: 'composer' })

    assert.equal(report.summary.ok, true)
    assert.equal(report.surfaceReview?.surface, 'composer')
    assert.equal(report.surfaceReview?.minReferences, 2)
    assert.deepEqual(
      report.surfaceReview?.references.map((reference) => reference.name),
      ['Chatbox', 'Vercel AI Chatbot'],
    )
    assert.ok(report.surfaceReview?.reviewRules.includes('Borrow constraints, not skins.'))
  })
})

test('open-source UI reference audit builds a prioritized Pro review queue', () => {
  withFixture({}, (root) => {
    const report = buildOpenSourceUiReferenceAuditReport(root, { queue: true })

    assert.equal(report.summary.ok, true)
    assert.equal(report.reviewQueue[0]?.surface, 'image4-presence')
    assert.equal(report.reviewQueue[1]?.surface, 'dial')
    assert.equal(report.reviewQueue[2]?.surface, 'companion-tone')
    assert.equal(report.reviewQueue.find((item) => item.surface === 'companion-tone')?.firstLocalCommand, 'npm run image4:color:audit')
    assert.equal(report.reviewQueue.find((item) => item.surface === 'composer')?.firstLocalCommand, 'npm run composer:surface:audit')
    assert.ok(report.reviewQueue.every((item) => item.proPromptCommand.includes('--pro-prompt --evidence')))
    assert.ok(report.reviewQueue.every((item) => item.proHandoffCommand.includes('--pro-handoff')))
    assert.ok(report.reviewQueue.every((item) => item.proSendPayloadCommand.includes('--pro-send-payload')))
    assert.ok(report.reviewQueue.every((item) => item.questionsCommand.includes('--questions')))
    assert.ok(report.reviewQueue.every((item) => item.patternsCommand.includes('--patterns')))
    assert.ok(report.reviewQueue.every((item) => item.intakeTemplateCommand.includes('--review-intake-template')))
    assert.ok(report.reviewQueue.every((item) => item.recordTemplateCommand.includes('--record-template')))
    assert.ok(report.reviewQueue.every((item) => item.references.length >= 1))
  })
})

test('open-source UI reference audit selects the next Pro review from the registry and queue', () => {
  withFixture({}, (root) => {
    const report = buildOpenSourceUiReferenceAuditReport(root, { nextProReview: true })
    const handoffReport = buildOpenSourceUiReferenceAuditReport(root, { nextProHandoff: true })

    assert.equal(report.summary.ok, true)
    assert.equal(report.nextProReview?.surface, 'image4-presence')
    assert.equal(report.nextProReview?.status, 'not-sent')
    assert.equal(report.nextProReview?.decision, 'pending')
    assert.match(report.nextProReview?.proHandoffCommand ?? '', /--surface=image4-presence --pro-handoff/)
    assert.equal(report.nextProReview?.firstLocalCommand, 'npm run image4:visual-contract:audit')
    assert.equal(handoffReport.summary.ok, true)
    assert.equal(handoffReport.surfaceReview?.surface, 'image4-presence')
    assert.match(handoffReport.proHandoffPackage ?? '', /# Nexus Pro Handoff: image4-presence/)
  })
})

test('open-source UI reference audit prioritizes Pro follow-up before unsent surfaces', () => {
  const registry = JSON.parse(BASELINE_PRO_REVIEW_REGISTRY)
  const composer = registry.surfaces.find((entry) => entry.surface === 'composer')
  composer.status = 'needs-follow-up'
  composer.decision = 'ask-follow-up'
  composer.nextAction = 'Ask Pro one focused follow-up before implementation.'

  withFixture({
    'docs/open-source-ui-pro-review-registry.json': JSON.stringify(registry, null, 2),
  }, (root) => {
    const report = buildOpenSourceUiReferenceAuditReport(root, { nextProReview: true })

    assert.equal(report.summary.ok, true)
    assert.equal(report.nextProReview?.surface, 'composer')
    assert.equal(report.nextProReview?.status, 'needs-follow-up')
    assert.equal(report.nextProReview?.decision, 'ask-follow-up')
    assert.equal(report.nextProReview?.intakeTemplateCommand, 'npm run ui:references:audit -- --surface=composer --review-intake-template')
  })
})

test('open-source UI reference audit skips completed or rejected Pro review registry items', () => {
  const registry = JSON.parse(BASELINE_PRO_REVIEW_REGISTRY)
  const image4 = registry.surfaces.find((entry) => entry.surface === 'image4-presence')
  image4.status = 'recorded'
    image4.decision = 'accepted'
    image4.nextAction = 'Review recorded.'
    const dial = registry.surfaces.find((entry) => entry.surface === 'dial')
  dial.status = 'rejected'
  dial.decision = 'rejected'
  dial.nextAction = 'Do not apply this review.'

  withFixture({
    'docs/open-source-ui-pro-review-registry.json': JSON.stringify(registry, null, 2),
  }, (root) => {
    const report = buildOpenSourceUiReferenceAuditReport(root, { nextProReview: true })

    assert.equal(report.summary.ok, true)
    assert.equal(report.nextProReview?.surface, 'companion-tone')
    assert.equal(report.nextProReview?.status, 'not-sent')
  })
})

test('open-source UI reference audit rejects unknown focused surface requests', () => {
  withFixture({}, (root) => {
    const report = buildOpenSourceUiReferenceAuditReport(root, { surface: 'unknown-surface' })

    assert.equal(report.summary.ok, false)
    assert.equal(report.surfaceReview, null)
    assert.equal(report.errors.unknownSurfaceRequests[0]?.surface, 'unknown-surface')
    assert.ok(report.errors.unknownSurfaceRequests[0]?.availableSurfaces.includes('composer'))
  })
})

test('open-source UI reference audit trims focused surface input', () => {
  withFixture({}, (root) => {
    const report = buildOpenSourceUiReferenceAuditReport(root, { surface: ' settings ' })

    assert.equal(report.summary.ok, true)
    assert.equal(report.surfaceReview?.surface, 'settings')
    assert.deepEqual(
      report.surfaceReview?.references.map((reference) => reference.name),
      ['Cherry Studio', 'shadcn/ui', 'Radix UI Primitives'],
    )
  })
})

test('open-source UI reference audit builds a safe Pro review prompt for a focused surface', () => {
  withFixture({}, (root) => {
    const report = buildOpenSourceUiReferenceAuditReport(root, {
      surface: 'composer',
      proPrompt: true,
    })

    assert.equal(report.summary.ok, true)
    assert.match(report.proPrompt ?? '', /本次 surface：composer/)
    assert.match(report.proPrompt ?? '', /Chatbox/)
    assert.match(report.proPrompt ?? '', /Vercel AI Chatbot/)
    assert.match(report.proPrompt ?? '', /不能复制任何产品皮肤/)
    assert.match(report.proPrompt ?? '', /可借鉴的开源 UI 抽象范式/)
    assert.match(report.proPrompt ?? '', /Nexus 映射/)
    assert.match(report.proPrompt ?? '', /必须回答的关键问题/)
    assert.match(report.proPrompt ?? '', /composer 应该更像 intent gateway/)
    assert.match(report.proPrompt ?? '', /不要泛泛讲 UI 美学/)
    assert.doesNotMatch(report.proPrompt ?? '', /API key|secret|password/i)
  })
})

test('open-source UI reference audit builds critical Pro questions for a focused surface', () => {
  withFixture({}, (root) => {
    const report = buildOpenSourceUiReferenceAuditReport(root, {
      surface: 'dial',
      questions: true,
    })

    assert.equal(report.summary.ok, true)
    assert.equal(report.surfaceQuestions?.surface, 'dial')
    assert.ok(report.surfaceQuestions?.questions.some((question) => question.includes('日期/天气')))
    assert.ok(report.surfaceQuestions?.decisionChecks.some((check) => check.includes('selected Nexus surface')))
  })
})

test('open-source UI reference audit builds a surface pattern matrix for focused Pro review', () => {
  withFixture({}, (root) => {
    const report = buildOpenSourceUiReferenceAuditReport(root, {
      surface: 'composer',
      patterns: true,
    })

    assert.equal(report.summary.ok, true)
    assert.equal(report.surfacePatterns?.surface, 'composer')
    assert.ok(report.surfacePatterns?.patterns.some((pattern) => pattern.reference === 'Chatbox'))
    assert.ok(report.surfacePatterns?.patterns.some((pattern) => pattern.reference === 'Vercel AI Chatbot'))
    assert.ok(report.surfacePatterns?.patterns.every((pattern) => pattern.nexusMapping.length > 0))
    assert.ok(report.surfacePatterns?.patterns.every((pattern) => pattern.avoid.length > 0))
  })
})

test('open-source UI reference audit builds a complete Pro handoff package for a focused surface', () => {
  withFixture({}, (root) => {
    const report = buildOpenSourceUiReferenceAuditReport(root, {
      surface: 'composer',
      proHandoff: true,
    })

    assert.equal(report.summary.ok, true)
    assert.equal(report.surfaceEvidence?.surface, 'composer')
    assert.match(report.proHandoffPackage ?? '', /# Nexus Pro Handoff: composer/)
    assert.match(report.proHandoffPackage ?? '', /Send This Prompt To Pro/)
    assert.match(report.proHandoffPackage ?? '', /Local Evidence Boundary/)
    assert.match(report.proHandoffPackage ?? '', /Pattern Matrix Snapshot/)
    assert.match(report.proHandoffPackage ?? '', /Required Questions/)
    assert.match(report.proHandoffPackage ?? '', /Record The Answer Here/)
    assert.match(report.proHandoffPackage ?? '', /npm run composer:surface:audit/)
    assert.match(report.proHandoffPackage ?? '', /Do not include secrets/)
    assert.doesNotMatch(report.proHandoffPackage ?? '', /API key|password/i)
  })
})

test('open-source UI reference audit builds a Pro review intake template for a focused surface', () => {
  withFixture({}, (root) => {
    const report = buildOpenSourceUiReferenceAuditReport(root, {
      surface: 'composer',
      intakeTemplate: true,
    })

    assert.equal(report.summary.ok, true)
    assert.match(report.proReviewIntakeTemplate ?? '', /# Pro Review Intake: composer/)
    assert.match(report.proReviewIntakeTemplate ?? '', /Answer Triage/)
    assert.match(report.proReviewIntakeTemplate ?? '', /Accepted Abstract Patterns/)
    assert.match(report.proReviewIntakeTemplate ?? '', /Decision outcome/)
    assert.match(report.proReviewIntakeTemplate ?? '', /Verification Plan/)
    assert.match(report.proReviewIntakeTemplate ?? '', /Privacy Check/)
    assert.match(report.proReviewIntakeTemplate ?? '', /npm run composer:surface:audit/)
    assert.doesNotMatch(report.proReviewIntakeTemplate ?? '', /API key|password/i)
  })
})

test('open-source UI reference audit builds a Pro review record template for a focused surface', () => {
  withFixture({}, (root) => {
    const report = buildOpenSourceUiReferenceAuditReport(root, {
      surface: 'composer',
      recordTemplate: true,
    })

    assert.equal(report.summary.ok, true)
    assert.match(report.proRecordTemplate ?? '', /# Pro Review Record: composer/)
    assert.match(report.proRecordTemplate ?? '', /Pro prompt command/)
    assert.match(report.proRecordTemplate ?? '', /Decision outcome/)
    assert.match(report.proRecordTemplate ?? '', /可借鉴的开源 UI 抽象范式/)
    assert.match(report.proRecordTemplate ?? '', /必须回答的关键问题/)
    assert.match(report.proRecordTemplate ?? '', /Do-Not-Copy Boundary/)
    assert.match(report.proRecordTemplate ?? '', /npm run composer:surface:audit/)
    assert.doesNotMatch(report.proRecordTemplate ?? '', /API key|password/i)
  })
})

test('open-source UI reference audit builds bounded surface evidence for Pro review', () => {
  withFixture({}, (root) => {
    const report = buildOpenSourceUiReferenceAuditReport(root, {
      surface: 'image4-presence',
      evidence: true,
    })

    assert.equal(report.summary.ok, true)
    assert.equal(report.surfaceEvidence?.surface, 'image4-presence')
    assert.ok(report.surfaceEvidence?.docs.includes('docs/IMAGE4_COMPANION_FIELD_REFERENCE_REVIEW.md'))
    assert.ok(report.surfaceEvidence?.sourceFiles.includes('src/app/views/Image4CompanionField.tsx'))
    assert.ok(report.surfaceEvidence?.commands.includes('npm run image4:visual-contract:audit'))
    assert.ok(report.surfaceEvidence?.browserChecks.some((check) => check.includes('image4Preview=1')))
    assert.equal(report.surfaceEvidence?.privacy.staticSourceOnly, true)
  })
})

test('open-source UI reference audit includes companion-tone research anchors in bounded evidence', () => {
  withFixture({}, (root) => {
    const report = buildOpenSourceUiReferenceAuditReport(root, { surface: 'companion-tone', evidence: true })
    const researchNotes = report.surfaceEvidence?.researchNotes ?? []

    assert.equal(report.summary.ok, true)
    assert.equal(report.surfaceEvidence?.surface, 'companion-tone')
    assert.ok(researchNotes.some((note) => note.includes('positive low-arousal comfort and relaxation')))
    assert.ok(researchNotes.some((note) => note.includes('Peach/apricot should stay a restrained warmth accent')))
    assert.ok(researchNotes.some((note) => note.includes('W3C non-text contrast guidance')))
  })
})

test('open-source UI reference audit includes evidence in safe Pro prompts when requested', () => {
  withFixture({}, (root) => {
    const report = buildOpenSourceUiReferenceAuditReport(root, {
      surface: 'dial',
      proPrompt: true,
      evidence: true,
    })

    assert.equal(report.summary.ok, true)
    assert.match(report.proPrompt ?? '', /当前 Nexus 本地证据边界/)
    assert.match(report.proPrompt ?? '', /src\/app\/views\/Image4CompanionField\.tsx/)
    assert.match(report.proPrompt ?? '', /npm run image4:visual-contract:audit/)
    assert.doesNotMatch(report.proPrompt ?? '', /API key|secret|password/i)
  })
})

test('open-source UI reference audit rejects Pro prompt requests without a focused surface', () => {
  withFixture({}, (root) => {
    const report = buildOpenSourceUiReferenceAuditReport(root, { proPrompt: true })

    assert.equal(report.summary.ok, false)
    assert.equal(report.proPrompt, null)
    assert.equal(
      report.errors.promptRequestIssues[0]?.issue,
      'pro prompt requires a valid --surface value',
    )
  })
})

test('open-source UI reference audit rejects Pro handoff requests without a focused surface', () => {
  withFixture({}, (root) => {
    const report = buildOpenSourceUiReferenceAuditReport(root, { proHandoff: true })

    assert.equal(report.summary.ok, false)
    assert.equal(report.proHandoffPackage, null)
    assert.equal(
      report.errors.handoffRequestIssues[0]?.issue,
      'pro handoff requires a valid --surface value',
    )
  })
})

test('open-source UI reference audit rejects evidence requests without a focused surface', () => {
  withFixture({}, (root) => {
    const report = buildOpenSourceUiReferenceAuditReport(root, { evidence: true })

    assert.equal(report.summary.ok, false)
    assert.equal(report.surfaceEvidence, null)
    assert.equal(
      report.errors.evidenceRequestIssues[0]?.issue,
      'evidence output requires a valid --surface value',
    )
  })
})

test('open-source UI reference audit rejects intake template requests without a focused surface', () => {
  withFixture({}, (root) => {
    const report = buildOpenSourceUiReferenceAuditReport(root, { intakeTemplate: true })

    assert.equal(report.summary.ok, false)
    assert.equal(report.proReviewIntakeTemplate, null)
    assert.equal(
      report.errors.intakeTemplateRequestIssues[0]?.issue,
      'review intake template requires a valid --surface value',
    )
  })
})

test('open-source UI reference audit rejects record template requests without a focused surface', () => {
  withFixture({}, (root) => {
    const report = buildOpenSourceUiReferenceAuditReport(root, { recordTemplate: true })

    assert.equal(report.summary.ok, false)
    assert.equal(report.proRecordTemplate, null)
    assert.equal(
      report.errors.recordTemplateRequestIssues[0]?.issue,
      'record template requires a valid --surface value',
    )
  })
})

test('open-source UI reference audit rejects question requests without a focused surface', () => {
  withFixture({}, (root) => {
    const report = buildOpenSourceUiReferenceAuditReport(root, { questions: true })

    assert.equal(report.summary.ok, false)
    assert.equal(report.surfaceQuestions, null)
    assert.equal(
      report.errors.questionsRequestIssues[0]?.issue,
      'questions output requires a valid --surface value',
    )
  })
})

test('open-source UI reference audit rejects pattern matrix requests without a focused surface', () => {
  withFixture({}, (root) => {
    const report = buildOpenSourceUiReferenceAuditReport(root, { patterns: true })

    assert.equal(report.summary.ok, false)
    assert.equal(report.surfacePatterns, null)
    assert.equal(
      report.errors.patternsRequestIssues[0]?.issue,
      'patterns output requires a valid --surface value',
    )
  })
})

test('open-source UI reference audit rejects malformed manifest references', () => {
  const manifest = JSON.parse(BASELINE_MANIFEST)
  manifest.references[0].observedHead.commit = 'not-a-sha'

  withFixture({
    'docs/open-source-ui-reference-manifest.json': JSON.stringify(manifest, null, 2),
  }, (root) => {
    const report = buildOpenSourceUiReferenceAuditReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.errors.manifestIssues.some((item) => item.path === 'references[0].observedHead.commit'))
  })
})

test('open-source UI reference audit rejects required surfaces without a pattern matrix entry', () => {
  const manifest = JSON.parse(BASELINE_MANIFEST)
  manifest.requiredSurfaceCoverage.push({
    surface: 'new-reference-surface',
    minReferences: 1,
    reason: 'New surfaces need a mapped pattern matrix before Pro review.',
  })
  manifest.references[0].surfaces.push('new-reference-surface')

  withFixture({
    'docs/open-source-ui-reference-manifest.json': JSON.stringify(manifest, null, 2),
  }, (root) => {
    const report = buildOpenSourceUiReferenceAuditReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.errors.missingPatternMatrixEntries.some((item) => item.surface === 'new-reference-surface'))
  })
})

test('open-source UI reference audit rejects missing required surface coverage', () => {
  const manifest = JSON.parse(BASELINE_MANIFEST)
  manifest.references[4].surfaces = ['streaming']

  withFixture({
    'docs/open-source-ui-reference-manifest.json': JSON.stringify(manifest, null, 2),
  }, (root) => {
    const report = buildOpenSourceUiReferenceAuditReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.errors.surfaceCoverageIssues.some((item) => item.surface === 'composer'))
  })
})

test('open-source UI reference audit rejects invalid coverage entries', () => {
  const manifest = JSON.parse(BASELINE_MANIFEST)
  manifest.requiredSurfaceCoverage[0].minReferences = 0

  withFixture({
    'docs/open-source-ui-reference-manifest.json': JSON.stringify(manifest, null, 2),
  }, (root) => {
    const report = buildOpenSourceUiReferenceAuditReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.errors.manifestIssues.some((item) => item.path === 'requiredSurfaceCoverage[0].minReferences'))
  })
})

test('open-source UI reference audit rejects missing verified reference URLs', () => {
  withFixture({
    'docs/OPEN_SOURCE_UI_REFERENCE_AUDIT.md': BASELINE_OPEN_SOURCE_DOC.replace(
      'https://github.com/open-webui/open-webui',
      'https://example.invalid/open-webui',
    ),
  }, (root) => {
    const report = buildOpenSourceUiReferenceAuditReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.errors.missingReferences.some((item) => item.reference === 'Open WebUI'))
  })
})

test('open-source UI reference audit rejects missing pinned remote evidence', () => {
  withFixture({
    'docs/OPEN_SOURCE_UI_REFERENCE_AUDIT.md': BASELINE_OPEN_SOURCE_DOC.replace(
      '02dc3e689ceac915a870b373318b99c029ddf603',
      'missing-open-webui-commit',
    ),
  }, (root) => {
    const report = buildOpenSourceUiReferenceAuditReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.errors.missingRemoteEvidence.some((item) => item.reference === 'Open WebUI'))
  })
})

test('open-source UI reference audit rejects missing boundary sections', () => {
  withFixture({
    'docs/OPEN_SOURCE_UI_REFERENCE_AUDIT.md': BASELINE_OPEN_SOURCE_DOC.replace(
      '## Decision Matrix',
      '## Removed Decision Matrix',
    ),
  }, (root) => {
    const report = buildOpenSourceUiReferenceAuditReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.errors.missingSections.some((item) => item.section === 'Decision Matrix'))
  })
})

test('open-source UI reference audit rejects unsafe copying language', () => {
  withFixture({
    'docs/OPEN_SOURCE_UI_REFERENCE_AUDIT.md': `${BASELINE_OPEN_SOURCE_DOC}
Borrow exact spacing from LobeHub when the panel feels close enough.
`,
  }, (root) => {
    const report = buildOpenSourceUiReferenceAuditReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.errors.unsafeBorrowingLanguage.some((item) => item.id === 'borrow-exact-spacing'))
  })
})

test('open-source UI reference audit rejects unsafe copying language in surface review docs', () => {
  withFixture({
    'docs/SETTINGS_SURFACE_REFERENCE_REVIEW.md': `${BASELINE_SETTINGS_REVIEW_DOC}
Copy exact reference colors into the settings drawer when it looks close.
`,
  }, (root) => {
    const report = buildOpenSourceUiReferenceAuditReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.errors.unsafeBorrowingLanguage.some((item) => (
      item.file === 'docs/SETTINGS_SURFACE_REFERENCE_REVIEW.md'
        && item.id === 'copy-exact-reference'
    )))
  })
})

test('open-source UI reference audit rejects missing chat Pro review record', () => {
  withFixture({
    'docs/CHAT_SURFACE_REFERENCE_REVIEW.md': BASELINE_CHAT_REVIEW_DOC.replace(
      'chat = streaming feed + input dominance + tool boundary contract',
      'chat = generic message list',
    ),
  }, (root) => {
    const report = buildOpenSourceUiReferenceAuditReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.errors.missingChatReviewPhrases.some((item) => item.phrase === 'chat = streaming feed + input dominance + tool boundary contract'))
  })
})

test('open-source UI reference audit rejects missing composer Pro review record', () => {
  withFixture({
    'docs/COMPOSER_SURFACE_REFERENCE_REVIEW.md': BASELINE_COMPOSER_REVIEW_DOC.replace(
      'composer = intent gateway + streaming controller',
      'composer = generic input',
    ),
  }, (root) => {
    const report = buildOpenSourceUiReferenceAuditReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.errors.missingComposerReviewPhrases.some((item) => item.phrase === 'composer = intent gateway + streaming controller'))
  })
})

test('open-source UI reference audit rejects missing Image4 companion-field Pro review record', () => {
  withFixture({
    'docs/IMAGE4_COMPANION_FIELD_REFERENCE_REVIEW.md': BASELINE_IMAGE4_REVIEW_DOC.replace(
      'image4 = companion semantic field',
      'image4 = widget stack',
    ),
  }, (root) => {
    const report = buildOpenSourceUiReferenceAuditReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.errors.missingImage4ReviewPhrases.some((item) => item.phrase === 'image4 = companion semantic field'))
  })
})

test('open-source UI reference audit rejects missing settings Pro review record', () => {
  withFixture({
    'docs/SETTINGS_SURFACE_REFERENCE_REVIEW.md': BASELINE_SETTINGS_REVIEW_DOC.replace(
      'settings = companion behavior tuning surface',
      'settings = generic preferences',
    ),
  }, (root) => {
    const report = buildOpenSourceUiReferenceAuditReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.errors.missingSettingsReviewPhrases.some((item) => item.phrase === 'settings = companion behavior tuning surface'))
  })
})

test('open-source UI reference audit is wired into the PR gate', () => {
  withFixture({
    'package.json': JSON.stringify({
      scripts: {
        'ui:references:audit': 'node scripts/open-source-ui-reference-audit.mjs',
        'verify:pr': 'npm run image4:contract:check',
      },
    }, null, 2),
  }, (root) => {
    const report = buildOpenSourceUiReferenceAuditReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.errors.missingPackageScripts.some((item) => item.script === 'verify:pr'))
  })
})
