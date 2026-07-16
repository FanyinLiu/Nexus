import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { buildComposerCrossSurfaceReport } from '../scripts/composer-cross-surface-audit.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const BASELINE_FILES: Record<string, string> = {
  'src/app/views/LegacyPanelView.tsx': `
import { deriveImage4ComposerState } from './image4ComposerState'

export function PanelView() {
  const image4ComposerState = deriveImage4ComposerState({
    busy: chat.busy,
    input: chat.input,
    hasPendingImage: Boolean(chat.pendingImage),
    hasNotificationReply,
    canSendNotificationReply,
    voiceState: voice.voiceState,
  })
  return (
    <div className="composer composer--minimal companion-chat__composer image4-composer">
      <div
        className="image4-composer__field"
        data-composer-state={image4ComposerState.mode}
        data-send-state={image4ComposerState.sendState}
        data-has-attachment={image4ComposerState.hasAttachment ? 'true' : 'false'}
        data-voice-state={image4ComposerState.voiceMode}
      >
        <textarea className="composer__input" />
        <input className="composer__file-input" />
        <button className="image4-attachment-pill" type="button">
          <PetControlIcon name="image" className="image4-attachment-pill__plus" />
        </button>
        <div className="composer__actions">
          <button disabled={image4ComposerState.sendDisabled}><PetControlIcon name="send" /></button>
        </div>
      </div>
      <div className="companion-chat__composer-meta" />
    </div>
  )
}
`,
  'src/app/views/image4ComposerState.ts': `
export type Image4ComposerMode = 'idle' | 'drafting' | 'streaming' | 'interrupted'
export type Image4ComposerSendState = 'disabled' | 'ready' | 'busy'
export type Image4ComposerVoiceMode = 'idle' | 'listening' | 'processing' | 'speaking'
export type Image4ComposerStateInput = {
  busy: boolean
  input: string
  hasPendingImage: boolean
  hasNotificationReply: boolean
  canSendNotificationReply: boolean
  voiceState: Image4ComposerVoiceMode
}
export type Image4ComposerState = {
  mode: Image4ComposerMode
  sendState: Image4ComposerSendState
  voiceMode: Image4ComposerVoiceMode
}
export function deriveImage4ComposerState(input) {
  return {
    mode: input.busy ? 'streaming' : 'idle',
    sendState: input.busy ? 'busy' : 'disabled',
    sendDisabled: true,
    hasAttachment: input.hasPendingImage,
    voiceMode: input.voiceState,
  }
}
`,
  'src/app/App.css': `
.composer textarea {
  resize: none;
}

.panel-window--companion .companion-chat__composer {
  display: grid;
  gap: 8px;
}

.panel-window--companion .composer textarea {
  height: 64px;
}

.panel-window--companion .composer textarea:focus {
  border-color: rgba(255, 214, 150, 0.34);
  box-shadow: 0 0 0 2px rgba(255, 214, 150, 0.08);
}

.panel-window--companion .composer__actions {
  justify-content: flex-end;
}

.panel-window--companion .composer__actions .ghost-button:hover,
.panel-window--companion .composer__actions .primary-button:hover {
  transform: none;
  box-shadow: none;
}
`,
  'src/app/styles/panel-companion.css': `
@import './panel-companion-shell.css';
@import './panel-companion-collapsed.css';
@import './panel-companion-layout.css';
@import './panel-companion-chat.css';
@import './panel-companion-composer.css';
@import './panel-companion-rhythm.css';
@import './panel-companion-motion.css';
`,
  'src/app/styles/panel-companion-chat.css': `
.panel-window--image4 .image4-composer {
  grid-row: composer;
  grid-template-areas: "input";
}
`,
  'src/app/styles/panel-companion-composer.css': `
.panel-window--image4 .image4-composer__field,
html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field {
  height: clamp(58px, 6.7vh, 76px);
  --image4-composer-control: 29px;
  --image4-composer-icon: 16px;
  --image4-composer-rail-gap: 2px;
  --image4-composer-side-inset: 12px;
  --image4-composer-left-text-gap: 11px;
  --image4-composer-right-text-gap: 10px;
}

.panel-window--image4 .image4-composer__field:focus-within,
html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field:focus-within {
  border-color: var(--image4-state-focus-border);
  outline: 2px solid color-mix(in srgb, var(--image4-state-focus-border) 10%, transparent);
}

.panel-window--image4 .image4-composer__field[data-composer-state='drafting'] {}
.panel-window--image4 .image4-composer__field[data-composer-state='streaming'] {}
.panel-window--image4 .image4-composer__field[data-composer-state='interrupted'] {}
.panel-window--image4 .image4-composer__field textarea,
html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field textarea {
  padding:
    17px
    calc(var(--image4-composer-control) + var(--image4-composer-side-inset) + var(--image4-composer-right-text-gap))
    13px
    calc(var(--image4-composer-control) + var(--image4-composer-side-inset) + var(--image4-composer-left-text-gap));
}

.panel-window--image4 .image4-composer__field textarea:focus,
html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field textarea:focus {
  border-color: transparent;
  box-shadow: none;
}

html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field textarea::placeholder {
  color: rgba(58, 74, 90, 0.68);
}

.panel-window--image4 .image4-composer__field .image4-attachment-pill,
.panel-window--image4 .image4-composer__field .composer__actions,
html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field .image4-attachment-pill,
html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field .composer__actions {
  position: absolute;
  top: 50%;
  bottom: auto;
  z-index: 2;
  transform: translateY(-50%);
}

.panel-window--image4 .image4-composer__field .image4-attachment-pill,
html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field .image4-attachment-pill {
  right: auto;
  display: inline-flex;
  left: var(--image4-composer-side-inset);
  width: var(--image4-composer-control);
  height: var(--image4-composer-control);
  min-width: var(--image4-composer-control);
  min-height: var(--image4-composer-control);
  align-items: center;
  justify-content: center;
  gap: 0;
  padding: 0;
}

.panel-window--image4 .image4-composer__field .composer__actions,
html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field .composer__actions {
  right: var(--image4-composer-side-inset);
  display: inline-grid;
  grid-auto-flow: column;
  grid-auto-columns: var(--image4-composer-control);
  width: auto;
  height: var(--image4-composer-control);
  align-items: center;
  justify-content: center;
  gap: var(--image4-composer-rail-gap);
  padding: 0;
}

.panel-window--image4 .image4-composer__field .image4-attachment-pill,
.panel-window--image4 .image4-composer__field .composer__actions .primary-button,
html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field .image4-attachment-pill,
html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field .composer__actions .primary-button {
  width: var(--image4-composer-control);
  height: var(--image4-composer-control);
  min-width: var(--image4-composer-control);
  min-height: var(--image4-composer-control);
  border-color: transparent;
  background: transparent;
  box-shadow: none;
}

.panel-window--image4 .image4-composer__field .composer__actions .primary-button,
html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field .composer__actions .primary-button {
  display: grid;
  place-items: center;
  padding: 0;
}

.panel-window--image4 .image4-composer__field .composer__actions .primary-button,
html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field .composer__actions .primary-button {
  order: 3;
}

.panel-window--image4 .image4-composer__field .composer__actions .primary-button span {
  display: none;
}

.panel-window--image4 .image4-composer__field .image4-attachment-pill__plus,
.panel-window--image4 .image4-composer__field .composer__action-icon,
html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field .image4-attachment-pill__plus,
html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field .composer__action-icon {
  width: var(--image4-composer-icon);
  height: var(--image4-composer-icon);
  stroke-width: 1.85;
}

.panel-window--image4 .image4-composer__field[data-send-state='ready'] .composer__actions .primary-button:not(:disabled),
html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field[data-send-state='ready'] .composer__actions .primary-button:not(:disabled) {
  color: rgba(45, 91, 126, 0.88);
}

.panel-window--image4 .image4-composer__field[data-send-state='busy'] .composer__actions .primary-button {
  cursor: progress;
}

.panel-window--image4 .image4-composer__field .image4-attachment-pill:hover,
.panel-window--image4 .image4-composer__field .composer__actions .primary-button:hover,
html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field .image4-attachment-pill:hover,
html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field .composer__actions .primary-button:hover {
  background: rgba(73, 94, 114, 0.08);
  transform: none;
  box-shadow: none;
}

.panel-window--image4 .image4-composer__field .image4-attachment-pill:focus-visible,
.panel-window--image4 .image4-composer__field .composer__actions .primary-button:focus-visible,
html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field .image4-attachment-pill:focus-visible,
html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field .composer__actions .primary-button:focus-visible {
  box-shadow: var(--image4-state-focus-ring);
}

.panel-window--image4 .image4-composer__field[data-send-state='disabled'] .composer__actions .primary-button:disabled,
html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field[data-send-state='disabled'] .composer__actions .primary-button:disabled {
  background: transparent;
  color: rgba(76, 92, 108, 0.36);
  box-shadow: none;
  cursor: default;
}
`,
  'docs/COMPOSER_SURFACE_REFERENCE_REVIEW.md': `
# Composer Surface Reference Review

## Composer Surface Contract

- Composer is a single-surface intent gateway, not a toolbar.
- Textarea is the primary intent area.
- Send is primary only when submit is available.
- Attachment is an embedded secondary tool.
- Voice runtime controls stay in Settings and out of the main composer.
- Runtime/model/streaming hints are tertiary.
- Image4 composer and normal chat composer must share alignment rhythm and control box rules.
- Hover/focus may reveal lightweight affordance, but default tool controls must not read as separate tiles.
- Do not add provider, agent, preset, tool-market, or runtime-dashboard controls to the default composer layer.
- Do not change Image4 button dimensions to repair alignment.

## Final Composer Rhythm

The final Image4 composer layer owns the compact control rhythm. \`panel-companion-composer.css\` owns final attachment, send, textarea, focus, and state styling; \`panel-companion-chat.css\` only owns the dock/container, empty state, action prompts, and hint text.

- field text padding: \`17px 51px 13px 52px\`;
- attachment and send use a \`29px control box\`;
- icon glyphs use a \`16px icon box\`;
- attachment/send controls use a \`2px control gap\`;
- default embedded controls stay transparent and do not carry persistent backplates.

## Composer Surface Contract

- Attachment is an embedded secondary tool.
- Voice runtime controls stay in Settings and out of the main composer.

Do not use button resizing as an alignment fix.
`,
}

function createComposerFixture(overrides: Record<string, string | null> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'nexus-composer-surface-audit-'))
  for (const [relativePath, baseline] of Object.entries(BASELINE_FILES)) {
    if (overrides[relativePath] === null) continue
    const absolutePath = join(root, relativePath)
    mkdirSync(dirname(absolutePath), { recursive: true })
    writeFileSync(absolutePath, overrides[relativePath] ?? baseline)
  }
  return root
}

function withComposerFixture<T>(
  overrides: Record<string, string | null>,
  callback: (root: string) => T,
): T {
  const root = createComposerFixture(overrides)
  try {
    return callback(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('composer cross-surface audit passes the protected shared composer structure', () => {
  withComposerFixture({}, (root) => {
    const report = buildComposerCrossSurfaceReport(root)

    assert.equal(report.summary.ok, true)
    assert.equal(report.summary.errors, 0)
    assert.equal(report.privacy.staticSourceOnly, true)
    assert.equal(report.composerDom.sharedHookOccurrences, 1)
    assert.equal(report.composerDom.hasMicAction, false)
    assert.equal(report.composerDom.hasSendAction, true)
    assert.equal(report.unsafeActionElevation.length, 0)
  })
})

test('composer cross-surface audit rejects a Legacy Panel mic action', () => {
  withComposerFixture({
    'src/app/views/LegacyPanelView.tsx': `${BASELINE_FILES['src/app/views/LegacyPanelView.tsx']}
<PetControlIcon name="mic" />
`,
  }, (root) => {
    const report = buildComposerCrossSurfaceReport(root)

    assert.equal(report.summary.ok, false)
    assert.equal(report.composerDom.hasMicAction, true)
    assert.ok(report.forbiddenPatterns.some((item) => item.id === 'legacy-composer-forbids-mic-action'))
  })
})

test('composer cross-surface audit rejects missing Image4 dock ownership', () => {
  withComposerFixture({
    'src/app/styles/panel-companion-chat.css': BASELINE_FILES['src/app/styles/panel-companion-chat.css'].replace(
      'grid-template-areas: "input";',
      'align-self: end;',
    ),
  }, (root) => {
    const report = buildComposerCrossSurfaceReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.missingContracts.some((item) => item.id === 'image4-single-dock-composer'))
  })
})

test('composer cross-surface audit rejects unaligned Image4 action controls', () => {
  withComposerFixture({
    'src/app/styles/panel-companion-composer.css': BASELINE_FILES['src/app/styles/panel-companion-composer.css']
      .replace('top: 50%;', 'top: calc(50% + 4px);')
      .replace('z-index: 2;', 'z-index: 1;'),
  }, (root) => {
    const report = buildComposerCrossSurfaceReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.missingContracts.some((item) => item.id === 'image4-action-rail-alignment'))
  })
})

test('composer cross-surface audit rejects final compact control rhythm drift', () => {
  withComposerFixture({
    'src/app/styles/panel-companion-composer.css': BASELINE_FILES['src/app/styles/panel-companion-composer.css']
      .replaceAll('29px', '38px')
      .replaceAll('16px', '22px'),
  }, (root) => {
    const report = buildComposerCrossSurfaceReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.missingContracts.some((item) => item.id === 'image4-final-compact-control-rhythm'))
  })
})

test('composer cross-surface audit rejects adding dropdown chrome to the Image4 attachment icon', () => {
  withComposerFixture({
    'src/app/views/LegacyPanelView.tsx': BASELINE_FILES['src/app/views/LegacyPanelView.tsx'].replace(
      '<PetControlIcon name="image" className="image4-attachment-pill__plus" />',
      `<PetControlIcon name="image" className="image4-attachment-pill__image" />
        <PetControlIcon name="chevron-down" className="image4-attachment-pill__chevron" />`,
    ),
  }, (root) => {
    const report = buildComposerCrossSurfaceReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.forbiddenPatterns.some((item) => item.id === 'image4-attachment-stays-single-purpose'))
  })
})

test('composer cross-surface audit rejects default provider or runtime controls in the composer layer', () => {
  withComposerFixture({
    'src/app/views/LegacyPanelView.tsx': BASELINE_FILES['src/app/views/LegacyPanelView.tsx'].replace(
      '<div className="composer__actions">',
      '<div className="composer__provider-dashboard" />\n      <div className="composer__actions">',
    ),
  }, (root) => {
    const report = buildComposerCrossSurfaceReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.forbiddenPatterns.some((item) => item.id === 'composer-forbids-default-dashboard-controls'))
  })
})

test('composer cross-surface audit rejects dead three-button Image4 sizing branches', () => {
  withComposerFixture({
    'src/app/styles/panel-companion-chat.css': `${BASELINE_FILES['src/app/styles/panel-companion-chat.css']}
.panel-window--image4 .composer__actions:has(> button:nth-child(3)) .ghost-button:first-child {
  width: 70px;
}
`,
  }, (root) => {
    const report = buildComposerCrossSurfaceReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.forbiddenPatterns.some((item) => item.id === 'composer-css-forbids-toolbar-and-three-button-mode'))
  })
})

test('composer cross-surface audit rejects final Image4 controls moving back into chat css', () => {
  withComposerFixture({
    'src/app/styles/panel-companion-chat.css': `${BASELINE_FILES['src/app/styles/panel-companion-chat.css']}
.panel-window--image4 .composer__actions {
  grid-auto-columns: clamp(30px, 5.2vw, 42px);
}
`,
  }, (root) => {
    const report = buildComposerCrossSurfaceReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.forbiddenPatterns.some((item) => item.id === 'composer-chat-css-forbids-final-control-ownership'))
  })
})

test('composer cross-surface audit rejects Image4 hooks leaking into normal companion CSS', () => {
  withComposerFixture({
    'src/app/App.css': `${BASELINE_FILES['src/app/App.css']}
.panel-window--companion .image4-composer { display: block; }
`,
  }, (root) => {
    const report = buildComposerCrossSurfaceReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.forbiddenPatterns.some((item) => item.id === 'companion-css-imports-image4-hooks'))
  })
})

test('composer cross-surface audit rejects hover or focus transform jumps', () => {
  withComposerFixture({
    'src/app/styles/panel-companion-chat.css': `${BASELINE_FILES['src/app/styles/panel-companion-chat.css']}
.panel-window--image4 .composer__actions .primary-button:hover {
  transform: translateY(-1px);
}
`,
  }, (root) => {
    const report = buildComposerCrossSurfaceReport(root)

    assert.equal(report.summary.ok, false)
    assert.equal(report.unsafeTransforms.length, 1)
    assert.equal(report.unsafeTransforms[0]?.value, 'translateY(-1px)')
  })
})

test('composer cross-surface audit rejects hover elevation on action buttons', () => {
  withComposerFixture({
    'src/app/App.css': `${BASELINE_FILES['src/app/App.css']}
.panel-window--companion .composer__actions .primary-button:hover {
  box-shadow: 0 10px 20px rgba(0, 0, 0, 0.2);
}
`,
  }, (root) => {
    const report = buildComposerCrossSurfaceReport(root)

    assert.equal(report.summary.ok, false)
    assert.equal(report.unsafeActionElevation.length, 1)
    assert.equal(report.unsafeActionElevation[0]?.issues[0]?.property, 'box-shadow')
  })
})

test('composer cross-surface audit rejects missing disabled-send tertiary lock', () => {
  withComposerFixture({
    'src/app/styles/panel-companion-composer.css': BASELINE_FILES['src/app/styles/panel-companion-composer.css'].replace(
      `.panel-window--image4 .image4-composer__field[data-send-state='disabled'] .composer__actions .primary-button:disabled,
html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field[data-send-state='disabled'] .composer__actions .primary-button:disabled {
  background: transparent;
  color: rgba(76, 92, 108, 0.36);
  box-shadow: none;
  cursor: default;
}`,
      `.panel-window--image4 .image4-composer__field[data-send-state='disabled'] .composer__actions .primary-button:disabled,
html[data-theme='warm-day'] .panel-window--image4 .image4-composer__field[data-send-state='disabled'] .composer__actions .primary-button:disabled {
  background: rgba(111, 226, 239, 0.12);
  color: rgba(135, 232, 247, 0.9);
  box-shadow: 0 0 0 1px rgba(111, 226, 239, 0.16);
  cursor: pointer;
}`,
    ),
  }, (root) => {
    const report = buildComposerCrossSurfaceReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(report.missingContracts.some((item) => item.id === 'send-disabled-tertiary-lock'))
  })
})

test('composer surface audit is wired into the PR gate', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> }

  assert.equal(pkg.scripts['composer:surface:audit'], 'node scripts/composer-cross-surface-audit.mjs')
  assert.match(pkg.scripts['verify:pr'], /composer:surface:audit/)
})

test('design docs keep Image4 rhythm grid scoped away from chat and settings', () => {
  const openSourceAudit = readFileSync(join(ROOT, 'docs/OPEN_SOURCE_UI_REFERENCE_AUDIT.md'), 'utf8')
  const designChecklist = readFileSync(join(ROOT, 'docs/DESIGN_REVIEW_CHECKLIST.md'), 'utf8')
  const image4Patterns = readFileSync(join(ROOT, 'docs/IMAGE4_UI_REFERENCE_PATTERNS.md'), 'utf8')

  assert.match(openSourceAudit, /Image4 is an ambient companion panel, so it can use a strict visual rhythm grid/)
  assert.match(openSourceAudit, /Chat \| Interaction density model/)
  assert.match(openSourceAudit, /Settings \| Structural density model/)
  assert.match(designChecklist, /Chat uses an interaction density model, not the Image4 voice-first four-part rhythm/)
  assert.match(designChecklist, /Settings use form-row density and hierarchy rules, not Image4 visual rhythm rows/)
  assert.match(image4Patterns, /do not extend this grid to chat or settings/)
})

test('design docs keep source-backed reference and visual-weight decisions explicit', () => {
  const openSourceAudit = readFileSync(join(ROOT, 'docs/OPEN_SOURCE_UI_REFERENCE_AUDIT.md'), 'utf8')
  const designChecklist = readFileSync(join(ROOT, 'docs/DESIGN_REVIEW_CHECKLIST.md'), 'utf8')
  const image4Patterns = readFileSync(join(ROOT, 'docs/IMAGE4_UI_REFERENCE_PATTERNS.md'), 'utf8')

  for (const reference of [
    'Open WebUI',
    'Chatbox',
    'Cherry Studio',
    'LobeHub',
    'Vercel Chatbot',
    'shadcn/ui',
    'Radix UI Primitives',
  ]) {
    assert.match(openSourceAudit, new RegExp(reference.replace('/', '\\/')))
  }

  assert.match(openSourceAudit, /Reference Evidence Snapshot/)
  assert.match(openSourceAudit, /Current upstream signal/)
  assert.match(openSourceAudit, /Borrow low-noise chat message density only/)
  assert.match(openSourceAudit, /Borrow structure and information organization only/)
  assert.match(openSourceAudit, /interaction state overlay/)
  assert.match(designChecklist, /Composer anchoring consistency/)
  assert.match(designChecklist, /Presence identity stabilization/)
  assert.match(designChecklist, /Cross-surface visual weight/)
  assert.match(designChecklist, /Streaming state can raise message\/tool-result weight/)
  assert.match(designChecklist, /Disabled send remains visually inert/)
  assert.match(openSourceAudit, /actions must stay secondary and disabled send must stay tertiary/)
  assert.match(image4Patterns, /Visual Weight Mapping/)
  assert.match(image4Patterns, /shared hierarchy, not shared layout/)
  assert.match(image4Patterns, /Settings\/integrations borrow structure only/)
  assert.match(image4Patterns, /Composer anchoring state stability/)
})
